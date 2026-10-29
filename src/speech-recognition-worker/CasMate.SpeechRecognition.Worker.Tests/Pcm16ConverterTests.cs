using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class Pcm16ConverterTests
{
    [Fact]
    public void ConvertsKnownPcmValuesToNormalizedSamples()
    {
        byte[] pcm = [0, 0, 0xff, 0x7f, 0, 0x80];

        var samples = Pcm16Converter.ToFloatSamples(pcm);

        Assert.Equal([0f, 32767f / 32768f, -1f], samples);
    }
}
