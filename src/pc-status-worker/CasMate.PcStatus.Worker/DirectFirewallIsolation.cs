using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace CasMate.PcStatus.Worker;

// Synchronous WMI runs only in an owned, protected child that can be killed at the deadline.
internal static class DirectFirewallIsolation
{
    internal static async Task<DirectFirewallResult> Execute(string id, DirectFirewallJob job, Func<bool> live)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!);
        start.ArgumentList.Add("--direct-firewall-provider"); start.ArgumentList.Add(id);
        var remaining = job.Deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var budget = (int)Math.Clamp(remaining, 1, job.Request.Action == "remove" ? 4000 : 10_000);
        var result = await Run(start, JsonSerializer.Serialize(job, DirectFirewallService.Json), live, budget);
        return DirectFirewallHost.ValidResult(result, 1 + (job.Request.Grants?.Length ?? 0)) ? result : new(1, false, "failed");
    }

    internal static async Task<DirectFirewallResult> Run(ProcessStartInfo start, string payload, Func<bool> live, int budget, Action<Process>? started = null)
    {
        if (!live()) return new(1, false, "cancelled");
        start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        start.StandardInputEncoding = new UTF8Encoding(false); start.StandardOutputEncoding = new UTF8Encoding(false, true);
        start.WorkingDirectory = AppContext.BaseDirectory;
        using var timeout = new CancellationTokenSource(budget);
        using var ownership = new OwnedProviderJob();
        using var child = new Process { StartInfo = start };
        try
        {
            if (!child.Start()) return new(1, false, "failed");
            ownership.Attach(child); // No request bytes, and hence no mutation, precede job ownership.
            started?.Invoke(child);
            var output = ReadResult(child.StandardOutput, timeout.Token);
            var errors = Discard(child.StandardError, timeout.Token);
            await child.StandardInput.WriteLineAsync(payload.AsMemory(), timeout.Token);
            while (!child.HasExited)
            {
                if (!live()) return new(1, false, "cancelled");
                await Task.Delay(25, timeout.Token);
            }
            var response = await output;
            await errors;
            if (child.ExitCode != 0 || response is null) return new(1, false, "failed");
            return JsonSerializer.Deserialize<DirectFirewallResult>(response, DirectFirewallService.Json) ?? new(1, false, "failed");
        }
        catch { return new(1, false, live() ? "failed" : "cancelled"); }
        finally
        {
            timeout.Cancel();
            try { if (!child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(1)); } } catch { }
        }
    }
    private static async Task<string?> ReadResult(TextReader reader, CancellationToken token)
    {
        try { return await DirectFirewallService.ReadLine(reader, token); } catch { return null; }
    }
    private static async Task Discard(TextReader reader, CancellationToken token)
    {
        var buffer = new char[1024];
        try { while (await reader.ReadAsync(buffer.AsMemory(), token) != 0) { } } catch { }
    }

    internal static async Task Provider(string id)
    {
        DirectFirewallResult result;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            if (identity.User?.Value != "S-1-5-18" || !System.Text.RegularExpressions.Regex.IsMatch(id, "\\A[a-f0-9]{32}\\z"))
                throw new DirectFirewallException("ownership");
            var parent = DirectFirewallHost.ParentPid(Environment.ProcessId);
            if (WindowsFirewallServiceHost.ProcessId(DirectFirewallService.Name(id)) != parent ||
                DirectFirewallHost.ProcessSid(parent) != "S-1-5-18" ||
                !DirectFirewallService.SamePath(DirectFirewallService.ProcessProgram(parent), Environment.ProcessPath!))
                throw new DirectFirewallException("ownership");
            DirectFirewallServiceSetup.ValidateProtectedDirectory(DirectFirewallService.Root);
            DirectFirewallServiceSetup.ValidateProtectedDirectory(DirectFirewallService.DirectoryFor(id));
            if (!DirectFirewallService.SamePath(Environment.ProcessPath!, DirectFirewallService.Executable(id))) throw new DirectFirewallException("ownership");
            var config = DirectFirewallService.ReadConfig(id);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var job = JsonSerializer.Deserialize<DirectFirewallJob>(await DirectFirewallService.ReadLine(Console.In, timeout.Token), DirectFirewallService.Json)
                ?? throw new DirectFirewallException("failed");
            DirectFirewallHost.ValidateJob(job, config.WorkerProgram, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (job.UserSid != config.UserSid || job.Request.Grant.PcId != config.PcId || !DirectFirewallService.SamePath(job.OwnerProgram, config.OwnerProgram))
                throw new DirectFirewallException("ownership");
            using var manager = Process.GetProcessById(parent);
            var started = manager.StartTime.ToUniversalTime().Ticks;
            bool Live() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() <= job.Deadline &&
                DirectFirewallHost.ProcessMatches(parent, started, Environment.ProcessPath!) &&
                DirectFirewallHost.ProcessMatches(job.ManagerPid, job.ManagerStarted, config.WorkerProgram) &&
                DirectFirewallHost.ProcessMatches(job.Request.OwnerPid, job.OwnerStarted, config.OwnerProgram);
            result = DirectFirewallServiceSetup.ApplyRecorded(id, job.Request, Live);
        }
        catch (DirectFirewallException error) { result = new(1, false, error.Code); }
        catch { result = new(1, false, "failed"); }
        Console.WriteLine(JsonSerializer.Serialize(result, DirectFirewallService.Json));
    }
}
