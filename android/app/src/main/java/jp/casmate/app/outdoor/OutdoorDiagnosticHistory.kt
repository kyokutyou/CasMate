package jp.casmate.app.outdoor

import com.pedro.common.TransportSnapshot
import com.pedro.encoder.video.BitrateChangeResult
import jp.casmate.app.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

data class OutdoorDiagnosticMetadata(val quality: OutdoorQuality, val portrait: Boolean, val timestamp: Boolean,
    val encoder: String = "", val emergencyBps: Int = 250000, val holdBps: Int = 150000, val injected: Boolean = false)
data class OutdoorDiagnosticRow(val atMs: Long, val sample: TransportSnapshot?, val view: OutdoorAdaptationView,
    val hidden: Boolean, val actual: TransportSnapshot?)
data class OutdoorDiagnosticEvent(val atMs: Long, val action: OutdoorAdaptationAction?, val phase: OutdoorAdaptationPhase,
    val requested: Int, val accepted: Int, val api: BitrateChangeResult? = null, val applied: Boolean? = null,
    val kind: OutdoorDiagnosticEventKind = OutdoorDiagnosticEventKind.STATE)
enum class OutdoorDiagnosticEventKind { STATE, APPLY, STOP }

/** A small read-only projection; opening the UI never copies the observation ring. */
data class OutdoorDiagnosticHistorySummary(val count: Int = 0, val firstMs: Long? = null, val lastMs: Long? = null,
    val discardedObservations: Long = 0, val discardedEvents: Long = 0)

/** Immutable copy taken before opening the save picker. Only this allowlist is serialized. */
data class OutdoorDiagnosticCapture(val startedAt: Long, val metadata: OutdoorDiagnosticMetadata,
    val observations: List<OutdoorDiagnosticRow>, val events: List<OutdoorDiagnosticEvent>,
    val discardedObservations: Long, val discardedEvents: Long) {
    fun json(): String {
        fun relative(at: Long?) = at?.let { maxOf(0, it - startedAt) }
        fun objectOf(vararg entries: Pair<String, Any?>) = JSONObject().apply {
            entries.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
        }
        fun snapshot(s: TransportSnapshot?) = s?.let { objectOf(
            "generation" to it.generation, "atMs" to relative(it.atMs), "valid" to it.valid,
            "queuedFrames" to it.queuedFrames, "queuedBytes" to it.queuedBytes, "processingBytes" to it.processingBytes,
            "localWaitMs" to it.localWaitMs, "audioWaitMs" to it.audioWaitMs,
            "unackedBytes" to it.unackedBytes, "unackedAgeMs" to it.unackedAgeMs,
            "ackedBytes" to it.ackedBytes, "ackProgress" to it.ackProgress, "lastAckAtMs" to relative(it.lastAckAtMs),
            "ackedLiveGeneration" to it.ackedLiveGeneration, "ackedLiveVideoId" to it.ackedLiveVideoId,
            "generatedVideoBytes" to it.generatedVideoBytes, "generatedVideoFrames" to it.generatedVideoFrames,
            "generatedAudioFrames" to it.generatedAudioFrames, "lastVideoAtMs" to relative(it.lastVideoAtMs),
            "lastAudioAtMs" to relative(it.lastAudioAtMs), "sentVideoFrames" to it.sentVideoFrames,
            "sentAudioFrames" to it.sentAudioFrames, "lastVideoSentAtMs" to relative(it.lastVideoSentAtMs),
            "lastAudioSentAtMs" to relative(it.lastAudioSentAtMs), "sentLiveGeneration" to it.sentLiveGeneration,
            "sentLiveVideoId" to it.sentLiveVideoId, "droppedVideoFrames" to it.droppedVideoFrames,
            "droppedAudioFrames" to it.droppedAudioFrames, "expiredPackets" to it.expiredPackets,
            "expiredBytes" to it.expiredBytes, "retransmittedPackets" to it.retransmittedPackets,
            "retransmittedBytes" to it.retransmittedBytes, "sentBytes" to it.sentBytes, "nakPackets" to it.nakPackets,
            "rttMs" to it.rttMs, "rttAtMs" to relative(it.rttAtMs), "keyframePeakBytes" to it.keyframePeakBytes,
            "generatedLiveGeneration" to it.generatedLiveGeneration, "generatedLiveVideoId" to it.generatedLiveVideoId,
            "lastLiveVideoAtMs" to relative(it.lastLiveVideoAtMs), "lastLiveVideoSentAtMs" to relative(it.lastLiveVideoSentAtMs)) }
        val q = metadata.quality
        val rows = JSONArray()
        observations.forEach { row ->
            val v = row.view; val d = v.diagnostics
            rows.put(objectOf("atMs" to relative(row.atMs), "input" to if (row.actual != null) "injected" else "actual",
                "observation" to snapshot(row.sample), "actualObservation" to snapshot(row.actual),
                "comparable" to d.comparable, "observationIssue" to d.observationIssue.name,
                "reason" to d.reason.name, "phase" to v.phase.name, "hidden" to row.hidden,
                "requestedBps" to v.target, "acceptedBps" to v.acceptedTarget, "generatedBps" to v.generatedBitrate,
                "apiResult" to v.apiResult?.name, "pendingId" to v.pending?.id, "pendingOperation" to v.pending?.kind?.name,
                "probeGeneration" to v.probeGeneration, "controlStopped" to v.controlStopped, "increaseBlocked" to v.increaseBlocked,
                "probeStartedAtMs" to relative(v.probeStartedAtMs), "probeDeadlineAtMs" to relative(v.probeDeadlineAtMs),
                "releaseApplied" to v.releaseApplied, "probeVideoConfirmed" to v.probeVideoConfirmed, "probeAckConfirmed" to v.probeAckConfirmed,
                "baselineRttMs" to d.baselineRttMs, "lagMs" to d.lagMs, "badForMs" to d.badForMs,
                "stableForMs" to d.stableForMs, "recoveryWaitMs" to d.recoveryWaitMs, "nextProbeInMs" to d.nextProbeInMs))
        }
        val changes = JSONArray()
        events.forEach { e -> changes.put(objectOf("atMs" to relative(e.atMs), "kind" to e.kind.name, "actionId" to e.action?.id,
            "operation" to e.action?.kind?.name, "requestedAtMs" to relative(e.action?.atMs),
            "phase" to e.phase.name, "requestedBps" to e.requested, "acceptedBps" to e.accepted,
            "apiResult" to e.api?.name, "applied" to e.applied)) }
        return objectOf("schemaVersion" to 1, "appVersion" to BuildConfig.VERSION_NAME, "controllerVersion" to "2",
            "input" to if (metadata.injected) "actual-and-injected" else "actual",
            "quality" to objectOf("codec" to q.videoCodec.name, "encoderComponent" to metadata.encoder,
                "portrait" to metadata.portrait, "width" to q.width, "height" to q.height, "fps" to q.fps,
                "mode" to q.bitrateMode.name, "weakNetwork" to q.audioFirst, "fixedBps" to q.videoBitrate,
                "normalMinBps" to q.autoMinBitrate, "normalMaxBps" to q.autoMaxBitrate,
                "emergencyBps" to metadata.emergencyBps, "holdBps" to metadata.holdBps, "audioBps" to q.audioBitrate,
                "keyframeSeconds" to q.keyframeSeconds, "latencyMs" to q.latencyMs, "timestampOverlay" to metadata.timestamp),
            "discardedObservations" to discardedObservations, "discardedEvents" to discardedEvents,
            "observations" to rows, "events" to changes).toString(2)
    }
}

/** Memory only, independent of the foreground service lifetime. No media or registration objects. */
class OutdoorDiagnosticRing {
    private var startedAt = 0L
    private var metadata = OutdoorDiagnosticMetadata(OutdoorQuality(), false, false)
    private val observations = ArrayDeque<OutdoorDiagnosticRow>()
    private val events = ArrayDeque<OutdoorDiagnosticEvent>()
    private var lostRows = 0L
    private var lostEvents = 0L
    private var lastEvent: OutdoorDiagnosticEvent? = null
    private var stopped = true
    @Synchronized fun begin(now: Long, quality: OutdoorQuality, portrait: Boolean, timestamp: Boolean) {
        startedAt = now; metadata = OutdoorDiagnosticMetadata(quality, portrait, timestamp)
        observations.clear(); events.clear(); lostRows = 0; lostEvents = 0; lastEvent = null; stopped = false
    }
    @Synchronized fun encoder(name: String, emergency: Int, hold: Int) {
        metadata = metadata.copy(encoder = name, emergencyBps = emergency, holdBps = hold)
    }
    @Synchronized fun injected() { metadata = metadata.copy(injected = true) }
    @Synchronized fun record(now: Long, sample: TransportSnapshot?, view: OutdoorAdaptationView, hidden: Boolean, actual: TransportSnapshot?) {
        if (stopped) return
        observations.addLast(OutdoorDiagnosticRow(now, sample, view, hidden, actual))
        val event = OutdoorDiagnosticEvent(now, view.pending, view.phase, view.target, view.acceptedTarget, view.apiResult)
        if (lastEvent?.copy(atMs = now) != event) { events.addLast(event); lastEvent = event }
        trim(now)
    }
    @Synchronized fun applied(now: Long, action: OutdoorAdaptationAction, api: BitrateChangeResult?, applied: Boolean?, view: OutdoorAdaptationView) {
        if (stopped) return
        events.addLast(OutdoorDiagnosticEvent(now, action, view.phase, action.target,
            view.acceptedTarget, api, applied, OutdoorDiagnosticEventKind.APPLY))
        trim(now)
    }
    @Synchronized fun stop(now: Long) {
        if (stopped) return
        stopped = true
        val last = events.lastOrNull() ?: return
        events.addLast(OutdoorDiagnosticEvent(now, null, last.phase, last.requested, last.accepted,
            kind = OutdoorDiagnosticEventKind.STOP))
        trim(now)
    }
    private fun trim(now: Long) {
        while (observations.isNotEmpty() && (observations.size > 1200 || now - observations.first().atMs >= 300000)) {
            observations.removeFirst(); lostRows++
        }
        while (events.isNotEmpty() && (events.size > 1200 || now - events.first().atMs >= 300000)) { events.removeFirst(); lostEvents++ }
    }
    @Synchronized fun capture(): OutdoorDiagnosticCapture? = if (observations.isEmpty()) null else
        OutdoorDiagnosticCapture(startedAt, metadata, observations.toList(), events.toList(), lostRows, lostEvents)
    @Synchronized fun summary() = OutdoorDiagnosticHistorySummary(observations.size,
        observations.firstOrNull()?.atMs?.minus(startedAt), observations.lastOrNull()?.atMs?.minus(startedAt), lostRows, lostEvents)
}

object OutdoorDiagnosticHistory {
    private val ring = OutdoorDiagnosticRing()
    private val mutable = MutableStateFlow(false)
    val available = mutable.asStateFlow()
    private val mutableSummary = MutableStateFlow(OutdoorDiagnosticHistorySummary())
    val summary = mutableSummary.asStateFlow()
    fun begin(now: Long, quality: OutdoorQuality, portrait: Boolean, timestamp: Boolean) {
        ring.begin(now, quality, portrait, timestamp); mutable.value = false
        mutableSummary.value = ring.summary()
    }
    fun encoder(name: String, emergency: Int, hold: Int) = ring.encoder(name, emergency, hold)
    fun injected() = ring.injected()
    fun record(now: Long, sample: TransportSnapshot?, view: OutdoorAdaptationView, hidden: Boolean, actual: TransportSnapshot?) {
        ring.record(now, sample, view, hidden, actual); mutable.value = true
        mutableSummary.value = ring.summary()
    }
    fun applied(now: Long, action: OutdoorAdaptationAction, api: BitrateChangeResult?, applied: Boolean?, view: OutdoorAdaptationView) = ring.applied(now, action, api, applied, view)
    fun stop(now: Long) { ring.stop(now); mutableSummary.value = ring.summary() }
    fun capture() = ring.capture()
}
