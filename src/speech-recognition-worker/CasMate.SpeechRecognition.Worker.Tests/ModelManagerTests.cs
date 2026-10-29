using CasMate.SpeechRecognition.Worker;
using System.Net;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class ModelManagerTests
{
    [Fact]
    public async Task InspectionReportsUnreadableModelAsFailureInsteadOfMissing()
    {
        var modelDirectory = Path.Combine(Path.GetTempPath(), $"casmate-model-locked-{Guid.NewGuid():N}");
        var modelFile = ModelPaths.FromRoot(ModelManager.ActiveModelDirectory(modelDirectory)).Model;
        Directory.CreateDirectory(Path.GetDirectoryName(modelFile)!);
        await File.WriteAllTextAsync(modelFile, "locked-model", TestContext.Current.CancellationToken);
        var states = new List<(string Status, string? Warning)>();
        try
        {
            using var locked = new FileStream(modelFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            await new ModelManager().InspectAsync(modelDirectory, (status, _, warning) => states.Add((status, warning)), TestContext.Current.CancellationToken);
            Assert.Equal(["validating", "failed"], states.Select(state => state.Status));
            Assert.Contains("アクセス", states[^1].Warning);
        }
        finally
        {
            Directory.Delete(modelDirectory, recursive: true);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InspectionDoesNotDownloadOrChangeMissingOrCorruptModels(bool corrupt)
    {
        var modelDirectory = Path.Combine(Path.GetTempPath(), $"casmate-model-inspect-{Guid.NewGuid():N}");
        var modelFile = ModelPaths.FromRoot(ModelManager.ActiveModelDirectory(modelDirectory)).Model;
        if (corrupt)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(modelFile)!);
            await File.WriteAllTextAsync(modelFile, "incomplete-model", TestContext.Current.CancellationToken);
        }
        var handler = new FailingHttpHandler();
        var manager = new ModelManager(new HttpClient(handler));
        var states = new List<string>();
        try
        {
            await manager.InspectAsync(modelDirectory, (status, _, warning) =>
            {
                states.Add(status);
                Assert.Null(warning);
            }, TestContext.Current.CancellationToken);
            Assert.Equal(["validating", "missing"], states);
            Assert.Equal(0, handler.Requests);
            Assert.Equal(corrupt, Directory.Exists(modelDirectory));
            if (corrupt) Assert.Equal("incomplete-model", await File.ReadAllTextAsync(modelFile, TestContext.Current.CancellationToken));
        }
        finally
        {
            if (Directory.Exists(modelDirectory)) Directory.Delete(modelDirectory, recursive: true);
        }
    }

    [Fact]
    public void ActiveModelUsesItsOwnVersionedDirectory()
    {
        var modelDirectory = Path.Combine("C:", "app-data", "models");

        var activeDirectory = ModelManager.ActiveModelDirectory(modelDirectory);

        Assert.Equal(Path.Combine(Path.GetFullPath(modelDirectory), "parakeet-ctc-v1"), activeDirectory);
        Assert.NotEqual(Path.GetFullPath(modelDirectory), activeDirectory);
    }

    [Fact]
    public void ModelPathsPointToTheParakeetCtcFiles()
    {
        var activeDirectory = Path.Combine("C:", "app-data", "models", "parakeet-ctc-v1");

        var paths = ModelPaths.FromRoot(activeDirectory);

        Assert.Equal(
            Path.Combine(activeDirectory, "sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8", "model.int8.onnx"),
            paths.Model);
        Assert.Equal(
            Path.Combine(activeDirectory, "sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8", "tokens.txt"),
            paths.Tokens);
        Assert.Equal(Path.Combine(activeDirectory, "silero_vad.onnx"), paths.Vad);
    }

    [Fact]
    public async Task FailedParakeetPreparationDoesNotDeleteExistingBaseContents()
    {
        var modelDirectory = Path.Combine(Path.GetTempPath(), $"casmate-model-test-{Guid.NewGuid():N}");
        var existingFile = Path.Combine(
            modelDirectory,
            "unmanaged-data",
            "existing.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(existingFile)!);
        await File.WriteAllTextAsync(existingFile, "existing-data", TestContext.Current.CancellationToken);
        var manager = new ModelManager(new HttpClient(new FailingHttpHandler()));

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                manager.EnsureAsync(
                    modelDirectory,
                    (_, _, _) => { },
                    TestContext.Current.CancellationToken));

            Assert.True(File.Exists(existingFile));
            Assert.Equal(
                "existing-data",
                await File.ReadAllTextAsync(existingFile, TestContext.Current.CancellationToken));
        }
        finally
        {
            if (Directory.Exists(modelDirectory)) Directory.Delete(modelDirectory, recursive: true);
        }
    }

    private sealed class FailingHttpHandler : HttpMessageHandler
    {
        public int Requests { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
