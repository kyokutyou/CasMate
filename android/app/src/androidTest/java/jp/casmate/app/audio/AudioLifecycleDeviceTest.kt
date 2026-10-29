package jp.casmate.app.audio

import android.app.NotificationManager
import android.content.ComponentName
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.obs.CasMateRegistration
import jp.casmate.app.obs.ObsControlRuntime
import jp.casmate.app.obs.RegistrationBundle
import jp.casmate.app.obs.RegistrationBundleStore
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
import org.junit.Test
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Opt-in real Android lifecycle/focus checks against the synthetic LAN fixture only. */
class AudioLifecycleDeviceTest {
    /** The external crash driver owns restoration; instrumentation must finish before starting audio. */
    @Test fun prepareProcessRecoveryFixture() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("transportBenchUrl")
        val stage = InstrumentationRegistry.getArguments().getString("lifecycleRecoveryStage")
        assumeNotNull(base, stage)
        check(stage == "prepare")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(java.io.File(context.noBackupFilesDir, "audit-lifecycle-original.protected").isFile) {
            "External restoration backup is required before preparing a crash fixture"
        }
        assertFalse("Do not interrupt speech", AppPreferences(context).startDesired.first())
        assertFalse("Do not interrupt camera", OutdoorRuntime.state.value.active)
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        try {
            val registration = client.newCall(Request.Builder().url(base + "/registration").build()).execute().use {
                check(it.isSuccessful); CasMateRegistration.parse(it.body.string()).getOrThrow()
            }
            RegistrationBundleStore(context).save(RegistrationBundle(emptyMap(), null).merge(registration))
        } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
    }

    @Test fun taskRemovalAndFocusLossPreserveOnlyNewAudio() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("transportBenchUrl")
        assumeNotNull(base)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = AppPreferences(context)
        assertFalse("Do not interrupt speech", preferences.startDesired.first())
        assertFalse("Do not interrupt camera", OutdoorRuntime.state.value.active)
        val original = RegistrationBundleStore.loadCurrent(context)
        val store = RegistrationBundleStore(context)
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        fun get(path: String): JSONObject = client.newCall(Request.Builder().url(base + path).build()).execute().use {
            check(it.isSuccessful); JSONObject(it.body.string())
        }
        val controller = AtomicReference<MediaController?>()
        val played = AtomicInteger()
        val manager = context.getSystemService(AudioManager::class.java)
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
            .setOnAudioFocusChangeListener({}, Handler(Looper.getMainLooper())).build()
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            val registration = CasMateRegistration.parse(get("/registration").toString()).getOrThrow()
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            scenario = ActivityScenario.launch(MainActivity::class.java)
            ContextCompat.startForegroundService(context, MobileAudioService.startIntent(context, registration.comments!!.commentsUrl))
            until(10000) { AudioServiceState.status.value == AudioStatus.WAITING && get("/audio-state").getInt("clientCount") == 1 }
            awaitDesired(preferences, true)
            instrumentation.runOnMainSync {
                val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, MobileAudioService::class.java))).buildAsync()
                future.addListener({ controller.set(future.get().apply {
                    addListener(object : Player.Listener {
                        override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) played.incrementAndGet() }
                    })
                }) }, ContextCompat.getMainExecutor(context))
            }
            until(5000) { controller.get() != null }
            scenario.onActivity { it.finishAndRemoveTask() }
            until(5000) { scenario.state == androidx.lifecycle.Lifecycle.State.DESTROYED }
            assertTrue(preferences.startDesired.first())
            get("/step?kind=audio&id=removed-task")
            until(5000) { played.get() == 1 }
            until(5000) { AudioServiceState.status.value == AudioStatus.WAITING }

            get("/step?kind=focus&id=loss")
            until(5000) { played.get() == 2 }
            assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, manager.requestAudioFocus(focus))
            until(1000) { get("/audio-state").getInt("clientCount") == 0 }
            instrumentation.runOnMainSync { assertFalse("Focus loss must stop playback", controller.get()!!.isPlaying) }
            assertTrue("Focus loss must preserve start intent", preferences.startDesired.first())
            get("/step?kind=missed&id=while-focus-lost")
            assertEquals(0, get("/audio-state").getInt("queueLength"))
            manager.abandonAudioFocusRequest(focus)
            until(10000) { get("/audio-state").getInt("clientCount") == 1 }
            Thread.sleep(500)
            assertEquals("Audio from the lost-focus interval must not replay", 2, played.get())
            get("/step?kind=audio&id=after-focus")
            until(5000) { played.get() == 3 }
            val stop = context.getSystemService(NotificationManager::class.java).activeNotifications
                .flatMap { it.notification.actions?.toList() ?: emptyList() }.first { it.title.toString() == "停止" }
            stop.actionIntent.send()
            awaitDesired(preferences, false)
            until(5000) { AudioServiceState.status.value == AudioStatus.STOPPED && get("/audio-state").getInt("clientCount") == 0 }
        } finally {
            manager.abandonAudioFocusRequest(focus)
            try {
                context.startService(MobileAudioService.stopIntent(context))
                awaitDesired(preferences, false)
            } finally {
                try {
                    store.save(original)
                    instrumentation.runOnMainSync { controller.get()?.release(); ObsControlRuntime.reload() }
                    assertTrue("Original registration must be restored without exposing credentials",
                        original.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
                } finally {
                    try { scenario?.close() }
                    finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
                }
            }
        }
    }

    @Test fun osMediaPauseThenPlayResubscribesWithoutReplayingOldAudio() = runBlocking<Unit> {
        verifyMediaPauseResume("pause", "play")
    }

    @Test fun osMediaToggleResubscribesWithoutReplayingOldAudio() = runBlocking<Unit> {
        verifyMediaPauseResume("play-pause", "play-pause")
    }

    private suspend fun verifyMediaPauseResume(pauseKey: String, playKey: String) {
        val base = InstrumentationRegistry.getArguments().getString("transportBenchUrl")
        assumeNotNull(base)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = AppPreferences(context)
        assertFalse("Do not interrupt speech", preferences.startDesired.first())
        assertFalse("Do not interrupt camera", OutdoorRuntime.state.value.active)
        val original = RegistrationBundleStore.loadCurrent(context)
        val store = RegistrationBundleStore(context)
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        fun get(path: String): JSONObject = client.newCall(Request.Builder().url(base + path).build()).execute().use {
            check(it.isSuccessful); JSONObject(it.body.string())
        }
        fun dispatchPause() {
            val code = if (pauseKey == "pause") android.view.KeyEvent.KEYCODE_MEDIA_PAUSE
                else android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.MEDIA_CONTENT_CONTROL")
            try {
                val target = context.getSystemService(android.media.session.MediaSessionManager::class.java)
                    .getActiveSessions(null).first { it.packageName == context.packageName }
                assertTrue(target.dispatchMediaButtonEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code)))
                target.dispatchMediaButtonEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code))
            } finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }
        }
        fun playing(): Boolean {
            instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.MEDIA_CONTENT_CONTROL")
            return try {
                context.getSystemService(android.media.session.MediaSessionManager::class.java)
                    .getActiveSessions(null).any {
                        it.packageName == context.packageName &&
                            it.playbackState?.state == android.media.session.PlaybackState.STATE_PLAYING
                    }
            } finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }
        }
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            val registration = CasMateRegistration.parse(get("/registration").toString()).getOrThrow()
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            scenario = ActivityScenario.launch(MainActivity::class.java)
            ContextCompat.startForegroundService(context, MobileAudioService.startIntent(context, registration.comments!!.commentsUrl))
            until(10000) { get("/audio-state").getInt("clientCount") == 1 }
            get("/step?kind=focus&id=media-before-pause")
            until(2000) { playing() }
            dispatchPause()
            until(5000) { get("/audio-state").getInt("clientCount") == 0 && !playing() }
            awaitDesired(preferences, false)
            get("/step?kind=missed&id=media-paused")
            assertEquals(0, get("/audio-state").getInt("queueLength"))
            // After service termination there is no controller: Android dispatches to its receiver.
            context.sendBroadcast(android.content.Intent(android.content.Intent.ACTION_MEDIA_BUTTON)
                .setPackage(context.packageName)
                .putExtra(android.content.Intent.EXTRA_KEY_EVENT, android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN,
                    if (playKey == "play") android.view.KeyEvent.KEYCODE_MEDIA_PLAY else android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)))
            until(5000) { get("/audio-state").getInt("clientCount") == 1 }
            assertFalse("A media resume must subscribe, not replay the previous audio", playing())
            get("/step?kind=focus&id=media-after-resume")
            until(2000) { playing() }
        } finally {
            try {
                context.startService(MobileAudioService.stopIntent(context))
                awaitDesired(preferences, false)
            } finally {
                try {
                    store.save(original)
                    assertTrue("Original registration must be restored without exposing credentials",
                        original.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
                    instrumentation.runOnMainSync { ObsControlRuntime.reload() }
                } finally {
                    try { scenario?.close() }
                    finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
                }
            }
        }
    }

    private suspend fun awaitDesired(preferences: AppPreferences, desired: Boolean) = withTimeout(5000) {
        while (withTimeout(1000) { preferences.startDesired.first() } != desired) delay(20)
    }
    private fun until(timeout: Long, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeout
        while (true) {
            val matched = condition()
            check(SystemClock.elapsedRealtime() <= deadline) { "Lifecycle/focus observation exceeded ${timeout}ms" }
            if (matched) return
            Thread.sleep(20)
        }
    }
}
