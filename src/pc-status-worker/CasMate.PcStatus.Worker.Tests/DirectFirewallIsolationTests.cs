using System.Diagnostics;
using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallIsolationTests
{
    [Fact] public async Task ClosingServiceJobHandleAlsoKillsItsOwnedProvider()
    {
        var start = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true };
        start.ArgumentList.Add("/d"); start.ArgumentList.Add("/c"); start.ArgumentList.Add("set /p input=");
        using var child = Process.Start(start)!;
        try
        {
            using (var ownership = new OwnedProviderJob()) ownership.Attach(child);
            await child.WaitForExitAsync(TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(3), TestContext.Current.CancellationToken);
            Assert.True(child.HasExited);
        }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
    }

    [Fact] public async Task UnresponsiveProviderProcessIsKilledAtDeadlineAndDoesNotBlockNextRequest()
    {
        Process? observed = null;
        try
        {
            var start = new ProcessStartInfo("cmd.exe"); start.ArgumentList.Add("/d"); start.ArgumentList.Add("/c");
            // Consume the request, then wait for more input without touching files or the network.
            start.ArgumentList.Add("set /p first= & set /p second=");
            var watch = Stopwatch.StartNew();
            var result = await DirectFirewallIsolation.Run(start, "{}", () => true, 250,
                process => observed = Process.GetProcessById(process.Id));
            Assert.False(result.Ok); Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3));
            Assert.True(observed!.HasExited);
            var next = new ProcessStartInfo("cmd.exe"); next.ArgumentList.Add("/d"); next.ArgumentList.Add("/c"); next.ArgumentList.Add("exit 7");
            Assert.False((await DirectFirewallIsolation.Run(next, "{}", () => true, 1000)).Ok);
        }
        finally { observed?.Dispose(); }
    }

    [Fact] public async Task CancellationKillsProviderWithoutWaitingForOperationDeadline()
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var start = new ProcessStartInfo("cmd.exe"); start.ArgumentList.Add("/d"); start.ArgumentList.Add("/c");
        start.ArgumentList.Add("set /p first= & set /p second=");
        var task = DirectFirewallIsolation.Run(start, "{}", () => !cancellation.IsCancellationRequested, 10_000);
        cancellation.Cancel();
        var result = await task.WaitAsync(TimeSpan.FromSeconds(3), TestContext.Current.CancellationToken);
        Assert.False(result.Ok); Assert.Equal("cancelled", result.Error);
    }
}
