using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class AudioBuffersTests
{
    [Fact]
    public void FixedSampleChunker_PreservesSamplesAcrossInputBoundaries()
    {
        var chunker = new FixedSampleChunker(4);

        Assert.Empty(chunker.Append([1, 2, 3]));
        Assert.Equal([1, 2, 3, 4], Assert.Single(chunker.Append([4, 5])));
        var padded = chunker.FlushPadded();
        Assert.NotNull(padded);
        Assert.Equal([5, 0, 0, 0], padded);
    }

    [Fact]
    public void RollingAudioBuffer_ReturnsAvailableAudioAndPadsOutsideHistory()
    {
        var buffer = new RollingAudioBuffer(4);
        buffer.Append([1, 2, 3, 4, 5]);

        Assert.Equal(5, buffer.TotalSamples);
        Assert.Equal([0, 2, 3, 4, 5, 0], buffer.ReadWithZeroPadding(0, 6));
    }
}
