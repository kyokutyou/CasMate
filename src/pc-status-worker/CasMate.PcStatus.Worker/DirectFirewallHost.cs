using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace CasMate.PcStatus.Worker;

internal sealed record DirectFirewallRequest(int ProtocolVersion, string Type, string Action, DirectFirewallGrant Grant, int OwnerPid, DirectFirewallGrant[]? Grants = null);
internal sealed record DirectFirewallJob(DirectFirewallRequest Request, long OwnerStarted, string OwnerProgram,
    int ManagerPid, long ManagerStarted, string UserSid, long Deadline);
internal sealed record DirectFirewallResult(int ProtocolVersion, bool Ok, string? Error = null, DirectFirewallResult[]? Results = null);

internal static class DirectFirewallHost
{
    private const int Limit = 65_536;
    private const string Prefix = "casmate-direct-firewall-native-";
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow
    };

    public static async Task Run()
    {
        DirectFirewallResult result;
        try
        {
            var line = await ReadBounded(Console.In);
            var request = JsonSerializer.Deserialize<DirectFirewallRequest>(line, Json) ?? throw new DirectFirewallException("failed");
            ValidateRequest(request);
            if (ParentPid(Environment.ProcessId) != request.OwnerPid) throw new DirectFirewallException("failed");
            using var owner = Process.GetProcessById(request.OwnerPid);
            var ownerStarted = owner.StartTime.ToUniversalTime().Ticks;
            var ownerProgram = owner.MainModule?.FileName ?? throw new DirectFirewallException("failed");
            ValidateProgram(request, ownerProgram, Environment.ProcessPath!);
            var deadline = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 120_000;
            var job = new DirectFirewallJob(request, ownerStarted, ownerProgram, Environment.ProcessId,
                Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks, WindowsIdentity.GetCurrent().User!.Value, deadline);
            var cancelled = 0;
            string? directory = null;
            _ = Task.Run(() => WatchCancel(() =>
            {
                Interlocked.Exchange(ref cancelled, 1);
                var path = Volatile.Read(ref directory);
                if (path is not null) { try { File.WriteAllText(Path.Combine(path, "cancel"), "cancel"); } catch { } }
            }));
            bool Live() => Volatile.Read(ref cancelled) == 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() <= deadline &&
                ProcessMatches(request.OwnerPid, ownerStarted, ownerProgram);
            if (!Live()) throw new DirectFirewallException("cancelled");
            var expected = DirectFirewallService.Expected(job, Environment.ProcessPath!);
            var id = DirectFirewallService.Identity(job.UserSid);
            if (DirectFirewallService.Installed(id, expected)) result = await DirectFirewallService.Call(id, job, Live);
            else
            {
                var readResult = ReadBatch(request, grant => TryReadOnly(() =>
                {
                    using var backend = new CimDirectFirewall();
                    return new DirectFirewall(backend).TryReadOnly(grant, request.Action, Live);
                }));
                if (readResult is not null) result = readResult;
                else
                {
                    result = await DirectFirewallService.WithSetup(() => DirectFirewallService.Installed(id, expected), async () =>
                    {
                        if (IsAdministrator()) { DirectFirewallServiceSetup.Install(job, Live); return; }
                        directory = CreateDirectory(job.UserSid);
                        try
                        {
                            var bytes = JsonSerializer.SerializeToUtf8Bytes(job, Json);
                            var path = Path.Combine(directory, "job.json");
                            using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) file.Write(bytes);
                            if (!Live()) throw new DirectFirewallException("cancelled");
                            var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                            start.ArgumentList.Add("--direct-firewall-elevated"); start.ArgumentList.Add(path);
                            start.ArgumentList.Add(Convert.ToHexStringLower(SHA256.HashData(bytes)));
                            using var elevated = Process.Start(start) ?? throw new DirectFirewallException("failed");
                            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Max(1, deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())));
                            try { await elevated.WaitForExitAsync(timeout.Token); }
                            catch (OperationCanceledException) { File.WriteAllText(Path.Combine(directory, "cancel"), "cancel"); throw new DirectFirewallException("cancelled"); }
                            var responsePath = Path.Combine(directory, "result.json");
                            if (elevated.ExitCode != 0 || !File.Exists(responsePath)) throw new DirectFirewallException("failed");
                            var setupResult = JsonSerializer.Deserialize<DirectFirewallResult>(ReadFile(responsePath), Json) ?? throw new DirectFirewallException("failed");
                            if (!ValidResult(setupResult, 1))
                                throw new DirectFirewallException("failed");
                            if (!setupResult.Ok) throw new DirectFirewallException(setupResult.Error ?? "failed");
                        }
                        finally
                        {
                            // A delayed helper cannot operate after its protected request is removed.
                            try { Directory.Delete(directory, true); } catch { }
                        }
                    }, () => DirectFirewallService.Call(id, job, Live));
                }
                }
        }
        catch (Win32Exception error) when (error.NativeErrorCode == 1223) { result = new(1, false, "cancelled"); }
        catch (DirectFirewallException error) { result = new(1, false, error.Code); }
        catch { result = new(1, false, "failed"); }
        Console.WriteLine(JsonSerializer.Serialize(result, Json));
    }

    // Reading the policy store can itself require elevation. This is not evidence
    // of a missing or effective rule: Apply must recheck the entire scope after UAC.
    internal static bool TryReadOnly(Func<bool> read)
    {
        try { return read(); }
        catch (Exception error) when (ReadAccessDenied(error)) { return false; }
    }

    private static bool ReadAccessDenied(Exception error) => error switch
    {
        UnauthorizedAccessException => true,
        COMException com => com.HResult is unchecked((int)0x80070005) or unchecked((int)0x80041003),
        Win32Exception win32 => win32.NativeErrorCode == 5,
        DirectFirewallException { Code: "failed", InnerException: { } inner } => ReadAccessDenied(inner),
        _ => false
    };

    public static void RunElevated(string path, string digest)
    {
        // No result is written until the job location, ACL and immutable bytes are trusted.
        string? directory = null;
        try
        {
            if (!IsAdministrator() || !System.Text.RegularExpressions.Regex.IsMatch(digest, "\\A[a-f0-9]{64}\\z")) return;
            path = Path.GetFullPath(path);
            directory = Path.GetDirectoryName(path)!;
            if (Path.GetFileName(path) != "job.json" || !Path.GetFileName(directory).StartsWith(Prefix, StringComparison.Ordinal) ||
                HasReparsePoint(directory) || HasReparsePoint(path)) return;
            using var locks = LockDirectoryPath(directory);
            var bytes = ReadFile(path);
            if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes), Convert.FromHexString(digest))) return;
            var job = JsonSerializer.Deserialize<DirectFirewallJob>(bytes, Json) ?? throw new DirectFirewallException("failed");
            ValidateRequest(job.Request);
            ValidateJob(job, Environment.ProcessPath!, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            ValidateDirectory(directory, job.UserSid);
            if (!ProcessMatches(job.ManagerPid, job.ManagerStarted, Environment.ProcessPath!) || ProcessSid(job.ManagerPid) != job.UserSid) return;
            var trustedDirectory = directory;
            bool Live() => File.Exists(path) && !File.Exists(Path.Combine(trustedDirectory, "cancel")) &&
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() <= job.Deadline &&
                ProcessMatches(job.ManagerPid, job.ManagerStarted, Environment.ProcessPath!) &&
                ProcessMatches(job.Request.OwnerPid, job.OwnerStarted, job.OwnerProgram);
            DirectFirewallResult result;
            try
            {
                if (!Live()) throw new DirectFirewallException("cancelled");
                DirectFirewallServiceSetup.Install(job, Live);
                result = new(1, true);
            }
            catch (DirectFirewallException error) { result = new(1, false, error.Code); }
            catch { result = new(1, false, "failed"); }
            // Never overwrite a path supplied or precreated by the requesting user.
            using var output = new FileStream(Path.Combine(directory, "result.json"), FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            output.Write(JsonSerializer.SerializeToUtf8Bytes(result, Json));
        }
        catch { /* An untrusted or unavailable request cannot authorize a mutation. */ }
    }

    internal static void ValidateRequest(DirectFirewallRequest request)
    {
        if (request.ProtocolVersion != 1 || request.Type != "firewall" || request.OwnerPid < 1) throw new DirectFirewallException("failed");
        DirectFirewall.Validate(request.Grant, request.Action);
        if (request.Grants is { Length: < 1 or > 31 }) throw new DirectFirewallException("failed");
        var grants = AllGrants(request);
        if (grants.Select(grant => grant.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != grants.Length)
            throw new DirectFirewallException("failed");
        foreach (var grant in grants)
        {
            DirectFirewall.Validate(grant, request.Action);
            if (grant.PcId != request.Grant.PcId) throw new DirectFirewallException("ownership");
        }
    }
    internal static void ValidateProgram(DirectFirewallRequest request, string ownerProgram, string workerProgram)
    {
        if (request.Action == "remove") return; // Old owned rules may refer to a previous installed executable.
        foreach (var grant in AllGrants(request))
        {
            var expected = grant.Protocol == "tcp" ? ownerProgram :
                Path.GetFullPath(Path.Combine(Path.GetDirectoryName(workerProgram)!, "..", "outdoor-worker", "casmate-outdoor-worker.exe"));
            if (!string.Equals(Path.GetFullPath(grant.Program), Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase))
                throw new DirectFirewallException("ownership");
        }
    }
    private static DirectFirewallGrant[] AllGrants(DirectFirewallRequest request) => [request.Grant, .. request.Grants ?? []];
    private static DirectFirewallResult Aggregate(DirectFirewallResult[] results) => results.Length == 1 ? results[0] :
        new(1, results.All(result => result.Ok), Results: results);
    internal static DirectFirewallResult? ReadBatch(DirectFirewallRequest request, Func<DirectFirewallGrant, bool> read)
    {
        var needsElevation = false;
        var results = AllGrants(request).Select(grant =>
        {
            try { if (!read(grant)) needsElevation = true; return new DirectFirewallResult(1, true); }
            catch (DirectFirewallException error) { return new DirectFirewallResult(1, false, error.Code); }
            catch { return new DirectFirewallResult(1, false, "failed"); }
        }).ToArray();
        return needsElevation ? null : Aggregate(results);
    }
    internal static DirectFirewallResult ApplyBatch(DirectFirewallRequest request, Func<bool> live,
        Action<DirectFirewallGrant, string, Func<bool>>? apply = null, bool parallel = false)
    {
        apply ??= (grant, action, isLive) =>
        {
            using var backend = new CimDirectFirewall();
            new DirectFirewall(backend).Apply(grant, action, isLive);
        };
        var grants = AllGrants(request);
        var results = new DirectFirewallResult[grants.Length];
        void ApplyTarget(int index)
        {
            try { apply(grants[index], request.Action, live); results[index] = new(1, true); }
            catch (DirectFirewallException error) { results[index] = new(1, false, error.Code); }
            catch { results[index] = new(1, false, "failed"); }
        }
        if (request.Action == "remove" || parallel) Parallel.For(0, grants.Length, new ParallelOptions { MaxDegreeOfParallelism = 4 }, ApplyTarget);
        else for (var i = 0; i < grants.Length; i++) ApplyTarget(i);
        if (request.Action == "allow" && !live())
            for (var i = 0; i < grants.Length; i++) if (results[i].Ok)
            {
                try { apply(grants[i], "remove", live); results[i] = new(1, false, "cancelled"); }
                catch { results[i] = new(1, false, "failed"); }
            }
        return Aggregate(results);
    }
    internal static bool ValidResult(DirectFirewallResult result, int count) => result.ProtocolVersion == 1 &&
        result.Error is null or "cancelled" or "ownership" or "policy" or "adapter" or "failed" && !(result.Ok && result.Error is not null) &&
        (result.Results is null ? count == 1 || !result.Ok && result.Error is not null : count > 1 && result.Error is null && result.Results.Length == count &&
            result.Results.All(item => item.Results is null && ValidResult(item, 1)) && result.Ok == result.Results.All(item => item.Ok));
    internal static void ValidateJob(DirectFirewallJob job, string workerProgram, long now)
    {
        ValidateRequest(job.Request);
        if (job.ManagerPid < 1 || job.ManagerStarted < 1 || job.OwnerStarted < 1 || job.Deadline < now || job.Deadline > now + 120_000 ||
            string.IsNullOrEmpty(job.OwnerProgram) || !Path.IsPathFullyQualified(job.OwnerProgram) || !ValidSid(job.UserSid))
            throw new DirectFirewallException("failed");
        ValidateProgram(job.Request, job.OwnerProgram, workerProgram);
    }
    internal static string CreateDirectory(string userSid)
    {
        var directory = Path.Combine(Path.GetTempPath(), Prefix + Guid.NewGuid().ToString("N"));
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        var user = new SecurityIdentifier(userSid);
        security.SetOwner(user);
        foreach (var sid in AllowedSids(userSid)) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        FileSystemAclExtensions.CreateDirectory(security, directory);
        return directory;
    }
    internal static void ValidateDirectory(string directory, string userSid)
    {
        var security = new DirectoryInfo(directory).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);
        if (!security.AreAccessRulesProtected || security.GetOwner(typeof(SecurityIdentifier))?.Value != userSid) throw new DirectFirewallException("failed");
        var allowed = AllowedSids(userSid).ToHashSet(StringComparer.Ordinal);
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow || !allowed.Contains(rule.IdentityReference.Value) || rule.IsInherited ||
                (rule.FileSystemRights & FileSystemRights.FullControl) != FileSystemRights.FullControl ||
                rule.InheritanceFlags != (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit) || rule.PropagationFlags != PropagationFlags.None)
                throw new DirectFirewallException("failed");
            found.Add(rule.IdentityReference.Value);
        }
        if (!found.SetEquals(allowed)) throw new DirectFirewallException("failed");
    }
    private static string[] AllowedSids(string userSid) => [userSid, "S-1-5-18", "S-1-5-32-544"];
    private static bool ValidSid(string value) { try { return new SecurityIdentifier(value).Value == value; } catch { return false; } }
    private static bool HasReparsePoint(string path)
    {
        for (var current = path; current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        return false;
    }
    internal static void RejectReparsePoints(string path) { if (HasReparsePoint(path)) throw new DirectFirewallException("ownership"); }
    internal sealed class DirectoryLocks(List<SafeFileHandle> handles) : IDisposable
    {
        public void Dispose() { foreach (var handle in handles) handle.Dispose(); }
    }
    // Deny rename/deletion of every path component until the elevated write ends.
    // Opening reparse points themselves makes a raced-in junction fail validation.
    internal static DirectoryLocks LockDirectoryPath(string directory)
    {
        var handles = new List<SafeFileHandle>();
        try
        {
            var paths = new List<string>();
            for (var current = directory; current is not null; current = Path.GetDirectoryName(current)) paths.Add(current);
            paths.Reverse();
            foreach (var current in paths)
            {
                var handle = CreateFileW(current, 0x80, 3, 0, 3, 0x02200000, 0);
                if (handle.IsInvalid) { handle.Dispose(); throw new DirectFirewallException("failed"); }
                handles.Add(handle);
                if (!GetFileInformationByHandleEx(handle, 9, out var attributes, (uint)Marshal.SizeOf<FileAttributeTag>()) ||
                    (attributes.Attributes & (uint)FileAttributes.ReparsePoint) != 0) throw new DirectFirewallException("failed");
            }
            return new DirectoryLocks(handles);
        }
        catch { foreach (var handle in handles) handle.Dispose(); throw; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileAttributeTag { public uint Attributes, ReparseTag; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, nint security, uint creation, uint flags, nint template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int informationClass, out FileAttributeTag attributes, uint size);
    private static byte[] ReadFile(string path)
    {
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > Limit) throw new DirectFirewallException("failed");
        var bytes = new byte[(int)file.Length]; file.ReadExactly(bytes); return bytes;
    }
    private static async Task<string> ReadBounded(TextReader input)
    {
        var text = new StringBuilder(); var buffer = new char[1];
        while (await input.ReadAsync(buffer.AsMemory()) != 0)
        {
            if (buffer[0] == '\n') return text.ToString().TrimEnd('\r');
            if (text.Length >= Limit) throw new DirectFirewallException("failed");
            text.Append(buffer[0]);
        }
        throw new DirectFirewallException("cancelled");
    }
    private static async Task WatchCancel(Action cancel)
    {
        try
        {
            var line = await ReadBounded(Console.In);
            using var value = JsonDocument.Parse(line);
            if (value.RootElement.GetProperty("protocolVersion").GetInt32() == 1 && value.RootElement.GetProperty("type").GetString() == "cancel") cancel();
            else cancel();
        }
        catch { cancel(); }
    }
    private static bool IsAdministrator() => new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    internal static bool ProcessMatches(int pid, long started, string program)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == started &&
                string.Equals(process.MainModule?.FileName, program, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }
    internal static int ParentPid(int pid)
    {
        var snapshot = Native.CreateToolhelp32Snapshot(2, 0);
        if (snapshot == -1) throw new DirectFirewallException("failed");
        try
        {
            var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>(), Name = "" };
            if (Native.Process32FirstW(snapshot, ref entry)) do { if (entry.Pid == pid) return (int)entry.ParentPid; } while (Native.Process32NextW(snapshot, ref entry));
            throw new DirectFirewallException("failed");
        }
        finally { Native.CloseHandle(snapshot); }
    }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(nint process, uint access, out nint token);
    internal static string ProcessSid(int pid)
    {
        var process = Native.OpenProcess(0x1000, false, pid);
        if (process == 0) throw new DirectFirewallException("failed");
        try
        {
            if (!OpenProcessToken(process, 8, out var token)) throw new DirectFirewallException("failed");
            try { using var identity = new WindowsIdentity(token); return identity.User!.Value; }
            finally { Native.CloseHandle(token); }
        }
        finally { Native.CloseHandle(process); }
    }
}
