using System.Diagnostics;

namespace CasMate.SpeechRecognition.Worker;

internal sealed record ExternalInput(int UdpPort, string FfmpegPath, string Generation)
{
    public void Validate()
    {
        if (UdpPort is < 1024 or > 65535 || string.IsNullOrWhiteSpace(Generation) || Generation.Length > 200 ||
            !Path.IsPathFullyQualified(FfmpegPath) || !File.Exists(FfmpegPath))
            throw new ArgumentException("スマホ音声の入力を準備できません。FFmpegと入力設定を確認してください。");
    }
}

internal sealed class FfmpegCapture(ExternalInput input) : IAsyncDisposable
{
    private Process? _process;
    private Task? _drain, _errors;
    private readonly CancellationTokenSource _stop = new();
    private int _stopping;
    public event Action<float[]>? SamplesAvailable;
    public event Action<Exception>? Failed;

    internal static string[] Arguments(int port) => [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay",
        "-probesize", "32768", "-analyzeduration", "1000000", "-f", "mpegts", "-i",
        $"udp://127.0.0.1:{port}?localaddr=127.0.0.1&fifo_size=256&overrun_nonfatal=1&buffer_size=65536&timeout=5000000",
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
    ];

    public void Start()
    {
        input.Validate(); WorkerProcessJob.EnsureChildOwnership();
        var info = new ProcessStartInfo(input.FfmpegPath)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var argument in Arguments(input.UdpPort)) info.ArgumentList.Add(argument);
        var process = new Process { StartInfo = info };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("FFmpegを起動できません。");
            _process = process;
            _errors = DrainErrorsAsync(process.StandardError);
            _drain = DrainPcmAsync(process.StandardOutput.BaseStream);
        }
        catch { process.Dispose(); throw; }
    }

    private async Task DrainPcmAsync(Stream output)
    {
        var bytes = new byte[4097]; var leftover = 0;
        try
        {
            while (await output.ReadAsync(bytes.AsMemory(leftover, 4096), _stop.Token) is var read && read > 0)
            {
                var total = leftover + read; var complete = total & ~1;
                if (complete > 0) SamplesAvailable?.Invoke(Pcm16Converter.ToFloatSamples(bytes.AsSpan(0, complete)));
                leftover = total - complete;
                if (leftover > 0) bytes[0] = bytes[complete];
            }
            if (Volatile.Read(ref _stopping) == 0) Failed?.Invoke(new InvalidOperationException("スマホ音声の復号が停止しました。再試行してください。"));
        }
        catch (OperationCanceledException) when (Volatile.Read(ref _stopping) != 0) { }
        catch (Exception) { if (Volatile.Read(ref _stopping) == 0) Failed?.Invoke(new InvalidOperationException("スマホ音声を取得できません。再試行してください。")); }
    }

    private async Task DrainErrorsAsync(StreamReader errors)
    {
        var buffer = new char[1024];
        try { while (await errors.ReadAsync(buffer.AsMemory(), _stop.Token) > 0) { } }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
    }

    public async Task StopAsync()
    {
        Interlocked.Exchange(ref _stopping, 1); _stop.Cancel();
        var process = Interlocked.Exchange(ref _process, null);
        if (process is not null)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException) { }
            finally { process.Dispose(); }
        }
        if (_drain is not null) await _drain;
        if (_errors is not null) await _errors;
    }

    public async ValueTask DisposeAsync() { await StopAsync(); _stop.Dispose(); }
}
