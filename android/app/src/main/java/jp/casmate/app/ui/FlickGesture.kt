package jp.casmate.app.ui

import android.view.MotionEvent
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlin.math.abs

val LocalHorizontalFlick = compositionLocalOf<(Int) -> Unit> { {} }

/** A completed, single-finger horizontal gesture. Observation never steals vertical scrolling. */
class HorizontalFlickTracker(
    private val minDistance: Float,
    private val slop: Float = minDistance / 4,
    private val maxDurationMillis: Long = 700,
) {
    private var valid = false
    private var startX = 0f
    private var startY = 0f
    private var startTime = 0L
    private var pointerId = -1

    fun begin(id: Int, x: Float, y: Float, time: Long) {
        valid = true; pointerId = id; startX = x; startY = y; startTime = time
    }

    fun move(id: Int, x: Float, y: Float, time: Long) {
        if (id != pointerId || time - startTime > maxDurationMillis ||
            (abs(y - startY) > slop && abs(y - startY) >= abs(x - startX))) cancel()
    }

    fun finish(id: Int, x: Float, y: Float, time: Long): Int? {
        move(id, x, y, time)
        val dx = x - startX
        val result = if (valid && abs(dx) >= minDistance && abs(dx) >= abs(y - startY) * 1.5f)
            if (dx < 0) -1 else 1 else null
        cancel()
        return result
    }

    fun cancel() { valid = false }

    fun observe(event: MotionEvent): Int? {
        if (event.pointerCount != 1) { cancel(); return null }
        val id = event.getPointerId(0)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> begin(id, event.x, event.y, event.eventTime)
            MotionEvent.ACTION_MOVE -> move(id, event.x, event.y, event.eventTime)
            MotionEvent.ACTION_UP -> return finish(id, event.x, event.y, event.eventTime)
            else -> cancel()
        }
        return null
    }
}

/** Child-consumed down/drag events (buttons, sliders and scrolling) cannot navigate. */
fun Modifier.horizontalFlick(enabled: Boolean, onFlick: (Int) -> Unit): Modifier = composed {
    val currentFlick by rememberUpdatedState(onFlick)
    val density = LocalDensity.current
    val minimum = with(density) { 56.dp.toPx() }
    val slop = with(density) { 12.dp.toPx() }
    pointerInput(enabled, minimum, slop) {
        if (!enabled) return@pointerInput
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val tracker = HorizontalFlickTracker(minimum, slop)
            tracker.begin(down.id.value.toInt(), down.position.x, down.position.y, down.uptimeMillis)
            val first = awaitPointerEvent(PointerEventPass.Final)
            if (first.changes.size != 1 || first.changes.any { it.isConsumed }) tracker.cancel()
            var pressed = true
            while (pressed) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val change = event.changes.firstOrNull { it.id == down.id }
                if (event.changes.size != 1 || change == null) tracker.cancel()
                val final = awaitPointerEvent(PointerEventPass.Final)
                if (final.changes.any { it.isConsumed }) tracker.cancel()
                if (change == null) break
                if (!change.pressed) {
                    tracker.finish(change.id.value.toInt(), change.position.x, change.position.y, change.uptimeMillis)
                        ?.let(currentFlick)
                    pressed = false
                } else tracker.move(change.id.value.toInt(), change.position.x, change.position.y, change.uptimeMillis)
            }
        }
    }
}
