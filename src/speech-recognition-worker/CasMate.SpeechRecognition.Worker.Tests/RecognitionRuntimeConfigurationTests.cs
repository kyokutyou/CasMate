using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class RecognitionRuntimeConfigurationTests
{
    [Fact]
    public void ParakeetCtcUsesGreedySearch()
    {
        var paths = new ModelPaths("model.onnx", "tokens.txt", "vad.onnx");

        var config = RecognitionRuntime.CreateRecognizerConfig(paths);

        Assert.Equal("model.onnx", config.ModelConfig.NeMoCtc.Model);
        Assert.Equal("tokens.txt", config.ModelConfig.Tokens);
        Assert.Equal("greedy_search", config.DecodingMethod);
        Assert.Equal(4, config.ModelConfig.NumThreads);
        Assert.Equal("cpu", config.ModelConfig.Provider);
    }
}
