package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorDrawingCameraReadinessTest {
    @Test fun continuingCameraCallbacksCannotEnableDrawingDuringCodecOrRenderFaultsAndRepair() {
        val ready = OutdoorState(active = true)
        assertTrue(outdoorDrawingCameraIsReady(true, true, ready))
        for (fault in OutdoorVideoFault.entries) {
            assertFalse(outdoorDrawingCameraIsReady(true, true, ready.copy(videoFaults = setOf(fault))))
        }
        for (blocked in listOf(ready.copy(videoRecovering = true), ready.copy(videoChanging = true),
            ready.copy(videoHidden = true), ready.copy(active = false))) {
            assertFalse(outdoorDrawingCameraIsReady(true, true, blocked))
        }
        assertFalse(outdoorDrawingCameraIsReady(false, true, ready))
        assertFalse(outdoorDrawingCameraIsReady(true, false, ready))
        // Held/probing adaptation intentionally retains drawing access when the source is healthy.
        for (phase in listOf(OutdoorAdaptationPhase.HELD, OutdoorAdaptationPhase.PROBING)) {
            assertTrue(outdoorDrawingCameraIsReady(true, true, ready.copy(adaptation = OutdoorAdaptationView(150000, phase))))
        }
    }
}
