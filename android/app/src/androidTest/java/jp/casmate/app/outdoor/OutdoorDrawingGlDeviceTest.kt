package jp.casmate.app.outdoor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.media.ImageReader
import androidx.test.platform.app.InstrumentationRegistry
import com.pedro.encoder.input.gl.render.CameraFrameGeometry
import com.pedro.encoder.input.gl.render.RenderMode
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.view.GlStreamInterface
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real GL tests with synthetic sources: no camera, microphone, recording or network. */
class OutdoorDrawingGlDeviceTest {
    @Test fun overlayStaysUprightAndMatchesPreviewForBothOutputsEveryDirectionAndPreviewResize() {
        enabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for ((width, height) in listOf(320 to 180, 180 to 320)) {
            val ink = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            Canvas(ink).apply {
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.RED; strokeWidth = 9f; strokeCap = Paint.Cap.ROUND }
                drawLine(width * .15f, height * .12f, width * .15f, height * .4f, paint)
                drawLine(width * .15f, height * .4f, width * .4f, height * .4f, paint)
                paint.color = Color.argb(128, 255, 255, 255)
                drawCircle(width * .5f, height * .5f, 11.3f, paint)
            }
            val value = OutdoorDrawingSnapshot(1L, 1L, ink, 0L)
            val gl = GlStreamInterface(context)
            var reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
            try {
                gl.autoHandleOrientation = false
                gl.setEncoderSize(width, height); gl.setIsPortrait(height > width)
                gl.setAspectRatioMode(AspectRatioMode.Adjust)
                gl.start(); waitFor { gl.isRunning }
                gl.surfaceTexture.setDefaultBufferSize(320, 180)
                gl.addFilter(OutdoorHoldFilter())
                val drawn = AtomicReference<OutdoorDrawingSnapshot?>()
                gl.addFilter(OutdoorDrawingFilter(RenderMode.OUTPUT, { value }, { drawn.set(it) }))
                gl.addFilter(OutdoorDrawingFilter(RenderMode.PREVIEW, { drawn.get() }))
                // Queue processing adds one filter per source frame.
                repeat(4) { capture(gl, Color.BLUE).recycle() }
                for (rotation in listOf(0, 90, 180, 270)) for (front in listOf(false, true)) {
                    gl.setCameraGeometry(CameraFrameGeometry(rotation, 320, 180))
                    // Simulate asymmetric front/back source content without changing upright ink.
                    gl.attachPreview(reader.surface); gl.setPreviewResolution(width, height)
                    reader.acquireLatestImage()?.close()
                    val output = capture(gl, Color.BLUE, front)
                    assertEquals("Upright unmirrored red mark", Color.RED, output.getPixel((width * .15f).toInt(), (height * .25f).toInt()))
                    // Half-transparent white over blue must be light blue, without a dark fringe.
                    val blended = output.getPixel((width * .5f).toInt(), (height * .5f).toInt())
                    assertTrue(Color.red(blended) in 126..130 && Color.green(blended) in 126..130)
                    assertEquals(255, Color.blue(blended))
                    assertPreviewEquals(reader, output)
                    output.recycle()
                    gl.deAttachPreview(); reader.close()
                    reader = ImageReader.newInstance(width / 2, height / 2, PixelFormat.RGBA_8888, 3)
                    gl.attachPreview(reader.surface); gl.setPreviewResolution(width / 2, height / 2)
                    val resizedOutput = capture(gl, Color.BLUE, front)
                    val preview = previewBitmap(reader)
                    assertEquals(Color.RED, preview.getPixel((width * .15f / 2).toInt(), (height * .25f / 2).toInt()))
                    assertEquals(width, resizedOutput.width); assertEquals(height, resizedOutput.height)
                    preview.recycle(); resizedOutput.recycle()
                    gl.deAttachPreview(); reader.close()
                    reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
                }
            } finally { gl.stop(); reader.close(); ink.recycle() }
        }
    }

    @Test fun heldCleanBackgroundSupportsEraseCloseReopenFailedReholdAndSuccessfulPublish() {
        enabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val controller = OutdoorDrawingController()
        val id = controller.beginSession(320, 180)
        controller.cameraReady(id); controller.openMode(id)
        controller.setColor(id, OutdoorDrawingColor.RED)
        controller.setWidth(id, OutdoorDrawingWidth.THICK)
        val strokeY = 36.5f / 180f // Place the narrow stroke on a pixel center; edges remain antialiased.
        controller.beginStroke(id, .1f, strokeY); controller.appendStroke(id, .5f, strokeY); controller.endStroke(id)
        val gl = GlStreamInterface(context)
        val reader = ImageReader.newInstance(320, 180, PixelFormat.RGBA_8888, 3)
        try {
            gl.autoHandleOrientation = false; gl.setEncoderSize(320, 180); gl.setIsPortrait(false)
            gl.start(); waitFor { gl.isRunning }; gl.surfaceTexture.setDefaultBufferSize(320, 180)
            gl.attachPreview(reader.surface); gl.setPreviewResolution(320, 180)
            var hold = OutdoorHoldFilter()
            var output = OutdoorDrawingFilter(RenderMode.OUTPUT, { controller.snapshot(false) }, { controller.acknowledgeOutput(it) })
            gl.addFilter(hold); gl.addFilter(output)
            gl.addFilter(OutdoorDrawingFilter(RenderMode.PREVIEW, { controller.snapshot(true) }))
            var publishedPixel = Color.TRANSPARENT
            repeat(4) {
                val initial = capture(gl, Color.BLUE)
                if (it >= 1) publishedPixel = initial.getPixel(96, 36)
                initial.recycle(); previewBitmap(reader).recycle()
            }
            assertTrue("The source-raster stroke is visibly red", Color.red(publishedPixel) > 240)
            var token = 0L
            val applied = CountDownLatch(1)
            hold.hold { success ->
                assertTrue(success); token = controller.freezeOutput(id, output.lastSuccessfulSnapshot); applied.countDown()
            }
            capture(gl, Color.GREEN).recycle(); previewBitmap(reader).recycle(); assertTrue(applied.await(5, TimeUnit.SECONDS))
            controller.setTool(id, OutdoorDrawingTool.ERASER)
            controller.beginStroke(id, .25f, strokeY); controller.appendStroke(id, .35f, strokeY); controller.endStroke(id)
            val fixedOutput = capture(gl, Color.GREEN)
            assertEquals(publishedPixel, fixedOutput.getPixel(96, 36))
            val draft = previewBitmap(reader)
            assertEquals("Eraser exposes the clean held source", Color.BLUE, draft.getPixel(96, 36))
            assertTrue(controller.state.value.pending)
            fixedOutput.recycle(); draft.recycle()
            controller.closeMode(id)
            capture(gl, Color.GREEN).recycle()
            val normal = previewBitmap(reader); assertEquals(publishedPixel, normal.getPixel(96, 36)); normal.recycle()
            controller.openMode(id)
            hold.resume()
            val probe = capture(gl, Color.GREEN)
            assertEquals("Release alone does not publish the erased draft", publishedPixel, probe.getPixel(96, 36)); probe.recycle()
            previewBitmap(reader).recycle()
            val oldToken = token
            val reheld = CountDownLatch(1)
            hold.hold { success -> assertTrue(success); token = controller.freezeOutput(id, output.lastSuccessfulSnapshot); reheld.countDown() }
            capture(gl, Color.YELLOW).recycle(); previewBitmap(reader).recycle(); assertTrue(reheld.await(5, TimeUnit.SECONDS))
            assertFalse(controller.confirmLive(id, oldToken))
            val failedProbeOutput = capture(gl, Color.YELLOW)
            assertEquals(publishedPixel, failedProbeOutput.getPixel(96, 36)); failedProbeOutput.recycle()
            previewBitmap(reader).recycle()
            // A replacement GL context restores CPU draft and pin separately; it is no success event.
            gl.stop(); gl.start(); waitFor { gl.isRunning }
            gl.surfaceTexture.setDefaultBufferSize(320, 180)
            gl.attachPreview(reader.surface); gl.setPreviewResolution(320, 180)
            hold = OutdoorHoldFilter()
            output = OutdoorDrawingFilter(RenderMode.OUTPUT, { controller.snapshot(false) }, { controller.acknowledgeOutput(it) })
            gl.addFilter(hold); gl.addFilter(output)
            gl.addFilter(OutdoorDrawingFilter(RenderMode.PREVIEW, { controller.snapshot(true) }))
            repeat(4) {
                val restored = capture(gl, Color.GREEN)
                if (it >= 1) assertEquals("GL recreation must retain the published pin", publishedPixel, restored.getPixel(96, 36))
                restored.recycle(); previewBitmap(reader).recycle()
            }
            assertTrue(controller.state.value.pending)
            hold.resume(); assertTrue(controller.confirmLive(id, token))
            val live = capture(gl, Color.GREEN)
            assertEquals(Color.GREEN, live.getPixel(96, 36))
            assertPreviewEquals(reader, live); live.recycle()
            assertFalse(controller.state.value.pending)
        } finally { gl.stop(); reader.close(); controller.endSession(id) }
    }

    @Test fun failedUploadKeepsPreviousOutputAndExplicitRetryReusesTheFilter() {
        enabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val good = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        val bad = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { recycle() }
        val replacement = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        val desired = AtomicReference(OutdoorDrawingSnapshot(1L, 1L, good, 0L))
        val failures = java.util.concurrent.atomic.AtomicInteger()
        val gl = GlStreamInterface(context)
        try {
            gl.autoHandleOrientation = false; gl.setEncoderSize(320, 180); gl.setIsPortrait(false)
            gl.start(); waitFor { gl.isRunning }; gl.surfaceTexture.setDefaultBufferSize(320, 180)
            gl.addFilter(OutdoorDrawingFilter(RenderMode.OUTPUT, { desired.get() }, onFailure = { failures.incrementAndGet() }))
            capture(gl, Color.BLUE).recycle()
            desired.set(OutdoorDrawingSnapshot(1L, 2L, bad, 0L))
            repeat(3) {
                val retained = capture(gl, Color.BLUE)
                assertEquals(Color.RED, retained.getPixel(160, 90)); retained.recycle()
            }
            assertEquals(1, failures.get())
            desired.set(OutdoorDrawingSnapshot(1L, 2L, replacement, 1L))
            val retried = capture(gl, Color.BLUE)
            assertEquals(Color.GREEN, retried.getPixel(160, 90)); retried.recycle()
            assertEquals(1, failures.get())
        } finally { gl.stop(); good.recycle(); replacement.recycle() }
    }

    @Test fun failedPreviewUploadUsesPublicOutputTextureWhenClosingPrivateDraftAndAfterNewOutput() {
        enabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val pin = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        val draft = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        val newer = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.YELLOW) }
        val pinSnapshot = OutdoorDrawingSnapshot(1L, 1L, pin, 0L)
        val desiredOutput = AtomicReference(pinSnapshot)
        val desiredPreview = AtomicReference(pinSnapshot)
        val failures = java.util.concurrent.atomic.AtomicInteger()
        val gl = GlStreamInterface(context)
        val reader = ImageReader.newInstance(320, 180, PixelFormat.RGBA_8888, 3)
        try {
            gl.autoHandleOrientation = false; gl.setEncoderSize(320, 180); gl.setIsPortrait(false)
            gl.start(); waitFor { gl.isRunning }; gl.surfaceTexture.setDefaultBufferSize(320, 180)
            gl.attachPreview(reader.surface); gl.setPreviewResolution(320, 180)
            val output = OutdoorDrawingFilter(RenderMode.OUTPUT, { desiredOutput.get() }, onOutput = {
                if (it.revision == 3L) {
                    desiredPreview.set(it)
                    // Inject failure after OUTPUT already has a valid texture, before PREVIEW upload.
                    if (!it.bitmap.isRecycled) it.bitmap.recycle()
                }
            })
            gl.addFilter(output)
            gl.addFilter(OutdoorDrawingFilter(RenderMode.PREVIEW, { desiredPreview.get() },
                onFailure = { failures.incrementAndGet() }, publicOutput = { output.publicOutputTexture() }))
            repeat(3) { capture(gl, Color.BLUE).recycle(); previewBitmap(reader).recycle() }
            desiredPreview.set(OutdoorDrawingSnapshot(1L, 2L, draft, 0L))
            val fixed = capture(gl, Color.BLUE)
            assertEquals(Color.RED, fixed.getPixel(160, 90)); fixed.recycle()
            val privatePreview = previewBitmap(reader)
            assertEquals(Color.GREEN, privatePreview.getPixel(160, 90)); privatePreview.recycle()
            // OUTPUT keeps its already-uploaded pin. Closing the mode must never retain green.
            pin.recycle(); desiredPreview.set(pinSnapshot)
            repeat(2) {
                val closed = capture(gl, Color.BLUE)
                assertEquals(Color.RED, closed.getPixel(160, 90))
                assertPreviewEquals(reader, closed); closed.recycle()
            }
            assertEquals(1, failures.get())
            desiredOutput.set(OutdoorDrawingSnapshot(1L, 3L, newer, 0L))
            repeat(2) {
                val current = capture(gl, Color.BLUE)
                assertEquals(Color.YELLOW, current.getPixel(160, 90))
                assertPreviewEquals(reader, current); current.recycle()
            }
            assertEquals(2, failures.get())
        } finally {
            gl.stop(); reader.close()
            if (!pin.isRecycled) pin.recycle()
            draft.recycle(); if (!newer.isRecycled) newer.recycle()
        }
    }

    private fun enabled() = assumeTrue(InstrumentationRegistry.getArguments().getString("verifyDrawingGl") == "true")
    private fun capture(gl: GlStreamInterface, color: Int, mirroredSource: Boolean? = null): Bitmap {
        val arrived = CountDownLatch(1)
        var bitmap: Bitmap? = null
        gl.takePhoto { bitmap = it; arrived.countDown() }
        val canvas = gl.surface.lockCanvas(null)
        canvas.drawColor(color)
        if (mirroredSource != null) {
            if (mirroredSource) canvas.scale(-1f, 1f, canvas.width / 2f, canvas.height / 2f)
            canvas.drawRect(0f, 0f, canvas.width * .08f, canvas.height * .08f, Paint().apply { this.color = Color.YELLOW })
        }
        gl.surface.unlockCanvasAndPost(canvas)
        assertTrue("Output frame arrived", arrived.await(5, TimeUnit.SECONDS))
        awaitGlPhotoConsumed(gl)
        return checkNotNull(bitmap)
    }
    private fun previewBitmap(reader: ImageReader): Bitmap {
        var image: android.media.Image? = null
        waitFor { reader.acquireLatestImage()?.also { image = it } != null }
        return checkNotNull(image).use { frame ->
            val plane = frame.planes[0]
            val bitmap = Bitmap.createBitmap(frame.width, frame.height, Bitmap.Config.ARGB_8888)
            for (y in 0 until frame.height) for (x in 0 until frame.width) {
                val index = y * plane.rowStride + x * plane.pixelStride
                bitmap.setPixel(x, y, Color.argb(plane.buffer.get(index + 3).toInt() and 255,
                    plane.buffer.get(index).toInt() and 255, plane.buffer.get(index + 1).toInt() and 255,
                    plane.buffer.get(index + 2).toInt() and 255))
            }
            bitmap
        }
    }
    private fun assertPreviewEquals(reader: ImageReader, output: Bitmap) {
        val preview = previewBitmap(reader)
        try {
            val expected = IntArray(output.width * output.height); val actual = IntArray(expected.size)
            output.getPixels(expected, 0, output.width, 0, 0, output.width, output.height)
            preview.getPixels(actual, 0, preview.width, 0, 0, preview.width, preview.height)
            assertArrayEquals("Output/preview pixels including antialiased edges", expected, actual)
        } finally { preview.recycle() }
    }
    private fun waitFor(condition: () -> Boolean) {
        val deadline = android.os.SystemClock.elapsedRealtime() + 5_000
        while (!condition()) {
            check(android.os.SystemClock.elapsedRealtime() < deadline) { "GL frame timeout" }
            Thread.sleep(10)
        }
    }
}
