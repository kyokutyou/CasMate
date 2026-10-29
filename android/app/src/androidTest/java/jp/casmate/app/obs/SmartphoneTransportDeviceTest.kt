package jp.casmate.app.obs

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.ComponentName
import android.os.PowerManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.outdoor.OutdoorRuntime
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Opt-in synthetic LAN checks. Restores registration; OBS commands target only the isolated fixture. Never starts camera transmission. */
class SmartphoneTransportDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun isolatedObsStartsAndStopsAfterConfirmation() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("isolatedObsUrl")
        assumeNotNull(base)
        val client = OkHttpClient()
        fun get(path: String): JSONObject = client.newCall(Request.Builder().url(base + path).build()).execute().use {
            check(it.isSuccessful); JSONObject(it.body.string())
        }
        val fixture = get("/fixture")
        check(fixture.getString("kind") == "isolated-loopback-obs")
        assertFalse("Do not interrupt existing speech", AppPreferences(ui.activity).startDesired.first())
        assertFalse("Do not interrupt existing camera transmission", OutdoorRuntime.state.value.active)
        val original = RegistrationBundleStore.loadCurrent(ui.activity)
        val store = RegistrationBundleStore(ui.activity)
        try {
            val registration = CasMateRegistration.parse(fixture.getJSONObject("registration").toString()).getOrThrow()
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            ui.activity.runOnUiThread { ObsControlRuntime.reload() }
            showScreen("カメラ")
            until(10000) { ObsControlRuntime.state.value.remote?.connection == "connected" }
            for ((action, expected) in listOf("start" to "streaming", "stop" to "stopped")) {
                val before = ObsControlRuntime.state.value.remote!!.stream
                ui.activity.runOnUiThread { ObsControlRuntime.begin(action) }
                until(5000) { ObsControlRuntime.state.value.pending != null }
                assertEquals("Preparing an operation must not execute it", before, ObsControlRuntime.state.value.remote!!.stream)
                ui.activity.runOnUiThread { ObsControlRuntime.confirm() }
                until(15000) {
                    val state = ObsControlRuntime.state.value
                    state.remote?.stream == expected && state.remote.lastOperation?.status == "succeeded" && !state.working
                }
            }
            assertTrue(get("/result").getBoolean("passed"))
        } finally {
            try { get("/stop") } finally {
                try {
                    store.save(original)
                    ui.activity.runOnUiThread { ObsControlRuntime.reload() }
                } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
            }
        }
    }

    @Test fun compareTransportAndVerifyLockedPlayback() = verifyTransport(lockScreen = true)

    @Test fun compareTransportAndVerifyBackgroundPlayback() = verifyTransport(lockScreen = false)

    @Test fun notificationStopClearsSavedStartIntent() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("transportBenchUrl")
        assumeNotNull(base)
        val context = ui.activity
        val preferences = AppPreferences(context)
        assertFalse("Do not interrupt existing speech", preferences.startDesired.first())
        assertFalse("Do not interrupt camera transmission", OutdoorRuntime.state.value.active)
        val store = RegistrationBundleStore(context)
        val original = RegistrationBundleStore.loadCurrent(context)
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        try {
            val registration = client.newCall(Request.Builder().url(base + "/registration").build()).execute().use {
                check(it.isSuccessful); CasMateRegistration.parse(it.body.string()).getOrThrow()
            }
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            repeat(5) { iteration ->
                ContextCompat.startForegroundService(context, MobileAudioService.startIntent(context, registration.comments!!.commentsUrl))
                until(5000) { AudioServiceState.status.value == AudioStatus.WAITING }
                awaitStartDesired(preferences, true)
                val stop = awaitStopNotification(context)
                stop.actionIntent.send()
                until(5000) { AudioServiceState.status.value == AudioStatus.STOPPED }
                try { awaitStartDesired(preferences, false) }
                catch (failure: Throwable) {
                    throw AssertionError("Stop iteration=$iteration; status=${AudioServiceState.status.value}; savedStart=${withTimeout(1000) { preferences.startDesired.first() }}", failure)
                }
                Thread.sleep(100)
            }
        } finally {
            try { context.startService(MobileAudioService.stopIntent(context)) } finally {
                try {
                    store.save(original)
                    ui.activity.runOnUiThread { ObsControlRuntime.reload() }
                    assertTrue("Original registration must be restored", original.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
                } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
            }
        }
    }

    private fun verifyTransport(lockScreen: Boolean) = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("transportBenchUrl")
        assumeNotNull(base)
        val backgroundIdleMs = InstrumentationRegistry.getArguments().getString("backgroundIdleMs")?.toLong() ?: 2500L
        require(backgroundIdleMs in 2500L..1200000L)
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        fun get(path: String): JSONObject = client.newCall(Request.Builder().url(base + path).build()).execute().use {
            check(it.isSuccessful) { "Benchmark endpoint failed: ${it.code}" }
            JSONObject(it.body.string())
        }
        val context = ui.activity
        val store = RegistrationBundleStore(context)
        val original = RegistrationBundleStore.loadCurrent(context)
        val preferences = AppPreferences(context)
        assertFalse("Do not interrupt existing speech", preferences.startDesired.first())
        assertFalse("Do not interrupt existing camera transmission", OutdoorRuntime.state.value.active)
        val controller = AtomicReference<MediaController?>()
        val played = AtomicInteger()
        val registration = CasMateRegistration.parse(get("/registration").toString()).getOrThrow()
        try {
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            ui.activity.runOnUiThread { ObsControlRuntime.reload() }
            showScreen("コメント")
            until(20000) { commentsStatus("コメント接続済み") }
            ContextCompat.startForegroundService(context, MobileAudioService.startIntent(context, registration.comments!!.commentsUrl))
            try { until(10000) { AudioServiceState.status.value == AudioStatus.WAITING } }
            catch (failure: Throwable) { throw AssertionError("Native audio status: ${AudioServiceState.status.value}", failure) }
            ui.activity.runOnUiThread {
                val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, MobileAudioService::class.java))).buildAsync()
                future.addListener({ controller.set(future.get().apply {
                    addListener(object : Player.Listener {
                        override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) played.incrementAndGet() }
                    })
                }) }, ContextCompat.getMainExecutor(context))
            }
            until(5000) { controller.get() != null }
            get("/phase?name=idle"); Thread.sleep(30000); get("/phase?name=comments")
            repeat(30) { index ->
                val sample = get("/step?kind=comments&id=$index")
                until(7000) { javascript("document.body.innerText.includes('${sample.getString("marker")}')") == "true" }
                get("/ack?kind=comments&id=$index")
            }
            showScreen("カメラ")
            until(10000) { ObsControlRuntime.state.value.remote?.connection == "connected" }
            get("/phase?name=obs")
            repeat(30) { index ->
                val revision = get("/step?kind=obs&id=$index").getLong("revision")
                until(7000) { (ObsControlRuntime.state.value.remote?.revision ?: 0L) >= revision }
                get("/ack?kind=obs&id=$index")
            }
            showScreen("コメント")
            until(20000) { commentsStatus("コメント接続済み") }
            get("/phase?name=audio")
            repeat(30) { index ->
                val before = played.get()
                get("/step?kind=audio&id=$index")
                until(7000) { played.get() > before }
                get("/ack?kind=audio&id=$index")
                until(5000) { AudioServiceState.status.value == AudioStatus.WAITING }
            }
            get("/phase?name=reconnect")
            repeat(30) { index ->
                get("/step?kind=reconnect&id=$index")
                until(7000) { commentsStatus("コメント接続待ち") }
                until(10000) { commentsStatus("コメント接続済み") }
                get("/ack?kind=reconnect&id=$index")
            }
            val playbackKind = if (lockScreen) "locked" else "background"
            get("/phase?name=$playbackKind")
            if (lockScreen) {
                shell("input keyevent 223")
                until(5000) { !context.getSystemService(PowerManager::class.java).isInteractive }
                // Lock-screen grace periods are device settings, independent of the screen-off event.
                until(20000) { context.getSystemService(KeyguardManager::class.java).isKeyguardLocked }
            } else {
                shell("input keyevent 3")
                until(5000) { !ui.activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) }
            }
            val waitingStarted = android.os.SystemClock.elapsedRealtime()
            Thread.sleep(if (lockScreen) 2500L else backgroundIdleMs)
            if (!lockScreen) {
                assertTrue("Requested background wait must actually elapse", android.os.SystemClock.elapsedRealtime() - waitingStarted >= backgroundIdleMs)
                assertTrue("Background wait must retain explicit start intent", preferences.startDesired.first())
                assertEquals(AudioStatus.WAITING, AudioServiceState.status.value)
            }
            repeat(3) { index ->
                val before = played.get(); get("/step?kind=$playbackKind&id=$index")
                until(7000) { played.get() > before }
                get("/ack?kind=$playbackKind&id=$index")
                until(5000) { AudioServiceState.status.value == AudioStatus.WAITING }
            }
            val notification = awaitStopNotification(context)
            notification.actionIntent.send()
            until(5000) { AudioServiceState.status.value == AudioStatus.STOPPED }
            awaitStartDesired(preferences, false)
            val stoppedCount = played.get()
            get("/step?kind=reconnect&id=stopped")
            until(10000) {
                runCatching {
                    client.newCall(Request.Builder().url(registration.comments!!.origin + "/mobile/bootstrap").build()).execute().use {
                        it.isSuccessful && JSONObject(it.body.string()).getInt("protocolVersion") == 2
                    }
                }.getOrDefault(false)
            }
            Thread.sleep(3000)
            assertEquals("Server restart after explicit stop must not resume playback", stoppedCount, played.get())
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            assertFalse(preferences.startDesired.first())
            get("/finish")
        } finally {
            try { context.startService(MobileAudioService.stopIntent(context)) } finally {
                try {
                    store.save(original)
                    ui.activity.runOnUiThread { controller.get()?.release(); ObsControlRuntime.reload() }
                    assertTrue("Saved registration must be restored without exposing credentials",
                        original.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
                } finally {
                    if (lockScreen) {
                        shell("input keyevent 224"); shell("wm dismiss-keyguard")
                    } else {
                        context.startActivity(android.content.Intent(context, MainActivity::class.java)
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                    client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
                }
            }
        }
    }

    private fun awaitStopNotification(context: android.content.Context): android.app.Notification.Action {
        var action: android.app.Notification.Action? = null
        until(5000) {
            action = context.getSystemService(NotificationManager::class.java).activeNotifications
                .flatMap { it.notification.actions?.toList() ?: emptyList() }.firstOrNull { it.title.toString() == "停止" }
            action != null
        }
        return checkNotNull(action)
    }

    private fun until(timeout: Long, condition: () -> Boolean) {
        ui.waitUntil(timeout, condition)
    }
    private suspend fun awaitStartDesired(preferences: AppPreferences, desired: Boolean) = withTimeout(5000) {
        // Verify saved snapshots without depending on a cold collector's update timing.
        while (withTimeout(1000) { preferences.startDesired.first() } != desired) delay(20)
    }
    private fun showScreen(name: String) {
        val tag = "画面切替・$name"
        until(10000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag(tag).performClick()
        ui.waitForIdle()
    }
    private fun commentsStatus(prefix: String): Boolean = javascript(
        "document.querySelector('.comment-list-notices [role=status]')?.textContent.startsWith('$prefix') === true",
    ) == "true"
    private fun javascript(code: String): String? {
        val latch = CountDownLatch(1); val result = AtomicReference<String?>()
        ui.activity.runOnUiThread { webView(ui.activity.window.decorView)?.evaluateJavascript(code) { result.set(it); latch.countDown() } ?: latch.countDown() }
        latch.await(1, TimeUnit.SECONDS); return result.get()
    }
    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) webView(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun shell(command: String) {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }
}
