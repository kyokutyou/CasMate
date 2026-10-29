package jp.casmate.app.outdoor

import android.graphics.SurfaceTexture
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.input.sources.audio.AudioSource
import com.pedro.encoder.input.sources.video.VideoSource
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorVideoFailureTest {
    @Test fun lateRepairDoesNotClearARepeatedCodecFailureOrAnIndependentCameraFailure() {
        val tracker = OutdoorVideoFailureTracker()
        tracker.record(OutdoorVideoFault.CODEC)
        tracker.record(OutdoorVideoFault.RENDER)
        val attempted = tracker.snapshot(setOf(OutdoorVideoFault.CODEC, OutdoorVideoFault.RENDER))
        tracker.record(OutdoorVideoFault.CODEC) // after a new keyframe but before repair completion
        tracker.record(OutdoorVideoFault.CAMERA)
        val faults = setOf(OutdoorVideoFault.CODEC, OutdoorVideoFault.RENDER, OutdoorVideoFault.CAMERA)
        assertEquals(setOf(OutdoorVideoFault.CODEC, OutdoorVideoFault.CAMERA), faults - tracker.unchanged(attempted))
    }
    private class Audio : AudioSource() {
        var stops = 0
        var releases = 0
        override fun create(sampleRate: Int, isStereo: Boolean, echoCanceler: Boolean, noiseSuppressor: Boolean) = true
        override fun start(getMicrophoneData: GetMicrophoneData) {}
        override fun stop() { stops++ }
        override fun release() { releases++ }
        override fun isRunning() = true
    }
    private class Video : VideoSource() {
        var starts = 0
        override fun create(width: Int, height: Int, fps: Int, rotation: Int) = true
        override fun start(surfaceTexture: SurfaceTexture) { starts++ }
        override fun stop() {}
        override fun release() {}
        override fun isRunning() = false
    }
    private val checker = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {}
        override fun onConnectionSuccess() {}
        override fun onConnectionFailed(reason: String) {}
        override fun onDisconnect() {}
        override fun onAuthError() {}
        override fun onAuthSuccess() {}
        override fun onNewBitrate(bitrate: Long) {}
    }
    @After fun clear() { OutdoorRuntime.update(OutdoorState()); OutdoorRuntime.service = null }
    @Test fun libraryOldSourceFallbackCannotRestartCameraAfterManualHide() {
        val video = Video()
        var allowed = true
        val cameraInput = OutdoorCameraInput(video) { allowed }
        val texture = SurfaceTexture(0)
        try {
            cameraInput.start(texture)
            allowed = false
            cameraInput.stop()
            cameraInput.start(texture) // library fallback or delayed renderer recovery
            assertEquals(1, video.starts)
        } finally { texture.release() }
    }

    @Test fun renderRepairDoesNotRestartAnOldSourceLeftAfterHidingFailed() {
        val lifecycle = Robolectric.buildService(OutdoorService::class.java).create()
        val service = lifecycle.get()
        val audio = Audio()
        val oldVideo = Video()
        val stream = OutdoorSrtStream(service, checker, oldVideo, audio)
        OutdoorService::class.java.getDeclaredField("stream").apply { isAccessible = true }.set(service, stream)
        OutdoorRuntime.update(OutdoorState(active = true, videoHidden = true, videoFaults = setOf(OutdoorVideoFault.RENDER)))
        try {
            OutdoorService::class.java.getDeclaredMethod("restartVideoInputAfterRenderFailure", OutdoorSrtStream::class.java)
                .apply { isAccessible = true }.invoke(service, stream)
            assertEquals(0, oldVideo.starts)
            assertEquals(0, audio.stops)
            assertTrue(OutdoorRuntime.state.value.videoHidden)
        } finally { lifecycle.destroy() }
    }

    @Test fun cameraFailureBeforeAnyImageKeepsAudioAndTransportOwnedByTheService() {
        val lifecycle = Robolectric.buildService(OutdoorService::class.java).create()
        val service = lifecycle.get()
        val audio = Audio()
        val stream = OutdoorSrtStream(service, checker, Video(), audio)
        val field = OutdoorService::class.java.getDeclaredField("stream").apply { isAccessible = true }
        field.set(service, stream)
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", muted = false, inputLost = false))
        try {
            OutdoorService::class.java.getDeclaredMethod("isolateCameraFailure").apply { isAccessible = true }.invoke(service)
            assertSame(stream, field.get(service))
            assertEquals(0, audio.stops)
            assertEquals(0, audio.releases)
            assertTrue(stream.getGlInterface().isVideoMuted)
            assertTrue(OutdoorRuntime.state.value.active)
            assertFalse(OutdoorRuntime.state.value.muted)
            assertEquals(setOf(OutdoorVideoFault.CAMERA), OutdoorRuntime.state.value.videoFaults)
        } finally { lifecycle.destroy() }
    }
}
