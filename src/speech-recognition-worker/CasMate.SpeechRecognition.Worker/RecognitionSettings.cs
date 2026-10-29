namespace CasMate.SpeechRecognition.Worker;

internal sealed record RecognitionSettings
{
    public static RecognitionSettings Default => new();

    public bool Enabled { get; init; }
    public string? MicrophoneId { get; init; }
    public float VadThreshold { get; init; } = 0.3f;
    public float MinSpeechDurationSeconds { get; init; } = 0.25f;
    public float MinSilenceDurationSeconds { get; init; } = 0.5f;
    public float MaxSpeechDurationSeconds { get; init; } = 30f;
    public float PreRollDurationSeconds { get; init; } = 0.3f;
    public float PostRollDurationSeconds { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (!float.IsFinite(VadThreshold) || VadThreshold is <= 0 or >= 1)
            errors.Add("VAD閾値は0より大きく1未満で指定してください。");
        if (!float.IsFinite(MinSpeechDurationSeconds) || MinSpeechDurationSeconds is < 0.05f or > 5)
            errors.Add("最短発話は0.05～5秒で指定してください。");
        if (!float.IsFinite(MinSilenceDurationSeconds) || MinSilenceDurationSeconds is < 0.05f or > 5)
            errors.Add("無音判定は0.05～5秒で指定してください。");
        if (!float.IsFinite(MaxSpeechDurationSeconds) ||
            MaxSpeechDurationSeconds <= MinSpeechDurationSeconds || MaxSpeechDurationSeconds > 300)
            errors.Add("最長発話は最短発話より長く、300秒以下で指定してください。");
        if (!float.IsFinite(PreRollDurationSeconds) || PreRollDurationSeconds is < 0 or > 3 ||
            !float.IsFinite(PostRollDurationSeconds) || PostRollDurationSeconds is < 0 or > 3)
            errors.Add("発話前後は0～3秒で指定してください。");
        return errors;
    }
}
