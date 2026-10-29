package jp.casmate.app.outdoor

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned

/** Window-space exclusion areas shared with the retained native camera view.
 * AndroidView can own an entire multi-pointer sequence even if another finger
 * lands on a Compose control. Hit testing keeps those contacts out of ink/pinch. */
internal class OutdoorDrawingInputRegions {
    private val areas = mutableMapOf<Any, Rect>()
    fun put(owner: Any, bounds: Rect) { areas[owner] = bounds }
    fun remove(owner: Any) { areas.remove(owner) }
    fun contains(x: Float, y: Float) = areas.values.any { it.contains(Offset(x, y)) }
}

internal val LocalOutdoorDrawingInputRegions = staticCompositionLocalOf<OutdoorDrawingInputRegions?> { null }

internal fun Modifier.drawingInputRegion(): Modifier = composed {
    val regions = LocalOutdoorDrawingInputRegions.current
    val owner = remember { Any() }
    DisposableEffect(regions) { onDispose { regions?.remove(owner) } }
    onGloballyPositioned { regions?.put(owner, it.boundsInWindow()) }
}
