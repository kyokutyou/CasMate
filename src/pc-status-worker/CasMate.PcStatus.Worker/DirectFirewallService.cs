using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace CasMate.PcStatus.Worker;

internal sealed record DirectFirewallServiceConfig(int Version, string UserSid, string PcId, string OwnerProgram,
    string WorkerProgram, string Fingerprint);

// The only privileged IPC operations are the already validated firewall allow/remove batch.
internal static class DirectFirewallService
{
    internal static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };
    internal const int Limit = 65_536;
    internal static string Identity(string sid) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sid)))[..32];
    internal static string Name(string id) => "CasMate.DirectFirewall." + id;
    internal static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "CasMate.DirectFirewall");
    internal static string DirectoryFor(string id) => Path.Combine(Root, id);
    internal static string ConfigPath(string id) => Path.Combine(DirectoryFor(id), "service.json");
    internal static string Executable(string id)
    {
        var fingerprint = ReadConfig(id).Fingerprint;
        if (!System.Text.RegularExpressions.Regex.IsMatch(fingerprint, "\\A[a-f0-9]{64}\\z")) throw new DirectFirewallException("failed");
        return Path.Combine(DirectoryFor(id), "runtime-" + fingerprint, "CasMate.PcStatus.Worker.exe");
    }

    internal static bool Compatible(DirectFirewallServiceConfig actual, DirectFirewallServiceConfig expected) =>
        actual.Version == expected.Version && actual.UserSid == expected.UserSid && actual.PcId == expected.PcId &&
        SamePath(actual.OwnerProgram, expected.OwnerProgram) && SamePath(actual.WorkerProgram, expected.WorkerProgram) && actual.Fingerprint == expected.Fingerprint;
    internal static bool SamePath(string first, string second) => string.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase);
    internal static async Task<DirectFirewallResult> WithSetup(Func<bool> installed, Func<Task> setup, Func<Task<DirectFirewallResult>> call)
    {
        if (!installed()) await setup();
        return await call(); // A failed installed service must never cause an elevation loop.
    }

    internal static DirectFirewallServiceConfig Expected(DirectFirewallJob job, string worker, bool verifyRuntime = false)
    {
        var directory = Path.GetDirectoryName(worker)!; var manifest = Path.Combine(directory, "service-runtime.sha256");
        var fingerprint = !verifyRuntime && File.Exists(manifest) ? Encoding.ASCII.GetString(ReadFile(manifest)).Trim() : Fingerprint(directory);
        if (!System.Text.RegularExpressions.Regex.IsMatch(fingerprint, "\\A[a-f0-9]{64}\\z")) throw new DirectFirewallException("failed");
        return new(1, job.UserSid, job.Request.Grant.PcId, job.OwnerProgram, worker, fingerprint);
    }

    internal static string Fingerprint(string directory)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        // Include all loadable runtime files, not only the application version string.
        foreach (var path in RuntimeFiles(directory))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(Path.GetFileName(path).ToLowerInvariant() + "\n"));
            using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            hash.AppendData(SHA256.HashData(input));
        }
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }
    internal static string[] RuntimeFiles(string directory) => Directory.GetFiles(directory).Where(path =>
        Path.GetExtension(path).ToLowerInvariant() is ".dll" or ".exe" or ".json").Order(StringComparer.OrdinalIgnoreCase).ToArray();

    internal static bool Installed(string id, DirectFirewallServiceConfig expected)
    {
        if (!File.Exists(ConfigPath(id))) return false;
        DirectFirewallServiceSetup.ValidateProtectedDirectory(Root);
        DirectFirewallServiceSetup.ValidateProtectedDirectory(DirectoryFor(id));
        var actual = ReadConfig(id);
        return Compatible(actual, expected) && File.Exists(Executable(id)) && WindowsFirewallServiceHost.State(Name(id)) != 0;
    }
    internal static DirectFirewallServiceConfig ReadConfig(string id) => JsonSerializer.Deserialize<DirectFirewallServiceConfig>(
        ReadFile(ConfigPath(id)), Json) ?? throw new DirectFirewallException("failed");
    internal static byte[] ReadFile(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > Limit) throw new DirectFirewallException("failed");
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes); return bytes;
    }

    internal static void ValidateClient(DirectFirewallServiceConfig config, DirectFirewallJob job, int peerPid,
        string peerSid, string peerProgram, int peerParentPid, long now)
    {
        DirectFirewallHost.ValidateJob(job, config.WorkerProgram, now);
        if (config.Version != 1 || job.UserSid != config.UserSid || peerSid != config.UserSid ||
            job.Request.Grant.PcId != config.PcId || job.ManagerPid != peerPid || job.Request.OwnerPid != peerParentPid ||
            !SamePath(peerProgram, config.WorkerProgram) || !SamePath(job.OwnerProgram, config.OwnerProgram))
            throw new DirectFirewallException("ownership");
    }

    internal static async Task<DirectFirewallResult> Call(string id, DirectFirewallJob job, Func<bool> live)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Max(1, job.Deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())));
        using var pipe = CreateClient(Name(id));
        if (!live()) throw new DirectFirewallException("cancelled");
        WindowsFirewallServiceHost.StartInstalled(Name(id));
        await pipe.ConnectAsync(5_000, timeout.Token);
        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var pid) ||
            WindowsFirewallServiceHost.ProcessId(Name(id)) != pid ||
            !SamePath(ProcessProgram((int)pid), Executable(id))) throw new DirectFirewallException("ownership");
        using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
        using var reader = new StreamReader(pipe, new UTF8Encoding(false, true), leaveOpen: true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(job, Json).AsMemory(), timeout.Token);
        var response = ReadLine(reader, timeout.Token);
        while (!response.IsCompleted)
        {
            var tick = Task.Delay(50, timeout.Token);
            if (await Task.WhenAny(response, tick) == response) break;
            if (!live())
            {
                await writer.WriteLineAsync("{\"type\":\"cancel\"}".AsMemory(), timeout.Token);
                break;
            }
        }
        var result = JsonSerializer.Deserialize<DirectFirewallResult>(await response, Json) ?? throw new DirectFirewallException("failed");
        if (!DirectFirewallHost.ValidResult(result, 1 + (job.Request.Grants?.Length ?? 0))) throw new DirectFirewallException("failed");
        if (result.Error is not null) return result;
        await writer.WriteLineAsync((live() ? "complete" : "cancel").AsMemory(), timeout.Token);
        // Keep this short-lived manager alive until the service commits the request.
        if (await ReadLine(reader, timeout.Token) != "committed") throw new DirectFirewallException("cancelled");
        return result;
    }
    internal static NamedPipeClientStream CreateClient(string name) => new(".", name, PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize,
        PipeOptions.Asynchronous, TokenImpersonationLevel.Identification, HandleInheritability.None);

    internal static string ProcessProgram(int pid)
    {
        var process = Native.OpenProcess(0x1000, false, pid);
        if (process == 0) throw new DirectFirewallException("ownership");
        try
        {
            var text = new StringBuilder(32768); var length = text.Capacity;
            if (!QueryFullProcessImageNameW(process, 0, text, ref length)) throw new DirectFirewallException("ownership");
            return text.ToString();
        }
        finally { Native.CloseHandle(process); }
    }
    internal static async Task<string> ReadLine(TextReader input, CancellationToken token)
    {
        var text = new StringBuilder(); var buffer = new char[1];
        while (await input.ReadAsync(buffer.AsMemory(), token) != 0)
        {
            if (buffer[0] == '\n') return text.ToString().TrimEnd('\r');
            if (text.Length >= Limit) throw new DirectFirewallException("failed");
            text.Append(buffer[0]);
        }
        throw new DirectFirewallException("cancelled");
    }

    internal static async Task Serve(string id, CancellationToken stop)
    {
        DirectFirewallServiceSetup.ValidateProtectedDirectory(Root);
        DirectFirewallServiceSetup.ValidateProtectedDirectory(DirectoryFor(id));
        var config = ReadConfig(id);
        if (Identity(config.UserSid) != id || !SamePath(Environment.ProcessPath!, Executable(id)))
            throw new DirectFirewallException("ownership");
        ServiceProcessAccess.AllowCurrentProcessQuery(config.UserSid);
        while (!stop.IsCancellationRequested)
        {
            var security = PipeSecurityFor(config.UserSid);
            using var pipe = NamedPipeServerStreamAcl.Create(Name(id), PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 4096, 4096, security);
            await pipe.WaitForConnectionAsync(stop);
            await Handle(pipe, config, stop);
        }
    }
    internal static PipeSecurity PipeSecurityFor(string sid)
    {
        var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
        security.SetOwner(new SecurityIdentifier("S-1-5-18"));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-5-2"), PipeAccessRights.FullControl, AccessControlType.Deny)); // NETWORK
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-5-18"), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        return security;
    }
    internal static async Task Handle(NamedPipeServerStream pipe, DirectFirewallServiceConfig config, CancellationToken stop,
        Func<DirectFirewallRequest, Func<bool>, DirectFirewallResult>? apply = null)
    {
        var id = Identity(config.UserSid);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(120));
        using var reader = new StreamReader(pipe, new UTF8Encoding(false, true), leaveOpen: true);
        using var output = new PipeOutput(pipe);
        var writer = output.Writer;
        var cancelled = 0;
        DirectFirewallResult result;
        try
        {
            var job = JsonSerializer.Deserialize<DirectFirewallJob>(await ReadLine(reader, timeout.Token), Json) ?? throw new DirectFirewallException("failed");
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var pid)) throw new DirectFirewallException("ownership");
            string? sid = null;
            pipe.RunAsClient(() => { using var identity = WindowsIdentity.GetCurrent(); sid = identity.User?.Value; });
            ValidateClient(config, job, (int)pid, sid ?? "", ProcessProgram((int)pid), DirectFirewallHost.ParentPid((int)pid), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (DirectFirewallHost.ProcessSid(job.Request.OwnerPid) != config.UserSid) throw new DirectFirewallException("ownership");
            bool Live() => Volatile.Read(ref cancelled) == 0 && !timeout.IsCancellationRequested &&
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() <= job.Deadline &&
                DirectFirewallHost.ProcessMatches(job.ManagerPid, job.ManagerStarted, config.WorkerProgram) &&
                DirectFirewallHost.ProcessMatches(job.Request.OwnerPid, job.OwnerStarted, config.OwnerProgram);
            if (!Live()) throw new DirectFirewallException("cancelled");
            // A successful response must be acknowledged; lost replies/disconnects roll back allows.
            var watch = Task.Run(async () =>
            {
                try { if (await ReadLine(reader, timeout.Token) == "complete") return true; } catch { }
                Interlocked.Exchange(ref cancelled, 1); return false;
            });
            result = apply is null ? await DirectFirewallIsolation.Execute(id, job, Live) : apply(job.Request, Live);
            var committed = false;
            try
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(result, Json).AsMemory(), timeout.Token);
                committed = await watch && Live();
            }
            catch { Interlocked.Exchange(ref cancelled, 1); }
            if (job.Request.Action == "allow" && !committed)
            {
                var rollback = job with { Request = job.Request with { Action = "remove" }, Deadline = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 4000 };
                if (apply is null) await DirectFirewallIsolation.Execute(id, rollback, () => true);
                else apply(rollback.Request, () => true);
            }
            // After this commit boundary the manager may exit normally; it no longer cancels the grant.
            try { await writer.WriteLineAsync((committed ? "committed" : "cancelled").AsMemory(), timeout.Token); } catch { }
            timeout.Cancel();
            return;
        }
        catch (DirectFirewallException error) { result = new(1, false, error.Code); }
        catch { result = new(1, false, "failed"); }
        try { await writer.WriteLineAsync(JsonSerializer.Serialize(result, Json).AsMemory(), timeout.Token); } catch { }
    }

    // A disconnected request must not terminate the service during StreamWriter's final flush.
    private sealed class PipeOutput(Stream stream) : IDisposable
    {
        internal StreamWriter Writer { get; } = new(stream, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
        public void Dispose() { try { Writer.Dispose(); } catch (IOException) { } catch (ObjectDisposedException) { } }
    }

    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(nint process, uint flags, StringBuilder text, ref int size);
}
