using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class FfmpegCaptureTests
{
    [Fact]
    public void FfmpegArgumentsDecodeOnlyLoopbackAudioWithoutRealtimeThrottling()
    {
        var arguments = FfmpegCapture.Arguments(12345);
        Assert.Contains("0:a:0", arguments); Assert.Contains("-vn", arguments);
        Assert.Contains("16000", arguments); Assert.Contains("pcm_s16le", arguments);
        Assert.Contains("pipe:1", arguments); Assert.DoesNotContain("-re", arguments);
        var endpoint = Assert.Single(arguments, value => value.StartsWith("udp://"));
        Assert.StartsWith("udp://127.0.0.1:12345?localaddr=127.0.0.1&", endpoint);
        Assert.Contains("fifo_size=256", endpoint);
    }

    [Fact]
    public void MissingOrNonLocalExternalInputIsRejectedBeforeStarting()
    {
        Assert.Throws<ArgumentException>(() => new ExternalInput(80, "ffmpeg.exe", "generation").Validate());
        Assert.Throws<ArgumentException>(() => new ExternalInput(12345, "ffmpeg.exe", "").Validate());
    }

    [Fact]
    public async Task ClosingTheOwnershipJobKillsItsRemainingChild()
    {
        if (!OperatingSystem.IsWindows()) return;
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ping.exe");
        using var child = Process.Start(new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true, Arguments = "-t 127.0.0.1",
            RedirectStandardOutput = true, RedirectStandardError = true,
        })!;
        try
        {
            var job = WorkerProcessJob.Create();
            try { Assert.True(WorkerProcessJob.AssignProcessToJobObject(job, child.Handle)); }
            finally { job.Dispose(); }
            await child.WaitForExitAsync(TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            Assert.True(child.HasExited);
        }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
    }

    [Fact]
    public async Task LiveMpegTsAudioIsDecodedAndStoppingReleasesTheUdpInput()
    {
        var executable = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../../resources/ffmpeg/ffmpeg.exe"));
        Assert.True(File.Exists(executable), "The bundled FFmpeg must be available for audio input integration tests.");
        int port;
        using (var reserve = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0))) port = ((IPEndPoint)reserve.Client.LocalEndPoint!).Port;
        await using var capture = new FfmpegCapture(new ExternalInput(port, executable, "test-generation"));
        var audio = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var samples = 0; double energy = 0;
        capture.SamplesAvailable += values => { samples += values.Length; foreach (var value in values) energy += value * value; if (samples >= 16000) audio.TrySetResult(); };
        capture.Failed += failure => audio.TrySetException(failure);
        capture.Start();
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var argument in new[] { "-nostdin", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:a", "aac", "-ar", "48000", "-ac", "1", "-f", "mpegts", $"udp://127.0.0.1:{port}?pkt_size=1316" }) start.ArgumentList.Add(argument);
        using var source = Process.Start(start)!;
        try
        {
            await audio.Task.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
            await capture.StopAsync();
            Assert.True(energy > 1, "Decoded PCM must contain real audio.");
            using var reopened = new UdpClient(new IPEndPoint(IPAddress.Loopback, port));
            Assert.Equal(port, ((IPEndPoint)reopened.Client.LocalEndPoint!).Port);
        }
        finally { if (!source.HasExited) source.Kill(entireProcessTree: true); }
    }
}
