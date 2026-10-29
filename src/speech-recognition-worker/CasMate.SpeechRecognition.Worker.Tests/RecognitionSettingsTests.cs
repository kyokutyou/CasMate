using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class RecognitionSettingsTests
{
    [Fact]
    public void SpecifiedDefaultsAreValid()
    {
        Assert.Empty(RecognitionSettings.Default.Validate());
    }

    [Theory]
    [InlineData(0f)]
    [InlineData(1f)]
    public void VadThresholdOutsideTheContractIsRejected(float vadThreshold)
    {
        var settings = RecognitionSettings.Default with
        {
            VadThreshold = vadThreshold,
        };

        Assert.NotEmpty(settings.Validate());
    }
}
