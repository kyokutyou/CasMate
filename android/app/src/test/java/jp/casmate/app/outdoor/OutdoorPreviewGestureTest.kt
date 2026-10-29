package jp.casmate.app.outdoor

import android.view.MotionEvent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 35])
class OutdoorPreviewGestureTest {
    private class Fixture {
        var clicks = 0
        val directions = mutableListOf<Int>()
        val view = OutdoorPreviewView(RuntimeEnvironment.getApplication()).apply {
            layout(0, 0, 320, 400)
            setOnClickListener { clicks++ }
            onHorizontalFlick = { directions.add(it) }
        }

        fun touch(action: Int, x: Float, y: Float, time: Long, start: Long = 100): Boolean =
            MotionEvent.obtain(start, time, action, x, y, 0).let { event ->
                try { view.onTouchEvent(event) } finally { event.recycle() }
            }
    }

    @Test fun focusTapStillClicksWhileCompletedFlickNavigatesWithoutClicking() {
        val fixture = Fixture()
        assertTrue(fixture.touch(MotionEvent.ACTION_DOWN, 220f, 100f, 100))
        fixture.touch(MotionEvent.ACTION_UP, 220f, 100f, 150)
        assertEquals(1, fixture.clicks)
        assertTrue(fixture.directions.isEmpty())
        fixture.touch(MotionEvent.ACTION_DOWN, 250f, 100f, 500, 500)
        fixture.touch(MotionEvent.ACTION_MOVE, 100f, 102f, 550, 500)
        fixture.touch(MotionEvent.ACTION_UP, 20f, 102f, 600, 500)
        assertEquals(listOf(-1), fixture.directions)
        assertEquals(1, fixture.clicks)
    }

    @Test fun verticalDragIsUnconsumedSoTheParentCanScrollAndNeverNavigatesOrFocuses() {
        val fixture = Fixture()
        fixture.touch(MotionEvent.ACTION_DOWN, 120f, 100f, 100)
        assertFalse(fixture.touch(MotionEvent.ACTION_MOVE, 121f, 220f, 150))
        fixture.touch(MotionEvent.ACTION_CANCEL, 121f, 220f, 200)
        assertTrue(fixture.directions.isEmpty())
        assertEquals(0, fixture.clicks)
    }

    @Test fun cancelAndMultitouchRejectNavigationForTheWholeSequence() {
        val fixture = Fixture()
        fixture.touch(MotionEvent.ACTION_DOWN, 250f, 100f, 100)
        fixture.touch(MotionEvent.ACTION_MOVE, 100f, 100f, 150)
        fixture.touch(MotionEvent.ACTION_CANCEL, 100f, 100f, 200)
        fixture.touch(MotionEvent.ACTION_UP, 20f, 100f, 220)
        assertTrue(fixture.directions.isEmpty())
        assertEquals(0, fixture.clicks)

        fixture.touch(MotionEvent.ACTION_DOWN, 250f, 100f, 500, 500)
        val properties = Array(2) { index -> MotionEvent.PointerProperties().apply {
            id = index; toolType = MotionEvent.TOOL_TYPE_FINGER
        } }
        val coordinates = Array(2) { index -> MotionEvent.PointerCoords().apply {
            x = 200f + index * 10; y = 100f; pressure = 1f; size = 1f
        } }
        val multiple = MotionEvent.obtain(500, 550,
            MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            2, properties, coordinates, 0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
        fixture.view.onTouchEvent(multiple); multiple.recycle()
        fixture.touch(MotionEvent.ACTION_UP, 20f, 100f, 600, 500)
        assertTrue(fixture.directions.isEmpty())
        assertEquals(0, fixture.clicks)
    }

    @Test fun previewWithoutFocusStillSupportsHorizontalFlickAndYieldsVerticalMoves() {
        val fixture = Fixture()
        fixture.view.isClickable = false
        fixture.touch(MotionEvent.ACTION_DOWN, 250f, 100f, 100)
        fixture.touch(MotionEvent.ACTION_MOVE, 100f, 100f, 150)
        fixture.touch(MotionEvent.ACTION_UP, 20f, 100f, 200)
        assertEquals(listOf(-1), fixture.directions)
        assertEquals(0, fixture.clicks)
        fixture.touch(MotionEvent.ACTION_DOWN, 120f, 100f, 500, 500)
        assertFalse(fixture.touch(MotionEvent.ACTION_MOVE, 121f, 220f, 550, 500))
        fixture.touch(MotionEvent.ACTION_CANCEL, 121f, 220f, 600, 500)
        assertEquals(listOf(-1), fixture.directions)
    }
}
