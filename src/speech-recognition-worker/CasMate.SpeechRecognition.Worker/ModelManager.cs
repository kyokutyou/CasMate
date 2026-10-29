using System.Diagnostics;
using System.Security.Cryptography;

namespace CasMate.SpeechRecognition.Worker;

internal static class FixedSpeechRecognitionModel
{
    public const string Name = "sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8";
    public const string VersionFolder = "parakeet-ctc-v1";
}

internal sealed record ModelPaths(
    string Model,
    string Tokens,
    string Vad)
{
    public static ModelPaths FromRoot(string root) => new(
        Path.Combine(root, FixedSpeechRecognitionModel.Name, "model.int8.onnx"),
        Path.Combine(root, FixedSpeechRecognitionModel.Name, "tokens.txt"),
        Path.Combine(root, "silero_vad.onnx"));
}

internal sealed class ModelManager(HttpClient? httpClient = null)
{
    private const string ModelUrl =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" +
        FixedSpeechRecognitionModel.Name + ".tar.bz2";
    private const string VadUrl =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";
    private readonly HttpClient _httpClient = httpClient ?? new HttpClient();

    private static readonly ModelFileSpec[] Files =
    [
        new(Path.Combine(FixedSpeechRecognitionModel.Name, "model.int8.onnx"), 655_542_604,
            "3addd00ef5bd1742078389e540b77394e4a508bdf2f4c9ad1b4a76d93e76598e"),
        new(Path.Combine(FixedSpeechRecognitionModel.Name, "tokens.txt"), 28_557,
            "732f64c53909f2620c713f4106b487d92e6f54a6915b3cd3d1dbd32f9f4f392a"),
        new("silero_vad.onnx", 643_854,
            "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"),
    ];

    public async Task InspectAsync(
        string modelDirectory,
        Action<string, double?, string?> report,
        CancellationToken cancellationToken = default)
    {
        report("validating", null, null);
        try
        {
            var ready = await ValidateAsync(ActiveModelDirectory(modelDirectory), cancellationToken);
            report(ready ? "ready" : "missing", null, null);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            report("failed", null, "保存済みの音声認識モデルを確認できません。ファイルへのアクセスを確認してください。");
        }
    }

    public async Task<ModelPaths> EnsureAsync(
        string modelDirectory,
        Action<string, double?, string?> report,
        CancellationToken cancellationToken = default)
    {
        var modelBase = Path.GetFullPath(modelDirectory);
        var root = ActiveModelDirectory(modelBase);
        if (await ValidateAsync(root, cancellationToken))
        {
            report("ready", null, null);
            return ModelPaths.FromRoot(root);
        }

        report("missing", null, null);
        Directory.CreateDirectory(modelBase);
        var temporaryRoot = Path.Combine(modelBase, $"speech-model-{Guid.NewGuid():N}");
        var extractRoot = Path.Combine(temporaryRoot, "extracted");
        var stagingRoot = Path.Combine(temporaryRoot, "staging");
        var archivePath = Path.Combine(temporaryRoot, FixedSpeechRecognitionModel.Name + ".tar.bz2");
        var vadPath = Path.Combine(temporaryRoot, "silero_vad.onnx");
        try
        {
            Directory.CreateDirectory(extractRoot);
            Directory.CreateDirectory(stagingRoot);
            report("downloading", 0, null);
            await DownloadAsync(ModelUrl, archivePath, progress => report("downloading", progress * 0.95, null), cancellationToken);
            await DownloadAsync(VadUrl, vadPath, progress => report("downloading", 0.95 + progress * 0.05, null), cancellationToken);

            report("extracting", null, null);
            await ExtractArchiveAsync(archivePath, extractRoot, cancellationToken);
            var extractedModel = Path.Combine(extractRoot, FixedSpeechRecognitionModel.Name);
            foreach (var spec in Files.Where(file => file.RelativePath != "silero_vad.onnx"))
            {
                var source = Path.Combine(extractedModel, Path.GetFileName(spec.RelativePath));
                var destination = Path.Combine(stagingRoot, spec.RelativePath);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Copy(source, destination);
            }
            File.Copy(vadPath, Path.Combine(stagingRoot, "silero_vad.onnx"));

            report("validating", null, null);
            if (!await ValidateAsync(stagingRoot, cancellationToken))
                throw new InvalidDataException("ダウンロードした音声認識モデルの検証に失敗しました。");

            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
            Directory.Move(stagingRoot, root);
            report("ready", null, null);
            return ModelPaths.FromRoot(root);
        }
        catch (Exception error)
        {
            report("failed", null, "音声認識モデルを準備できませんでした。再試行してください。");
            throw new InvalidOperationException("音声認識モデルを準備できませんでした。再試行してください。", error);
        }
        finally
        {
            if (Directory.Exists(temporaryRoot)) Directory.Delete(temporaryRoot, recursive: true);
        }
    }

    internal static async Task<bool> ValidateAsync(string root, CancellationToken cancellationToken = default)
    {
        foreach (var spec in Files)
        {
            var path = Path.Combine(root, spec.RelativePath);
            try
            {
                await using var stream = File.OpenRead(path);
                if (stream.Length != spec.Length) return false;
                var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
                if (!hash.Equals(spec.Sha256, StringComparison.Ordinal)) return false;
            }
            catch (FileNotFoundException) { return false; }
            catch (DirectoryNotFoundException) { return false; }
        }
        return true;
    }

    internal static string ActiveModelDirectory(string modelDirectory) =>
        Path.Combine(Path.GetFullPath(modelDirectory), FixedSpeechRecognitionModel.VersionFolder);

    private async Task DownloadAsync(
        string url,
        string destination,
        Action<double> report,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength;
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        var buffer = new byte[128 * 1024];
        long received = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
            received += count;
            if (total is > 0) report(Math.Clamp((double)received / total.Value, 0, 1));
        }
    }

    private static async Task ExtractArchiveAsync(
        string archivePath,
        string destination,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        WorkerProcessJob.EnsureChildOwnership();
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "tar.exe",
            ArgumentList = { "-xjf", archivePath, "-C", destination },
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
        }) ?? throw new InvalidOperationException("モデル展開処理を開始できませんでした。");
        // Drain without retaining potentially large diagnostics in memory.
        var errorDrain = process.StandardError.BaseStream.CopyToAsync(Stream.Null);
        try { await process.WaitForExitAsync(cancellationToken); }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            throw;
        }
        finally { await errorDrain; }
        if (process.ExitCode != 0) throw new InvalidDataException("音声認識モデルを展開できませんでした。");
    }

    private sealed record ModelFileSpec(string RelativePath, long Length, string Sha256);
}
