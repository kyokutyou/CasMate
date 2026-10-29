namespace CasMate.SpeechRecognition.Worker;

// Offsets use the same sample timeline as VAD, including a partially filled chunk.
// Keep one boundary before the rolling audio history so pre-roll remains attributable.
internal sealed class CapturePeriodTimeline(int capacity)
{
    private readonly List<(long Start, string? Id)> _periods = [];
    private long _total;

    public void Append(int samples, string? id)
    {
        if (samples <= 0) return;
        if (_periods.Count == 0 || _periods[^1].Id != id) _periods.Add((_total, id));
        _total += samples;
        var oldest = _total - capacity;
        var remove = 0;
        while (remove + 1 < _periods.Count && _periods[remove + 1].Start <= oldest) remove++;
        if (remove > 0) _periods.RemoveRange(0, remove);
    }

    public string? At(long start)
    {
        for (var i = _periods.Count - 1; i >= 0; i--)
            if (_periods[i].Start <= start) return _periods[i].Id;
        return _periods.Count == 0 ? null : _periods[0].Id;
    }
}
