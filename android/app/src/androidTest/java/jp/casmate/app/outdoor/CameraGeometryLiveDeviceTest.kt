package jp.casmate.app.outdoor

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.obs.ConnectionNetwork
import jp.casmate.app.obs.RegistrationBundleStore
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in, previously authorized LAN camera/microphone transmission. Never starts OBS or reading. */
class CameraGeometryLiveDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun landscapeCameraAndTabReturnKeepTheLiveSender() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyCameraGeometryLive") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val original = RegistrationBundleStore.loadCurrent(context)
        assertEquals(ConnectionNetwork.LAN, original.activeNetwork)
        val quality = OutdoorPreferences(context).quality()
        val microphone = SelectedMicrophone.inputs(context).first { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC }
        try {
            ui.runOnIdle { ContextCompat.startForegroundService(ui.activity,
                createOutdoorStartIntent(ui.activity, false, false, microphone.id, true)) }
            ui.waitUntil(30_000) { OutdoorRuntime.state.value.let { it.status == "sending" && it.camera.ready && (it.observation?.ackedLiveVideoId ?: 0) > 0 } }
            val generation = OutdoorRuntime.state.value.observation!!.generation
            for (front in listOf(false, true)) {
                if (front) {
                    ui.runOnIdle { checkNotNull(OutdoorRuntime.service).switchCamera() }
                    ui.waitUntil(10_000) { OutdoorRuntime.state.value.let { it.front && it.camera.ready } }
                }
                ui.onNodeWithTag("画面切替・カメラ").performClick()
                val rect = ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
                assertEquals(quality.width.toFloat() / quality.height, rect.width / rect.height, .01f)
                assertEquals(quality, OutdoorRuntime.state.value.quality)
                assertFalse(OutdoorRuntime.state.value.portrait)
                capture(instrumentation, context, if (front) "front" else "back")
                val tag = InstrumentationRegistry.getArguments().getString("liveTag") ?: "manual"
                android.util.Log.i("CameraGeometryLive", (if (front) "FRONT_READY-" else "BACK_READY-") + tag)
                // Allow the PC-side QA wrapper to decode one still frame from the existing local UDP receiver.
                Thread.sleep(8_000)
                ui.onNodeWithTag("画面切替・コメント").performClick()
                assertTrue(OutdoorRuntime.state.value.active)
                ui.onNodeWithTag("画面切替・カメラ").performClick()
                ui.onNodeWithTag("映像表示面").assertIsDisplayed()
                ui.waitUntil(10_000) { (OutdoorRuntime.state.value.observation?.ackedLiveVideoId ?: 0L) > 0L }
                assertEquals(generation, OutdoorRuntime.state.value.observation?.generation)
                assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            }
            ui.runOnIdle { checkNotNull(OutdoorRuntime.service).toggleVideoVisibility() }
            ui.waitUntil(10_000) { OutdoorRuntime.state.value.let { it.videoHidden && !it.videoChanging } }
            ui.runOnIdle { checkNotNull(OutdoorRuntime.service).toggleVideoVisibility() }
            ui.waitUntil(10_000) { OutdoorRuntime.state.value.let { !it.videoHidden && !it.videoChanging && it.camera.ready } }
            assertEquals(generation, OutdoorRuntime.state.value.observation?.generation)
            capture(instrumentation, context, "restored")
        } finally {
            // Cleanup must also run when Compose cannot become idle or the activity has failed.
            context.startService(android.content.Intent(context, OutdoorService::class.java).setAction("STOP"))
            val deadline = android.os.SystemClock.elapsedRealtime() + 10_000
            while ((OutdoorRuntime.state.value.active || OutdoorRuntime.service != null) &&
                android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(20)
            assertFalse(OutdoorRuntime.state.value.active)
            assertNull(OutdoorRuntime.service)
            assertEquals(original.json().toString(), RegistrationBundleStore.loadCurrent(context).json().toString())
            assertEquals(quality, OutdoorPreferences(context).quality())
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        }
    }

    private fun capture(instrumentation: android.app.Instrumentation, context: android.content.Context, name: String) {
        instrumentation.uiAutomation.waitForIdle(500, 5_000)
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(context.getExternalFilesDir(null), "camera-geometry-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}
