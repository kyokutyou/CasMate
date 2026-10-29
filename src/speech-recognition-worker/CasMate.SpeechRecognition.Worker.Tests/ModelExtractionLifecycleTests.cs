using System.Diagnostics;
using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class ModelExtractionLifecycleTests
{
    [Theory]
    [InlineData("kill")]
    [InlineData("cancel")]
    [InlineData("failure")]
    public async Task ExtractionChildNeverSurvivesParentTerminationOrCancellation(string mode)
    {
        var directory = Path.Combine(Path.GetTempPath(), $"casmate-extraction-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        Process? child = null;
        Process? parent = null;
        try
        {
            foreach (var file in Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "extraction-test-host")))
                File.Copy(file, Path.Combine(directory, Path.GetFileName(file)));
            var executable = Path.Combine(directory, "CasMate.SpeechRecognition.ExtractionTestHost.exe");
            File.Copy(executable, Path.Combine(directory, "tar.exe"));
            var marker = Path.Combine(directory, "child.pid");
            var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = directory, RedirectStandardInput = true };
            start.ArgumentList.Add(typeof(ModelManager).Assembly.Location);
            start.ArgumentList.Add(directory);
            start.ArgumentList.Add(mode);
            start.Environment["CASMATE_EXTRACTION_TEST_PID"] = marker;
            start.Environment["CASMATE_EXTRACTION_TEST_MODE"] = mode;
            parent = Process.Start(start)!;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            deadline.CancelAfter(TimeSpan.FromSeconds(30));
            while (!File.Exists(marker)) await Task.Delay(20, deadline.Token);
            var pid = await File.ReadAllTextAsync(marker, deadline.Token);
            try { child = Process.GetProcessById(int.Parse(pid)); }
            catch (ArgumentException) when (mode == "failure") { }
            if (mode == "kill") parent.Kill();
            if (mode == "cancel") await parent.StandardInput.WriteLineAsync("cancel");
            await parent.WaitForExitAsync(deadline.Token);
            if (mode != "kill") Assert.Equal(mode == "cancel" ? 2 : 3, parent.ExitCode);
            if (child is not null)
            {
                await child.WaitForExitAsync(deadline.Token);
                Assert.True(child.HasExited);
            }
        }
        finally
        {
            if (parent is { HasExited: false }) parent.Kill(entireProcessTree: true);
            if (child is { HasExited: false }) child.Kill(entireProcessTree: true);
            if (parent is not null) { await parent.WaitForExitAsync(CancellationToken.None); parent.Dispose(); }
            if (child is not null) { await child.WaitForExitAsync(CancellationToken.None); child.Dispose(); }
            // Windows can signal process exit just before releasing its mapped
            // images. Retry only cleanup; assertions and process waits stay bounded.
            for (var attempt = 0; ; attempt++)
            {
                try { Directory.Delete(directory, recursive: true); break; }
                catch (Exception error) when (attempt < 40 && error is IOException or UnauthorizedAccessException)
                { await Task.Delay(50, CancellationToken.None); }
            }
        }
    }
}
