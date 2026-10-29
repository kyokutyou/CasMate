package jp.casmate.app.outdoor

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.media.ImageReader
import com.pedro.encoder.input.gl.render.CameraFrameGeometry
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.view.GlStreamInterface
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real GL source/output/preview passes with an asymmetric synthetic chart. No services or network. */
class CameraGeometryDeviceTest {
    @Test fun fittedSourcePreservesCirclesAndMatchesPreviewInEveryDirection() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyCameraGeometry") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for ((width, height) in listOf(320 to 180, 180 to 320)) {
            val gl = GlStreamInterface(context)
            val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
            try {
                gl.autoHandleOrientation = false
                gl.setEncoderSize(width, height)
                gl.setIsPortrait(height > width)
                gl.setAspectRatioMode(AspectRatioMode.Adjust)
                gl.start()
                waitFor { gl.isRunning }
                gl.surfaceTexture.setDefaultBufferSize(320, 180)
                gl.attachPreview(reader.surface)
                gl.setPreviewResolution(width, height)
                for (rotation in listOf(0, 90, 180, 270)) {
                    reader.acquireLatestImage()?.close()
                    val geometry = CameraFrameGeometry(rotation, 320, 180)
                    gl.setCameraGeometry(geometry)
                    val latch = CountDownLatch(1)
                    var output: Bitmap? = null
                    gl.takePhoto { bitmap -> output = bitmap; latch.countDown() }
                    val canvas = gl.surface.lockCanvas(null)
                    canvas.drawColor(Color.WHITE)
                    val paint = Paint().apply { color = Color.GREEN }
                    canvas.drawRect(0f, 0f, 80f, 45f, paint)
                    paint.color = Color.BLUE; canvas.drawRect(240f, 0f, 320f, 45f, paint)
                    paint.color = Color.YELLOW; canvas.drawRect(240f, 135f, 320f, 180f, paint)
                    paint.color = Color.MAGENTA; canvas.drawRect(0f, 135f, 80f, 180f, paint)
                    paint.color = Color.RED; canvas.drawCircle(160f, 90f, 20f, paint)
                    gl.surface.unlockCanvasAndPost(canvas)
                    assertTrue("Output frame arrived", latch.await(5, TimeUnit.SECONDS))
                    var preview: android.media.Image? = null
                    waitFor { reader.acquireLatestImage()?.also { preview = it } != null }
                    val bitmap = checkNotNull(output)
                    checkNotNull(preview).use { image ->
                        val plane = image.planes[0]
                        for (y in 0 until height) for (x in 0 until width) {
                            val index = y * plane.rowStride + x * plane.pixelStride
                            val color = Color.rgb(plane.buffer.get(index).toInt() and 255,
                                plane.buffer.get(index + 1).toInt() and 255, plane.buffer.get(index + 2).toInt() and 255)
                            assertEquals("Preview/output pixel at $x,$y for $width,$height,$rotation", bitmap.getPixel(x, y), color)
                        }
                    }
                    val identity = floatArrayOf(1f,0f,0f,0f, 0f,1f,0f,0f, 0f,0f,1f,0f, 0f,0f,0f,1f)
                    val fit = checkNotNull(geometry.fit(width, height, identity))
                    val green = when (rotation) { 90 -> .875f to .125f; 180 -> .875f to .875f; 270 -> .125f to .875f; else -> .125f to .125f }
                    assertEquals(Color.GREEN, bitmap.getPixel(((.5f + (green.first - .5f) * fit[0]) * width).toInt(),
                        ((.5f + (green.second - .5f) * fit[1]) * height).toInt()))
                    val red = buildList { for (y in 0 until height) for (x in 0 until width) {
                        if (bitmap.getPixel(x,y) == Color.RED) add(x to y)
                    } }
                    assertTrue(red.isNotEmpty())
                    assertTrue("Circle must not become an ellipse", kotlin.math.abs(
                        (red.maxOf { it.first } - red.minOf { it.first }) - (red.maxOf { it.second } - red.minOf { it.second })) <= 2)
                    if (fit[0] < .9f) assertEquals(Color.BLACK, bitmap.getPixel(0, height / 2))
                    if (fit[1] < .9f) assertEquals(Color.BLACK, bitmap.getPixel(width / 2, 0))
                    java.io.File(context.getExternalFilesDir(null), "geometry-$width-$rotation.png").outputStream().use {
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                    }
                    bitmap.recycle()
                }
            } finally {
                gl.stop()
                reader.close()
            }
        }
    }

    private fun waitFor(condition: () -> Boolean) {
        val deadline = android.os.SystemClock.elapsedRealtime() + 5_000
        while (!condition()) {
            check(android.os.SystemClock.elapsedRealtime() < deadline) { "GL frame timeout" }
            Thread.sleep(20)
        }
    }

    @Test fun heldFramesKeepTheirPictureAndPlaceholderClearsCameraFit() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyCameraGeometry") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val gl = GlStreamInterface(context)
        try {
            gl.setEncoderSize(320, 180)
            gl.autoHandleOrientation = false
            gl.setIsPortrait(false)
            gl.setCameraGeometry(CameraFrameGeometry(90, 320, 180))
            gl.start(); waitFor { gl.isRunning }
            gl.surfaceTexture.setDefaultBufferSize(320, 180)
            val hold = OutdoorHoldFilter()
            gl.addFilter(hold)
            capture(gl, Color.BLUE).recycle()
            val held = CountDownLatch(1)
            hold.hold { success -> assertTrue(success); held.countDown() }
            val frozen = capture(gl, Color.RED)
            assertTrue(held.await(5, TimeUnit.SECONDS))
            gl.setCameraGeometry(CameraFrameGeometry(180, 320, 180))
            val rotated = capture(gl, Color.GREEN)
            val before = IntArray(320 * 180); val after = IntArray(before.size)
            frozen.getPixels(before, 0, 320, 0, 0, 320, 180)
            rotated.getPixels(after, 0, 320, 0, 0, 320, 180)
            assertArrayEquals(before, after)
            val resumed = CountDownLatch(1)
            hold.resume { success -> assertTrue(success); resumed.countDown() }
            val live = capture(gl, Color.BLUE)
            assertTrue(resumed.await(5, TimeUnit.SECONDS))
            assertEquals(Color.BLUE, live.getPixel(160, 90))
            assertEquals(Color.BLUE, live.getPixel(0, 90))
            gl.removeFilter(hold)
            gl.setCameraGeometry(null)
            gl.setCameraOrientation(0)
            val placeholder = capture(gl, Color.CYAN)
            assertEquals(Color.CYAN, placeholder.getPixel(0, 90))
            for (bitmap in listOf(frozen, rotated, live, placeholder)) bitmap.recycle()
        } finally { gl.stop() }
    }

    private fun capture(gl: GlStreamInterface, color: Int): Bitmap {
        val arrived = CountDownLatch(1)
        var bitmap: Bitmap? = null
        gl.takePhoto { bitmap = it; arrived.countDown() }
        val canvas = gl.surface.lockCanvas(null)
        canvas.drawColor(color)
        gl.surface.unlockCanvasAndPost(canvas)
        assertTrue(arrived.await(5, TimeUnit.SECONDS))
        return checkNotNull(bitmap)
    }
}
