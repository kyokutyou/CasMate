package jp.casmate.app.obs

import android.content.Intent
import android.util.AtomicFile
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import androidx.core.content.ContextCompat
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.outdoor.OutdoorService
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Explicitly opted-in device test. Restores registration and never starts OBS or records footage. */
class IsolatedVideoDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun enrollSendAndRestore() = runBlocking<Unit> {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("isolatedVideo") == "true")
        assertFalse("Do not interrupt an existing send", OutdoorRuntime.state.value.active)
        val restoreSpeech = AppPreferences(ui.activity).startDesired.first()
        val pauseSpeech = args.getString("pauseSpeech") == "true"
        if (!pauseSpeech) {
            assertEquals("Do not redirect existing speech", AudioStatus.STOPPED, AudioServiceState.status.value)
            assertFalse("Do not redirect desired speech", restoreSpeech)
        }
        val store = RegistrationBundleStore(ui.activity)
        val backup = AtomicFile(java.io.File(ui.activity.noBackupFilesDir, "registration.isolated-video-backup"))
        if (backup.baseFile.exists() || java.io.File(backup.baseFile.path + ".bak").exists()) {
            val recovered = RegistrationBundle.parse(org.json.JSONObject(AndroidRegistrationProtection().decrypt(backup.readFully())))
            store.save(recovered)
            assertTrue("Recovered registration must match without exposing credentials", recovered.json().toString() == RegistrationBundleStore.loadCurrent(ui.activity).json().toString())
            backup.delete()
            throw AssertionError("Previous interrupted test registration restored; rerun the opted-in test")
        }
        val original = RegistrationBundleStore.loadCurrent(ui.activity)
        // Ensure an encrypted original also exists for initially unregistered devices.
        if (!store.exists()) store.save(original)
        val bytes = AtomicFile(java.io.File(ui.activity.noBackupFilesDir, "registration.protected")).readFully()
        val output = backup.startWrite()
        try {
            output.write(bytes); backup.finishWrite(output)
            check(backup.readFully().contentEquals(bytes))
        } catch (error: Exception) { backup.failWrite(output); throw error }
        val file = java.io.File(ui.activity.getExternalFilesDir(null), "casmate-isolated-invitation.json")
        try {
            if (pauseSpeech) {
                ui.activity.startService(MobileAudioService.stopIntent(ui.activity))
                ui.waitUntil(10_000) { AudioServiceState.status.value == AudioStatus.STOPPED }
                assertFalse(AppPreferences(ui.activity).startDesired.first())
            }
            val invitation = SmartphoneInvitation.parse(file.readText()).getOrThrow()
            store.save(RegistrationBundle(emptyMap(), null))
            assertNull(enrollSmartphone(ui.activity, invitation))
            val first = RegistrationBundleStore.loadCurrent(ui.activity)
            if (args.getString("expectPartial") == "true") {
                val profile = first.profiles[first.activeNetwork]!!
                assertNotNull(profile.update)
                assertFalse("Enrollment must finish while video is still preparing", profile.canStartVideo)
                assertEquals("Enrollment must preserve the current preparation state", "preparing", requireNotNull(profile.update).video)
            }
            assertNull(enrollSmartphone(ui.activity, invitation))
            assertEquals(first.deviceId, RegistrationBundleStore.loadCurrent(ui.activity).deviceId)
            ui.activity.runOnUiThread { ObsControlRuntime.reload() }
            // Modern enrollment may succeed before video preparation. Its existing control lease delivers readiness.
            ui.waitUntil(30_000) { RegistrationBundleStore.loadCurrent(ui.activity).let { it.profiles[it.activeNetwork]?.canStartVideo == true } }
            assertFalse("Preparation and registration must not start capture", OutdoorRuntime.state.value.active)
            ui.waitUntil(10_000) { ui.onAllNodesWithTag("画面切替・カメラ").fetchSemanticsNodes().isNotEmpty() }
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            ui.onNodeWithTag("機能操作の入口").performClick()
            ui.waitUntil(10_000) {
                ui.onAllNodesWithText("送信を開始").filter(isEnabled()).fetchSemanticsNodes().isNotEmpty()
            }
            ui.onNodeWithText("送信を開始").performClick()
            ui.waitUntil(30_000) { OutdoorRuntime.state.value.status == "sending" && OutdoorRuntime.state.value.reportOk }
            ui.waitUntil(20_000) { (OutdoorRuntime.state.value.observation?.ackedLiveVideoId ?: 0L) > 0 }
            val observation = requireNotNull(OutdoorRuntime.state.value.observation)
            android.util.Log.i("CasMateConnectionTest", "ISOLATED_SRT_READY")
            Thread.sleep((args.getString("holdSeconds")?.toLongOrNull() ?: 10).coerceIn(1, 90) * 1000)
            assertTrue("Healthy sender must remain active", OutdoorRuntime.state.value.active)
            assertEquals(observation.generation, OutdoorRuntime.state.value.observation?.generation)
            assertTrue((OutdoorRuntime.state.value.observation?.ackedLiveVideoId ?: 0L) > observation.ackedLiveVideoId)
        } finally {
            try {
                try {
                    ui.activity.startService(Intent(ui.activity, OutdoorService::class.java).setAction("STOP"))
                    ui.waitUntil(10_000) { !OutdoorRuntime.state.value.active && OutdoorRuntime.service == null }
                } finally {
                    if (OutdoorRuntime.state.value.active || OutdoorRuntime.service != null) {
                        ui.activity.stopService(Intent(ui.activity, OutdoorService::class.java))
                        ui.waitUntil(10_000) { !OutdoorRuntime.state.value.active && OutdoorRuntime.service == null }
                    }
                }
            } finally {
                store.save(original)
                ui.activity.runOnUiThread { ObsControlRuntime.reload() }
                file.delete()
                assertTrue("Original registration must be restored without exposing credentials", original.json().toString() == RegistrationBundleStore.loadCurrent(ui.activity).json().toString())
                backup.delete()
                if (restoreSpeech) original.commentsUrl?.let {
                    ContextCompat.startForegroundService(ui.activity, MobileAudioService.startIntent(ui.activity, it))
                    ui.waitUntil(10_000) { kotlinx.coroutines.runBlocking { AppPreferences(ui.activity).startDesired.first() } }
                }
            }
        }
    }
}
