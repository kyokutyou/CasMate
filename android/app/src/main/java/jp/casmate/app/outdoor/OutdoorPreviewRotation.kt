package jp.casmate.app.outdoor

import android.graphics.Matrix
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.encoder.utils.gl.SizeCalculator

/** Sensor degrees are opposite to Display rotation. Android view matrices use clockwise degrees. */
internal fun outdoorPreviewRotation(sensorDegrees: Int, displayRotation: Int): Int =
    (360 - (sensorDegrees + displayRotation * 90) % 360) % 360

/** Fit the rotated output, excluding the GL viewport's letterboxing, inside the view. */
internal fun outdoorPreviewRotationMatrix(width: Int, height: Int, rotation: Int,
    outputWidth: Int = width, outputHeight: Int = height) = Matrix().apply {
    if (width > 0 && height > 0 && outputWidth > 0 && outputHeight > 0 && rotation != 0) {
        val frame = SizeCalculator.calculateViewPort(AspectRatioMode.Adjust, width, height, outputWidth, outputHeight)
        if (frame.width > 0 && frame.height > 0) {
            val rotatedWidth = if (rotation % 180 != 0) frame.height else frame.width
            val rotatedHeight = if (rotation % 180 != 0) frame.width else frame.height
            val scale = minOf(width.toFloat() / rotatedWidth, height.toFloat() / rotatedHeight)
            setTranslate(-frame.x - frame.width / 2f, -(height - frame.y - frame.height / 2f))
            postRotate(rotation.toFloat())
            postScale(scale, scale)
            postTranslate(width / 2f, height / 2f)
        }
    }
}

internal fun outdoorPreviewInputPoint(x: Float, y: Float, width: Int, height: Int, rotation: Int,
    outputWidth: Int = width, outputHeight: Int = height): Pair<Float, Float> {
    val inverse = Matrix()
    outdoorPreviewRotationMatrix(width, height, rotation, outputWidth, outputHeight).invert(inverse)
    val point = floatArrayOf(x, y)
    inverse.mapPoints(point)
    return point[0] to point[1]
}
