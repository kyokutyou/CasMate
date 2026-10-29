package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorDrawingViewportTest {
    @Test fun centeredFillAndWholeAlternateWithoutChangingTheOutput() {
        for ((width, height) in listOf(320f to 700f, 400f to 770f, 760f to 350f)) {
            val fill = OutdoorDrawingViewport.centeredFill(width, height, 1280, 720)
            val frame = fill.geometry(width, height, 1280, 720)
            assertTrue(frame.width >= width - .01f); assertTrue(frame.height >= height - .01f)
            assertTrue(fill.zoom in 1f..6f); assertEquals(0f, fill.panX, 0f); assertEquals(0f, fill.panY, 0f)
            val whole = fill.toggled(width, height, 1280, 720)
            assertEquals(1f, whole.zoom, 0f); assertTrue(whole.nextFill)
            assertEquals(fill, whole.toggled(width, height, 1280, 720))
        }
    }

    @Test fun pinchKeepsThePointUnderTheMovingMidpointAndClampsContinuously() {
        val view = OutdoorDrawingViewport.centeredFill(320f, 700f, 1280, 720)
        val point = view.geometry(320f, 700f, 1280, 720).point(150f, 350f)!!
        val changed = view.transformed(320f, 700f, 1280, 720, 150f, 350f, 170f, 380f, 1.2f)
        val mapped = changed.geometry(320f, 700f, 1280, 720).point(170f, 380f)!!
        assertEquals(point.x, mapped.x, .00001f); assertEquals(point.y, mapped.y, .00001f)
        assertEquals(6f, changed.transformed(320f, 700f, 1280, 720, 160f, 350f, 160f, 350f, 20f).zoom, 0f)
        assertEquals(1f, changed.transformed(320f, 700f, 1280, 720, 160f, 350f, 160f, 350f, .01f).zoom, 0f)
    }

    @Test fun everyZoomAndOutputAspectRoundTripsVisibleOutputCoordinates() {
        for ((outputWidth, outputHeight) in listOf(16 to 9, 9 to 16)) for ((width, height) in listOf(320f to 600f, 760f to 240f)) {
            for (zoom in listOf(1f, 1.5f, 2f, 3f, 4f, 6f)) {
                val viewport = OutdoorDrawingViewport(zoom = zoom)
                val geometry = viewport.geometry(width, height, outputWidth, outputHeight)
                assertTrue(kotlin.math.abs(geometry.width - geometry.height * outputWidth / outputHeight) <= viewport.zoom)
                for (point in listOf(.2f to .3f, .5f to .5f, .8f to .7f)) {
                    val restored = geometry.point(geometry.left + point.first * geometry.width, geometry.top + point.second * geometry.height)!!
                    assertEquals(point.first, restored.x, .0001f); assertEquals(point.second, restored.y, .0001f)
                }
            }
        }
    }

    @Test fun dragLimitsKeepTheEnlargedFrameCoveringTheViewportAndResetShowsTheWholeFrame() {
        val zoomed = OutdoorDrawingViewport(zoom = 6f).transformed(320f, 600f, 16, 9, 0f, 0f, 10000f, -10000f, 1f)
        val frame = zoomed.geometry(320f, 600f, 16, 9)
        assertEquals(0f, frame.left, .001f)
        assertEquals(600f, frame.top + frame.height, .001f)
        val fit = OutdoorDrawingViewport().geometry(320f, 600f, 16, 9)
        assertEquals(320f, fit.width, .001f); assertEquals(180f, fit.height, .001f)
        assertNull(fit.point(160f, 0f))
        assertEquals(OutdoorDrawingPoint(.5f, .5f), fit.point(160f, 300f))
    }

    @Test fun oddMarginsFollowTheExactGlViewportAtMaximumZoom() {
        val fit = OutdoorDrawingViewport().geometry(1080f, 2400f, 1280, 720)
        assertEquals(607f, fit.height, 0f); assertEquals(897f, fit.top, 0f)
        val zoom = OutdoorDrawingViewport(zoom = 6f).geometry(1080f, 2400f, 1280, 720)
        assertEquals(-618f, zoom.top, 0f)
        assertEquals(OutdoorDrawingPoint(.5f, .5f), zoom.point(540f, 1203f))
        assertTrue(zoom.point(540f, 1200f)!!.y < .5f)
    }
}
