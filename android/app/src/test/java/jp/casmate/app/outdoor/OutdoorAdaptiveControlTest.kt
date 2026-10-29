package jp.casmate.app.outdoor

import com.pedro.common.TransportObservation
import com.pedro.common.TransportSnapshot
import com.pedro.encoder.video.BitrateChangeResult
import org.junit.Assert.*
import org.junit.Test

internal class AdaptiveCircuit(
    quality: OutdoorQuality = OutdoorQuality(bitrateMode = OutdoorBitrateMode.AUTO, audioFirst = true),
    minimum: Int = 1,
) {
    val control = OutdoorAdaptiveControl(quality, minimum)
    var now = 0L
    var count = 0L
    var current = TransportObservation { 0 }.apply { beginConnection() }.snapshot()
    var holdSuccess = true
    var apply = true
    var release = true
    val actions = mutableListOf<OutdoorAdaptationAction>()
    fun step(wait: Long = 0, audioDrop: Long = 0, live: Boolean = true,
        ackGeneration: Long? = null, rtt: Double = 50.0, available: Boolean = true,
        bytes: Long = 4000, transform: (TransportSnapshot) -> TransportSnapshot = { it }): OutdoorAdaptationView {
        now += 250; count++
        val generation = if (live) control.view.probeGeneration else 0L
        current = transform(current.copy(atMs = now, localWaitMs = wait, audioWaitMs = wait,
            generatedVideoBytes = current.generatedVideoBytes + bytes,
            generatedVideoFrames = count, generatedAudioFrames = count,
            lastVideoAtMs = now, lastAudioAtMs = now, sentVideoFrames = count, sentAudioFrames = count,
            lastVideoSentAtMs = now, lastAudioSentAtMs = now, ackProgress = count,
            ackedBytes = count * 1000, lastAckAtMs = now, droppedAudioFrames = current.droppedAudioFrames + audioDrop,
            rttMs = rtt, rttAtMs = now, generatedLiveGeneration = generation, generatedLiveVideoId = count,
            sentLiveGeneration = generation, sentLiveVideoId = count,
            ackedLiveGeneration = ackGeneration ?: generation, ackedLiveVideoId = count,
            lastLiveVideoAtMs = if (live) now else current.lastLiveVideoAtMs,
            lastLiveVideoSentAtMs = if (live) now else current.lastLiveVideoSentAtMs))
        control.tick(now, current, available)
        if (apply) drain()
        return control.view
    }
    fun drain() {
        repeat(4) {
            val action = control.action ?: return
            if (actions.lastOrNull()?.id != action.id) actions.add(action)
            when (action.kind) {
                OutdoorAdaptationOperation.BITRATE -> control.bitrateResult(action.id, BitrateChangeResult.ACCEPTED, now)
                OutdoorAdaptationOperation.HOLD -> control.held(action.id, holdSuccess, now)
                OutdoorAdaptationOperation.RELEASE -> if (release) control.released(action.id, true, now) else return
            }
        }
    }
    fun until(steps: Int = 100, wait: Long = 0, live: Boolean = true, predicate: () -> Boolean) {
        repeat(steps) { if (predicate()) return; step(wait = wait, live = live) }
        assertTrue("condition not reached at time " + now + ": " + control.view, predicate())
    }
    fun hold() = until(wait = 300) { control.view.phase == OutdoorAdaptationPhase.HELD }
    fun probe() = until(live = false) { control.view.phase == OutdoorAdaptationPhase.PROBING }
}

class OutdoorAdaptiveControlTest {
    @Test fun completionEventRequiresSuccessfulLiveRecoveryAndNeverComesFromReleaseOrMovingPhase() {
        val c = AdaptiveCircuit(); c.hold(); c.probe()
        val probeGeneration = c.control.view.probeGeneration
        assertTrue(c.control.view.releaseApplied)
        assertEquals(0L, c.control.view.completedProbeGeneration)
        repeat(4) { c.step(ackGeneration = probeGeneration - 1) }
        assertEquals(0L, c.control.view.completedProbeGeneration)
        c.apply = false
        c.step(wait = 300)
        assertEquals(OutdoorAdaptationPhase.LOW_VIDEO, c.control.view.phase)
        assertEquals(0L, c.control.view.completedProbeGeneration)
        c.apply = true; c.drain(); c.probe()
        val successfulGeneration = c.control.view.probeGeneration
        c.until { c.control.view.completedProbeGeneration > 0 }
        assertEquals(successfulGeneration, c.control.view.completedProbeGeneration)
        c.control.visibility(true, c.now); c.control.visibility(false, c.now)
        c.control.videoRecovered(c.now)
        assertEquals(successfulGeneration, c.control.view.completedProbeGeneration)
        c.hold(); c.probe(); c.step(available = false)
        assertEquals(successfulGeneration, c.control.view.completedProbeGeneration)
        c.probe()
        val laterGeneration = c.control.view.probeGeneration
        c.until { c.control.view.completedProbeGeneration > successfulGeneration }
        assertEquals(laterGeneration, c.control.view.completedProbeGeneration)
    }

    @Test fun holdTimeoutAndReleaseDeadlineIncludeTheApplyWaitAndRejectLateResults() {
        val c = AdaptiveCircuit(); c.apply = false
        c.until(wait = 300) { c.control.action != null }
        c.control.bitrateResult(c.control.action!!.id, BitrateChangeResult.ACCEPTED, c.now)
        c.until(wait = 300) { c.control.action != null }
        c.control.bitrateResult(c.control.action!!.id, BitrateChangeResult.ACCEPTED, c.now)
        val hold = c.control.action!!
        assertEquals(OutdoorAdaptationOperation.HOLD, hold.kind)
        repeat(8) { c.step(wait = 300) }
        assertNull(c.control.action)
        c.control.held(hold.id, true, c.now)
        assertEquals(OutdoorAdaptationPhase.LOW_VIDEO, c.control.view.phase)
        val pending = AdaptiveCircuit(); pending.hold(); pending.release = false; pending.probe()
        val release = pending.control.action!!
        // Even fabricated healthy frames cannot complete a probe before GL release is applied.
        repeat(12) { pending.step() }
        assertEquals(OutdoorAdaptationPhase.PROBING, pending.control.view.phase)
        repeat(8) { pending.step() }
        assertEquals(OutdoorAdaptationPhase.HELD, pending.control.view.phase)
        pending.control.released(release.id, true, pending.now)
        assertEquals(OutdoorAdaptationPhase.HELD, pending.control.view.phase)
    }

    @Test fun thresholdBoundariesAndExpiryAreIndependentOfRttOrMainQueueSize() {
        val c = AdaptiveCircuit(OutdoorQuality(latencyMs = 1000, bitrateMode = OutdoorBitrateMode.AUTO, audioFirst = true)); c.step(); c.step(wait = 249)
        assertEquals(OutdoorAdaptationReason.OBSERVING, c.control.view.diagnostics.reason)
        c.step(wait = 250)
        assertEquals(OutdoorAdaptationReason.QUEUE_CONGESTION, c.control.view.diagnostics.reason)
        c.step(wait = 251)
        assertEquals(500000, c.control.view.acceptedTarget)
        c.step(wait = 250)
        assertEquals(250000, c.control.view.acceptedTarget)
        c.hold(); c.probe()
        c.step(transform = { it.copy(expiredPackets = 1, queuedFrames = 0) })
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
    }

    @Test fun unavailableNotRunningAndReconnectCannotResumeStoppedControl() {
        val c = AdaptiveCircuit(); c.apply = false
        c.until(wait = 300) { c.control.action != null }
        c.control.bitrateResult(c.control.action!!.id, BitrateChangeResult.NOT_RUNNING, c.now)
        c.control.videoRecovered(c.now)
        repeat(10) { c.step(transform = { it.copy(generation = 2) }) }
        assertTrue(c.control.view.controlStopped)
        assertNull(c.control.action)
        c.control.retry(c.now)
        c.control.bitrateResult(c.control.action!!.id, BitrateChangeResult.ERROR, c.now)
        assertTrue(c.control.view.controlStopped)
    }

    @Test fun pendingApiIsNotAnAppliedTargetAndFailureRequiresExplicitRetry() {
        val c = AdaptiveCircuit(); c.apply = false
        c.until(wait = 300) { c.control.action != null }
        val action = c.control.action!!
        assertEquals(250000, c.control.view.target)
        assertEquals(500000, c.control.view.acceptedTarget)
        c.control.bitrateResult(action.id, BitrateChangeResult.ERROR, c.now)
        assertTrue(c.control.view.controlStopped)
        repeat(40) { c.step() }
        assertNull(c.control.action)
        c.control.retry(c.now)
        assertEquals(500000, c.control.action!!.target)
        c.control.bitrateResult(c.control.action!!.id, BitrateChangeResult.ACCEPTED, c.now)
        assertFalse(c.control.view.controlStopped)
        assertEquals(500000, c.control.view.acceptedTarget)
    }

    @Test fun fixedAndOptOutNeverHoldOrGoBelowTheNormalRange() {
        for (q in listOf(OutdoorQuality(), OutdoorQuality(bitrateMode = OutdoorBitrateMode.AUTO))) {
            val c = AdaptiveCircuit(q)
            repeat(80) { c.step(wait = 500, audioDrop = 1) }
            assertEquals(q.initialBitrate, c.control.view.acceptedTarget)
            assertTrue(c.actions.isEmpty())
        }
    }

    @Test fun dropIsRetainedUntilTheFiveHundredMillisecondSpacingExpires() {
        val c = AdaptiveCircuit(); c.step(); c.step(audioDrop = 1)
        assertEquals(250000, c.control.view.acceptedTarget)
        c.step(audioDrop = 1)
        assertEquals(OutdoorAdaptationPhase.LOW_VIDEO, c.control.view.phase)
        c.step()
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
    }

    @Test fun minimumCodecRateClampsEmergencyAndCanSkipMovingEmergency() {
        val c = AdaptiveCircuit(minimum = 400000); c.hold()
        assertEquals(400000, c.control.view.acceptedTarget)
        assertFalse(c.actions.any { it.target == 250000 || it.target == 150000 })
        val skip = AdaptiveCircuit(minimum = 500000); skip.hold()
        assertTrue(skip.actions.none { it.target < 500000 })
        assertEquals(OutdoorAdaptationPhase.HELD, skip.control.view.phase)
    }

    @Test fun probeNeedsNewLiveDataAndMatchingAckAndHasFiniteLifetime() {
        val c = AdaptiveCircuit(); c.hold(); c.probe()
        val generation = c.control.view.probeGeneration
        repeat(4) { c.step(ackGeneration = generation - 1) }
        assertEquals(OutdoorAdaptationPhase.PROBING, c.control.view.phase)
        c.until { c.control.view.phase == OutdoorAdaptationPhase.LOW_VIDEO }
        assertEquals(250000, c.control.view.acceptedTarget)
        val stuck = AdaptiveCircuit(); stuck.hold(); stuck.probe()
        stuck.until(live = false) { stuck.control.view.phase == OutdoorAdaptationPhase.HELD }
        assertEquals(OutdoorAdaptationPhase.HELD, stuck.control.view.phase)
        assertEquals(2000L, stuck.control.view.diagnostics.recoveryWaitMs)
    }

    @Test fun jitterDoesNotAbortButGrayZoneResetsSuccessWithoutExtendingDeadline() {
        val c = AdaptiveCircuit(); c.hold(); c.probe()
        repeat(4) { c.step(wait = 5) }
        assertEquals(OutdoorAdaptationPhase.PROBING, c.control.view.phase)
        repeat(16) { c.step(wait = 150) }
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
    }

    @Test fun everyFailedProbeGetsANewHoldAndBackoffCapsWithoutSelfReset() {
        val c = AdaptiveCircuit(); c.hold()
        for (expected in listOf(2000L, 4000L, 8000L, 8000L)) {
            c.probe(); c.step(wait = 250)
            assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
            assertEquals(expected, c.control.view.diagnostics.recoveryWaitMs)
            repeat(3) { c.step(live = false) }
            assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
        }
        assertEquals(5, c.actions.count { it.kind == OutdoorAdaptationOperation.HOLD })
        c.control.visibility(true, c.now); c.control.visibility(false, c.now)
        assertEquals(8000L, c.control.view.diagnostics.recoveryWaitMs)
    }

    @Test fun holdCaptureFailuresAreBoundedAndLateCallbacksCannotOverridePrivacy() {
        val c = AdaptiveCircuit(); c.holdSuccess = false
        repeat(80) { c.step(wait = 500) }
        assertEquals(2, c.actions.count { it.kind == OutdoorAdaptationOperation.HOLD })
        assertEquals(OutdoorAdaptationPhase.LOW_VIDEO, c.control.view.phase)
        c.control.visibility(true, c.now)
        val old = c.actions.last { it.kind == OutdoorAdaptationOperation.HOLD }
        c.control.held(old.id, true, c.now)
        repeat(40) { c.step(wait = 500) }
        assertEquals(2, c.actions.count { it.kind == OutdoorAdaptationOperation.HOLD })
    }

    @Test fun missingAndEpochChangesResetTimersAndDoNotTurnIntoHealthyZeros() {
        val c = AdaptiveCircuit(); c.hold()
        repeat(30) { c.step(transform = { it.copy(lastAckAtMs = 0) }) }
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
        c.step(transform = { it.copy(generation = it.generation + 1) })
        assertEquals(OutdoorAdaptationReason.REBASELINE, c.control.view.diagnostics.reason)
        c.step(transform = { it.copy(atMs = c.now + 1) })
        assertEquals(OutdoorAdaptationReason.UNAVAILABLE, c.control.view.diagnostics.reason)
        c.probe(); c.step(available = false)
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
    }

    @Test fun rttAloneIsNotCongestionAndBaselineNeverRisesInAnEpoch() {
        val c = AdaptiveCircuit(); c.step(); c.step()
        repeat(40) { c.step(rtt = 900.0) }
        assertFalse(c.actions.any { it.kind == OutdoorAdaptationOperation.HOLD })
        assertEquals(50.0, c.control.view.diagnostics.baselineRttMs!!, 0.01)
        c.until { c.control.view.acceptedTarget >= 700000 }
        c.step(transform = { it.copy(unackedAgeMs = 301) })
        assertEquals(OutdoorAdaptationReason.QUEUE_CONGESTION, c.control.view.diagnostics.reason)
    }

    @Test fun ignoredTargetBlocksIncreasesButNotProbesAndNewOutputClearsIt() {
        val c = AdaptiveCircuit(); c.hold()
        repeat(28) { c.step(bytes = 100000, live = false, transform = { it.copy(lastAckAtMs = 0) }) }
        assertTrue(c.control.view.increaseBlocked)
        c.probe()
        assertEquals(OutdoorAdaptationPhase.PROBING, c.control.view.phase)
        repeat(32) { c.step(bytes = 4000) }
        assertFalse(c.control.view.increaseBlocked)
        assertTrue(c.control.view.acceptedTarget > 250000)
    }
}
