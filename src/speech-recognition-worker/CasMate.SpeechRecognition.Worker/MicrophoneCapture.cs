using System.Security.Cryptography;
using System.Text;
using NAudio.Wave;

namespace CasMate.SpeechRecognition.Worker;

internal sealed record MicrophoneView(string Id, string Name, bool IsDefault, int DeviceNumber);

internal sealed class MicrophoneCapture : IDisposable
{
    public const int SampleRate = 16_000;
    private WaveInEvent? _waveIn;

    public event Action<float[]>? SamplesAvailable;
    public event Action<Exception>? Failed;

    public static IReadOnlyList<MicrophoneView> Enumerate()
    {
        var devices = new List<MicrophoneView>
        {
            new("wavein:default", "Windowsの既定の入力デバイス", true, -1),
        };
        for (var index = 0; index < WaveIn.DeviceCount; index++)
        {
            var capabilities = WaveIn.GetCapabilities(index);
            devices.Add(new MicrophoneView(
                CreateId(index, capabilities.ProductName),
                capabilities.ProductName,
                false,
                index));
        }
        return devices;
    }

    public void Start(string? microphoneId)
    {
        if (_waveIn is not null) throw new InvalidOperationException("マイクは既に開始されています。");
        var devices = Enumerate();
        var selected = microphoneId is null
            ? devices.FirstOrDefault(device => device.IsDefault)
            : devices.FirstOrDefault(device => device.Id == microphoneId);
        if (selected is null)
            throw new InvalidOperationException("選択したマイクが見つかりません。マイクを再選択してください。");

        var waveIn = new WaveInEvent
        {
            DeviceNumber = selected.DeviceNumber,
            WaveFormat = new WaveFormat(SampleRate, 16, 1),
            BufferMilliseconds = 32,
            NumberOfBuffers = 4,
        };
        waveIn.DataAvailable += OnDataAvailable;
        waveIn.RecordingStopped += OnRecordingStopped;
        try
        {
            waveIn.StartRecording();
            _waveIn = waveIn;
        }
        catch
        {
            waveIn.DataAvailable -= OnDataAvailable;
            waveIn.RecordingStopped -= OnRecordingStopped;
            waveIn.Dispose();
            throw;
        }
    }

    public void Stop()
    {
        var waveIn = Interlocked.Exchange(ref _waveIn, null);
        if (waveIn is null) return;
        waveIn.StopRecording();
        waveIn.DataAvailable -= OnDataAvailable;
        waveIn.RecordingStopped -= OnRecordingStopped;
        waveIn.Dispose();
    }

    public void Dispose() => Stop();

    private void OnDataAvailable(object? sender, WaveInEventArgs eventArgs)
    {
        if (eventArgs.BytesRecorded > 0)
            SamplesAvailable?.Invoke(Pcm16Converter.ToFloatSamples(eventArgs.Buffer.AsSpan(0, eventArgs.BytesRecorded)));
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs eventArgs)
    {
        if (eventArgs.Exception is not null) Failed?.Invoke(eventArgs.Exception);
    }

    private static string CreateId(int index, string name)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(name)))[..12].ToLowerInvariant();
        return $"wavein:{index}:{hash}";
    }
}
