using System.Text;
using System.Text.Json;

namespace CasMate.SpeechRecognition.Worker;

internal static class Program
{
    public static async Task<int> Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(false);
        var writer = new ProtocolWriter(Console.Out);
        var coordinator = new RecognitionCoordinator(writer);
        await writer.EventAsync("worker.ready", new { });
        try
        {
            while (await Console.In.ReadLineAsync() is { } line)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var shouldContinue = await HandleLineAsync(line, coordinator, writer);
                if (!shouldContinue) break;
            }
            return 0;
        }
        finally
        {
            await coordinator.DisposeAsync();
        }
    }

    private static async Task<bool> HandleLineAsync(
        string line,
        RecognitionCoordinator coordinator,
        ProtocolWriter writer)
    {
        string? requestId = null;
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            requestId = RequiredString(root, "requestId");
            if (RequiredInt(root, "protocolVersion") != 1)
                throw new ProtocolException("PROTOCOL_VERSION_UNSUPPORTED", "音声認識ワーカーのプロトコルが一致しません。");
            if (RequiredString(root, "type") != "command")
                throw new ProtocolException("MESSAGE_TYPE_INVALID", "音声認識ワーカーの要求形式が正しくありません。");
            var command = RequiredString(root, "command");
            var payload = root.TryGetProperty("payload", out var payloadElement)
                ? payloadElement
                : default;
            switch (command)
            {
                case "initialize":
                {
                    var initialize = payload.Deserialize<ModelDirectoryPayload>(ProtocolWriter.JsonOptions)
                        ?? throw new ProtocolException("PAYLOAD_INVALID", "モデル確認要求が正しくありません。");
                    await coordinator.InitializeAsync(initialize.ModelDirectory);
                    await writer.ResponseAsync(requestId, new { });
                    return true;
                }
                case "listMicrophones":
                    await writer.ResponseAsync(requestId, new
                    {
                        microphones = coordinator.ListMicrophones().Select(device => new
                        {
                            id = device.Id,
                            name = device.Name,
                            isDefault = device.IsDefault,
                        }),
                    });
                    return true;
                case "prepareModel":
                {
                    var prepare = payload.Deserialize<ModelDirectoryPayload>(ProtocolWriter.JsonOptions)
                        ?? throw new ProtocolException("PAYLOAD_INVALID", "モデル準備要求が正しくありません。");
                    await coordinator.PrepareModelAsync(prepare.ModelDirectory);
                    await writer.ResponseAsync(requestId, new { });
                    return true;
                }
                case "start":
                {
                    var start = payload.Deserialize<StartPayload>(ProtocolWriter.JsonOptions)
                        ?? throw new ProtocolException("PAYLOAD_INVALID", "音声認識の開始設定が正しくありません。");
                    var sessionId = await coordinator.StartAsync(start);
                    await writer.ResponseAsync(requestId, new { sessionId });
                    return true;
                }
                case "stop":
                    var discard = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("discard", out var discardValue) && discardValue.ValueKind == JsonValueKind.True;
                    await coordinator.StopAsync(discard);
                    await writer.ResponseAsync(requestId, new { });
                    return true;
                case "setWavSaving":
                {
                    if (!payload.TryGetProperty("enabled", out var enabled) ||
                        enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                        throw new ProtocolException("PAYLOAD_INVALID", "WAV保存設定が正しくありません。");
                    coordinator.SetWavSaving(enabled.GetBoolean());
                    await writer.ResponseAsync(requestId, new { });
                    return true;
                }
                case "setVoiceCapturePeriod":
                {
                    var id = RequiredString(payload, "id");
                    if (!Guid.TryParse(id, out _)) throw new ProtocolException("PAYLOAD_INVALID", "音声操作の取得期間が正しくありません。");
                    coordinator.SetVoiceCapturePeriod(id);
                    await writer.ResponseAsync(requestId, new { });
                    return true;
                }
                case "shutdown":
                    await coordinator.StopAsync();
                    await writer.ResponseAsync(requestId, new { });
                    return false;
                default:
                    throw new ProtocolException("COMMAND_UNKNOWN", "未対応の音声認識ワーカー操作です。");
            }
        }
        catch (ProtocolException error)
        {
            if (requestId is not null) await writer.ErrorAsync(requestId, error.Code, error.Message);
            return true;
        }
        catch (JsonException)
        {
            if (requestId is not null)
                await writer.ErrorAsync(requestId, "JSON_INVALID", "音声認識ワーカーの要求形式が正しくありません。");
            else
                await writer.EventAsync("worker.fatal", new { warning = "音声認識ワーカーとの通信に失敗しました。" });
            return true;
        }
        catch (Exception error)
        {
            if (requestId is not null)
                await writer.ErrorAsync(requestId, "OPERATION_FAILED", SafeMessage(error));
            return true;
        }
    }

    private static string RequiredString(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
            throw new ProtocolException("MESSAGE_INVALID", "音声認識ワーカーの要求形式が正しくありません。");
        return value.GetString()!;
    }

    private static int RequiredInt(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || !value.TryGetInt32(out var result))
            throw new ProtocolException("MESSAGE_INVALID", "音声認識ワーカーの要求形式が正しくありません。");
        return result;
    }

    private static string SafeMessage(Exception error) => error switch
    {
        ArgumentException => error.Message,
        InvalidOperationException => error.Message,
        _ => "音声認識ワーカーの操作に失敗しました。再試行してください。",
    };
}

internal sealed record StartPayload(
    RecognitionSettings Settings,
    string ModelDirectory,
    string RecordingsDirectory,
    ExternalInput? ExternalInput = null);

internal sealed record ModelDirectoryPayload(string ModelDirectory);

internal sealed class RecognitionCoordinator(ProtocolWriter writer) : IAsyncDisposable
{
    private readonly ModelManager _models = new();
    private RecognitionRuntime? _runtime;

    public Task InitializeAsync(string modelDirectory) => _models.InspectAsync(
        modelDirectory,
        (status, progress, warning) => _ = writer.EventAsync("model.changed", new { status, progress, warning }));

    public IReadOnlyList<MicrophoneView> ListMicrophones()
    {
        var devices = MicrophoneCapture.Enumerate();
        _ = writer.EventAsync("microphones.changed", new
        {
            microphones = devices.Select(device => new
            {
                id = device.Id,
                name = device.Name,
                isDefault = device.IsDefault,
            }),
        });
        return devices;
    }

    public async Task<string> StartAsync(StartPayload payload)
    {
        var validation = payload.Settings.Validate();
        if (validation.Count > 0) throw new ArgumentException(string.Join(" ", validation));
        payload.ExternalInput?.Validate();
        await StopAsync(discard: true);
        await writer.EventAsync("status.changed", new { status = "preparing", warning = (string?)null });
        var paths = await _models.EnsureAsync(
            payload.ModelDirectory,
            (status, progress, warning) => _ = writer.EventAsync("model.changed", new
            {
                status,
                progress,
                warning,
            }));
        var sessionId = Guid.NewGuid().ToString("N");
        var runtime = new RecognitionRuntime(
            sessionId,
            paths,
            payload.Settings,
            payload.RecordingsDirectory,
            (status, warning) => _ = writer.EventAsync("status.changed", new { status, warning, sessionId }),
            result => _ = writer.EventAsync("recognition.result", result),
            (enabled, warning) => _ = writer.EventAsync("wavSaving.changed", new { enabled, warning, sessionId }),
            payload.ExternalInput);
        try
        {
            runtime.Start();
            _runtime = runtime;
            return sessionId;
        }
        catch
        {
            await runtime.DisposeAsync();
            await writer.EventAsync("status.changed", new
            {
                status = "unavailable",
                warning = payload.ExternalInput is null ? "マイクを開始できません。マイクとWindowsの権限を確認してください。" : "スマホ音声の復号を開始できません。再試行してください。",
            });
            throw new InvalidOperationException(payload.ExternalInput is null ? "マイクを開始できません。マイクとWindowsの権限を確認してください。" : "スマホ音声の復号を開始できません。再試行してください。");
        }
    }

    public async Task PrepareModelAsync(string modelDirectory)
    {
        await _models.EnsureAsync(
            modelDirectory,
            (status, progress, warning) => _ = writer.EventAsync("model.changed", new
            {
                status,
                progress,
                warning,
            }));
    }

    public void SetWavSaving(bool enabled) => _runtime?.SetWavSaving(enabled);
    public void SetVoiceCapturePeriod(string id) => _runtime?.SetVoiceCapturePeriod(id);

    public async Task StopAsync(bool discard = false)
    {
        var runtime = Interlocked.Exchange(ref _runtime, null);
        if (runtime is not null) { await runtime.StopAsync(discard); await runtime.DisposeAsync(); }
        await writer.EventAsync("status.changed", new { status = "disabled", warning = (string?)null });
    }

    public async ValueTask DisposeAsync() => await StopAsync();
}

internal sealed class ProtocolWriter(TextWriter output)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public Task ResponseAsync(string requestId, object result) => WriteAsync(new
    {
        protocolVersion = 1,
        type = "response",
        requestId,
        ok = true,
        result,
    });

    public Task ErrorAsync(string requestId, string code, string message) => WriteAsync(new
    {
        protocolVersion = 1,
        type = "response",
        requestId,
        ok = false,
        error = new { code, message },
    });

    public Task EventAsync(string eventName, object payload) => WriteAsync(new
    {
        protocolVersion = 1,
        type = "event",
        @event = eventName,
        payload,
    });

    private async Task WriteAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        await _gate.WaitAsync();
        try
        {
            await output.WriteLineAsync(json);
            await output.FlushAsync();
        }
        finally
        {
            _gate.Release();
        }
    }
}

internal sealed class ProtocolException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
