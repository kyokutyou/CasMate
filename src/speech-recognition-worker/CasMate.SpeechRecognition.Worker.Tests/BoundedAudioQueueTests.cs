using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class BoundedAudioQueueTests
{
    [Fact]
    public async Task OverflowDiscardsOldWaitingAudioAndInvalidatesRunningDecode()
    {
        var queue = new BoundedAudioQueue(5);
        queue.Enqueue([1, 2]); var decoding = await queue.ReadAsync();
        queue.Enqueue([3, 4, 5]);
        Assert.True(queue.Enqueue([6, 7, 8]));
        Assert.NotEqual(decoding!.Epoch, queue.Epoch);
        Assert.Equal(3, queue.WaitingSamples);
        var fresh = await queue.ReadAsync();
        Assert.Equal([6, 7, 8], fresh!.Samples);
        Assert.Equal(queue.Epoch, fresh.Epoch);
        queue.Complete(); Assert.Null(await queue.ReadAsync());
    }

    [Fact]
    public async Task NormalCompletionPreservesRemainingAudioButDiscardDropsIt()
    {
        var flush = new BoundedAudioQueue(5); flush.Enqueue([1, 2]); flush.Complete();
        var flushed = await flush.ReadAsync(); Assert.Equal([1, 2], flushed!.Samples); Assert.Null(await flush.ReadAsync());
        var discard = new BoundedAudioQueue(5); discard.Enqueue([1, 2]); var epoch = discard.Epoch;
        discard.Complete(discard: true); Assert.NotEqual(epoch, discard.Epoch); Assert.Null(await discard.ReadAsync());
        Assert.False(discard.Enqueue([3]));
    }

    [Fact]
    public async Task AnOversizedReadRetainsOnlyTheNewestCapacityAndWakesTheReader()
    {
        var queue = new BoundedAudioQueue(3); var reading = queue.ReadAsync().AsTask();
        Assert.False(reading.IsCompleted); Assert.True(queue.Enqueue([1, 2, 3, 4, 5]));
        var current = await reading.WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);
        Assert.Equal([3, 4, 5], current!.Samples);
        Assert.Equal(0, queue.WaitingSamples);
    }
}
