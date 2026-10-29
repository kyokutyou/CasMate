using Xunit;
using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallServiceTests
{
    private const string Sid = "S-1-5-21-100-200-300-1001";
    private const string Owner = @"C:\CasMate\CasMate.exe";
    private const string Worker = @"C:\CasMate\resources\pc-status-worker\CasMate.PcStatus.Worker.exe";
    private const string Pc = "a2354a19-7bcb-4a60-90ed-5e90e23e4b6c";
    private const long Now = 1_800_000_000_000;
    private static DirectFirewallGrant Grant() => new("d2354a19-7bcb-4a60-90ed-5e90e23e4b6c", Pc,
        "0123456789abcdef01234567", Owner, "192.168.1.9", "tcp", 54321,
        "{856DB8BE-55DA-4F75-AC34-C1D4823486AD}", "イーサネット", "Private");
    private static DirectFirewallJob Job() => new(new(1, "firewall", "allow", Grant(), 123), 100, Owner, 124, 101, Sid, Now + 60_000);
    private static DirectFirewallServiceConfig Config() => new(1, Sid, Pc, Owner, Worker, new string('a', 64));

    [Fact] public async Task FirstSetupThenRepeatedOnOffAndRestartUseServiceWithoutElevation()
    {
        var installed = false; var setups = 0; var calls = 0;
        // Each iteration represents a new short-lived native host, including app restart.
        foreach (var action in new[] { "allow", "remove", "allow", "remove", "allow" })
        {
            var result = await DirectFirewallService.WithSetup(() => installed,
                () => { setups++; installed = true; return Task.CompletedTask; },
                () => { calls++; Assert.Contains(action, new[] { "allow", "remove" }); return Task.FromResult(new DirectFirewallResult(1, true)); });
            Assert.True(result.Ok);
        }
        Assert.Equal(1, setups); Assert.Equal(5, calls);
    }

    [Fact] public async Task RefusedSetupOrBrokenServiceNeverFallsBackToPerOperationUac()
    {
        var setups = 0; var calls = 0;
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => DirectFirewallService.WithSetup(() => false,
            () => { setups++; throw new UnauthorizedAccessException(); },
            () => { calls++; return Task.FromResult(new DirectFirewallResult(1, true)); }));
        Assert.Equal(1, setups); Assert.Equal(0, calls);
        await Assert.ThrowsAsync<IOException>(() => DirectFirewallService.WithSetup(() => true,
            () => { setups++; return Task.CompletedTask; }, () => throw new IOException()));
        Assert.Equal(1, setups);
    }

    [Fact] public void ServiceAcceptsOnlyPinnedLocalUserPcAndActualCallingProcess()
    {
        DirectFirewallService.ValidateClient(Config(), Job(), 124, Sid, Worker, 123, Now);
        foreach (var job in new[] { Job() with { UserSid = "S-1-5-18" }, Job() with { ManagerPid = 125 },
            Job() with { OwnerProgram = @"C:\Other.exe" }, Job() with { Deadline = Now - 1 },
            Job() with { Request = Job().Request with { Grant = Grant() with { PcId = "b2354a19-7bcb-4a60-90ed-5e90e23e4b6c" } } } })
            Assert.Throws<DirectFirewallException>(() => DirectFirewallService.ValidateClient(Config(), job, 124, Sid, Worker, 123, Now));
        Assert.Throws<DirectFirewallException>(() => DirectFirewallService.ValidateClient(Config(), Job(), 124, "S-1-5-18", Worker, 123, Now));
        Assert.Throws<DirectFirewallException>(() => DirectFirewallService.ValidateClient(Config(), Job(), 124, Sid, @"C:\Forged.exe", 123, Now));
        Assert.Throws<DirectFirewallException>(() => DirectFirewallService.ValidateClient(Config(), Job(), 124, Sid, Worker, 999, Now));
    }

    [Fact] public void AllTargetsAreValidatedAndArbitraryProgramsAndOperationsAreRejected()
    {
        foreach (var request in new[] {
            Job().Request with { Action = "execute" },
            Job().Request with { Grant = Grant() with { Program = @"C:\Windows\System32\cmd.exe" } },
            Job().Request with { Grants = [Grant() with { Id = "e2354a19-7bcb-4a60-90ed-5e90e23e4b6c", Program = @"C:\Other.exe" }] },
            Job().Request with { Grant = Grant() with { Address = "0.0.0.0" } } })
            Assert.Throws<DirectFirewallException>(() => DirectFirewallService.ValidateClient(Config(), Job() with { Request = request }, 124, Sid, Worker, 123, Now));
    }

    [Fact] public void OldOwnedRuleRemovalRemainsPossibleAfterApplicationUpdate()
    {
        var request = Job().Request with { Action = "remove", Grant = Grant() with { Program = @"C:\Old\CasMate.exe" } };
        DirectFirewallService.ValidateClient(Config(), Job() with { Request = request }, 124, Sid, Worker, 123, Now);
    }

    [Fact] public void SetupIdentityIsStableButCodeOrApprovedApplicationChangesRequireSetup()
    {
        var config = Config();
        Assert.True(DirectFirewallService.Compatible(config, config with { WorkerProgram = Worker.ToUpperInvariant() }));
        Assert.False(DirectFirewallService.Compatible(config, config with { Fingerprint = new string('b', 64) }));
        Assert.False(DirectFirewallService.Compatible(config, config with { OwnerProgram = @"C:\New\CasMate.exe" }));
        Assert.False(DirectFirewallService.Compatible(config, config with { PcId = Guid.NewGuid().ToString() }));
        Assert.NotEqual(DirectFirewallService.Identity(Sid), DirectFirewallService.Identity("S-1-5-18"));
        Assert.Equal(DirectFirewallService.Identity(Sid), DirectFirewallService.Identity(config.UserSid));
    }

    [Fact] public void PublishedFingerprintAvoidsRuntimeReadsButElevatedInstallationAlwaysVerifiesBytes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "casmate-fingerprint-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var worker = Path.Combine(directory, "worker.exe"); var manifest = Path.Combine(directory, "service-runtime.sha256");
        try
        {
            File.WriteAllText(worker, "runtime");
            var actual = DirectFirewallService.Fingerprint(directory);
            File.WriteAllText(manifest, new string('a', 64) + "\n");
            Assert.Equal(new string('a', 64), DirectFirewallService.Expected(Job(), worker).Fingerprint);
            Assert.Equal(actual, DirectFirewallService.Expected(Job(), worker, verifyRuntime: true).Fingerprint);
            File.Delete(manifest);
            Assert.Equal(actual, DirectFirewallService.Expected(Job(), worker).Fingerprint);
        }
        finally { File.Delete(worker); File.Delete(manifest); Directory.Delete(directory); }
    }

    [Fact] public void ScmAbsenceCanBeQueriedWithoutInstallingOrElevating()
    {
        Assert.Equal(0u, WindowsFirewallServiceHost.State("CasMate.Test.Absent." + Guid.NewGuid().ToString("N")));
    }

    [Fact] public void UserOwnedRuntimeCannotBeTrustedAsPrivilegedServiceLocation()
    {
        var directory = Path.Combine(Path.GetTempPath(), "casmate-service-acl-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var security = new DirectoryInfo(directory).GetAccessControl();
            security.SetOwner(WindowsIdentity.GetCurrent().User!);
            new DirectoryInfo(directory).SetAccessControl(security);
            Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => DirectFirewallServiceSetup.ValidateProtectedDirectory(directory)).Code);
        }
        finally { Directory.Delete(directory); }
    }

    [Fact] public void InterruptedRuntimeCopyCanBeRepairedWithoutManualCleanup()
    {
        var directory = Path.Combine(Path.GetTempPath(), "casmate-service-copy-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var source = Path.Combine(directory, "source.dll"); var target = Path.Combine(directory, "installed.dll");
        try
        {
            File.WriteAllText(source, "complete runtime image"); File.WriteAllText(target, "truncated");
            DirectFirewallServiceSetup.CopyRuntimeFile(source, target);
            Assert.Equal(File.ReadAllBytes(source), File.ReadAllBytes(target));
            DirectFirewallServiceSetup.CopyRuntimeFile(source, target);
            Assert.Equal(File.ReadAllBytes(source), File.ReadAllBytes(target));
            Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
        }
        finally { File.Delete(source); File.Delete(target); Directory.Delete(directory); }
    }

    [Fact] public void PipeAclAllowsOnlyLocalApprovedUserAndSystem()
    {
        var acl = DirectFirewallService.PipeSecurityFor(Sid);
        var rules = acl.GetAccessRules(true, false, typeof(SecurityIdentifier)).Cast<PipeAccessRule>().ToArray();
        Assert.True(acl.AreAccessRulesProtected);
        Assert.Contains(rules, rule => rule.IdentityReference.Value == "S-1-5-2" && rule.AccessControlType == AccessControlType.Deny);
        Assert.Equal(new[] { "S-1-5-18", Sid }, rules.Where(rule => rule.AccessControlType == AccessControlType.Allow).Select(rule => rule.IdentityReference.Value).Order().ToArray());
        var user = Assert.Single(rules, rule => rule.IdentityReference.Value == Sid);
        Assert.Equal((PipeAccessRights)0, user.PipeAccessRights & (PipeAccessRights.CreateNewInstance | PipeAccessRights.ChangePermissions | PipeAccessRights.TakeOwnership));
    }

    [Fact] public void UninstallIsIdempotentAfterReinstallWithoutDirectUseAndPreservesOtherInstallation()
    {
        Assert.True(DirectFirewallServiceSetup.NeedsRemoval(Config(), Worker, 4));
        Assert.False(DirectFirewallServiceSetup.NeedsRemoval(null, Worker, 0));
        Assert.False(DirectFirewallServiceSetup.NeedsRemoval(null, Worker, 0));
        var moved = Config() with { WorkerProgram = @"C:\New Location\resources\pc-status-worker\CasMate.PcStatus.Worker.exe" };
        Assert.False(DirectFirewallServiceSetup.NeedsRemoval(moved, Worker, 4));
        Assert.True(DirectFirewallServiceSetup.NeedsRemoval(moved, moved.WorkerProgram, 4));
        Assert.Throws<DirectFirewallException>(() => DirectFirewallServiceSetup.NeedsRemoval(null, Worker, 4));
    }

    [Fact] public async Task BoundedReaderRejectsOversizedOrTruncatedMessages()
    {
        Assert.Equal("hello", await DirectFirewallService.ReadLine(new StringReader("hello\r\n"), CancellationToken.None));
        await Assert.ThrowsAsync<DirectFirewallException>(() => DirectFirewallService.ReadLine(new StringReader(new string('x', 65537) + "\n"), CancellationToken.None));
        await Assert.ThrowsAsync<DirectFirewallException>(() => DirectFirewallService.ReadLine(new StringReader("{}"), CancellationToken.None));
    }

    [Theory] [InlineData("complete", false)] [InlineData("cancel", true)] [InlineData(null, true)]
    public async Task RealPipeAuthenticatesClientAndRollsBackUnacknowledgedAllow(string? acknowledgement, bool rollback)
    {
        using var current = Process.GetCurrentProcess();
        var parentPid = DirectFirewallHost.ParentPid(current.Id);
        using var parent = Process.GetProcessById(parentPid);
        var ownerProgram = DirectFirewallService.ProcessProgram(parentPid);
        var workerProgram = Environment.ProcessPath!;
        var sid = WindowsIdentity.GetCurrent().User!.Value;
        var config = Config() with { UserSid = sid, OwnerProgram = ownerProgram, WorkerProgram = workerProgram };
        var job = Job() with { UserSid = sid, OwnerProgram = ownerProgram, ManagerPid = current.Id, ManagerStarted = current.StartTime.ToUniversalTime().Ticks,
            OwnerStarted = parent.StartTime.ToUniversalTime().Ticks, Deadline = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5_000,
            Request = Job().Request with { OwnerPid = parentPid, Grant = Grant() with { Program = ownerProgram } } };
        var name = "casmate-service-test-" + Guid.NewGuid().ToString("N");
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        stop.CancelAfter(TimeSpan.FromSeconds(8));
        var acl = DirectFirewallService.PipeSecurityFor(sid);
        // The production service runs as SYSTEM. Tests retain its client ACL while using the test identity as owner.
        acl.SetOwner(new SecurityIdentifier(sid));
        using var server = NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, acl);
        using var client = DirectFirewallService.CreateClient(name);
        var actions = new List<string>();
        var handle = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync(stop.Token);
            await DirectFirewallService.Handle(server, config, stop.Token, (request, live) =>
            { actions.Add(request.Action); Assert.True(live()); return new(1, true); });
        }, stop.Token);
        await client.ConnectAsync(stop.Token);
        using var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true };
        using var reader = new StreamReader(client, leaveOpen: true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(job, DirectFirewallService.Json));
        var response = JsonSerializer.Deserialize<DirectFirewallResult>(await DirectFirewallService.ReadLine(reader, stop.Token), DirectFirewallService.Json);
        Assert.True(response!.Ok);
        if (acknowledgement is null) { writer.Dispose(); client.Dispose(); }
        else
        {
            await writer.WriteLineAsync(acknowledgement);
            Assert.Equal(rollback ? "cancelled" : "committed", await DirectFirewallService.ReadLine(reader, stop.Token));
            writer.Dispose(); client.Dispose();
        }
        await handle.WaitAsync(stop.Token);
        Assert.Equal(rollback ? new[] { "allow", "remove" } : ["allow"], actions);
    }
}
