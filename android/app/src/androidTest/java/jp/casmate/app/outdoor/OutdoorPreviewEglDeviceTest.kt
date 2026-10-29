package jp.casmate.app.outdoor

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.opengl.GLES20
import android.os.SystemClock
import android.view.Surface
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pedro.encoder.input.gl.SurfaceManager
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic solid colors only: no camera, microphone, files or network transmission. */
@RunWith(AndroidJUnit4::class)
class OutdoorPreviewEglDeviceTest {
    @Test fun previewRecreationKeepsHardwareHevcOutputAlive() {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_HEVC, 640, 360).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 300_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val hardware = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
            info.isEncoder && info.isHardwareAccelerated && info.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_VIDEO_HEVC, true) } &&
                runCatching { info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_HEVC).isFormatSupported(format) }.getOrDefault(false)
        }
        assumeTrue("A hardware HEVC surface encoder is required", hardware != null)
        val codec = MediaCodec.createByCodecName(hardware!!.name)
        val owner = SurfaceManager(); val encoded = SurfaceManager(); val preview = SurfaceManager()
        var input: Surface? = null; var started = false
        var beforeReplacement = 0; var frames = 0
        val buffer = MediaCodec.BufferInfo()
        fun drain(timeoutUs: Long) {
            var next = codec.dequeueOutputBuffer(buffer, timeoutUs)
            while (next >= 0) {
                if (buffer.size > 0 && buffer.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) frames++
                codec.releaseOutputBuffer(next, false)
                next = codec.dequeueOutputBuffer(buffer, 0)
            }
        }
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            input = codec.createInputSurface(); codec.start(); started = true
            owner.eglSetup(); encoded.eglSetup(input, owner)
            val origin = System.nanoTime()
            for (frame in 0 until 90) {
                if (frame >= 30) {
                    val portrait = frame % 2 == 0
                    preview.eglSetup(if (portrait) 180 else 320, if (portrait) 320 else 180, owner)
                    assertTrue(preview.makeCurrent())
                    GLES20.glClearColor(1f, 0f, 0f, 1f); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                    preview.release()
                }
                assertTrue("Encoder EGL context must survive preview recreation", encoded.makeCurrent())
                GLES20.glViewport(0, 0, 640, 360)
                GLES20.glClearColor(0f, if (frame % 2 == 0) 1f else 0f, 1f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                assertEquals(GLES20.GL_NO_ERROR, GLES20.glGetError())
                encoded.setPresentationTime(origin + frame * 33_333_333L); encoded.swapBuffer()
                drain(10_000)
                if (frame == 29) beforeReplacement = frames
            }
            codec.signalEndOfInputStream()
            val deadline = SystemClock.elapsedRealtime() + 5_000
            while (buffer.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM == 0 && SystemClock.elapsedRealtime() < deadline) drain(10_000)
            assertTrue("The encoder must produce baseline frames", beforeReplacement > 0)
            assertTrue("HEVC encoding must continue through sixty preview recreations", frames >= beforeReplacement + 30)
        } finally {
            preview.release(); encoded.release(); owner.release()
            if (started) codec.stop()
            codec.release(); input?.release()
        }
    }
}
