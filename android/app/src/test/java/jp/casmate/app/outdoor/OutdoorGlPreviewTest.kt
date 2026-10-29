package jp.casmate.app.outdoor

import android.graphics.SurfaceTexture
import android.view.Surface
import com.pedro.encoder.input.gl.SurfaceManager
import com.pedro.library.view.GlStreamInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Checks the public preview boundary without cameras, microphones or network traffic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutdoorGlPreviewTest {
    private class PreviewResources : SurfaceManager() {
        val released = AtomicInteger()
        val attached = AtomicInteger()
        override fun release() { released.incrementAndGet() }
        override fun eglSetup(surface: Surface, manager: SurfaceManager) { attached.incrementAndGet() }
    }
    private class ReadyOwner : SurfaceManager() {
        override fun isReady() = true
        override fun makeCurrent() = true
    }
    private fun inject(gl: GlStreamInterface, name: String, value: Any) {
        GlStreamInterface::class.java.getDeclaredField(name).apply { isAccessible = true }.set(gl, value)
    }
    private fun running(gl: GlStreamInterface) = GlStreamInterface::class.java.getDeclaredField("running")
        .apply { isAccessible = true }.get(gl) as AtomicBoolean

    @Test fun previewDetachWaitsForTheCurrentRenderTask() {
        val gl = GlStreamInterface(RuntimeEnvironment.getApplication())
        val preview = PreviewResources()
        val renderer = Executors.newSingleThreadExecutor()
        val drawing = CountDownLatch(1)
        val finishDrawing = CountDownLatch(1)
        inject(gl, "executor", renderer)
        inject(gl, "surfaceManagerPreview", preview)
        running(gl).set(true)
        try {
            renderer.submit { drawing.countDown(); finishDrawing.await(5, TimeUnit.SECONDS) }
            assertTrue(drawing.await(5, TimeUnit.SECONDS))
            gl.deAttachPreview()
            assertEquals("Preview resources must survive the current render", 0, preview.released.get())
            finishDrawing.countDown()
            renderer.submit {}.get(5, TimeUnit.SECONDS)
            assertEquals(1, preview.released.get())
        } finally {
            finishDrawing.countDown()
            renderer.shutdownNow()
        }
    }

    @Test fun previewReplacementQueuesBehindRenderingAndSurvivesRepeatedDetach() {
        val gl = GlStreamInterface(RuntimeEnvironment.getApplication())
        val preview = PreviewResources(); val renderer = Executors.newSingleThreadExecutor()
        val drawing = CountDownLatch(1); val finish = CountDownLatch(1)
        val texture = SurfaceTexture(0); val surface = Surface(texture)
        inject(gl, "executor", renderer); inject(gl, "surfaceManagerPreview", preview); inject(gl, "surfaceManager", ReadyOwner())
        running(gl).set(true)
        try {
            assertTrue(surface.isValid)
            renderer.submit { drawing.countDown(); finish.await(5, TimeUnit.SECONDS) }
            assertTrue(drawing.await(5, TimeUnit.SECONDS))
            gl.attachPreview(surface); gl.deAttachPreview(); gl.deAttachPreview(); gl.attachPreview(surface)
            assertEquals(0, preview.released.get()); assertEquals(0, preview.attached.get())
            finish.countDown(); renderer.submit {}.get(5, TimeUnit.SECONDS)
            assertEquals(4, preview.released.get()); assertEquals(2, preview.attached.get())
        } finally { finish.countDown(); renderer.shutdownNow(); surface.release(); texture.release() }
    }

    @Test fun staleRendererAndLateShutdownCallbacksCannotReleaseNewResources() {
        val gl = GlStreamInterface(RuntimeEnvironment.getApplication()); val preview = PreviewResources()
        val old = Executors.newSingleThreadExecutor(); val current = Executors.newSingleThreadExecutor()
        val drawing = CountDownLatch(1); val finish = CountDownLatch(1)
        inject(gl, "executor", old); inject(gl, "surfaceManagerPreview", preview); running(gl).set(true)
        try {
            old.submit { drawing.countDown(); finish.await(5, TimeUnit.SECONDS) }; assertTrue(drawing.await(5, TimeUnit.SECONDS))
            gl.deAttachPreview(); inject(gl, "executor", current)
            finish.countDown(); old.submit {}.get(5, TimeUnit.SECONDS)
            assertEquals(0, preview.released.get())
            running(gl).set(false); gl.deAttachPreview(); current.submit {}.get(5, TimeUnit.SECONDS)
            assertEquals(0, preview.released.get())
            current.shutdownNow(); gl.deAttachPreview()
        } finally { finish.countDown(); old.shutdownNow(); current.shutdownNow() }
    }
}
