package jp.casmate.app.outdoor

import android.content.Context
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.TextureView
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.hypot

/** Normal taps focus the camera; handwriting owns its complete pointer sequence. */
class OutdoorPreviewView(context: Context) : TextureView(context) {
    var onHorizontalFlick: ((Int) -> Unit)? = null
    var drawingMode = false
        set(value) { if (field != value) cancelInput(); field = value; updateViewportTransform() }
    var drawingEnabled = false
        set(value) { if (field && !value) cancelInput(); field = value }
    var onDrawingStart: ((Float, Float) -> Boolean)? = null
    var onDrawingMove: ((Float, Float) -> Unit)? = null
    var onDrawingEnd: (() -> Unit)? = null
    internal var drawingViewport: OutdoorDrawingViewport? = null
        set(value) {
            if (field != value && sequenceActive && !applyingGestureViewport) cancelInput()
            field = value; updateViewportTransform()
        }
    internal var drawingOutputWidth = 16
        set(value) { field = value; updateViewportTransform() }
    internal var drawingOutputHeight = 9
        set(value) { field = value; updateViewportTransform() }
    internal var viewportInputEnabled = false
        set(value) { if (field && !value) cancelInput(); field = value }
    internal var onViewportChange: ((OutdoorDrawingViewport) -> Unit)? = null
    internal var drawingInputRegions: OutdoorDrawingInputRegions? = null
    internal var drawingSession = 0L
        set(value) { if (field != value) cancelInput(); field = value }
    private var applyingGestureViewport = false
    private enum class Phase { IDLE, WAITING, INK, TRANSFORM, BLOCKED }
    private var phase = Phase.IDLE
    private var sequenceActive = false
    private var primary = -1
    private var primaryTool = MotionEvent.TOOL_TYPE_UNKNOWN
    private val pending = mutableListOf<Pair<Float, Float>>()
    private val inputHandler = Handler(Looper.getMainLooper())
    private val beginPending = Runnable { startInk() }
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private var firstFinger = -1; private var secondFinger = -1
    private var focusX = 0f; private var focusY = 0f; private var distance = 1f
    private val flick = jp.casmate.app.ui.HorizontalFlickTracker(48f * resources.displayMetrics.density, slop)
    private var tapped: Pair<Float, Float>? = null
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = isClickable || onHorizontalFlick != null
        override fun onSingleTapUp(event: MotionEvent): Boolean {
            if (!isClickable) return false
            tapped = event.x to event.y; return true
        }
        override fun onScroll(first: MotionEvent?, current: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            if (first == null || onHorizontalFlick == null) return false
            return abs(current.x - first.x) > abs(current.y - first.y) * 1.5f
        }
    })
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (drawingMode) return drawTouch(event)
        val direction = flick.observe(event)
        if (direction != null && onHorizontalFlick != null) {
            tapped = null
            val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            gestures.onTouchEvent(cancel); cancel.recycle(); onHorizontalFlick?.invoke(direction); return true
        }
        if (!isClickable && onHorizontalFlick == null) return super.onTouchEvent(event)
        val handled = gestures.onTouchEvent(event)
        if (tapped != null) performClick()
        return handled
    }
    override fun performClick(): Boolean {
        if (drawingMode) return false
        super.performClick()
        if (!isClickable) return false
        val point = tapped ?: (width / 2f to height / 2f)
        tapped = null; OutdoorRuntime.service?.focus(point.first, point.second, width, height); return true
    }
    private fun drawTouch(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                cancelInput(); sequenceActive = true; phase = Phase.WAITING
                if (hitsControl(event, 0)) { cancelInput(); return true }
                primaryTool = event.getToolType(0)
                if (width > 0 && height > 0 && primaryTool in listOf(MotionEvent.TOOL_TYPE_FINGER, MotionEvent.TOOL_TYPE_STYLUS)) {
                    parent?.requestDisallowInterceptTouchEvent(true)
                    if (drawingEnabled) {
                        primary = event.getPointerId(0); pending.add(event.x to event.y)
                        if (primaryTool == MotionEvent.TOOL_TYPE_STYLUS) startInk() else inputHandler.postDelayed(beginPending, 80)
                    }
                } else cancelInput()
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (phase == Phase.INK && primaryTool == MotionEvent.TOOL_TYPE_STYLUS) return true
                if (hitsControl(event, event.actionIndex)) { cancelInput(); return true }
                if (sequenceActive && phase != Phase.BLOCKED && viewportInputEnabled && event.pointerCount == 2 &&
                    (0..1).all { event.getToolType(it) == MotionEvent.TOOL_TYPE_FINGER }) {
                    endInk(); phase = Phase.TRANSFORM
                    firstFinger = event.getPointerId(0); secondFinger = event.getPointerId(1)
                    updateGrip(event, apply = false)
                } else cancelInput()
            }
            MotionEvent.ACTION_MOVE -> {
                if (phase == Phase.TRANSFORM) {
                    if (viewportInputEnabled && event.pointerCount == 2) updateGrip(event, apply = true) else cancelInput()
                } else if (drawingEnabled && primary >= 0 && phase in listOf(Phase.WAITING, Phase.INK)) {
                    val index = event.findPointerIndex(primary)
                    if (index < 0 || primaryTool != MotionEvent.TOOL_TYPE_STYLUS && event.pointerCount != 1) cancelInput()
                    else {
                        for (sample in 0 until event.historySize) inkMove(event.getHistoricalX(index, sample), event.getHistoricalY(index, sample))
                        inkMove(event.getX(index), event.getY(index))
                    }
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                if (phase == Phase.INK && primaryTool == MotionEvent.TOOL_TYPE_STYLUS && event.getPointerId(event.actionIndex) != primary) return true
                cancelInput()
            }
            MotionEvent.ACTION_UP -> {
                if (phase == Phase.WAITING) startInk()
                if (drawingEnabled && phase == Phase.INK) appendDrawing(event.x, event.y)
                endInk(); sequenceActive = false; phase = Phase.IDLE
                parent?.requestDisallowInterceptTouchEvent(false)
            }
            MotionEvent.ACTION_CANCEL -> { cancelInput(); sequenceActive = false; phase = Phase.IDLE }
        }
        return true
    }
    private fun startInk() {
        inputHandler.removeCallbacks(beginPending)
        if (phase != Phase.WAITING || !drawingEnabled || primary < 0 || pending.isEmpty()) return
        val point = drawingPoint(pending[0].first, pending[0].second)
        if (point == null || onDrawingStart?.invoke(point.x, point.y) != true) { cancelInput(); return }
        phase = Phase.INK
        for ((x, y) in pending.drop(1)) appendDrawing(x, y)
        pending.clear()
    }
    private fun hitsControl(event: MotionEvent, index: Int): Boolean {
        val regions = drawingInputRegions ?: return false
        val location = IntArray(2)
        getLocationInWindow(location)
        return regions.contains(location[0] + event.getX(index), location[1] + event.getY(index))
    }
    private fun inkMove(x: Float, y: Float) {
        if (phase == Phase.WAITING) {
            val first = pending.firstOrNull() ?: return
            if (pending.size < 256) pending.add(x to y) else pending[pending.lastIndex] = x to y
            if (hypot(x - first.first, y - first.second) >= slop) startInk()
        } else if (phase == Phase.INK) appendDrawing(x, y)
    }
    private fun updateGrip(event: MotionEvent, apply: Boolean) {
        val first = event.findPointerIndex(firstFinger); val second = event.findPointerIndex(secondFinger)
        if (first < 0 || second < 0) { cancelInput(); return }
        val x = (event.getX(first) + event.getX(second)) / 2f
        val y = (event.getY(first) + event.getY(second)) / 2f
        val span = hypot(event.getX(first) - event.getX(second), event.getY(first) - event.getY(second)).coerceAtLeast(1f)
        val current = drawingViewport
        if (apply && current != null && width > 0 && height > 0) {
            val next = current.transformed(width.toFloat(), height.toFloat(), drawingOutputWidth, drawingOutputHeight,
                focusX, focusY, x, y, span / distance)
            applyingGestureViewport = true
            try { drawingViewport = next } finally { applyingGestureViewport = false }
            onViewportChange?.invoke(next)
        }
        focusX = x; focusY = y; distance = span
    }
    private fun appendDrawing(x: Float, y: Float) { drawingPoint(x, y, clip = true)?.let { onDrawingMove?.invoke(it.x, it.y) } }
    private fun drawingPoint(x: Float, y: Float, clip: Boolean = false): OutdoorDrawingPoint? {
        if (width <= 0 || height <= 0) return null
        return drawingViewport?.geometry(width.toFloat(), height.toFloat(), drawingOutputWidth, drawingOutputHeight)?.point(x, y, clip)
            ?: if (drawingViewport == null && (clip || x in 0f..width.toFloat() && y in 0f..height.toFloat()))
                OutdoorDrawingPoint((x / width).coerceIn(0f, 1f), (y / height).coerceIn(0f, 1f)) else null
    }
    private fun updateViewportTransform() {
        val matrix = Matrix()
        if (drawingMode && drawingViewport != null && width > 0 && height > 0) {
            val frame = drawingViewport!!.geometry(width.toFloat(), height.toFloat(), drawingOutputWidth, drawingOutputHeight)
            matrix.setScale(frame.zoom, frame.zoom, width / 2f, height / 2f); matrix.postTranslate(frame.offsetX, frame.offsetY)
        }
        setTransform(matrix)
    }
    private fun endInk() {
        inputHandler.removeCallbacks(beginPending); pending.clear()
        if (phase == Phase.INK) onDrawingEnd?.invoke()
        primary = -1
    }
    private fun cancelInput() {
        endInk(); firstFinger = -1; secondFinger = -1
        phase = if (sequenceActive) Phase.BLOCKED else Phase.IDLE
        parent?.requestDisallowInterceptTouchEvent(false)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh); cancelInput(); updateViewportTransform()
    }
    override fun onDetachedFromWindow() { cancelInput(); super.onDetachedFromWindow() }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        if (!hasWindowFocus) cancelInput()
        super.onWindowFocusChanged(hasWindowFocus)
    }
}
