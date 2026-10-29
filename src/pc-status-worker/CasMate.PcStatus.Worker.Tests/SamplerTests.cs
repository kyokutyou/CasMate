using Xunit;
namespace CasMate.PcStatus.Worker.Tests;
public class SamplerTests
{
    [Fact] public void SumsProcessesWithinEngineButNotAcrossEnginesOrAdapters()
    {
        List<CounterValue> counters = [new("pid_1_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D", 30), new("pid_2_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D", 40), new("pid_1_luid_0x00000000_0x00000001_phys_0_eng_1_engtype_Copy", 60), new("pid_1_luid_0x00000000_0x00000002_phys_0_eng_0_engtype_3D", 99)];
        Assert.Equal(70, GpuCounters.ForAdapter("00000000:00000001", counters, "valid", true).Value);
        Assert.Equal(99, GpuCounters.ForAdapter("00000000:00000002", counters, "valid", true).Value);
        Assert.Null(GpuCounters.ForAdapter("00000000:00000003", counters, "valid", true).Value);
    }
    [Theory] [InlineData("unsupported")] [InlineData("denied")] [InlineData("failed")]
    public void MissingCountersAreNotZero(string reason)
    {
        var result = GpuCounters.ForAdapter("00000000:00000001", [], reason, false);
        Assert.Null(result.Value); Assert.Equal(reason, result.Status);
    }
    [Fact] public void MissingEngineDoesNotProduceFalseCompleteGpuValue()
    {
        List<CounterValue> counters = [new("pid_1_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D", null), new("pid_2_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D", 20)];
        Assert.Null(GpuCounters.ForAdapter("00000000:00000001", counters, "valid", true).Value);
    }
    private const long Epoch = 116444736000000000L;
    private static ProcessReading P(int pid, int parent, int createdMs, double cpu, double? memory) => new(pid, parent, Epoch + createdMs * 10000L, cpu, memory);
    [Fact] public void UsesCreationTimeCpuDeltaMachineDenominatorAndPrivateMemory()
    {
        var sampler = new ProcessSampler(); ProcessRoot[] roots = [new(10, 100, 100, true)];
        var first = sampler.Aggregate(roots, [P(10, 0, 100, 100, 200), P(11, 10, 101, 50, 300), P(99, 0, 101, 999, 999)], 0, 4);
        Assert.Null(first.Cpu.Value); Assert.Equal(500, first.Memory.Value); Assert.False(first.Incomplete);
        var next = sampler.Aggregate(roots, [P(10, 0, 100, 200, 210), P(11, 10, 101, 150, 310)], 1000, 4);
        Assert.Equal(5, next.Cpu.Value); Assert.Equal(520, next.Memory.Value);
    }
    [Fact] public void ExcludesReusedPidAndChildrenOfReusedParent()
    {
        var sampler = new ProcessSampler(); ProcessRoot[] roots = [new(10, 100, 100, true)];
        sampler.Aggregate(roots, [P(10, 0, 100, 100, 200)], 0, 4);
        var next = sampler.Aggregate(roots, [P(10, 0, 200, 200, 999), P(11, 10, 201, 100, 999)], 1000, 4);
        Assert.Null(next.Memory.Value); Assert.True(next.Incomplete);
    }
    [Fact] public void RetainsOwnedOrphanButExcludesUnregisteredBrowserAndExternalVoicevox()
    {
        var sampler = new ProcessSampler(); ProcessRoot[] roots = [new(10, 100, 100, false), new(20, 101, 101, true)];
        var first = sampler.Aggregate(roots, [P(10, 0, 100, 100, 100), P(20, 10, 101, 100, 200), P(21, 20, 102, 100, 300), P(30, 10, 103, 100, 900), P(40, 0, 103, 100, 900)], 0, 4);
        Assert.Equal(600, first.Memory.Value);
        var next = sampler.Aggregate([roots[0]], [P(10, 0, 100, 100, 100), P(21, 20, 102, 100, 300)], 1000, 4);
        Assert.Equal(400, next.Memory.Value);
    }
    [Fact] public void PartialMemoryIsMarkedAndNewProcessDoesNotCreateCpuSpike()
    {
        var sampler = new ProcessSampler(); ProcessRoot[] roots = [new(10, 100, 100, true)];
        sampler.Aggregate(roots, [P(10, 0, 100, 100, 100)], 0, 4);
        var next = sampler.Aggregate(roots, [P(10, 0, 100, 100, 100), P(11, 10, 101, 5000, null)], 1000, 4);
        Assert.Equal(100, next.Memory.Value); Assert.Equal(0, next.Cpu.Value); Assert.True(next.Incomplete);
    }
}
