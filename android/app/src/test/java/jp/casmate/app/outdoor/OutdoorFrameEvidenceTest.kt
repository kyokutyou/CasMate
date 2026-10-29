package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorFrameEvidenceTest {
    @Test fun oldFrozenFramesAndRepeatedSourceImagesAreNotNewLiveEvidence() {
        val evidence = OutdoorFrameEvidence()
        evidence.submitted(100, 1, 0) // held image encoded before release
        evidence.submitted(200, 2, 7) // actual new live image of this trial
        evidence.submitted(300, 2, 7) // forced redraw of the same source
        assertEquals(0L, evidence.encoded(100))
        assertEquals(7L, evidence.encoded(200))
        assertEquals(0L, evidence.encoded(200))
        assertEquals(0L, evidence.encoded(300))
        assertEquals(0L, evidence.encoded(999))
    }

    @Test fun delayedEncoderOutputCannotBorrowANewGeneration() {
        val evidence = OutdoorFrameEvidence()
        evidence.submitted(100, 1, 5)
        evidence.submitted(200, 2, 6)
        assertEquals(5L, evidence.encoded(100))
        evidence.clear()
        assertEquals(0L, evidence.encoded(200))
    }
}
