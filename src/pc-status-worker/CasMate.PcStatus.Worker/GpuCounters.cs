using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace CasMate.PcStatus.Worker;
internal record Metric(double? Value, string Status)
{
    public static Metric Missing(string status = "pending") => new(null, status);
    public static Metric Valid(double value) => new(value, "valid");
}
internal record CounterValue(string Name, double? Value);
internal sealed class GpuCounters : IDisposable
{
    private nint query;
    private readonly Dictionary<string, (nint Handle, string Error)> counters = new();
    private bool collected;
    public GpuCounters()
    {
        if (Native.PdhOpenQueryW(null, 0, out query) != 0) return;
        Add("usage", @"\GPU Engine(*)\Utilization Percentage");
        Add("dedicated", @"\GPU Adapter Memory(*)\Dedicated Usage");
        Add("shared", @"\GPU Adapter Memory(*)\Shared Usage");
    }
    private void Add(string name, string path)
    {
        var status = Native.PdhAddEnglishCounterW(query, path, 0, out var handle);
        counters[name] = (handle, status == 5 || status == 0xC0000BDB ? "denied" : "unsupported");
    }
    public bool Collect()
    {
        var before = collected;
        collected = query != 0 && Native.PdhCollectQueryData(query) == 0;
        return before && collected;
    }
    public (List<CounterValue> Values, string Status) Read(string name)
    {
        if (!counters.TryGetValue(name, out var counter) || counter.Handle == 0) return ([], counters.GetValueOrDefault(name).Error ?? "unsupported");
        if (!collected) return ([], "failed");
        uint size = 0;
        var status = Native.PdhGetFormattedCounterArrayW(counter.Handle, 0x200 | 0x8000, ref size, out _, 0);
        if (status != 0x800007D2 || size == 0 || size > 32_000_000) return ([], status == 5 ? "denied" : "failed");
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            status = Native.PdhGetFormattedCounterArrayW(counter.Handle, 0x200 | 0x8000, ref size, out var count, buffer);
            if (status != 0) return ([], status == 5 ? "denied" : "failed");
            var result = new List<CounterValue>();
            var stride = Marshal.SizeOf<Native.CounterItem>();
            for (var i = 0; i < count; i++)
            {
                var item = Marshal.PtrToStructure<Native.CounterItem>(buffer + i * stride);
                var valid = item.Status <= 1 && double.IsFinite(item.Value) && item.Value >= 0;
                result.Add(new(Marshal.PtrToStringUni(item.Name) ?? "", valid ? item.Value : null));
            }
            return (result, "valid");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    internal static Metric ForAdapter(string id, List<CounterValue> values, string status, bool engines)
    {
        if (status != "valid") return Metric.Missing(status);
        var matching = values.Select(v => (Value: v, Match: Regex.Match(v.Name, @"luid_0x([0-9a-f]+)_0x([0-9a-f]+)_phys_(\d+)(?:_eng_(\d+))?", RegexOptions.IgnoreCase)))
            .Where(v => v.Match.Success && $"{v.Match.Groups[1].Value}:{v.Match.Groups[2].Value}".Equals(id, StringComparison.OrdinalIgnoreCase)).ToList();
        if (matching.Count == 0 || matching.Any(v => v.Value.Value is null)) return Metric.Missing("failed");
        if (!engines) return Metric.Valid(matching.Sum(v => v.Value.Value!.Value));
        // Process instances for one physical engine are additive; different engines are not.
        return Metric.Valid(Math.Clamp(matching.GroupBy(v => $"{v.Match.Groups[3].Value}:{v.Match.Groups[4].Value}")
            .Max(engine => engine.Sum(v => v.Value.Value!.Value)), 0, 100));
    }
    public void Dispose() { if (query != 0) Native.PdhCloseQuery(query); query = 0; }
}
