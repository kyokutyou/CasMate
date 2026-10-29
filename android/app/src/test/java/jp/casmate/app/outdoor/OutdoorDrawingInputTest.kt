package jp.casmate.app.outdoor

import android.view.InputDevice
import android.view.MotionEvent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 35])
class OutdoorDrawingInputTest {
    private class Fixture {
        var starts = 0
        var ends = 0
        var clicks = 0
        val points = mutableListOf<Pair<Float, Float>>()
        val flicks = mutableListOf<Int>()
        val view = OutdoorPreviewView(RuntimeEnvironment.getApplication()).apply {
            layout(0, 0, 320, 180)
            isClickable = true
            setOnClickListener { clicks++ }
            onHorizontalFlick = { flicks.add(it) }
            drawingMode = true; drawingEnabled = true
            onDrawingStart = { x, y -> starts++; points.add(x to y); true }
            onDrawingMove = { x, y -> points.add(x to y) }
            onDrawingEnd = { ends++ }
        }
        fun touch(action: Int, x: Float, y: Float, tool: Int = MotionEvent.TOOL_TYPE_FINGER, count: Int = 1, pressure: Float = 1f) {
            val properties = Array(count) { index -> MotionEvent.PointerProperties().apply { id = index; toolType = tool } }
            val coordinates = Array(count) { MotionEvent.PointerCoords().apply {
                this.x = x; this.y = y; this.pressure = pressure; size = 1f
            } }
            val event = MotionEvent.obtain(100, 120, action, count, properties, coordinates,
                0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
            try { assertTrue(view.onTouchEvent(event)) } finally { event.recycle() }
        }
    }

    @Test fun fingerAndStylusNormalizeTheWholeOutputWithoutFocusOrNavigation() {
        for (tool in listOf(MotionEvent.TOOL_TYPE_FINGER, MotionEvent.TOOL_TYPE_STYLUS)) {
            val fixture = Fixture()
            fixture.touch(MotionEvent.ACTION_DOWN, 320f, 90f, tool, pressure = .1f)
            fixture.touch(MotionEvent.ACTION_MOVE, 160f, 45f, tool, pressure = 1f)
            fixture.touch(MotionEvent.ACTION_UP, 0f, 0f, tool)
            assertEquals(listOf(1f to .5f, .5f to .25f, 0f to 0f), fixture.points)
            assertEquals(1, fixture.starts); assertEquals(1, fixture.ends)
            assertEquals(0, fixture.clicks); assertTrue(fixture.flicks.isEmpty())
            assertFalse(fixture.view.performClick())
        }
    }

    @Test fun secondPointerCommitsTheValidPartAndRejectsTheRemainingSequence() {
        val fixture = Fixture()
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.touch(MotionEvent.ACTION_MOVE, 160f, 90f)
        fixture.touch(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 200f, 120f, count = 2)
        fixture.touch(MotionEvent.ACTION_MOVE, 220f, 130f)
        fixture.touch(MotionEvent.ACTION_UP, 240f, 140f)
        assertEquals(listOf(.25f to .25f, .5f to .5f), fixture.points)
        assertEquals(1, fixture.ends)
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.touch(MotionEvent.ACTION_UP, 80f, 45f)
        assertEquals(2, fixture.starts); assertEquals(2, fixture.ends)
        assertTrue(fixture.flicks.isEmpty())
    }

    @Test fun disabledMenuCancelAndOutsideDownCannotLeakLateInput() {
        val fixture = Fixture()
        fixture.touch(MotionEvent.ACTION_DOWN, -1f, 45f)
        fixture.touch(MotionEvent.ACTION_UP, 80f, 45f)
        assertEquals(0, fixture.starts)
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.view.drawingEnabled = false
        fixture.touch(MotionEvent.ACTION_MOVE, 160f, 90f)
        fixture.touch(MotionEvent.ACTION_UP, 240f, 135f)
        assertTrue(fixture.points.isEmpty())
        assertEquals(0, fixture.ends)
        fixture.view.drawingEnabled = true
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.touch(MotionEvent.ACTION_CANCEL, 100f, 80f)
        fixture.touch(MotionEvent.ACTION_UP, 240f, 135f)
        assertEquals(0, fixture.starts); assertEquals(0, fixture.ends)
        assertEquals(0, fixture.clicks)
    }

    @Test fun edgeMovesClipAndClosingModeCompletesTheVisibleStrokeOnce() {
        val fixture = Fixture()
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.touch(MotionEvent.ACTION_MOVE, 640f, -90f)
        fixture.view.drawingMode = false
        assertEquals(listOf(.25f to .25f, 1f to 0f), fixture.points)
        assertEquals(1, fixture.ends)
        fixture.view.drawingEnabled = false
        assertEquals(1, fixture.ends)
    }

    @Test fun portraitZoomAndPanUseTheSameInverseTransformForInkAndRejectExternalMargins() {
        val fixture = Fixture()
        fixture.view.layout(0, 0, 320, 600)
        fixture.view.drawingOutputWidth = 16; fixture.view.drawingOutputHeight = 9
        fixture.view.drawingViewport = OutdoorDrawingViewport(zoom = 2f, initialized = true)
        fixture.touch(MotionEvent.ACTION_DOWN, 20f, 20f)
        fixture.touch(MotionEvent.ACTION_UP, 20f, 20f)
        assertEquals(0, fixture.starts)
        fixture.touch(MotionEvent.ACTION_DOWN, 160f, 300f)
        fixture.touch(MotionEvent.ACTION_UP, 160f, 300f)
        assertEquals(.5f to .5f, fixture.points.last())
        fixture.view.drawingViewport = fixture.view.drawingViewport!!.transformed(320f, 600f, 16, 9, 160f, 300f, 240f, 300f, 1f)
        fixture.touch(MotionEvent.ACTION_DOWN, 160f, 300f)
        fixture.touch(MotionEvent.ACTION_UP, 160f, 300f)
        assertEquals(.375f to .5f, fixture.points.last())
        assertEquals(0, fixture.clicks); assertTrue(fixture.flicks.isEmpty())
    }

    @Test fun disabledInputCannotDrawOrNavigateBehindAMenu() {
        val fixture = Fixture()
        val original = OutdoorDrawingViewport(zoom = 3f, initialized = true)
        fixture.view.drawingViewport = original
        fixture.view.drawingEnabled = false
        fixture.view.viewportInputEnabled = false
        fixture.touch(MotionEvent.ACTION_DOWN, 80f, 45f)
        fixture.touch(MotionEvent.ACTION_MOVE, 160f, 90f)
        assertEquals(original, fixture.view.drawingViewport)
        fixture.touch(MotionEvent.ACTION_UP, 160f, 90f)
        assertEquals(original, fixture.view.drawingViewport)
        assertTrue(fixture.points.isEmpty())
    }
}
