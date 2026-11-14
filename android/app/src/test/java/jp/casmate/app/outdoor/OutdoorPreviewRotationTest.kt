package jp.casmate.app.outdoor

import android.view.MotionEvent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutdoorPreviewRotationTest {
    @Test fun lockedDisplayCompensatesPhysicalRotationAndFollowingDisplayDoesNotRotateTwice() {
        for (sensor in listOf(0, 90, 180, 270)) {
            assertEquals((360 - sensor) % 360, outdoorPreviewRotation(sensor, 0))
            assertEquals(0, outdoorPreviewRotation(sensor, (4 - sensor / 90) % 4))
        }
    }

    @Test fun completeFrameFitsAndTouchesMapBackThroughEveryQuarterTurn() {
        for ((width, height) in listOf(320 to 180, 180 to 320)) for (rotation in listOf(0, 90, 180, 270)) {
            val matrix = outdoorPreviewRotationMatrix(width, height, rotation)
            val corners = floatArrayOf(0f, 0f, width.toFloat(), height.toFloat())
            matrix.mapPoints(corners)
            assertTrue(corners.filterIndexed { i, _ -> i % 2 == 0 }.all { it >= -.001f && it <= width + .001f })
            assertTrue(corners.filterIndexed { i, _ -> i % 2 == 1 }.all { it >= -.001f && it <= height + .001f })
            val point = floatArrayOf(width * .25f, height * .35f)
            matrix.mapPoints(point)
            val original = outdoorPreviewInputPoint(point[0], point[1], width, height, rotation)
            assertEquals(width * .25f, original.first, .001f)
            assertEquals(height * .35f, original.second, .001f)
        }
    }

    @Test fun handwritingUsesTheDisplayedPointAfterRotation() {
        for (rotation in listOf(0, 90, 180, 270)) {
            val view = OutdoorPreviewView(RuntimeEnvironment.getApplication())
            view.layout(0, 0, 320, 180)
            view.drawingMode = true; view.drawingEnabled = true; view.previewRotation = rotation
            var start: Pair<Float, Float>? = null
            view.onDrawingStart = { x, y -> start = x to y; true }
            val displayed = floatArrayOf(80f, 45f)
            view.getTransform(android.graphics.Matrix()).mapPoints(displayed)
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
                val coordinates = MotionEvent.PointerCoords().apply { x = displayed[0]; y = displayed[1]; pressure = 1f; size = 1f }
                val event = MotionEvent.obtain(0, 1, action, 1, arrayOf(properties), arrayOf(coordinates),
                    0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
                view.onTouchEvent(event); event.recycle()
            }
            val actual = checkNotNull(start)
            assertEquals(.25f, actual.first, .001f)
            assertEquals(.25f, actual.second, .001f)
        }
    }

    @Test fun normalVideoFitsWithoutLetterboxShrinkAndFocusMapsBackThroughTheSameTransform() {
        for ((width, height) in listOf(1080 to 1992, 1992 to 1080, 321 to 703)) {
            for ((outputWidth, outputHeight) in listOf(1280 to 720, 720 to 1280)) {
                val frame = com.pedro.encoder.utils.gl.SizeCalculator.calculateViewPort(
                    com.pedro.encoder.utils.gl.AspectRatioMode.Adjust, width, height, outputWidth, outputHeight)
                val top = height - frame.y - frame.height
                for (rotation in listOf(0, 90, 180, 270)) {
                    val matrix = outdoorPreviewRotationMatrix(width, height, rotation, outputWidth, outputHeight)
                    val bounds = android.graphics.RectF(frame.x.toFloat(), top.toFloat(),
                        (frame.x + frame.width).toFloat(), (top + frame.height).toFloat())
                    matrix.mapRect(bounds)
                    assertTrue(bounds.left >= -1f && bounds.top >= -1f)
                    assertTrue(bounds.right <= width + 1f && bounds.bottom <= height + 1f)
                    assertTrue(kotlin.math.abs(bounds.width() - width) <= 1f || kotlin.math.abs(bounds.height() - height) <= 1f)
                    val point = floatArrayOf(frame.x + frame.width * .25f, top + frame.height * .35f)
                    // Focus fitting already uses floating bounds while GL rounds its viewport to pixels.
                    // Preview rotation must preserve the existing focus point, including that rounding.
                    val expected = checkNotNull(outdoorFocusPoint(point[0], point[1],
                        width, height, outputWidth, outputHeight, 0, false))
                    matrix.mapPoints(point)
                    val original = outdoorPreviewInputPoint(point[0], point[1], width, height, rotation, outputWidth, outputHeight)
                    val focus = checkNotNull(outdoorFocusPoint(original.first, original.second,
                        width, height, outputWidth, outputHeight, 0, false))
                    assertEquals(expected.first, focus.first, .00001f)
                    assertEquals(expected.second, focus.second, .00001f)
                    if (bounds.top > 2f) {
                        val padding = outdoorPreviewInputPoint(width / 2f, bounds.top - 2f,
                            width, height, rotation, outputWidth, outputHeight)
                        assertNull(outdoorFocusPoint(padding.first, padding.second, width, height, outputWidth, outputHeight, 0, false))
                    }
                }
            }
        }
    }

    @Test fun sameSizeDisplayRotationRefreshesWithoutAnotherSensorSample() {
        val activity = org.robolectric.Robolectric.buildActivity(android.app.Activity::class.java).setup()
        try {
            val view = OutdoorPreviewView(activity.get())
            activity.get().setContentView(view)
            view.layout(0, 0, 320, 180)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertEquals(0, view.previewRotation)
            val originalWidth = view.width; val originalHeight = view.height
            org.robolectric.Shadows.shadowOf(view.display).setRotation(android.view.Surface.ROTATION_180)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertEquals(180, view.previewRotation)
            assertEquals(originalWidth, view.width); assertEquals(originalHeight, view.height)
            org.robolectric.Shadows.shadowOf(view.display).setRotation(android.view.Surface.ROTATION_0)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertEquals(0, view.previewRotation)
        } finally { activity.pause().stop().destroy() }
    }
}
