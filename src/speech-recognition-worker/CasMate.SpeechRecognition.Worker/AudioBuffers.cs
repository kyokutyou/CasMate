namespace CasMate.SpeechRecognition.Worker;

internal sealed class FixedSampleChunker(int chunkSize)
{
    private readonly float[] _buffer = new float[chunkSize > 0
        ? chunkSize
        : throw new ArgumentOutOfRangeException(nameof(chunkSize))];
    private int _count;

    public IEnumerable<float[]> Append(ReadOnlySpan<float> samples)
    {
        var chunks = new List<float[]>();
        var offset = 0;
        while (offset < samples.Length)
        {
            var count = Math.Min(_buffer.Length - _count, samples.Length - offset);
            samples.Slice(offset, count).CopyTo(_buffer.AsSpan(_count));
            _count += count;
            offset += count;
            if (_count != _buffer.Length) continue;
            chunks.Add((float[])_buffer.Clone());
            _count = 0;
        }
        return chunks;
    }

    public float[]? FlushPadded()
    {
        if (_count == 0) return null;
        var chunk = new float[_buffer.Length];
        Array.Copy(_buffer, chunk, _count);
        _count = 0;
        return chunk;
    }
}

internal sealed class RollingAudioBuffer(int capacity)
{
    private readonly float[] _samples = new float[capacity > 0
        ? capacity
        : throw new ArgumentOutOfRangeException(nameof(capacity))];
    private long _totalSamples;
    public long TotalSamples => _totalSamples;
    private long OldestSample => Math.Max(0, _totalSamples - _samples.Length);

    public void Append(ReadOnlySpan<float> samples)
    {
        foreach (var sample in samples)
        {
            _samples[(int)(_totalSamples % _samples.Length)] = sample;
            _totalSamples++;
        }
    }

    public float[] ReadWithZeroPadding(long start, int length)
    {
        var result = new float[length];
        var availableStart = Math.Max(start, OldestSample);
        var availableEnd = Math.Min(start + length, _totalSamples);
        for (var position = availableStart; position < availableEnd; position++)
            result[position - start] = _samples[(int)(position % _samples.Length)];
        return result;
    }
}
