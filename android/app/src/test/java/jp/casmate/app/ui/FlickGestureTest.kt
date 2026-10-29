package jp.casmate.app.ui

import android.view.MotionEvent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 35])
class FlickGestureTest {
    private fun gesture(startX: Float, x: Float, y: Float = 20f, duration: Long = 250): Int? {
        val tracker = HorizontalFlickTracker(56f, 12f)
        tracker.begin(1, startX, 20f, 0)
        tracker.move(1, x, y, duration / 2)
        return tracker.finish(1, x, y, duration)
    }

    @Test fun completeHorizontalGesturesHaveTheirDirection() {
        assertEquals(-1, gesture(200f, 80f))
        assertEquals(1, gesture(80f, 200f))
    }

    @Test fun tapsShortSlowAndVerticalGesturesAreRejected() {
        assertNull(gesture(80f, 80f))
        assertNull(gesture(80f, 100f))
        assertNull(gesture(80f, 200f, duration = 900))
        assertNull(gesture(80f, 200f, y = 220f))
        assertNull(gesture(80f, 200f, y = 110f))
    }

    @Test fun canceledMultitouchAndInitiallyVerticalGesturesNeverBecomeFlicks() {
        val tracker = HorizontalFlickTracker(56f, 12f)
        tracker.begin(1, 200f, 20f, 0); tracker.cancel()
        assertNull(tracker.finish(1, 20f, 20f, 100))
        tracker.begin(1, 200f, 20f, 0); tracker.move(2, 20f, 20f, 50)
        assertNull(tracker.finish(1, 20f, 20f, 100))
        tracker.begin(1, 200f, 20f, 0); tracker.move(1, 190f, 60f, 50)
        assertNull(tracker.finish(1, 20f, 60f, 100))
    }

    @Test fun nativeTouchCancelIsRejectedButTheNextGestureCanNavigate() {
        val tracker = HorizontalFlickTracker(56f, 12f)
        fun event(action: Int, x: Float, time: Long): Int? = MotionEvent.obtain(0, time, action, x, 20f, 0).let {
            try { tracker.observe(it) } finally { it.recycle() }
        }
        assertNull(event(MotionEvent.ACTION_DOWN, 200f, 0))
        assertNull(event(MotionEvent.ACTION_MOVE, 50f, 50))
        assertNull(event(MotionEvent.ACTION_CANCEL, 50f, 100))
        assertNull(event(MotionEvent.ACTION_UP, 50f, 150))
        assertNull(event(MotionEvent.ACTION_DOWN, 200f, 200))
        assertEquals(-1, event(MotionEvent.ACTION_UP, 50f, 400))
    }

    @Test fun nativeMultiplePointersCancelTheWholeGesture() {
        val tracker = HorizontalFlickTracker(56f, 12f)
        val down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, 200f, 20f, 0)
        tracker.observe(down); down.recycle()
        val properties = Array(2) { index -> MotionEvent.PointerProperties().apply {
            id = index; toolType = MotionEvent.TOOL_TYPE_FINGER
        } }
        val coordinates = Array(2) { index -> MotionEvent.PointerCoords().apply {
            x = 150f + index * 10; y = 20f; pressure = 1f; size = 1f
        } }
        val multiple = MotionEvent.obtain(0, 50,
            MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            2, properties, coordinates, 0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
        assertNull(tracker.observe(multiple)); multiple.recycle()
        val up = MotionEvent.obtain(0, 100, MotionEvent.ACTION_UP, 20f, 20f, 0)
        assertNull(tracker.observe(up)); up.recycle()
    }
}
