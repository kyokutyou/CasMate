package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorHoldFilterTest {
    private class Filter : OutdoorHoldFilter() {
        var frames = 0
        override fun renderLiveFrame() { frames++ }
    }
    @Test fun holdKeepsRawOutputWhileRenderTicksContinueAndResumeReplacesIt() {
        val filter = Filter()
        filter.draw(); filter.draw()
        var completions = 0
        filter.hold { assertTrue(it); completions++ }
        repeat(100) { filter.draw() }
        assertEquals(2, filter.frames)
        assertEquals(1, completions)
        assertFalse(filter.outputLive)
        var released = false
        filter.resume { released = it }
        assertFalse(released)
        assertFalse(filter.outputLive)
        filter.draw()
        assertTrue(released)
        assertTrue(filter.outputLive)
        assertEquals(3, filter.frames)
    }
    @Test fun hideOrStopCancelsPendingHoldWithoutRunningItsLateCallback() {
        val filter = Filter()
        filter.draw()
        filter.hold { fail("stale callback") }
        filter.resume(); filter.draw()
        assertEquals(2, filter.frames)
    }
    @Test fun unavailableCameraImageRejectsHoldAndContinuesLiveRendering() {
        val filter = Filter()
        var result: Boolean? = null
        filter.hold { result = it }
        filter.draw(); filter.draw()
        assertEquals(false, result)
        assertEquals(2, filter.frames)
    }
}
