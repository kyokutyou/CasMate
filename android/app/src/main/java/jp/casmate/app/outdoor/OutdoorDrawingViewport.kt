package jp.casmate.app.outdoor

import androidx.compose.runtime.saveable.listSaver
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.encoder.utils.gl.SizeCalculator
import kotlin.math.max
import kotlin.math.min

/** Display-only transform. Offsets are fractions of the enlarged upright output frame. */
internal data class OutdoorDrawingViewport(
    val zoom: Float = 1f,
    val panX: Float = 0f,
    val panY: Float = 0f,
    val initialized: Boolean = false,
    val nextFill: Boolean = false,
) {
    fun geometry(width: Float, height: Float, outputWidth: Int, outputHeight: Int): OutdoorDrawingViewportGeometry {
        require(width > 0 && height > 0 && outputWidth > 0 && outputHeight > 0)
        // Use the renderer's integer viewport and convert its bottom origin to screen top.
        // Fractional fitting would amplify subpixel edge errors when the preview is enlarged.
        val fitted = SizeCalculator.calculateViewPort(AspectRatioMode.Adjust, width.toInt(), height.toInt(), outputWidth, outputHeight)
        val scale = zoom.coerceIn(1f, 6f)
        val frameWidth = fitted.width * scale
        val frameHeight = fitted.height * scale
        val left = (fitted.x - width / 2) * scale + width / 2
        val top = (height - fitted.y - fitted.height - height / 2) * scale + height / 2
        val offsetX = (panX * frameWidth).coerceIn(min(0f, width - left - frameWidth), max(0f, -left))
        val offsetY = (panY * frameHeight).coerceIn(min(0f, height - top - frameHeight), max(0f, -top))
        return OutdoorDrawingViewportGeometry(left + offsetX,
            top + offsetY, frameWidth, frameHeight, offsetX, offsetY, scale)
    }

    fun transformed(width: Float, height: Float, outputWidth: Int, outputHeight: Int,
        oldX: Float, oldY: Float, newX: Float, newY: Float, ratio: Float): OutdoorDrawingViewport {
        val old = geometry(width, height, outputWidth, outputHeight)
        val x = (oldX - old.left) / old.width; val y = (oldY - old.top) / old.height
        val next = copy(zoom = (zoom * ratio).coerceIn(1f, 6f), panX = 0f, panY = 0f, initialized = true)
        val base = next.geometry(width, height, outputWidth, outputHeight)
        val anchored = next.copy(panX = (newX - base.left - x * base.width) / base.width,
            panY = (newY - base.top - y * base.height) / base.height)
        val bounded = anchored.geometry(width, height, outputWidth, outputHeight)
        return anchored.copy(panX = bounded.offsetX / bounded.width, panY = bounded.offsetY / bounded.height)
    }

    fun toggled(width: Float, height: Float, outputWidth: Int, outputHeight: Int): OutdoorDrawingViewport =
        if (nextFill) centeredFill(width, height, outputWidth, outputHeight)
        else OutdoorDrawingViewport(initialized = true, nextFill = true)

    companion object {
        fun centeredFill(width: Float, height: Float, outputWidth: Int, outputHeight: Int): OutdoorDrawingViewport {
            val fit = OutdoorDrawingViewport().geometry(width, height, outputWidth, outputHeight)
            return OutdoorDrawingViewport(zoom = max(width / fit.width, height / fit.height).coerceIn(1f, 6f), initialized = true)
        }
        val Saver = listSaver<OutdoorDrawingViewport, Any>(
            save = { listOf(it.zoom, it.panX, it.panY, it.initialized, it.nextFill) },
            restore = { OutdoorDrawingViewport(it[0] as Float, it[1] as Float, it[2] as Float,
                initialized = if (it.size == 4) true else it[3] as Boolean,
                nextFill = it.getOrNull(4) as? Boolean ?: false) })
    }
}

internal data class OutdoorDrawingViewportGeometry(
    val left: Float, val top: Float, val width: Float, val height: Float,
    val offsetX: Float, val offsetY: Float, val zoom: Float,
) {
    fun point(x: Float, y: Float, clip: Boolean = false): OutdoorDrawingPoint? {
        val normalizedX = (x - left) / width
        val normalizedY = (y - top) / height
        if (!normalizedX.isFinite() || !normalizedY.isFinite()) return null
        if (!clip && (normalizedX !in 0f..1f || normalizedY !in 0f..1f)) return null
        return OutdoorDrawingPoint(normalizedX.coerceIn(0f, 1f), normalizedY.coerceIn(0f, 1f))
    }
}
