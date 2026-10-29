package jp.casmate.app.obs

import android.content.Intent
import android.content.ComponentName
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.*
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.content.ContextCompat
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.outdoor.OutdoorService
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** Opt-in tests against the user's connected PC. Never start OBS broadcasting or record camera footage. */
class SmartphoneRuntimeDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun webViewRendersAndNativeSpeechReceivesPreview() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyRuntime") == "true")
        assertEquals("Do not interrupt existing reading", AudioStatus.STOPPED, AudioServiceState.status.value)
        assertFalse("Do not interrupt an existing send", OutdoorRuntime.state.value.active)
        val preferences = AppPreferences(ui.activity)
        val appearance = runBlocking { preferences.appearance.first() }
        ui.onNodeWithTag("画面切替・コメント").performClick()
        val rendered = AtomicBoolean(false)
        ui.waitUntil(15_000) {
            ui.activity.runOnUiThread {
                webView(ui.activity.window.decorView)?.evaluateJavascript("Array.from(document.querySelectorAll('[role=status]')).some(n=>n.textContent.includes('コメント接続済み'))") {
                    rendered.set(it == "true")
                }
            }
            rendered.get()
        }
        assertTrue("The embedded comment page must receive its WebSocket snapshot", rendered.get())
        ui.onNodeWithContentDescription("読み上げを聞く").assertIsOff().performClick()
        val controller = AtomicReference<MediaController?>()
        val played = AtomicBoolean(false)
        val playerError = AtomicReference<String?>()
        try {
            ui.waitUntil(12_000) { AudioServiceState.status.value == AudioStatus.WAITING }
            ui.onNodeWithContentDescription("読み上げを停止").assertIsOn()
            ui.onNodeWithText("コメントの操作").assertDoesNotExist()
            ui.onNodeWithTag("コメント設定の入口").performClick()
            ui.onNodeWithText("読み上げの状態：${AudioStatus.WAITING.label}").performScrollTo().assertIsDisplayed()
            ui.onNodeWithText("ダークモード").performScrollTo().performClick()
            ui.onNodeWithText("閉じる").performClick()
            assertEquals(AudioStatus.WAITING, AudioServiceState.status.value)
            ui.onNodeWithTag("機能画面").performTouchInput { swipeRight() }
            ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
            ui.onNodeWithTag("コメント・読み上げ操作").assertDoesNotExist()
            ui.onNodeWithTag("機能画面").performTouchInput { swipeLeft() }
            ui.onNodeWithContentDescription("読み上げを停止").assertIsOn()
            assertEquals(AudioStatus.WAITING, AudioServiceState.status.value)
            ui.activity.runOnUiThread {
                val future = MediaController.Builder(ui.activity,
                    SessionToken(ui.activity, ComponentName(ui.activity, MobileAudioService::class.java))).buildAsync()
                future.addListener({
                    controller.set(future.get().apply {
                        addListener(PlaybackProbe(played, playerError))
                    })
                }, ContextCompat.getMainExecutor(ui.activity))
            }
            ui.waitUntil(5_000) { controller.get() != null }
            android.util.Log.i("CasMateConnectionTest", "HEADPHONE_AUDIO_READY")
            ui.waitUntil(40_000) { played.get() || playerError.get() != null }
            assertNull("The native player must decode the received M4A", playerError.get())
            assertTrue("The native player must actually play the received M4A", played.get())
            ui.waitUntil(12_000) { AudioServiceState.status.value == AudioStatus.WAITING }
            ui.onNodeWithContentDescription("読み上げを停止").performClick()
            ui.waitUntil(10_000) { AudioServiceState.status.value == AudioStatus.STOPPED }
            ui.onNodeWithContentDescription("読み上げを聞く").assertIsOff()
            ui.onNodeWithText("コメントの操作").assertDoesNotExist()
            assertFalse(OutdoorRuntime.state.value.active)
        } finally {
            ui.activity.runOnUiThread { controller.get()?.release() }
            ui.activity.startService(MobileAudioService.stopIntent(ui.activity))
            runBlocking { preferences.setAppearance(appearance) }
        }
    }

    private class PlaybackProbe(private val played: AtomicBoolean, private val error: AtomicReference<String?>) : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) played.set(true) }
        override fun onPlayerError(exception: PlaybackException) { error.set(exception.errorCodeName) }
    }

    @Test fun registeredVideoSendsToObsAndStopsIndependently() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyVideo") == "true")
        assertFalse("Do not interrupt an existing send", OutdoorRuntime.state.value.active)
        ui.onNodeWithTag("画面切替・カメラ").performClick()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("送信を開始").performClick()
        try {
            ui.waitUntil(25_000) { OutdoorRuntime.state.value.status == "sending" && OutdoorRuntime.state.value.reportOk }
            ui.waitUntil(15_000) { (OutdoorRuntime.state.value.observation?.ackedLiveVideoId ?: 0L) > 0L }
            android.util.Log.i("CasMateConnectionTest", "SRT_SENDING_WITH_ACK")
            if (InstrumentationRegistry.getArguments().getString("verifyControlReconnect") == "true") {
                val before = requireNotNull(OutdoorRuntime.state.value.observation)
                val field = jp.casmate.app.connection.SmartphoneControlConnection::class.java.getDeclaredField("socket").apply { isAccessible = true }
                val control = field.get(jp.casmate.app.connection.SmartphoneControlConnection) as jp.casmate.app.connection.ManagedSocket
                val connectionId = requireNotNull(control.connectionId)
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    control.retryNow()
                    assertNull(control.connectionId)
                }
                ui.waitUntil(10000) {
                    val current = OutdoorRuntime.state.value
                    control.connectionId != null && control.connectionId != connectionId && current.reportOk &&
                        (current.observation?.ackedLiveVideoId ?: 0L) > before.ackedLiveVideoId
                }
                assertTrue(OutdoorRuntime.state.value.active)
                assertEquals("Control reconnection must retain the healthy SRT sender", before.generation, OutdoorRuntime.state.value.observation?.generation)
            }
            if (InstrumentationRegistry.getArguments().getString("verifyNativeReconnect") == "true") {
                val file = java.io.File(ui.activity.getExternalFilesDir(null), "casmate-native-receiver-test.json")
                val generation = requireNotNull(OutdoorRuntime.state.value.observation).generation
                val ready = android.os.SystemClock.elapsedRealtime()
                fun evidence(phase: String) = org.json.JSONObject().put("phase", phase)
                    .put("generation", OutdoorRuntime.state.value.observation?.generation)
                    .put("elapsedAfterReadyMs", android.os.SystemClock.elapsedRealtime() - ready)
                    .put("ackedVideoId", OutdoorRuntime.state.value.observation?.ackedLiveVideoId)
                    .put("codec", OutdoorRuntime.state.value.quality.videoCodec.name)
                    .put("latencyMs", OutdoorRuntime.state.value.quality.latencyMs).toString()
                file.writeText(evidence("ready"))
                ui.waitUntil(20_000) {
                    val sample = OutdoorRuntime.state.value.observation
                    sample != null && sample.generation > generation && sample.ackedLiveVideoId > 0
                }
                file.writeText(evidence("recovered"))
                assertTrue(OutdoorRuntime.state.value.active)
            }
            Thread.sleep(5000)
        } finally {
            ui.activity.startService(Intent(ui.activity, OutdoorService::class.java).setAction("STOP"))
            ui.waitUntil(10_000) { !OutdoorRuntime.state.value.active }
        }
    }

    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) webView(view.getChildAt(index))?.let { return it }
        return null
    }
}
