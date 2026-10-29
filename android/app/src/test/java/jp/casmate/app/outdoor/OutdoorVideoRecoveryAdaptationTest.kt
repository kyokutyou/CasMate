package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorVideoRecoveryAdaptationTest {
    @Test fun automaticCodecRepairRetainsHeldInputAndExistingProbeBackoff() {
        val c = AdaptiveCircuit(); c.hold(); c.probe(); c.step(wait = 300)
        var releases = 0
        c.control.tick(c.now, null, false)
        completeOutdoorVideoRecovery(c.control, false, false, false, c.now) { releases++ }
        assertEquals(0, releases)
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
        assertEquals(2000L, c.control.view.diagnostics.recoveryWaitMs)
        repeat(3) { c.step(live = false) }
        assertEquals(OutdoorAdaptationPhase.HELD, c.control.view.phase)
        c.probe() // New healthy observations and the original finite wait are still required.
        assertEquals(OutdoorAdaptationPhase.PROBING, c.control.view.phase)
    }

    @Test fun explicitRenderRepairStartsNewObservationWithoutResettingNetworkBackoff() {
        val c = AdaptiveCircuit(); c.hold(); c.probe(); c.step(wait = 300)
        var releases = 0
        completeOutdoorVideoRecovery(c.control, true, true, false, c.now) { releases++ }
        assertEquals(1, releases)
        assertEquals(OutdoorAdaptationPhase.LOW_VIDEO, c.control.view.phase)
        assertEquals(2000L, c.control.view.diagnostics.recoveryWaitMs)
    }
}
