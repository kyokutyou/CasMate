using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;
internal record ProcessRoot(int Pid, double Earliest, double Latest, bool Descendants);
internal record ProcessReading(int Pid, int ParentPid, long Created, double CpuMilliseconds, double? PrivateMemory, bool Denied = false);
internal record ApplicationSample(Metric Cpu, Metric Memory, bool Incomplete);
internal sealed class ProcessSampler
{
    private readonly Dictionary<int, (long Created, bool Descendants)> owned = new();
    private Dictionary<(int Pid, long Created), double> previous = new();
    private double? previousAt;

    internal ApplicationSample Aggregate(ProcessRoot[] roots, List<ProcessReading> processes, double at, int processors, bool enumerationComplete = true)
    {
        var current = processes.ToDictionary(p => p.Pid);
        var incomplete = !enumerationComplete;
        foreach (var root in roots)
        {
            if (!current.TryGetValue(root.Pid, out var p)) { incomplete = true; continue; }
            var createdMs = (p.Created - 116444736000000000L) / 10000d;
            if (createdMs < root.Earliest || createdMs > root.Latest) { incomplete = true; continue; }
            owned[root.Pid] = (p.Created, root.Descendants);
        }
        foreach (var (pid, identity) in owned.ToArray())
            if (!current.TryGetValue(pid, out var p) || p.Created != identity.Created) owned.Remove(pid);
        bool added;
        do
        {
            added = false;
            foreach (var p in processes)
            {
                if (owned.ContainsKey(p.Pid)) continue;
                if (owned.TryGetValue(p.ParentPid, out var parent) && parent.Descendants && p.Created >= parent.Created)
                { owned[p.Pid] = (p.Created, true); added = true; }
            }
        } while (added);
        double memory = 0, cpu = 0; var measuredMemory = false;
        var next = new Dictionary<(int Pid, long Created), double>();
        foreach (var (pid, identity) in owned)
        {
            var p = current[pid];
            if (p.PrivateMemory is { } bytes) { memory += bytes; measuredMemory = true; } else incomplete = true;
            if (p.Denied) { incomplete = true; continue; }
            var key = (pid, identity.Created);
            next[key] = p.CpuMilliseconds;
            if (previous.TryGetValue(key, out var before)) cpu += Math.Max(0, p.CpuMilliseconds - before);
            else if (previousAt is not null) incomplete = true;
        }
        var cpuValue = previousAt is { } last && at > last && next.Count > 0
            ? Metric.Valid(Math.Clamp(cpu / (at - last) / processors * 100, 0, 100)) : Metric.Missing();
        previous = next; previousAt = at;
        return new(cpuValue, measuredMemory ? Metric.Valid(memory) : Metric.Missing("denied"), incomplete);
    }
    internal ApplicationSample Sample(ProcessRoot[] roots)
    {
        var snapshot = Native.CreateToolhelp32Snapshot(2, 0);
        if (snapshot == -1) return new(Metric.Missing("failed"), Metric.Missing("failed"), true);
        var entries = new List<(int Pid, int Parent)>();
        var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>(), Name = "" };
        try
        {
            if (!Native.Process32FirstW(snapshot, ref entry)) return new(Metric.Missing("failed"), Metric.Missing("failed"), true);
            do { entries.Add(((int)entry.Pid, (int)entry.ParentPid)); } while (Native.Process32NextW(snapshot, ref entry));
        }
        finally { Native.CloseHandle(snapshot); }
        // Read only known owned roots and potential descendants, never every process's memory.
        var candidates = new HashSet<int>(roots.Select(r => r.Pid).Concat(owned.Keys)) { Environment.ProcessId };
        var descendantRoots = new HashSet<int>(roots.Where(r => r.Descendants).Select(r => r.Pid).Concat(owned.Where(p => p.Value.Descendants).Select(p => p.Key))) { Environment.ProcessId };
        bool added;
        do
        {
            added = false;
            foreach (var e in entries) if (descendantRoots.Contains(e.Parent) && candidates.Add(e.Pid)) { descendantRoots.Add(e.Pid); added = true; }
        } while (added);
        var processes = new List<ProcessReading>(); var complete = true;
        foreach (var e in entries.Where(e => candidates.Contains(e.Pid)))
        {
            var handle = Native.OpenProcess(0x400 | 0x10, false, e.Pid);
            if (handle == 0) { complete = false; continue; }
            try
            {
                if (!Native.GetProcessTimes(handle, out var creation, out _, out var kernel, out var user)) { complete = false; continue; }
                var memory = new Native.ProcessMemory { Size = (uint)Marshal.SizeOf<Native.ProcessMemory>() };
                var ok = Native.GetProcessMemoryInfo(handle, ref memory, memory.Size);
                processes.Add(new(e.Pid, e.Parent, creation, (kernel + user) / 10000d, ok ? memory.PrivateWorkingSet : null));
            }
            finally { Native.CloseHandle(handle); }
        }
        var self = processes.Find(p => p.Pid == Environment.ProcessId);
        if (self is not null) owned[self.Pid] = (self.Created, true);
        return Aggregate(roots, processes, Stopwatch.GetTimestamp() * 1000d / Stopwatch.Frequency, Environment.ProcessorCount, complete);
    }
}
