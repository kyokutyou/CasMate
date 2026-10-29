package jp.casmate.app.outdoor

import android.opengl.*
import com.pedro.encoder.input.gl.SurfaceManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Resetter

/** Simulates EGL display lifetime; it does not invoke a real GPU or codec. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PreviewEglLifetime::class])
class OutdoorSharedEglTest {
    @Test fun replacingPreviewKeepsTheOwnerAndEncoderUsable() {
        val owner = SurfaceManager(); owner.eglSetup()
        val encoder = SurfaceManager(); encoder.eglSetup(1280, 720, owner)
        val preview = SurfaceManager(); preview.eglSetup(320, 180, owner)
        try {
            assertTrue(encoder.makeCurrent())
            preview.release()
            assertTrue("Preview release must keep the owner's display initialized", owner.makeCurrent())
            assertTrue("The encoded output must survive preview removal", encoder.makeCurrent())
            preview.eglSetup(560, 315, owner)
            preview.release()
            assertTrue(encoder.makeCurrent())
            assertEquals(1, PreviewEglLifetime.initializations)
            assertEquals(0, PreviewEglLifetime.terminations)
        } finally { preview.release(); encoder.release(); owner.release() }
        assertEquals(1, PreviewEglLifetime.terminations)
        assertEquals(1, PreviewEglLifetime.threadReleases)
    }
}

@Implements(EGL14::class)
class PreviewEglLifetime {
    companion object {
        private var initialized = false
        var initializations = 0; private set
        var terminations = 0; private set
        var threadReleases = 0; private set
        private fun <T> handle(type: Class<T>, id: Long): T = type.getDeclaredConstructor(java.lang.Long.TYPE)
            .apply { isAccessible = true }.newInstance(id)
        @Resetter @JvmStatic fun reset() { initialized = false; initializations = 0; terminations = 0; threadReleases = 0 }
        @Implementation @JvmStatic fun eglGetDisplay(id: Int): EGLDisplay = handle(EGLDisplay::class.java, 1)
        @Implementation @JvmStatic fun eglInitialize(display: EGLDisplay, major: IntArray, majorOffset: Int, minor: IntArray, minorOffset: Int): Boolean {
            initialized = true; initializations++; major[majorOffset] = 1; minor[minorOffset] = 5; return true
        }
        @Implementation @JvmStatic fun eglChooseConfig(display: EGLDisplay, attributes: IntArray, attributeOffset: Int,
            configs: Array<EGLConfig?>, configOffset: Int, size: Int, count: IntArray, countOffset: Int): Boolean {
            configs[configOffset] = handle(EGLConfig::class.java, 2); count[countOffset] = 1; return initialized
        }
        @Implementation @JvmStatic fun eglCreateContext(display: EGLDisplay, config: EGLConfig, shared: EGLContext?,
            attributes: IntArray, offset: Int): EGLContext = handle(EGLContext::class.java, 3)
        @Implementation @JvmStatic fun eglCreatePbufferSurface(display: EGLDisplay, config: EGLConfig,
            attributes: IntArray, offset: Int): EGLSurface = handle(EGLSurface::class.java, 4)
        @Implementation @JvmStatic fun eglGetError(): Int = EGL14.EGL_SUCCESS
        @Implementation @JvmStatic fun eglMakeCurrent(display: EGLDisplay, draw: EGLSurface?, read: EGLSurface?, context: EGLContext?): Boolean = initialized
        @Implementation @JvmStatic fun eglDestroySurface(display: EGLDisplay, surface: EGLSurface): Boolean = true
        @Implementation @JvmStatic fun eglDestroyContext(display: EGLDisplay, context: EGLContext): Boolean = true
        @Implementation @JvmStatic fun eglReleaseThread(): Boolean { threadReleases++; return true }
        @Implementation @JvmStatic fun eglTerminate(display: EGLDisplay): Boolean { initialized = false; terminations++; return true }
    }
}
