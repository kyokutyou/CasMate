package jp.casmate.app.outdoor

import com.pedro.common.TransportSnapshot
import com.pedro.encoder.video.BitrateChangeResult

enum class OutdoorAdaptationOperation { BITRATE, HOLD, RELEASE }
data class OutdoorAdaptationAction(val id: Long, val kind: OutdoorAdaptationOperation, val target: Int, val atMs: Long)

/** Pure controller. Only the actuator may report accepted targets and applied GL operations. */
class OutdoorAdaptiveControl(private val quality: OutdoorQuality, encoderMinimum: Int = 1) {
    val emergencyTarget = maxOf(250000, encoderMinimum).coerceAtMost(quality.autoMinBitrate)
    val holdTarget = maxOf(150000, encoderMinimum).coerceAtMost(quality.autoMinBitrate)
    var view = OutdoorAdaptationView(quality.initialBitrate); private set
    val action get() = view.pending
    private enum class Purpose { RATE, HOLD, RESTORE_HOLD, PROBE, RETRY }
    private var purpose = Purpose.RATE
    private var serial = 0L
    private var previous: TransportSnapshot? = null
    private var epoch: Long? = null
    private var baselineRtt: Double? = null
    private var hidden = false
    private var badSince: Long? = null
    private var goodSince: Long? = null
    private var lastDownAt = -500L
    private var acceptedAt = 0L
    private var audioDropPending = false
    private var lastSafeTarget: Int? = null
    private var captureAttempts = 0
    private var nextCaptureAt = 0L
    private var restorationAttempts = 0
    private var restorationRetryAt = 0L
    val recoveryHoldExhausted get() = restorationAttempts >= 2 && action == null &&
        view.phase !in setOf(OutdoorAdaptationPhase.HELD, OutdoorAdaptationPhase.PROBING)
    private var failedProbes = 0
    private var retryAt = 0L
    private var probeAt = 0L
    private var released = false
    private var probeFirstVideoId = 0L
    private var highSince: Long? = null
    private var effectiveSince: Long? = null
    private val output = ArrayDeque<Pair<Long, Long>>()
    private val warningMs = (quality.latencyMs / 4).coerceIn(50, 250)
    private val auto get() = quality.bitrateMode == OutdoorBitrateMode.AUTO
    private val backoff get() = if (failedProbes == 0) 0L else (2000L shl minOf(failedProbes - 1, 2))

    fun visibility(isHidden: Boolean, now: Long) {
        hidden = isHidden
        cancelAction()
        view = view.copy(phase = movingPhase(), probeGeneration = view.probeGeneration + 1)
        captureAttempts = 0; nextCaptureAt = now
        rebaseline()
        publishWait(now)
    }

    /** Explicit local video recovery, preserving privacy, accepted rate and network backoff. */
    fun videoRecovered(now: Long) = visibility(hidden, now)

    /** Rebuilt camera/GL lost its raw hold, while a drawing still awaits network proof.
     * Apply a fresh real hold before entering the existing live generation/ACK probe. */
    fun restoreRecoveryGate(now: Long): Boolean {
        if (hidden || !auto || !quality.audioFirst || view.controlStopped || action != null ||
            restorationAttempts >= 2 || now < restorationRetryAt) return false
        resetTimers()
        requestRate(holdTarget, Purpose.RESTORE_HOLD, now)
        return true
    }

    /** Explicit drawing retry only; healthy-video timers and bitrate retry cannot renew this budget. */
    fun retryRecoveryGate(now: Long) { restorationAttempts = 0; restorationRetryAt = now }

    fun retry(now: Long) {
        if (!view.controlStopped || action != null) return
        requestRate(view.acceptedTarget, Purpose.RETRY, now)
    }

    fun bitrateResult(id: Long, result: BitrateChangeResult, now: Long) {
        val pending = action?.takeIf { it.id == id && it.kind == OutdoorAdaptationOperation.BITRATE } ?: return
        val completedPurpose = purpose
        view = view.copy(pending = null, apiResult = result)
        if (result != BitrateChangeResult.ACCEPTED) {
            view = view.copy(controlStopped = true,
                message = if (result == BitrateChangeResult.NOT_RUNNING) "映像エンコーダーが未稼働です。映像を復旧して再試行してください。"
                    else "目標値を変更できません。自動調整を再試行してください。",
                diagnostics = view.diagnostics.copy(reason = OutdoorAdaptationReason.CONTROL_STOPPED))
            resetTimers()
            return
        }
        val changed = pending.target != view.acceptedTarget
        view = view.copy(acceptedTarget = pending.target, target = pending.target, controlStopped = false, message = "",
            trend = if (pending.target > view.acceptedTarget) OutdoorBitrateTrend.RECOVERING else OutdoorBitrateTrend.REDUCED)
        if (changed || completedPurpose == Purpose.RETRY) {
            acceptedAt = now; output.clear(); highSince = null; effectiveSince = null
        }
        resetTimers()
        when (completedPurpose) {
            Purpose.HOLD, Purpose.RESTORE_HOLD -> requestHold(now)
            Purpose.PROBE -> {
                probeAt = now; released = false
                audioDropPending = false
                probeFirstVideoId = previous?.generatedLiveVideoId ?: 0
                view = view.copy(phase = OutdoorAdaptationPhase.PROBING, probeGeneration = view.probeGeneration + 1,
                    probeStartedAtMs = now, probeDeadlineAtMs = now + 5000, releaseApplied = false,
                    probeVideoConfirmed = false, probeAckConfirmed = false)
                issue(OutdoorAdaptationOperation.RELEASE, now)
            }
            Purpose.RETRY -> { audioDropPending = false; rebaseline() }
            Purpose.RATE -> if (view.phase != OutdoorAdaptationPhase.HELD) view = view.copy(phase = movingPhase())
        }
    }

    fun held(id: Long, success: Boolean, now: Long) {
        if (action?.id != id || action?.kind != OutdoorAdaptationOperation.HOLD) return
        val restoring = purpose == Purpose.RESTORE_HOLD
        cancelAction(); resetTimers()
        if (success) {
            captureAttempts = 0; nextCaptureAt = 0
            view = view.copy(phase = OutdoorAdaptationPhase.HELD, message = "")
        } else {
            nextCaptureAt = now + 5000
            if (restoring) restorationRetryAt = now + 5000
            view = view.copy(phase = movingPhase(), message = "画像を保持できません。低い目標値で動画を継続します。")
        }
        publishWait(now)
    }

    fun released(id: Long, success: Boolean, now: Long) {
        if (action?.id != id || action?.kind != OutdoorAdaptationOperation.RELEASE) return
        cancelAction()
        if (success) { released = true; view = view.copy(releaseApplied = true) } else failProbe(now)
    }

    fun tick(now: Long, sample: TransportSnapshot?, available: Boolean): OutdoorAdaptationView {
        action?.takeIf { it.kind == OutdoorAdaptationOperation.HOLD && now - it.atMs >= 2000 }
            ?.let { held(it.id, false, now) }
        val old = previous
        if (!available || sample == null || !sample.valid || sample.atMs > now || now - sample.atMs >= 1000 ||
            counters(sample).any { it < 0 } || sample.localWaitMs < 0 || sample.audioWaitMs < 0 || sample.unackedAgeMs < 0) {
            if (view.phase == OutdoorAdaptationPhase.PROBING && !view.controlStopped) failProbe(now)
            rebaseline()
            return unavailable(OutdoorAdaptationReason.UNAVAILABLE, now, when {
                !available || sample == null -> OutdoorObservationIssue.UNAVAILABLE
                !sample.valid -> OutdoorObservationIssue.INVALID
                sample.atMs > now -> OutdoorObservationIssue.FUTURE
                now - sample.atMs >= 1000 -> OutdoorObservationIssue.STALE
                else -> OutdoorObservationIssue.INVALID
            })
        }
        val epochChanged = epoch != null && sample.generation != epoch
        if (epoch != sample.generation) { epoch = sample.generation; baselineRtt = null }
        if (sample.rttAtMs?.let { it <= now && now - it < 1000 } == true) {
            sample.rttMs?.takeIf { it.isFinite() && it > 0 }?.let { baselineRtt = minOf(baselineRtt ?: it, it) }
        }
        previous = sample
        val rollback = old != null && counters(sample).zip(counters(old)).any { (a, b) -> a < b }
        if (old == null || epochChanged || rollback || sample.atMs - old.atMs !in 1..1000) {
            if (view.phase == OutdoorAdaptationPhase.PROBING && !view.controlStopped) failProbe(now)
            resetTimers(); resetRateWindow()
            return unavailable(if (epochChanged) OutdoorAdaptationReason.REBASELINE else if (rollback)
                OutdoorAdaptationReason.COUNTER_RESET else if (old == null) OutdoorAdaptationReason.BASELINE
                else OutdoorAdaptationReason.REBASELINE, now, when {
                    epochChanged -> OutdoorObservationIssue.EPOCH
                    rollback -> OutdoorObservationIssue.COUNTER_RESET
                    old == null -> OutdoorObservationIssue.BASELINE
                    else -> OutdoorObservationIssue.INTERVAL
                })
        }
        val window = sample.atMs - old.atMs
        val audioDropped = sample.droppedAudioFrames - old.droppedAudioFrames
        val videoDropped = sample.droppedVideoFrames - old.droppedVideoFrames
        val expired = sample.expiredPackets - old.expiredPackets
        if (audioDropped > 0) audioDropPending = true
        val lag = baselineRtt?.let { maxOf(sample.localWaitMs.toDouble(), sample.unackedAgeMs - it, 0.0) }
        val bad = (lag != null && lag >= warningMs) || sample.localWaitMs >= warningMs ||
            sample.audioWaitMs >= warningMs || sample.unackedAgeMs >= quality.latencyMs ||
            audioDropped > 0 || videoDropped > 0 || expired > 0
        fun fresh(at: Long?) = at != null && at <= now && now - at < 1000
        val audioFresh = fresh(sample.lastAudioAtMs) && fresh(sample.lastAudioSentAtMs)
        val liveRequired = !hidden && view.phase != OutdoorAdaptationPhase.HELD
        val videoFresh = fresh(sample.lastVideoAtMs) && fresh(sample.lastVideoSentAtMs) &&
            (!liveRequired || (sample.generatedLiveGeneration == view.probeGeneration &&
                sample.sentLiveGeneration == view.probeGeneration && fresh(sample.lastLiveVideoAtMs) && fresh(sample.lastLiveVideoSentAtMs)))
        val healthy = !bad && lag != null && lag < warningMs / 2.0 && sample.audioWaitMs < warningMs / 2.0 &&
            fresh(sample.lastAckAtMs) && audioFresh && videoFresh
        val probeEvidence = released && sample.generatedLiveGeneration == view.probeGeneration &&
            sample.sentLiveGeneration == view.probeGeneration && sample.ackedLiveGeneration == view.probeGeneration &&
            sample.generatedLiveVideoId > probeFirstVideoId && sample.sentLiveVideoId > probeFirstVideoId &&
            sample.ackedLiveVideoId > probeFirstVideoId
        if (view.phase == OutdoorAdaptationPhase.PROBING) view = view.copy(
            probeVideoConfirmed = videoFresh && sample.generatedLiveVideoId > probeFirstVideoId && sample.sentLiveVideoId > probeFirstVideoId,
            probeAckConfirmed = sample.ackedLiveGeneration == view.probeGeneration && sample.ackedLiveVideoId > probeFirstVideoId)
        badSince = if (bad) badSince ?: now else null
        goodSince = if (healthy && (view.phase != OutdoorAdaptationPhase.PROBING || probeEvidence)) goodSince ?: now else null
        val badFor = badSince?.let { now - it } ?: 0
        val goodFor = goodSince?.let { now - it } ?: 0
        val rate = (sample.generatedVideoBytes - old.generatedVideoBytes) * 8000 / window
        updateEffect(sample.atMs, sample.generatedVideoBytes)
        val reason = when {
            view.controlStopped -> OutdoorAdaptationReason.CONTROL_STOPPED
            audioDropped > 0 -> OutdoorAdaptationReason.AUDIO_DROPPED
            !audioFresh -> OutdoorAdaptationReason.AUDIO_STALLED
            !videoFresh -> OutdoorAdaptationReason.VIDEO_WRITE_STALLED
            bad -> OutdoorAdaptationReason.QUEUE_CONGESTION
            !auto -> OutdoorAdaptationReason.FIXED
            healthy -> OutdoorAdaptationReason.STABLE
            view.increaseBlocked -> OutdoorAdaptationReason.EXCESS_OUTPUT
            else -> OutdoorAdaptationReason.OBSERVING
        }
        view = view.copy(generatedBitrate = rate, diagnostics = OutdoorAdaptationDiagnostics(reason = reason,
            windowMs = window, queued = sample.queuedFrames, queuedBytes = sample.queuedBytes + sample.processingBytes,
            rttMs = sample.rttMs.takeIf { fresh(sample.rttAtMs) }, nakDelta = sample.nakPackets - old.nakPackets,
            sentAudioDelta = sample.sentAudioFrames - old.sentAudioFrames, droppedAudioDelta = audioDropped,
            sentVideoDelta = sample.sentVideoFrames - old.sentVideoFrames, droppedVideoDelta = videoDropped,
            badForMs = badFor, stableForMs = goodFor, baselineRttMs = baselineRtt, lagMs = lag,
            audioWaitMs = sample.audioWaitMs, unackedAgeMs = sample.unackedAgeMs, expiredDelta = expired,
            ackDelta = sample.ackProgress - old.ackProgress, comparable = true, observationIssue = OutdoorObservationIssue.NONE,
            videoWriteStalledForMs = if (videoFresh) 0 else sample.lastVideoSentAtMs?.let { now - it }))
        publishWait(now)
        if (!auto || view.controlStopped) return view
        if (view.phase == OutdoorAdaptationPhase.PROBING) {
            if (bad || now - probeAt >= 5000 || (now - probeAt >= 1000 && !videoFresh)) failProbe(now)
            else if (goodFor >= 2000) {
                view = view.copy(phase = movingPhase(), message = "", completedProbeGeneration = view.probeGeneration)
                failedProbes = 0; retryAt = 0; lastSafeTarget = null; resetTimers(); publishWait(now)
            }
            return view
        }
        if (action != null) return view
        if (view.phase == OutdoorAdaptationPhase.HELD) {
            if (goodFor >= 1000 && now >= retryAt) requestRate(emergencyTarget, Purpose.PROBE, now)
            return view
        }
        if (goodFor >= 2000) {
            captureAttempts = 0
            if (!view.increaseBlocked && view.acceptedTarget < quality.autoMaxBitrate) {
                lastSafeTarget = view.acceptedTarget
                requestRate(minOf(quality.autoMaxBitrate, view.acceptedTarget + minOf(view.acceptedTarget / 5, 100000)), Purpose.RATE, now)
                return view
            }
        }
        if (now - lastDownAt < 500) return view
        if (bad && lastSafeTarget?.let { it < view.acceptedTarget } == true) {
            val safe = lastSafeTarget!!; lastSafeTarget = null
            requestRate(safe, Purpose.RATE, now); return view
        }
        if (audioDropPending || badFor >= 500) {
            if (view.acceptedTarget > quality.autoMinBitrate) {
                val target = if (audioDropPending) quality.autoMinBitrate else maxOf(quality.autoMinBitrate, view.acceptedTarget * 7 / 10)
                audioDropPending = false; requestRate(target, Purpose.RATE, now)
            } else if (quality.audioFirst) {
                if (view.acceptedTarget >= quality.autoMinBitrate && emergencyTarget < quality.autoMinBitrate) {
                    audioDropPending = false; requestRate(emergencyTarget, Purpose.RATE, now)
                } else if ((badFor >= 1000 || audioDropPending) && captureAttempts < 2 && now >= nextCaptureAt) {
                    audioDropPending = false
                    if (!hidden) requestRate(holdTarget, Purpose.HOLD, now)
                    else if (view.acceptedTarget > holdTarget) requestRate(holdTarget, Purpose.RATE, now)
                }
            } else audioDropPending = false
        }
        return view
    }

    private fun requestRate(target: Int, next: Purpose, now: Long) {
        purpose = next
        if (target < view.acceptedTarget || next in setOf(Purpose.HOLD, Purpose.RESTORE_HOLD)) lastDownAt = now
        view = view.copy(target = target)
        if (target == view.acceptedTarget && next in setOf(Purpose.HOLD, Purpose.RESTORE_HOLD)) requestHold(now)
        else issue(OutdoorAdaptationOperation.BITRATE, now)
    }
    private fun requestHold(now: Long) {
        if (hidden) { view = view.copy(phase = movingPhase()); return }
        captureAttempts++
        if (purpose == Purpose.RESTORE_HOLD) restorationAttempts++
        issue(OutdoorAdaptationOperation.HOLD, now)
    }
    private fun failProbe(now: Long) {
        cancelAction(); failedProbes++; retryAt = now + backoff
        resetTimers(); audioDropPending = false; lastSafeTarget = null
        captureAttempts = 0; nextCaptureAt = now
        // The probe has ended, but a new hold is not applied until GL confirms it.
        view = view.copy(phase = movingPhase())
        requestRate(holdTarget, Purpose.HOLD, now)
        publishWait(now)
    }
    private fun movingPhase() = if (view.acceptedTarget < quality.autoMinBitrate) OutdoorAdaptationPhase.LOW_VIDEO else OutdoorAdaptationPhase.VIDEO
    private fun issue(kind: OutdoorAdaptationOperation, now: Long) {
        view = view.copy(pending = OutdoorAdaptationAction(++serial, kind, view.target, now))
    }
    private fun cancelAction() { view = view.copy(pending = null) }
    private fun resetTimers() { badSince = null; goodSince = null }
    private fun resetRateWindow() { output.clear(); highSince = null; effectiveSince = null }
    private fun rebaseline() { previous = null; resetTimers(); resetRateWindow() }
    private fun unavailable(reason: OutdoorAdaptationReason, now: Long, issue: OutdoorObservationIssue): OutdoorAdaptationView {
        view = view.copy(generatedBitrate = null, diagnostics = OutdoorAdaptationDiagnostics(
            reason = if (view.controlStopped) OutdoorAdaptationReason.CONTROL_STOPPED else reason, baselineRttMs = baselineRtt, observationIssue = issue))
        publishWait(now); return view
    }
    private fun publishWait(now: Long) {
        view = view.copy(diagnostics = view.diagnostics.copy(recoveryWaitMs = backoff,
            nextProbeInMs = if (view.phase == OutdoorAdaptationPhase.HELD) maxOf(0, retryAt - now, 1000 - (goodSince?.let { now - it } ?: 0)) else null))
    }
    private fun updateEffect(now: Long, bytes: Long) {
        output.addLast(now to bytes)
        while (output.size > 1 && output.elementAt(1).first <= now - 2000) output.removeFirst()
        val first = output.first()
        if (now - acceptedAt < 2000 || now - first.first < 2000) return
        val high = (bytes - first.second) * 8000 / (now - first.first) > view.acceptedTarget * 2L
        highSince = if (high) highSince ?: now else null
        effectiveSince = if (!high) effectiveSince ?: now else null
        if (highSince?.let { now - it >= 2000 } == true) view = view.copy(increaseBlocked = true)
        if (effectiveSince?.let { now - it >= 2000 } == true) view = view.copy(increaseBlocked = false)
    }
    private fun counters(s: TransportSnapshot) = listOf(s.ackedBytes, s.ackProgress, s.generatedVideoBytes,
        s.generatedVideoFrames, s.generatedAudioFrames, s.sentVideoFrames, s.sentAudioFrames, s.droppedVideoFrames,
        s.droppedAudioFrames, s.expiredPackets, s.expiredBytes, s.retransmittedBytes, s.retransmittedPackets, s.sentBytes, s.nakPackets)
}
