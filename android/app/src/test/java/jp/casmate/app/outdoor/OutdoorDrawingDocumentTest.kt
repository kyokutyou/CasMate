package jp.casmate.app.outdoor

import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorDrawingDocumentTest {
    private fun line(document: OutdoorDrawingDocument, tool: OutdoorDrawingTool = OutdoorDrawingTool.PEN,
        color: OutdoorDrawingColor = OutdoorDrawingColor.WHITE, y: Float = .5f) {
        assertTrue(document.beginStroke(OutdoorDrawingPoint(.1f, y), tool, color, OutdoorDrawingWidth.THICK))
        assertTrue(document.appendStroke(OutdoorDrawingPoint(.9f, y)))
        assertTrue(document.endStroke())
    }

    @Test fun pointAndLiveLineUseNormalizedOutputCoordinatesAndImmutableSharedSnapshot() {
        val document = OutdoorDrawingDocument(400, 200)
        assertTrue(document.beginStroke(OutdoorDrawingPoint(.1f, .5f), OutdoorDrawingTool.PEN,
            OutdoorDrawingColor.RED, OutdoorDrawingWidth.THICK))
        val point = document.bitmapSnapshot()
        assertEquals(Color.RED, point.getPixel(40, 100))
        assertEquals(Color.TRANSPARENT, point.getPixel(200, 100))
        assertFalse(point.isMutable)
        assertSame(point, document.bitmapSnapshot())
        assertTrue(document.appendStroke(OutdoorDrawingPoint(.9f, .5f)))
        val line = document.bitmapSnapshot()
        assertNotSame(point, line)
        assertEquals(Color.RED, line.getPixel(200, 100))
        assertEquals(Color.TRANSPARENT, point.getPixel(200, 100))
        assertEquals(Color.TRANSPARENT, line.getPixel(200, 90))
    }

    @Test fun eraserRemovesOnlyTouchedContentAndUndoClearRestoresExactRaster() {
        val document = OutdoorDrawingDocument(400, 200)
        line(document, color = OutdoorDrawingColor.BLUE)
        val original = document.bitmapSnapshot()
        document.beginStroke(OutdoorDrawingPoint(.5f, .4f), OutdoorDrawingTool.ERASER,
            OutdoorDrawingColor.WHITE, OutdoorDrawingWidth.THICK)
        document.appendStroke(OutdoorDrawingPoint(.5f, .6f)); document.endStroke()
        val erased = document.bitmapSnapshot()
        assertEquals(Color.TRANSPARENT, erased.getPixel(200, 100))
        assertEquals(Color.BLUE, erased.getPixel(80, 100))
        assertTrue(document.undo())
        assertTrue(original.sameAs(document.bitmapSnapshot()))
        assertTrue(document.clear())
        assertFalse(document.hasDrawing)
        assertEquals(Color.TRANSPARENT, document.bitmapSnapshot().getPixel(200, 100))
        assertTrue(document.undo())
        assertTrue(original.sameAs(document.bitmapSnapshot()))
    }

    @Test fun invalidCoordinatesDoNotCreateHistoryAndBordersAreClipped() {
        val document = OutdoorDrawingDocument(200, 200)
        for (point in listOf(OutdoorDrawingPoint(-.1f, .5f), OutdoorDrawingPoint(1.1f, .5f),
            OutdoorDrawingPoint(Float.NaN, .5f), OutdoorDrawingPoint(.5f, Float.POSITIVE_INFINITY))) {
            assertFalse(document.beginStroke(point, OutdoorDrawingTool.PEN, OutdoorDrawingColor.WHITE, OutdoorDrawingWidth.THICK))
        }
        assertFalse(document.canUndo)
        document.beginStroke(OutdoorDrawingPoint(0f, .5f), OutdoorDrawingTool.PEN,
            OutdoorDrawingColor.GREEN, OutdoorDrawingWidth.THICK)
        document.endStroke()
        assertEquals(Color.GREEN, document.bitmapSnapshot().getPixel(0, 100))
        assertEquals(Color.TRANSPARENT, document.bitmapSnapshot().getPixel(199, 100))
    }

    @Test fun historyFoldsOldestStrokesIntoBaselineAndRetainsOnlyFiftyUndoOperations() {
        val document = OutdoorDrawingDocument(400, 200)
        repeat(55) { index -> line(document, color = OutdoorDrawingColor.RED, y = .1f + index * .012f) }
        assertEquals(50, document.retainedOperationCount)
        repeat(50) { assertTrue(document.undo()) }
        assertFalse(document.undo())
        assertTrue(document.hasDrawing)
        assertEquals(Color.RED, document.bitmapSnapshot().getPixel(200, 20))
        assertEquals(Color.TRANSPARENT, document.bitmapSnapshot().getPixel(200, 149))
    }

    @Test fun longGestureSplitsWithoutDecimationAndUndoRebuildPreservesAllAcceptedPixels() {
        val document = OutdoorDrawingDocument(200, 200, maxUndoOperations = 3, maxHistoryPoints = 8, maxStrokePoints = 4)
        document.beginStroke(OutdoorDrawingPoint(.1f, .5f), OutdoorDrawingTool.PEN,
            OutdoorDrawingColor.YELLOW, OutdoorDrawingWidth.THICK)
        for (index in 1..12) document.appendStroke(OutdoorDrawingPoint(.1f + index * .06f, .5f))
        document.endStroke()
        assertTrue(document.retainedOperationCount <= 3)
        assertTrue(document.retainedPointCount <= 8)
        val accepted = document.bitmapSnapshot()
        document.clear(); assertTrue(document.undo())
        assertTrue(accepted.sameAs(document.bitmapSnapshot()))
        assertEquals(Color.YELLOW, document.bitmapSnapshot().getPixel(164, 100))
    }
}
