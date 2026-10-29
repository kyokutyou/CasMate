using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;
internal record GpuSample(string Id, string Name, string Kind, Metric Capacity, Metric Usage, Metric DedicatedMemory, Metric SharedMemory);
internal record MemorySample(Metric Used, Metric Total);
internal record Sample(string GpuStatus, List<GpuSample> Gpus, MemorySample Memory, ApplicationSample Application);
internal sealed class Sampler : IDisposable
{
    private readonly GpuCounters counters = new();
    private readonly ProcessSampler processes = new();
    public Sample Sample(ProcessRoot[] roots)
    {
        var gpus = new List<GpuSample>(); var gpuStatus = "valid";
        try
        {
            var ready = counters.Collect();
            var usage = counters.Read("usage"); var dedicated = counters.Read("dedicated"); var shared = counters.Read("shared");
            foreach (var adapter in Native.Adapters())
                gpus.Add(new(adapter.Id, adapter.Name, adapter.Dedicated ? "dedicated" : "integrated", Metric.Valid(adapter.Capacity),
                    ready ? GpuCounters.ForAdapter(adapter.Id, usage.Values, usage.Status, true) : Metric.Missing(usage.Status == "valid" ? "pending" : usage.Status),
                    GpuCounters.ForAdapter(adapter.Id, dedicated.Values, dedicated.Status, false), GpuCounters.ForAdapter(adapter.Id, shared.Values, shared.Status, false)));
        }
        catch (UnauthorizedAccessException) { gpuStatus = "denied"; }
        catch { gpuStatus = "unsupported"; }
        MemorySample memory;
        try
        {
            var m = new Native.MemoryStatus { Length = (uint)Marshal.SizeOf<Native.MemoryStatus>() };
            memory = Native.GlobalMemoryStatusEx(ref m) ? new(Metric.Valid(m.TotalPhysical - m.AvailablePhysical), Metric.Valid(m.TotalPhysical)) : new(Metric.Missing("failed"), Metric.Missing("failed"));
        }
        catch { memory = new(Metric.Missing("failed"), Metric.Missing("failed")); }
        ApplicationSample application;
        try { application = processes.Sample(roots); }
        catch { application = new(Metric.Missing("failed"), Metric.Missing("failed"), true); }
        return new(gpuStatus, gpus, memory, application);
    }
    public void Dispose() => counters.Dispose();
}
