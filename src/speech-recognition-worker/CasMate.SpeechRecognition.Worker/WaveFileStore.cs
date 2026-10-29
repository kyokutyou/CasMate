namespace CasMate.SpeechRecognition.Worker;

internal sealed class WaveFileStore(string rootDirectory)
{
    public string Save(DateTimeOffset recordedAt, ReadOnlySpan<float> samples, int sampleRate)
    {
        var dayDirectory = Path.Combine(rootDirectory, recordedAt.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(dayDirectory);
        var finalPath = Path.Combine(
            dayDirectory,
            $"{recordedAt:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}.wav");
        var temporaryPath = finalPath + ".tmp";
        try
        {
            WriteWave(temporaryPath, samples, sampleRate);
            File.Move(temporaryPath, finalPath);
            return finalPath;
        }
        catch
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            throw;
        }
    }

    private static void WriteWave(string path, ReadOnlySpan<float> samples, int sampleRate)
    {
        const short channels = 1;
        const short bitsPerSample = 16;
        var dataLength = checked(samples.Length * sizeof(short));
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var writer = new BinaryWriter(stream);
        writer.Write("RIFF"u8);
        writer.Write(36 + dataLength);
        writer.Write("WAVE"u8);
        writer.Write("fmt "u8);
        writer.Write(16);
        writer.Write((short)1);
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * channels * bitsPerSample / 8);
        writer.Write((short)(channels * bitsPerSample / 8));
        writer.Write(bitsPerSample);
        writer.Write("data"u8);
        writer.Write(dataLength);
        foreach (var sample in samples) writer.Write(Pcm16Converter.ToPcm16(sample));
    }
}
