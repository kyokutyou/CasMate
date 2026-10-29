namespace CasMate.SpeechRecognition.Worker;

internal static class Pcm16Converter
{
    public static float[] ToFloatSamples(ReadOnlySpan<byte> pcmBytes)
    {
        var samples = new float[pcmBytes.Length / sizeof(short)];
        for (var index = 0; index < samples.Length; index++)
        {
            var offset = index * sizeof(short);
            var value = (short)(pcmBytes[offset] | (pcmBytes[offset + 1] << 8));
            samples[index] = value / 32768f;
        }
        return samples;
    }

    public static short ToPcm16(float sample)
    {
        var clamped = Math.Clamp(sample, -1f, 1f);
        return clamped >= 0
            ? (short)Math.Round(clamped * short.MaxValue)
            : (short)Math.Round(clamped * -short.MinValue);
    }
}
