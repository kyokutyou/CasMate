namespace CasMate.SpeechRecognition.Worker;

internal sealed record CapturedAudio(float[] Samples, long Epoch, string? VoiceCapturePeriodId = null);

// The capture/drain thread never waits for offline decoding. Overflow starts a fresh capture period.
internal sealed class BoundedAudioQueue(int sampleCapacity)
{
    private readonly object _gate = new();
    private readonly Queue<CapturedAudio> _queue = new();
    private readonly SemaphoreSlim _changed = new(0, 1);
    private readonly int _sampleCapacity = sampleCapacity > 0 ? sampleCapacity : throw new ArgumentOutOfRangeException(nameof(sampleCapacity));
    private int _samples;
    private long _epoch;
    private bool _complete;
    private Exception? _failure;

    public long Epoch { get { lock (_gate) return _epoch; } }
    internal int WaitingSamples { get { lock (_gate) return _samples; } }

    public bool Enqueue(float[] samples, string? voiceCapturePeriodId = null)
    {
        lock (_gate)
        {
            if (_complete || samples.Length == 0) return false;
            var overflow = samples.Length + _samples > _sampleCapacity;
            if (overflow) { _queue.Clear(); _samples = 0; _epoch++; }
            var current = samples.Length <= _sampleCapacity ? samples : samples[^_sampleCapacity..];
            _queue.Enqueue(new CapturedAudio(current, _epoch, voiceCapturePeriodId)); _samples += current.Length;
            Signal(); return overflow;
        }
    }

    public async ValueTask<CapturedAudio?> ReadAsync()
    {
        while (true)
        {
            lock (_gate)
            {
                if (_queue.TryDequeue(out var item)) { _samples -= item.Samples.Length; return item; }
                if (_complete)
                {
                    if (_failure is not null) throw _failure;
                    return null;
                }
            }
            await _changed.WaitAsync();
        }
    }

    public void Complete(bool discard = false, Exception? failure = null)
    {
        lock (_gate)
        {
            if (discard) { _epoch++; _queue.Clear(); _samples = 0; }
            _complete = true; _failure = failure; Signal();
        }
    }

    private void Signal() { if (_changed.CurrentCount == 0) _changed.Release(); }
}
