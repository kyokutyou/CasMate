package jp.casmate.app.outdoor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode

enum class OutdoorDrawingTool(val label: String) { PEN("ペン"), ERASER("消しゴム") }
enum class OutdoorDrawingColor(val label: String, val argb: Int) {
    WHITE("白", Color.WHITE), BLACK("黒", Color.BLACK), RED("赤", Color.RED),
    YELLOW("黄", Color.YELLOW), GREEN("緑", Color.GREEN), BLUE("青", Color.BLUE),
}
enum class OutdoorDrawingWidth(val label: String, val fraction: Float) {
    THIN("細", .004f), MEDIUM("中", .008f), THICK("太", .016f),
}

/** Coordinates belong to the entire upright encoder frame, including its internal black bars. */
internal data class OutdoorDrawingPoint(val x: Float, val y: Float) {
    val valid get() = x.isFinite() && y.isFinite() && x in 0f..1f && y in 0f..1f
}

/** A bounded vector history and two CPU rasters. Published bitmaps are immutable and never recycled
 * while a GL renderer or a held output can still own them. No drawing data is persisted. */
internal class OutdoorDrawingDocument(
    val width: Int,
    val height: Int,
    private val maxUndoOperations: Int = 50,
    private val maxHistoryPoints: Int = 50_000,
    private val maxStrokePoints: Int = 4096,
) {
    private sealed interface Operation {
        data class Stroke(
            val tool: OutdoorDrawingTool,
            val color: OutdoorDrawingColor,
            val thickness: OutdoorDrawingWidth,
            val points: List<OutdoorDrawingPoint>,
        ) : Operation
        data object Clear : Operation
    }
    private data class ActiveStroke(
        val tool: OutdoorDrawingTool,
        val color: OutdoorDrawingColor,
        val thickness: OutdoorDrawingWidth,
        val points: MutableList<OutdoorDrawingPoint>,
        val brush: Paint,
    ) {
        fun completed() = Operation.Stroke(tool, color, thickness, points.toList())
    }

    init {
        require(width > 0 && height > 0)
        require(maxUndoOperations > 0 && maxHistoryPoints >= maxStrokePoints && maxStrokePoints >= 2)
    }

    private val baseline = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    private val raster = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    private val baselineCanvas = Canvas(baseline)
    private val canvas = Canvas(raster)
    private val history = ArrayDeque<Operation>()
    private var active: ActiveStroke? = null
    private var snapshot: Bitmap? = null
    private var snapshotRevision = -1L
    var revision = 0L
        private set
    var hasDrawing = false
        private set
    val canUndo get() = active != null || history.isNotEmpty()
    internal val retainedOperationCount get() = history.size + if (active != null) 1 else 0
    internal val retainedPointCount get() = history.sumOf { (it as? Operation.Stroke)?.points?.size ?: 0 } + (active?.points?.size ?: 0)

    fun beginStroke(point: OutdoorDrawingPoint, tool: OutdoorDrawingTool, color: OutdoorDrawingColor,
        thickness: OutdoorDrawingWidth): Boolean {
        if (!point.valid) return false
        endStroke()
        active = ActiveStroke(tool, color, thickness, mutableListOf(point), paint(tool, color, thickness))
        drawFirstPoint(canvas, point, active!!.brush)
        if (tool == OutdoorDrawingTool.PEN) hasDrawing = true
        changed()
        trimHistory()
        return true
    }

    fun appendStroke(point: OutdoorDrawingPoint): Boolean {
        if (!point.valid) return false
        var stroke = active ?: return false
        val previous = stroke.points.last()
        if (point == previous) return false
        // Split a very long gesture losslessly. Each retained interval is independently undoable;
        // neither accepted coordinates nor its already-rendered appearance are decimated.
        if (stroke.points.size >= maxStrokePoints) {
            endStroke()
            beginStroke(previous, stroke.tool, stroke.color, stroke.thickness)
            stroke = active!!
        }
        stroke.points += point
        drawSegment(canvas, stroke.brush, previous, point)
        changed()
        trimHistory()
        return true
    }

    fun endStroke(): Boolean {
        val stroke = active ?: return false
        history.addLast(stroke.completed())
        active = null
        trimHistory()
        hasDrawing = rasterHasContent()
        return true
    }

    fun undo(): Boolean {
        endStroke()
        if (history.isEmpty()) return false
        history.removeLast()
        rebuild()
        changed()
        return true
    }

    fun clear(): Boolean {
        endStroke()
        if (!hasDrawing) return false
        history.addLast(Operation.Clear)
        raster.eraseColor(Color.TRANSPARENT)
        hasDrawing = false
        changed()
        trimHistory()
        return true
    }

    fun rebuild() {
        raster.eraseColor(Color.TRANSPARENT)
        canvas.drawBitmap(baseline, 0f, 0f, null)
        history.forEach { renderOperation(canvas, raster, it) }
        active?.let { renderOperation(canvas, raster, it.completed()) }
        hasDrawing = rasterHasContent()
        snapshotRevision = -1L
    }

    fun bitmapSnapshot(): Bitmap {
        if (snapshotRevision != revision) {
            snapshot = checkNotNull(raster.copy(Bitmap.Config.ARGB_8888, false))
            snapshotRevision = revision
        }
        return checkNotNull(snapshot)
    }

    private fun changed() { revision++ }

    private fun trimHistory() {
        while (history.isNotEmpty() &&
            (retainedOperationCount > maxUndoOperations || retainedPointCount > maxHistoryPoints)) {
            renderOperation(baselineCanvas, baseline, history.removeFirst())
        }
    }

    private fun renderOperation(target: Canvas, bitmap: Bitmap, operation: Operation) {
        when (operation) {
            Operation.Clear -> bitmap.eraseColor(Color.TRANSPARENT)
            is Operation.Stroke -> {
                val brush = paint(operation.tool, operation.color, operation.thickness)
                drawFirstPoint(target, operation.points.first(), brush)
                for (index in 1 until operation.points.size) {
                    drawSegment(target, brush, operation.points[index - 1], operation.points[index])
                }
            }
        }
    }

    private fun paint(tool: OutdoorDrawingTool, selectedColor: OutdoorDrawingColor,
        thickness: OutdoorDrawingWidth) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = selectedColor.argb
        strokeWidth = minOf(width, height) * thickness.fraction
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        if (tool == OutdoorDrawingTool.ERASER) xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
    }

    private fun drawFirstPoint(target: Canvas, point: OutdoorDrawingPoint, brush: Paint) {
        target.drawCircle(point.x * width, point.y * height, brush.strokeWidth / 2f, brush)
    }

    private fun drawSegment(target: Canvas, brush: Paint, from: OutdoorDrawingPoint, to: OutdoorDrawingPoint) {
        target.drawLine(from.x * width, from.y * height, to.x * width, to.y * height, brush)
    }

    private fun rasterHasContent(): Boolean {
        val row = IntArray(width)
        for (y in 0 until height) {
            raster.getPixels(row, 0, width, 0, y, width, 1)
            if (row.any { Color.alpha(it) != 0 }) return true
        }
        return false
    }
}
