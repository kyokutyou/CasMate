using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class CapturePeriodTimelineTests
{
    [Fact]
    public void ADelayedUtteranceKeepsThePeriodOfItsFirstSamplesIncludingPreRoll()
    {
        var periods = new CapturePeriodTimeline(1000);
        periods.Append(300, "old");
        periods.Append(700, "new");
        Assert.Equal("old", periods.At(299));
        Assert.Equal("new", periods.At(300));
        Assert.Equal("old", periods.At(-100));
        periods.Append(300, "latest");
        Assert.Equal("new", periods.At(700));
        Assert.Equal("latest", periods.At(1000));
    }

    [Fact]
    public async Task QueuedAudioRetainsItsCapturePeriodAcrossPermissionChangesAndOverflow()
    {
        var queue = new BoundedAudioQueue(3);
        queue.Enqueue([1], "old");
        queue.Enqueue([2], "new");
        Assert.Equal("old", (await queue.ReadAsync())!.VoiceCapturePeriodId);
        Assert.Equal("new", (await queue.ReadAsync())!.VoiceCapturePeriodId);
        queue.Enqueue([3, 4], "old");
        queue.Enqueue([5, 6], "new");
        Assert.Equal("new", (await queue.ReadAsync())!.VoiceCapturePeriodId);
        queue.Complete();
    }
}
