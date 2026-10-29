package jp.casmate.app.outdoor

import android.view.InputDevice
import android.view.MotionEvent
import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 35])
class OutdoorDrawingGestureTest {
    private data class Point(val id: Int, val x: Float, val y: Float, val tool: Int = MotionEvent.TOOL_TYPE_FINGER)
    private class Fixture {
        var starts = 0; var ends = 0; var clicks = 0; var flicks = 0
        val ink = mutableListOf<OutdoorDrawingPoint>()
        val view = OutdoorPreviewView(RuntimeEnvironment.getApplication()).apply {
            layout(0, 0, 320, 600); drawingMode = true; drawingEnabled = true; viewportInputEnabled = true
            drawingOutputWidth = 1280; drawingOutputHeight = 720
            drawingViewport = OutdoorDrawingViewport(zoom = 3.5f, initialized = true)
            isClickable = true; setOnClickListener { clicks++ }; onHorizontalFlick = { flicks++ }
            onDrawingStart = { x, y -> starts++; ink.add(OutdoorDrawingPoint(x, y)); true }
            onDrawingMove = { x, y -> ink.add(OutdoorDrawingPoint(x, y)) }
            onDrawingEnd = { ends++ }
        }
        fun send(action: Int, vararg points: Point) {
            val properties = points.map { p -> MotionEvent.PointerProperties().apply { id = p.id; toolType = p.tool } }.toTypedArray()
            val coordinates = points.map { p -> MotionEvent.PointerCoords().apply { x = p.x; y = p.y; pressure = .5f; size = 1f } }.toTypedArray()
            val event = MotionEvent.obtain(100, 120, action, points.size, properties, coordinates, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
            try { assertTrue(view.onTouchEvent(event)) } finally { event.recycle() }
        }
        fun tick(ms: Long) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms)) }
    }

    @Test fun fingerWaitsAtMostEightyMillisecondsAndMovementStartsEarlier() {
        val f = Fixture(); val p = Point(0, 160f, 300f)
        f.send(MotionEvent.ACTION_DOWN, p); assertEquals(0, f.starts)
        f.tick(79); assertEquals(0, f.starts); f.tick(1); assertEquals(1, f.starts)
        f.send(MotionEvent.ACTION_UP, p); assertEquals(1, f.ends)
        val g = Fixture(); g.send(MotionEvent.ACTION_DOWN, p)
        g.send(MotionEvent.ACTION_MOVE, p.copy(x = 200f)); assertEquals(1, g.starts)
        assertEquals(0, g.clicks); assertEquals(0, g.flicks)
    }

    @Test fun aQuickTapStillDrawsOneDotAndStylusStartsImmediatelyIgnoringThePalm() {
        val f = Fixture(); val p = Point(0, 160f, 300f)
        f.send(MotionEvent.ACTION_DOWN, p); f.send(MotionEvent.ACTION_UP, p)
        assertEquals(1, f.starts); assertEquals(1, f.ends)
        val g = Fixture(); val pen = p.copy(tool = MotionEvent.TOOL_TYPE_STYLUS); val palm = Point(1, 250f, 300f)
        g.send(MotionEvent.ACTION_DOWN, pen); assertEquals(1, g.starts)
        val view = g.view.drawingViewport
        g.send(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), pen, palm)
        g.send(MotionEvent.ACTION_MOVE, pen.copy(x = 180f), palm.copy(x = 270f))
        g.send(MotionEvent.ACTION_POINTER_UP or (1 shl 8), pen.copy(x = 180f), palm.copy(x = 270f))
        g.send(MotionEvent.ACTION_UP, pen.copy(x = 190f))
        assertEquals(1, g.ends); assertEquals(view, g.view.drawingViewport)
        assertTrue(g.ink.size >= 3)
    }

    @Test fun twoFingersBeforeTheDeadlineNeverDrawAndTheRemainingFingerCannotLeaveATail() {
        val f = Fixture(); val p = Point(0, 100f, 300f); val q = Point(1, 220f, 300f)
        val before = f.view.drawingViewport!!
        f.send(MotionEvent.ACTION_DOWN, p)
        f.send(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), p, q); f.tick(100)
        f.send(MotionEvent.ACTION_MOVE, p.copy(x = 90f, y = 320f), q.copy(x = 260f, y = 320f))
        assertTrue(f.view.drawingViewport!!.zoom > before.zoom)
        assertTrue(f.view.drawingViewport!!.panX != 0f || f.view.drawingViewport!!.panY != 0f)
        f.send(MotionEvent.ACTION_POINTER_UP or (1 shl 8), p, q)
        val stopped = f.view.drawingViewport
        f.send(MotionEvent.ACTION_MOVE, p.copy(x = 170f)); f.send(MotionEvent.ACTION_UP, p.copy(x = 170f))
        assertEquals(stopped, f.view.drawingViewport); assertEquals(0, f.starts); assertEquals(0, f.ends)
        assertTrue(f.ink.isEmpty())
    }

    @Test fun validInkEndsBeforePinchAndMenusCancelBothPendingInkAndNavigation() {
        val f = Fixture(); val p = Point(0, 100f, 300f); val q = Point(1, 220f, 300f)
        f.send(MotionEvent.ACTION_DOWN, p); f.send(MotionEvent.ACTION_MOVE, p.copy(x = 140f))
        assertEquals(1, f.starts)
        f.send(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), p.copy(x = 140f), q); assertEquals(1, f.ends)
        val before = f.view.drawingViewport
        f.view.viewportInputEnabled = false; f.view.drawingEnabled = false
        f.send(MotionEvent.ACTION_MOVE, p.copy(x = 80f), q.copy(x = 270f)); assertEquals(before, f.view.drawingViewport)
        f.send(MotionEvent.ACTION_UP, p); assertEquals(1, f.ends)
        val g = Fixture(); g.send(MotionEvent.ACTION_DOWN, p); g.view.drawingEnabled = false; g.view.viewportInputEnabled = false
        g.tick(200); g.send(MotionEvent.ACTION_UP, p); assertEquals(0, g.starts)
    }

    @Test fun cancelFocusLossAndModeCloseCannotPublishDelayedInk() {
        for (kind in 0..3) {
            val f = Fixture(); val p = Point(0, 160f, 300f)
            f.send(MotionEvent.ACTION_DOWN, p)
            when (kind) { 0 -> f.send(MotionEvent.ACTION_CANCEL, p); 1 -> f.view.onWindowFocusChanged(false); 2 -> f.view.drawingMode = false; else -> f.view.drawingSession = 42L }
            f.tick(200); assertEquals(0, f.starts); assertEquals(0, f.ends)
        }
    }
}
