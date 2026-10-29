package jp.casmate.app.outdoor

enum class OutdoorBitrateTrend { STARTING, REDUCED, RECOVERING }
enum class OutdoorObservationIssue { NONE, NOT_STARTED, UNAVAILABLE, INVALID, FUTURE, STALE, INTERVAL, EPOCH, COUNTER_RESET, BASELINE }

enum class OutdoorAdaptationReason {
    NOT_STARTED,
    UNAVAILABLE,
    BASELINE,
    REBASELINE,
    COUNTER_RESET,
    AUDIO_DROPPED,
    AUDIO_STALLED,
    QUEUE_CONGESTION,
    NETWORK_PRESSURE,
    STABLE,
    OBSERVING,
    FIXED,
    CONTROL_STOPPED,
    EXCESS_OUTPUT,
    VIDEO_WRITE_STALLED,
}

data class OutdoorAdaptationDiagnostics(
    val reason: OutdoorAdaptationReason = OutdoorAdaptationReason.NOT_STARTED,
    val windowMs: Long? = null,
    val queued: Int? = null,
    val queuedBytes: Long? = null,
    val rttMs: Double? = null,
    val nakDelta: Long? = null,
    val sentAudioDelta: Long? = null,
    val droppedAudioDelta: Long? = null,
    val sentVideoDelta: Long? = null,
    val droppedVideoDelta: Long? = null,
    val badForMs: Long = 0,
    val stableForMs: Long = 0,
    val videoWriteStalledForMs: Long? = null,
    val recoveryWaitMs: Long? = null,
    val nextProbeInMs: Long? = null,
    val baselineRttMs: Double? = null,
    val lagMs: Double? = null,
    val audioWaitMs: Long? = null,
    val unackedAgeMs: Long? = null,
    val expiredDelta: Long? = null,
    val ackDelta: Long? = null,
    val comparable: Boolean = false,
    val observationIssue: OutdoorObservationIssue = OutdoorObservationIssue.NOT_STARTED,
)
