using System.Diagnostics;
using SherpaOnnx;

namespace CasMate.SpeechRecognition.Worker;

internal sealed record RecognitionResultView(
    string Id,
    string SessionId,
    string CapturePeriodId,
    string? VoiceCapturePeriodId,
    long Sequence,
    string RecognizedAt,
    string Text,
    long AudioDurationMilliseconds,
    long RecognitionDurationMilliseconds);

internal sealed class RecognitionRuntime : IAsyncDisposable
{
    private const int VadWindowSize = 512;
    private const int AudioHistoryCapacity = MicrophoneCapture.SampleRate * 310;
    private readonly string _sessionId;
    private string _capturePeriodId;
    private string _voiceCapturePeriodId = Guid.NewGuid().ToString("N");
    private readonly ModelPaths _paths;
    private readonly RecognitionSettings _settings;
    private readonly WaveFileStore _waveFileStore;
    private readonly Action<string, string?> _status;
    private readonly Action<RecognitionResultView> _result;
    private readonly Action<bool, string?> _wavSavingChanged;
    private readonly MicrophoneCapture _capture = new();
    private readonly FfmpegCapture? _externalCapture;
    private readonly OfflineRecognizer _recognizer;
    private VoiceActivityDetector? _vad;
    private BoundedAudioQueue? _audio;
    private Task? _processing;
    private bool _speechDetected;
    private volatile bool _wavSaving;
    private long _sequence;
    private volatile bool _discard;
    private readonly Queue<PendingSegment> _pendingSegments = new();

    public RecognitionRuntime(
        string sessionId,
        ModelPaths paths,
        RecognitionSettings settings,
        string recordingsDirectory,
        Action<string, string?> status,
        Action<RecognitionResultView> result,
        Action<bool, string?> wavSavingChanged,
        ExternalInput? externalInput = null)
    {
        _sessionId = sessionId;
        _settings = settings;
        _paths = paths;
        _capturePeriodId = externalInput?.Generation ?? Guid.NewGuid().ToString("N");
        _waveFileStore = new WaveFileStore(recordingsDirectory);
        _status = status;
        _result = result;
        _wavSavingChanged = wavSavingChanged;
        _recognizer = CreateRecognizer(paths);
        _capture.SamplesAvailable += OnSamplesAvailable;
        _capture.Failed += OnCaptureFailed;
        if (externalInput is not null)
        {
            _externalCapture = new FfmpegCapture(externalInput);
            _externalCapture.SamplesAvailable += OnSamplesAvailable;
            _externalCapture.Failed += OnCaptureFailed;
        }
        _vad = CreateVad(paths, settings);
    }

    public void Start()
    {
        var vad = _vad ?? throw new InvalidOperationException("VADを準備できませんでした。");
        _audio = new BoundedAudioQueue(MicrophoneCapture.SampleRate * 5);
        _processing = ProcessAudioAsync(_audio, vad);
        try
        {
            if (_externalCapture is not null) _externalCapture.Start();
            else _capture.Start(_settings.MicrophoneId);
            _status("listening", null);
        }
        catch
        {
            _audio.Complete(discard: true);
            throw;
        }
    }

    public void SetWavSaving(bool enabled)
    {
        _wavSaving = enabled;
        _wavSavingChanged(enabled, null);
    }

    public void SetVoiceCapturePeriod(string id) => Volatile.Write(ref _voiceCapturePeriodId, id);

    public async Task StopAsync(bool discard = false)
    {
        if (discard) _discard = true;
        // Invalidate a running decode before waiting for capture/FFmpeg termination.
        if (discard) _audio?.Complete(discard: true);
        _capture.Stop();
        if (_externalCapture is not null) await _externalCapture.StopAsync();
        _audio?.Complete(discard);
        if (_processing is not null) await _processing;
        _audio = null;
        _processing = null;
        _vad?.Dispose();
        _vad = null;
        _speechDetected = false;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _capture.SamplesAvailable -= OnSamplesAvailable;
        _capture.Failed -= OnCaptureFailed;
        _capture.Dispose();
        if (_externalCapture is not null)
        {
            _externalCapture.SamplesAvailable -= OnSamplesAvailable;
            _externalCapture.Failed -= OnCaptureFailed;
            await _externalCapture.DisposeAsync();
        }
        _recognizer.Dispose();
    }

    private async Task ProcessAudioAsync(BoundedAudioQueue queue, VoiceActivityDetector vad)
    {
        var chunker = new FixedSampleChunker(VadWindowSize);
        var history = new RollingAudioBuffer(AudioHistoryCapacity);
        var periods = new CapturePeriodTimeline(AudioHistoryCapacity);
        var epoch = queue.Epoch;
        try
        {
            while (await queue.ReadAsync() is { } audio)
            {
                if (audio.Epoch != epoch)
                {
                    epoch = audio.Epoch;
                    vad.Dispose(); vad = CreateVad(_paths, _settings); _vad = vad;
                    chunker = new FixedSampleChunker(VadWindowSize); history = new RollingAudioBuffer(AudioHistoryCapacity);
                    periods = new CapturePeriodTimeline(AudioHistoryCapacity);
                    _pendingSegments.Clear(); _speechDetected = false; _capturePeriodId = Guid.NewGuid().ToString("N");
                    _status("preparing", "認識処理が追いつかなかったため古い音声を破棄しました。現在の音声から再開します。");
                    _status("listening", null);
                }
                periods.Append(audio.Samples.Length, audio.VoiceCapturePeriodId);
                foreach (var chunk in chunker.Append(audio.Samples))
                {
                    if (_discard || queue.Epoch != epoch) break;
                    history.Append(chunk);
                    ProcessVadChunk(vad, chunk, history, periods, queue, epoch);
                }
            }
            if (_discard || epoch != queue.Epoch) return;
            var final = chunker.FlushPadded();
            if (final is not null)
            {
                history.Append(final);
                ProcessVadChunk(vad, final, history, periods, queue, epoch);
            }
            vad.Flush();
            DrainSegments(vad, periods);
            RecognizeReadySegments(history, queue, epoch, flush: true);
        }
        catch
        {
            if (!_discard) _status("unavailable", "音声認識処理に失敗しました。再試行してください。");
        }
    }

    private void ProcessVadChunk(VoiceActivityDetector vad, float[] chunk, RollingAudioBuffer history, CapturePeriodTimeline periods, BoundedAudioQueue queue, long epoch)
    {
        vad.AcceptWaveform(chunk);
        var detected = vad.IsSpeechDetected();
        if (detected != _speechDetected)
        {
            _speechDetected = detected;
            _status(detected ? "speechDetected" : "listening", null);
        }
        DrainSegments(vad, periods);
        RecognizeReadySegments(history, queue, epoch, flush: false);
    }

    private void DrainSegments(VoiceActivityDetector vad, CapturePeriodTimeline periods)
    {
        var pre = (int)(MicrophoneCapture.SampleRate * _settings.PreRollDurationSeconds);
        var post = (int)(MicrophoneCapture.SampleRate * _settings.PostRollDurationSeconds);
        while (!vad.IsEmpty())
        {
            var segment = vad.Front();
            vad.Pop();
            var start = (long)segment.Start - pre;
            var length = checked(pre + segment.Samples.Length + post);
            _pendingSegments.Enqueue(new PendingSegment(start, length, start + length, periods.At(start)));
        }
    }

    private void RecognizeReadySegments(RollingAudioBuffer history, BoundedAudioQueue queue, long epoch, bool flush)
    {
        while (_pendingSegments.TryPeek(out var segment) && (flush || history.TotalSamples >= segment.ReadyAt))
        {
            _pendingSegments.Dequeue();
            if (_discard || epoch != queue.Epoch) return;
            Recognize(history.ReadWithZeroPadding(segment.Start, segment.Length), segment.VoiceCapturePeriodId, queue, epoch);
        }
    }

    private void Recognize(float[] samples, string? voiceCapturePeriodId, BoundedAudioQueue queue, long epoch)
    {
        _status("recognizing", null);
        var recognizedAt = DateTimeOffset.UtcNow;
        // Sample the preview-only choice when the VAD segment becomes ready, never retroactively.
        var saveWav = _wavSaving;
        using var stream = _recognizer.CreateStream();
        stream.AcceptWaveform(MicrophoneCapture.SampleRate, samples);
        var stopwatch = Stopwatch.StartNew();
        _recognizer.Decode(stream);
        stopwatch.Stop();
        if (_discard || epoch != queue.Epoch) return;
        string? wavWarning = null;
        if (saveWav)
        {
            try
            {
                _waveFileStore.Save(recognizedAt, samples, MicrophoneCapture.SampleRate);
            }
            catch
            {
                _wavSaving = false;
                wavWarning = "WAVを保存できなかったためWAV保存をオフにしました。";
            }
        }
        if (_discard || epoch != queue.Epoch) return;
        _result(new RecognitionResultView(
            Guid.NewGuid().ToString("N"),
            _sessionId,
            _capturePeriodId,
            voiceCapturePeriodId,
            Interlocked.Increment(ref _sequence),
            recognizedAt.ToString("O"),
            RecognitionResultText.Normalize(stream.Result.Text.Trim()),
            samples.LongLength * 1000 / MicrophoneCapture.SampleRate,
            stopwatch.ElapsedMilliseconds));
        _status("listening", null);
        if (wavWarning is not null) _wavSavingChanged(false, wavWarning);
    }

    private void OnSamplesAvailable(float[] samples) => _audio?.Enqueue(samples, Volatile.Read(ref _voiceCapturePeriodId));

    private void OnCaptureFailed(Exception error)
    {
        _status("unavailable", _externalCapture is null
            ? "マイクから音声を取得できません。マイクとWindowsの権限を確認してください。"
            : "スマホ音声を取得できません。送信状態を確認して再試行してください。");
        _audio?.Complete(discard: true, failure: error);
    }

    private static OfflineRecognizer CreateRecognizer(ModelPaths paths)
        => new(CreateRecognizerConfig(paths));

    internal static OfflineRecognizerConfig CreateRecognizerConfig(ModelPaths paths)
    {
        var config = new OfflineRecognizerConfig();
        config.FeatConfig.SampleRate = MicrophoneCapture.SampleRate;
        config.FeatConfig.FeatureDim = 80;
        config.ModelConfig.NeMoCtc.Model = paths.Model;
        config.ModelConfig.Tokens = paths.Tokens;
        config.ModelConfig.NumThreads = 4;
        config.ModelConfig.Provider = "cpu";
        config.ModelConfig.Debug = 0;
        config.ModelConfig.ModelingUnit = "cjkchar";
        config.DecodingMethod = "greedy_search";
        return config;
    }

    private static VoiceActivityDetector CreateVad(ModelPaths paths, RecognitionSettings settings)
    {
        var config = new VadModelConfig();
        config.SampleRate = MicrophoneCapture.SampleRate;
        config.NumThreads = 1;
        config.Provider = "cpu";
        config.Debug = 0;
        config.SileroVad.Model = paths.Vad;
        config.SileroVad.Threshold = settings.VadThreshold;
        config.SileroVad.MinSpeechDuration = settings.MinSpeechDurationSeconds;
        config.SileroVad.MinSilenceDuration = settings.MinSilenceDurationSeconds;
        config.SileroVad.MaxSpeechDuration = settings.MaxSpeechDurationSeconds;
        config.SileroVad.WindowSize = VadWindowSize;
        return new VoiceActivityDetector(config, 310f);
    }

    private sealed record PendingSegment(long Start, int Length, long ReadyAt, string? VoiceCapturePeriodId);
}
