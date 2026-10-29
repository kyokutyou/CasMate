package jp.casmate.app.outdoor

enum class OutdoorAdaptationPhase { VIDEO, LOW_VIDEO, HELD, PROBING }
data class OutdoorAdaptationView(val target: Int, val phase: OutdoorAdaptationPhase = OutdoorAdaptationPhase.VIDEO,
    val message: String = "", val generatedBitrate: Long? = null,
    val trend: OutdoorBitrateTrend = OutdoorBitrateTrend.STARTING,
    val diagnostics: OutdoorAdaptationDiagnostics = OutdoorAdaptationDiagnostics(),
    val acceptedTarget: Int = target,
    val apiResult: com.pedro.encoder.video.BitrateChangeResult? = null,
    val pending: OutdoorAdaptationAction? = null,
    val probeGeneration: Long = 1,
    /** Advances only after new live video and its ACK satisfy the recovery success window. */
    val completedProbeGeneration: Long = 0,
    val probeStartedAtMs: Long? = null,
    val probeDeadlineAtMs: Long? = null,
    val releaseApplied: Boolean = false,
    val probeVideoConfirmed: Boolean = false,
    val probeAckConfirmed: Boolean = false,
    val controlStopped: Boolean = false,
    val increaseBlocked: Boolean = false) {
    val locksCamera get() = phase in setOf(OutdoorAdaptationPhase.HELD, OutdoorAdaptationPhase.PROBING) || pending?.kind == OutdoorAdaptationOperation.HOLD
}
