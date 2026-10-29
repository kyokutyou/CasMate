using System.Security.AccessControl;
using System.Security.Principal;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallHostTests
{
    [Fact] public void ReadOnlySuccessAndMissingRulePreserveTheirElevationDecision()
    {
        Assert.True(DirectFirewallHost.TryReadOnly(() => true));
        Assert.False(DirectFirewallHost.TryReadOnly(() => false));
    }

    public static IEnumerable<object[]> AccessDeniedErrors()
    {
        yield return [new UnauthorizedAccessException()];
        yield return [new COMException("read denied", unchecked((int)0x80070005))];
        yield return [new COMException("WMI read denied", unchecked((int)0x80041003))];
        yield return [new Win32Exception(5)];
    }

    [Theory] [MemberData(nameof(AccessDeniedErrors))]
    public void BackendConnectionAndWrappedReadDenialsCanRequestElevation(Exception error)
    {
        Assert.False(DirectFirewallHost.TryReadOnly(() => throw error));
        Assert.False(DirectFirewallHost.TryReadOnly(() => throw new DirectFirewallException("failed", error)));
    }

    [Theory] [InlineData("ownership")] [InlineData("policy")] [InlineData("adapter")] [InlineData("cancelled")]
    public void KnownRefusalNeverBecomesAnElevationRequest(string code)
    {
        var error = new DirectFirewallException(code, new UnauthorizedAccessException());
        Assert.Same(error, Assert.Throws<DirectFirewallException>(() => DirectFirewallHost.TryReadOnly(() => throw error)));
    }

    [Fact] public void UnknownProviderFailureNeverBecomesAnElevationRequest()
    {
        foreach (var error in new Exception[] { new IOException("offline"), new COMException("unavailable", unchecked((int)0x80041001)), new Win32Exception(2), new DirectFirewallException("failed") })
            Assert.Same(error, Assert.Throws(error.GetType(), () => DirectFirewallHost.TryReadOnly(() => throw error)));
    }

    private const string OwnerProgram = @"C:\Program Files\CasMate\CasMate.exe";
    private const string WorkerProgram = @"C:\Program Files\CasMate\resources\pc-status-worker\CasMate.PcStatus.Worker.exe";
    private const string OutdoorProgram = @"C:\Program Files\CasMate\resources\outdoor-worker\casmate-outdoor-worker.exe";
    private static DirectFirewallGrant Grant() => new("d2354a19-7bcb-4a60-90ed-5e90e23e4b6c", "a2354a19-7bcb-4a60-90ed-5e90e23e4b6c",
        "0123456789abcdef01234567", OwnerProgram, "192.168.1.9", "tcp", 54321,
        "{856DB8BE-55DA-4F75-AC34-C1D4823486AD}", "イーサネット 2", "Private");
    private static DirectFirewallRequest Request() => new(1, "firewall", "allow", Grant(), 123);
    private static DirectFirewallJob Job(long now) => new(Request(), DateTime.UtcNow.Ticks, OwnerProgram,
        124, DateTime.UtcNow.Ticks, "S-1-5-21-100-200-300-1001", now + 60_000);
    private static void Error(string code, Action action) => Assert.Equal(code, Assert.Throws<DirectFirewallException>(action).Code);

    private static DirectFirewallRequest Batch() => Request() with
    {
        Grants = [Grant() with { Id = "e2354a19-7bcb-4a60-90ed-5e90e23e4b6c", Protocol = "udp", Program = OutdoorProgram, Port = 10001 }]
    };

    [Fact] public void BatchValidatesEveryTargetBeforeElevation()
    {
        var batch = Batch();
        DirectFirewallHost.ValidateRequest(batch); DirectFirewallHost.ValidateProgram(batch, OwnerProgram, WorkerProgram);
        Error("failed", () => DirectFirewallHost.ValidateRequest(batch with { Grants = [] }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(batch with { Grants = [Grant()] }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(batch with { Grants = Enumerable.Repeat(Grant(), 32).ToArray() }));
        Error("ownership", () => DirectFirewallHost.ValidateRequest(batch with { Grants = [batch.Grants![0] with { PcId = "b2354a19-7bcb-4a60-90ed-5e90e23e4b6c" }] }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(batch with { Grants = [batch.Grants![0] with { Address = "0.0.0.0" }] }));
        Error("ownership", () => DirectFirewallHost.ValidateProgram(batch with { Grants = [batch.Grants![0] with { Program = @"C:\Other.exe" }] }, OwnerProgram, WorkerProgram));
    }

    [Fact] public void BatchReadOnlyDistinguishesKnownRefusalAndNeedForElevation()
    {
        var batch = Batch(); var reads = new List<string>();
        var complete = DirectFirewallHost.ReadBatch(batch, grant => { reads.Add(grant.Id); return true; });
        Assert.True(complete!.Ok); Assert.Equal(2, reads.Count); Assert.Equal(2, complete.Results!.Length);
        Assert.Null(DirectFirewallHost.ReadBatch(batch, grant => grant.Protocol == "tcp"));
        var refused = DirectFirewallHost.ReadBatch(batch, grant => grant.Protocol == "tcp" ? true : throw new DirectFirewallException("policy"));
        Assert.False(refused!.Ok); Assert.True(refused.Results![0].Ok); Assert.Equal("policy", refused.Results[1].Error);
    }

    [Fact] public void BatchApplyKeepsIndependentResultsAndOneOperationKind()
    {
        var calls = new List<string>();
        var result = DirectFirewallHost.ApplyBatch(Batch(), () => true, (grant, action, live) =>
        {
            calls.Add(action); Assert.True(live());
            if (grant.Protocol == "udp") throw new DirectFirewallException("policy");
        });
        Assert.Equal(["allow", "allow"], calls); Assert.False(result.Ok);
        Assert.True(result.Results![0].Ok); Assert.Equal("policy", result.Results[1].Error);
        Assert.True(DirectFirewallHost.ValidResult(result, 2));
        Assert.False(DirectFirewallHost.ValidResult(result with { Ok = true }, 2));
        Assert.False(DirectFirewallHost.ValidResult(result, 3));
        Assert.False(DirectFirewallHost.ValidResult(new(1, true), 2));
        Assert.True(DirectFirewallHost.ValidResult(new(1, false, "cancelled"), 2));
    }

    [Fact] public void SlowOwnedRemovalDoesNotBlockAnotherTargetInTheSameBatch()
    {
        using var bothStarted = new CountdownEvent(2);
        var result = DirectFirewallHost.ApplyBatch(Batch() with { Action = "remove" }, () => true, (grant, action, _) =>
        {
            Assert.Equal("remove", action);
            bothStarted.Signal();
            if (!bothStarted.Wait(TimeSpan.FromSeconds(1))) throw new DirectFirewallException("failed");
            if (grant.Protocol == "udp") throw new DirectFirewallException("ownership");
        });
        Assert.True(result.Results![0].Ok);
        Assert.Equal("ownership", result.Results[1].Error);
    }

    [Fact] public void IndependentAllowConnectionsCanPrepareTogetherAndKeepPerTargetPolicyFailure()
    {
        using var bothStarted = new CountdownEvent(2);
        var result = DirectFirewallHost.ApplyBatch(Batch(), () => true, (grant, action, _) =>
        {
            Assert.Equal("allow", action); bothStarted.Signal();
            if (!bothStarted.Wait(TimeSpan.FromSeconds(1))) throw new DirectFirewallException("failed");
            if (grant.Protocol == "udp") throw new DirectFirewallException("policy");
        }, parallel: true);
        Assert.True(result.Results![0].Ok); Assert.Equal("policy", result.Results[1].Error);
    }

    [Fact] public void CancellingBatchRollsBackEarlierSuccessfulAllows()
    {
        var live = true; var calls = new List<string>();
        var result = DirectFirewallHost.ApplyBatch(Batch(), () => live, (grant, action, _) =>
        {
            calls.Add($"{action}:{grant.Protocol}");
            if (action == "allow" && grant.Protocol == "udp") { live = false; throw new DirectFirewallException("cancelled"); }
        });
        Assert.Equal(["allow:tcp", "allow:udp", "remove:tcp"], calls);
        Assert.All(result.Results!, item => { Assert.False(item.Ok); Assert.Equal("cancelled", item.Error); });
    }

    [Fact] public void CancellationRollsBackEverySuccessfulParallelTarget()
    {
        using var bothStarted = new CountdownEvent(2);
        var live = 1;
        var removed = new System.Collections.Concurrent.ConcurrentBag<string>();
        var result = DirectFirewallHost.ApplyBatch(Batch(), () => Volatile.Read(ref live) != 0, (grant, action, _) =>
        {
            if (action == "remove") { removed.Add(grant.Id); return; }
            bothStarted.Signal();
            if (!bothStarted.Wait(TimeSpan.FromSeconds(1))) throw new DirectFirewallException("failed");
            Volatile.Write(ref live, 0);
        }, parallel: true);
        Assert.Equal(2, removed.Count);
        Assert.All(result.Results!, item => { Assert.False(item.Ok); Assert.Equal("cancelled", item.Error); });
    }

    [Fact] public void ValidatesNarrowRequestProtocol()
    {
        DirectFirewallHost.ValidateRequest(Request());
        DirectFirewallHost.ValidateRequest(Request() with { Action = "remove" });
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { ProtocolVersion = 2 }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Type = "sample" }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { OwnerPid = 0 }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Action = "enable-any" }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Grant = Grant() with { Protocol = "Any" } }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Grant = Grant() with { Address = "0.0.0.0" } }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Grant = Grant() with { Profile = "Any" } }));
        Error("failed", () => DirectFirewallHost.ValidateRequest(Request() with { Grant = Grant() with { Program = "*" } }));
    }

    [Fact] public void TcpAllowBindsToExactCallingProgram()
    {
        DirectFirewallHost.ValidateProgram(Request(), OwnerProgram, WorkerProgram);
        DirectFirewallHost.ValidateProgram(Request() with { Grant = Grant() with { Program = OwnerProgram.ToUpperInvariant() } }, OwnerProgram, WorkerProgram);
        Error("ownership", () => DirectFirewallHost.ValidateProgram(Request() with { Grant = Grant() with { Program = OutdoorProgram } }, OwnerProgram, WorkerProgram));
        Error("ownership", () => DirectFirewallHost.ValidateProgram(Request(), @"C:\Other\CasMate.exe", WorkerProgram));
        Error("ownership", () => DirectFirewallHost.ValidateProgram(Request() with { Grant = Grant() with { Program = @"C:\Windows\System32\svchost.exe" } }, OwnerProgram, WorkerProgram));
    }

    [Fact] public void UdpAllowBindsToSiblingOutdoorWorker()
    {
        var udp = Request() with { Grant = Grant() with { Protocol = "udp", Program = OutdoorProgram } };
        DirectFirewallHost.ValidateProgram(udp, OwnerProgram, WorkerProgram);
        Error("ownership", () => DirectFirewallHost.ValidateProgram(udp with { Grant = udp.Grant with { Program = OwnerProgram } }, OwnerProgram, WorkerProgram));
        Error("ownership", () => DirectFirewallHost.ValidateProgram(udp with { Grant = udp.Grant with { Program = WorkerProgram } }, OwnerProgram, WorkerProgram));
        Error("ownership", () => DirectFirewallHost.ValidateProgram(udp with { Grant = udp.Grant with { Program = @"C:\Other\resources\outdoor-worker\casmate-outdoor-worker.exe" } }, OwnerProgram, WorkerProgram));
    }

    [Fact] public void RemovalCanCloseExactOwnedRulesFromPreviousInstallation()
    {
        var old = Request() with { Action = "remove", Grant = Grant() with { Program = @"C:\Old CasMate\CasMate.exe" } };
        DirectFirewallHost.ValidateRequest(old);
        DirectFirewallHost.ValidateProgram(old, OwnerProgram, WorkerProgram);
        Error("failed", () => DirectFirewallHost.ValidateRequest(old with { Grant = old.Grant with { Program = "CasMate.exe" } }));
    }

    [Fact] public void ValidatesManagerOwnerAndBoundedJobLifetime()
    {
        const long now = 1_800_000_000_000;
        var job = Job(now);
        DirectFirewallHost.ValidateJob(job, WorkerProgram, now);
        DirectFirewallHost.ValidateJob(job with { Deadline = now + 120_000 }, WorkerProgram, now);
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { Deadline = now - 1 }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { Deadline = now + 120_001 }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { ManagerPid = 0 }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { ManagerStarted = 0 }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { OwnerStarted = 0 }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { OwnerProgram = "CasMate.exe" }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { UserSid = "Everyone" }, WorkerProgram, now));
        Error("failed", () => DirectFirewallHost.ValidateJob(job with { Request = job.Request with { ProtocolVersion = 2 } }, WorkerProgram, now));
        Error("ownership", () => DirectFirewallHost.ValidateJob(job with { OwnerProgram = @"C:\another.exe" }, WorkerProgram, now));
        Error("ownership", () => DirectFirewallHost.ValidateJob(job with { Request = job.Request with { Grant = job.Request.Grant with { Program = OutdoorProgram } } }, WorkerProgram, now));
    }

    [Fact] public void ProtectedJobDirectoryGrantsOnlyCurrentUserSystemAndAdministrators()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var identity = WindowsIdentity.GetCurrent(); var sid = identity.User!.Value;
        var directory = DirectFirewallHost.CreateDirectory(sid);
        try
        {
            DirectFirewallHost.ValidateDirectory(directory, sid);
            var security = new DirectoryInfo(directory).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);
            Assert.True(security.AreAccessRulesProtected);
            Assert.Equal(sid, security.GetOwner(typeof(SecurityIdentifier))!.Value);
            var actual = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
                .Select(rule => rule.IdentityReference.Value).ToHashSet(StringComparer.Ordinal);
            Assert.True(actual.SetEquals([sid, "S-1-5-18", "S-1-5-32-544"]));
            // Child job files inherit the protected directory's restricted grants.
            var path = Path.Combine(directory, "job.json"); File.WriteAllText(path, "{}");
            var child = new FileInfo(path).GetAccessControl(AccessControlSections.Access);
            var childSids = child.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
                .Select(rule => rule.IdentityReference.Value).ToHashSet(StringComparer.Ordinal);
            Assert.True(childSids.SetEquals(actual));
            Error("failed", () => DirectFirewallHost.ValidateDirectory(directory, "S-1-5-18"));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact] public void OrdinaryUnprotectedFolderCannotAuthorizeElevatedWork()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var identity = WindowsIdentity.GetCurrent(); var sid = identity.User!.Value;
        var directory = Path.Combine(Path.GetTempPath(), "casmate-firewall-host-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var security = new DirectoryInfo(directory).GetAccessControl();
            security.SetAccessRuleProtection(false, true);
            new DirectoryInfo(directory).SetAccessControl(security);
            Error("failed", () => DirectFirewallHost.ValidateDirectory(directory, sid));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Theory] [InlineData("extraUser")] [InlineData("missingSystem")] [InlineData("denyRule")]
    [InlineData("incompleteRights")] [InlineData("wrongInheritance")]
    public void RejectsTamperedDirectorySecurity(string change)
    {
        if (!OperatingSystem.IsWindows()) return;
        using var identity = WindowsIdentity.GetCurrent(); var sid = identity.User!.Value;
        var directory = DirectFirewallHost.CreateDirectory(sid);
        var initial = new DirectoryInfo(directory).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);
        try
        {
            var security = new DirectoryInfo(directory).GetAccessControl(AccessControlSections.Access);
            var inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            if (change == "missingSystem")
                security.PurgeAccessRules(new SecurityIdentifier("S-1-5-18"));
            else if (change == "incompleteRights")
            {
                security.PurgeAccessRules(new SecurityIdentifier("S-1-5-18"));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-18"), FileSystemRights.Read, inherit,
                    PropagationFlags.None, AccessControlType.Allow));
            }
            else if (change == "wrongInheritance")
            {
                security.PurgeAccessRules(new SecurityIdentifier("S-1-5-18"));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-18"), FileSystemRights.FullControl,
                    InheritanceFlags.None, PropagationFlags.None, AccessControlType.Allow));
            }
            else security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-1-0"),
                change == "denyRule" ? FileSystemRights.Delete : FileSystemRights.FullControl, inherit, PropagationFlags.None,
                change == "denyRule" ? AccessControlType.Deny : AccessControlType.Allow));
            new DirectoryInfo(directory).SetAccessControl(security);
            Error("failed", () => DirectFirewallHost.ValidateDirectory(directory, sid));
        }
        finally
        {
            new DirectoryInfo(directory).SetAccessControl(initial);
            Directory.Delete(directory, true);
        }
    }
}
