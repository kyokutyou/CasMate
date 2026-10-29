package jp.casmate.app.outdoor

import android.graphics.Color
import com.pedro.encoder.video.BitrateChangeResult
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorDrawingRecoveryIntegrationTest {
    @Test fun failedOrTimedOutRecoveryHoldsWaitFiveSecondsStopAfterTwoAndRequireExplicitRetry() {
        for (timeout in listOf(false, true)) {
            val circuit = AdaptiveCircuit().apply { apply = false }
            val drawing = OutdoorDrawingController()
            val session = drawing.beginSession(400, 200)
            drawing.openMode(session); drawing.cameraReady(session)
            drawing.setColor(session, OutdoorDrawingColor.RED)
            drawing.beginStroke(session, .1f, .5f); drawing.appendStroke(session, .9f, .5f); drawing.endStroke(session)
            val published = drawing.snapshot(false)!!
            drawing.acknowledgeOutput(published); drawing.freezeOutput(session, published); drawing.clear(session)
            circuit.control.videoRecovered(circuit.now)
            fun acceptBitrate() {
                circuit.control.action?.takeIf { it.kind == OutdoorAdaptationOperation.BITRATE }?.let {
                    circuit.control.bitrateResult(it.id, BitrateChangeResult.ACCEPTED, circuit.now)
                }
            }
            assertTrue(circuit.control.restoreRecoveryGate(circuit.now)); acceptBitrate()
            val first = circuit.control.action!!
            assertEquals(OutdoorAdaptationOperation.HOLD, first.kind)
            if (timeout) repeat(8) { circuit.step() }
            else circuit.control.held(first.id, false, circuit.now)
            assertNull(circuit.control.action)
            assertTrue(drawing.networkRecoveryPending(session))
            val failedAt = circuit.now
            assertFalse(circuit.control.restoreRecoveryGate(failedAt + 4999))
            circuit.now = failedAt + 5000
            assertTrue(circuit.control.restoreRecoveryGate(circuit.now)); acceptBitrate()
            val second = circuit.control.action!!
            assertEquals(OutdoorAdaptationOperation.HOLD, second.kind)
            circuit.control.held(second.id, false, circuit.now)
            assertTrue(circuit.control.recoveryHoldExhausted)
            // Healthy VIDEO resets the ordinary capture counter; it must not replenish this budget.
            repeat(40) {
                circuit.step(); acceptBitrate()
                assertTrue(circuit.control.action?.kind != OutdoorAdaptationOperation.HOLD)
                assertFalse(circuit.control.restoreRecoveryGate(circuit.now))
            }
            assertTrue(circuit.control.recoveryHoldExhausted)
            drawing.fail(session, "配信映像への反映を再開できません。手書きを再試行してください。", drawing.state.value.retryGeneration)
            assertFalse(drawing.state.value.editEnabled)
            assertSame(published.bitmap, drawing.snapshot(false)!!.bitmap)
            val failedRetryGeneration = drawing.state.value.retryGeneration
            drawing.retry(session)
            assertTrue(drawing.state.value.retryGeneration > failedRetryGeneration)
            circuit.control.retryRecoveryGate(circuit.now)
            assertTrue(circuit.control.restoreRecoveryGate(circuit.now)); acceptBitrate()
            var holdToken = 0L
            var releaseGeneration = 0L
            fun applySuccessfulActions() {
                repeat(4) {
                    val action = circuit.control.action ?: return@repeat
                    when (action.kind) {
                        OutdoorAdaptationOperation.BITRATE -> circuit.control.bitrateResult(action.id, BitrateChangeResult.ACCEPTED, circuit.now)
                        OutdoorAdaptationOperation.HOLD -> {
                            holdToken = drawing.freezeOutput(session, drawing.snapshot(false))
                            circuit.control.held(action.id, true, circuit.now)
                        }
                        OutdoorAdaptationOperation.RELEASE -> {
                            releaseGeneration = circuit.control.view.probeGeneration
                            circuit.control.released(action.id, true, circuit.now)
                        }
                    }
                }
            }
            applySuccessfulActions()
            assertEquals(OutdoorAdaptationPhase.HELD, circuit.control.view.phase)
            repeat(100) {
                if (circuit.control.view.completedProbeGeneration > 0L) return@repeat
                circuit.step(live = circuit.control.view.phase != OutdoorAdaptationPhase.HELD)
                applySuccessfulActions()
                assertSame(published.bitmap, drawing.snapshot(false)!!.bitmap)
            }
            assertTrue(circuit.control.view.completedProbeGeneration > 0L)
            assertEquals(releaseGeneration, circuit.control.view.completedProbeGeneration)
            assertTrue(drawing.confirmLive(session, holdToken))
            assertEquals(Color.TRANSPARENT, drawing.snapshot(false)!!.bitmap.getPixel(200, 100))
        }
    }

    @Test fun cameraOrGlRepairOfNetworkHeldDraftRequiresAFreshAppliedHoldAndSuccessfulLiveAckProbe() {
        for (renderRebuilt in listOf(false, true)) {
            val circuit = AdaptiveCircuit().apply { apply = false }
            val drawing = OutdoorDrawingController()
            val session = drawing.beginSession(400, 200)
            drawing.openMode(session); drawing.cameraReady(session)
            drawing.setColor(session, OutdoorDrawingColor.RED)
            drawing.beginStroke(session, .1f, .5f); drawing.appendStroke(session, .9f, .5f); drawing.endStroke(session)
            val published = checkNotNull(drawing.snapshot(false))
            drawing.acknowledgeOutput(published)
            var holdToken = 0L
            var releaseGeneration = 0L
            var releaseToken = 0L
            var consumedSuccess = 0L
            fun applyServiceActions() {
                repeat(4) {
                    val action = circuit.control.action ?: return@repeat
                    when (action.kind) {
                        OutdoorAdaptationOperation.BITRATE -> circuit.control.bitrateResult(action.id, BitrateChangeResult.ACCEPTED, circuit.now)
                        OutdoorAdaptationOperation.HOLD -> {
                            holdToken = drawing.freezeOutput(session, drawing.snapshot(false))
                            releaseGeneration = 0L; releaseToken = 0L
                            circuit.control.held(action.id, true, circuit.now)
                        }
                        OutdoorAdaptationOperation.RELEASE -> {
                            releaseGeneration = circuit.control.view.probeGeneration; releaseToken = holdToken
                            circuit.control.released(action.id, true, circuit.now)
                        }
                    }
                }
                val completed = circuit.control.view.completedProbeGeneration
                if (completed > consumedSuccess && completed == releaseGeneration && releaseToken == holdToken &&
                    drawing.confirmLive(session, releaseToken)) consumedSuccess = completed
            }
            fun step(wait: Long = 0, live: Boolean = true) { circuit.step(wait = wait, live = live); applyServiceActions() }
            fun until(wait: Long = 0, live: Boolean = true, condition: () -> Boolean) {
                repeat(100) { if (condition()) return; step(wait, live) }
                assertTrue("Recovery condition must be reachable", condition())
            }
            until(wait = 300) { circuit.control.view.phase == OutdoorAdaptationPhase.HELD }
            assertTrue(drawing.clear(session))
            drawing.setVideoHidden(session, false)
            if (renderRebuilt) completeOutdoorVideoRecovery(circuit.control, true, true, false, circuit.now) {}
            else circuit.control.visibility(false, circuit.now)
            drawing.cameraReady(session)
            assertTrue(drawing.networkRecoveryPending(session))
            assertTrue(drawing.state.value.pending)
            assertSame(published.bitmap, drawing.snapshot(false)!!.bitmap)
            assertTrue(circuit.control.restoreRecoveryGate(circuit.now))
            applyServiceActions()
            assertEquals(OutdoorAdaptationPhase.HELD, circuit.control.view.phase)
            until(live = false) { circuit.control.view.phase == OutdoorAdaptationPhase.PROBING }
            assertTrue(circuit.control.view.releaseApplied)
            assertEquals(0L, consumedSuccess)
            assertSame(published.bitmap, drawing.snapshot(false)!!.bitmap)
            step(wait = 300)
            assertEquals(OutdoorAdaptationPhase.HELD, circuit.control.view.phase)
            assertSame(published.bitmap, drawing.snapshot(false)!!.bitmap)
            until(live = false) { circuit.control.view.phase == OutdoorAdaptationPhase.PROBING }
            until { consumedSuccess > 0L }
            assertFalse(drawing.state.value.pending)
            assertEquals(Color.TRANSPARENT, drawing.snapshot(false)!!.bitmap.getPixel(200, 100))
        }
    }
}
