package jp.casmate.app.outdoor

import android.media.AudioDeviceInfo
import android.os.SystemClock
import android.util.Log
import android.util.AtomicFile
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.audio.MobileAudioService
import jp.casmate.app.obs.ConnectionNetwork
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.obs.RegistrationBundle
import jp.casmate.app.obs.SmartphoneInvitation
import jp.casmate.app.obs.AndroidRegistrationProtection
import jp.casmate.app.obs.ObsControlRuntime
import jp.casmate.app.obs.enrollSmartphone
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Explicitly opted-in local camera/microphone QA; never starts OBS broadcast or recording.
 * The host wrapper captures a still from its disposable OBS receiver at each marker. */
class OutdoorDrawingLiveDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun handwritingSurvivesModeAndTabChangesWhileMediaKeepsSending() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyDrawingLive") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val controller = OutdoorDrawingRuntime.controller
        val store = RegistrationBundleStore(context)
        val backup = AtomicFile(java.io.File(context.noBackupFilesDir, "registration.handwriting-backup"))
        val owner = AtomicFile(java.io.File(context.noBackupFilesDir, "registration.handwriting-owner"))
        val invitationFile = java.io.File(context.getExternalFilesDir(null), "casmate-handwriting-invitation.json")
        fun digest(bundle: RegistrationBundle) = java.security.MessageDigest.getInstance("SHA-256")
            .digest(bundle.json().toString().toByteArray(Charsets.UTF_8))
        fun markOwned(bundle: RegistrationBundle) {
            val output = owner.startWrite()
            try { output.write(digest(bundle)); owner.finishWrite(output) }
            catch (error: Exception) { owner.failWrite(output); throw error }
        }
        if (backup.baseFile.exists() || java.io.File(backup.baseFile.path + ".bak").exists()) {
            val recovered = RegistrationBundle.parse(org.json.JSONObject(AndroidRegistrationProtection().decrypt(backup.readFully())))
            val current = RegistrationBundleStore.loadCurrent(context)
            if (current.json().toString() == recovered.json().toString()) {
                backup.delete(); owner.delete(); invitationFile.delete()
                throw AssertionError("Interrupted handwriting QA already restored; rerun the opted-in test")
            }
            assertTrue("Registration changed after interrupted QA; encrypted original retained without overwriting",
                (owner.baseFile.exists() || java.io.File(owner.baseFile.path + ".bak").exists()) &&
                    owner.readFully().contentEquals(digest(current)))
            assertTrue("Stop the interrupted QA media before restoring its encrypted registration; rerun the opted-in test",
                !OutdoorRuntime.state.value.active && AudioServiceState.status.value == AudioStatus.STOPPED)
            // Only clear stale auto-resume intent when the stopped registration still belongs to QA.
            if (runBlocking { AppPreferences(context).startDesired.first() }) {
                context.startService(MobileAudioService.stopIntent(context))
                val deadline = SystemClock.elapsedRealtime() + 10_000
                while (runBlocking { AppPreferences(context).startDesired.first() } &&
                    SystemClock.elapsedRealtime() < deadline) Thread.sleep(20)
                assertFalse(runBlocking { AppPreferences(context).startDesired.first() })
            }
            store.save(recovered)
            ui.runOnUiThread { ObsControlRuntime.reload() }
            assertTrue("Interrupted QA registration restoration did not match",
                recovered.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
            backup.delete(); owner.delete(); invitationFile.delete()
            throw AssertionError("Interrupted handwriting QA registration restored; rerun the opted-in test")
        }
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        assertFalse(runBlocking { AppPreferences(context).startDesired.first() })
        val registration = RegistrationBundleStore.loadCurrent(context)
        if (!store.exists()) store.save(registration)
        val originalBytes = AtomicFile(java.io.File(context.noBackupFilesDir, "registration.protected")).readFully()
        val backupOutput = backup.startWrite()
        try { backupOutput.write(originalBytes); backup.finishWrite(backupOutput); check(backup.readFully().contentEquals(originalBytes)) }
        catch (error: Exception) { backup.failWrite(backupOutput); throw error }
        val quality = OutdoorPreferences(context).quality()
        val microphone = SelectedMicrophone.inputs(context).first { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
        val tag = requireNotNull(InstrumentationRegistry.getArguments().getString("liveTag"))
        fun marker(name: String) {
            Log.i("OutdoorDrawingLive", "$name-$tag")
            // The external receiver waits for decoded pixels, including its normal probe/buffer delay.
            Thread.sleep(20_000)
        }
        try {
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(true)
                ui.activity.setTurnScreenOn(true)
                ui.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            val invitation = SmartphoneInvitation.parse(invitationFile.readText()).getOrThrow()
            assertEquals(ConnectionNetwork.LAN, invitation.network)
            val emptyRegistration = RegistrationBundle(emptyMap(), null)
            markOwned(emptyRegistration)
            store.save(emptyRegistration)
            assertNull(runBlocking { enrollSmartphone(context, invitation) })
            markOwned(RegistrationBundleStore.loadCurrent(context))
            ui.runOnUiThread { ObsControlRuntime.reload() }
            ui.waitUntil(30_000) { RegistrationBundleStore.loadCurrent(context).let { it.profiles[it.activeNetwork]?.canStartVideo == true } }
            ui.runOnIdle {
                ContextCompat.startForegroundService(context, createOutdoorStartIntent(context, false, false, microphone.id, false))
                ContextCompat.startForegroundService(context, MobileAudioService.resumeIntent(context))
            }
            ui.waitUntil(30_000) { OutdoorRuntime.state.value.let {
                it.status == "sending" && it.camera.ready && (it.observation?.ackedLiveVideoId ?: 0) > 0
            } }
            ui.waitUntil(20_000) { AudioServiceState.status.value != AudioStatus.STOPPED }
            val connection = checkNotNull(OutdoorRuntime.state.value.observation).generation
            val id = controller.state.value.sessionId
            marker("BASE_READY")
            ui.runOnIdle {
                assertTrue(controller.openMode(id))
                controller.setColor(id, OutdoorDrawingColor.RED)
                controller.setWidth(id, OutdoorDrawingWidth.THICK)
                assertTrue(controller.beginStroke(id, .25f, .3f))
                controller.appendStroke(id, .5f, .7f)
                controller.appendStroke(id, .75f, .3f)
                controller.endStroke(id)
            }
            ui.waitUntil(5_000) { controller.state.value.outputRevision == controller.state.value.draftRevision }
            marker("DRAWN_READY")
            ui.runOnIdle { controller.closeMode(id) }
            ui.onNodeWithTag("画面切替・コメント").performClick()
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            assertEquals(connection, OutdoorRuntime.state.value.observation?.generation)
            assertTrue(controller.state.value.hasDrawing)
            ui.runOnIdle {
                controller.openMode(id)
                assertTrue(controller.clear(id))
            }
            ui.waitUntil(5_000) { controller.state.value.outputRevision == controller.state.value.draftRevision }
            marker("CLEARED_READY")
            ui.runOnIdle { assertTrue(controller.undo(id)) }
            ui.waitUntil(5_000) { controller.state.value.outputRevision == controller.state.value.draftRevision }
            marker("RESTORED_READY")
            val before = checkNotNull(OutdoorRuntime.state.value.observation)
            Thread.sleep(1_000)
            val after = checkNotNull(OutdoorRuntime.state.value.observation)
            assertTrue(after.sentAudioFrames > before.sentAudioFrames)
            assertTrue(after.sentVideoFrames > before.sentVideoFrames)
            assertFalse(OutdoorRuntime.state.value.inputLost)
            assertEquals(connection, after.generation)
            assertNotEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        } finally {
            try {
                context.startService(android.content.Intent(context, OutdoorService::class.java).setAction("STOP"))
                context.startService(MobileAudioService.stopIntent(context))
                val deadline = SystemClock.elapsedRealtime() + 10_000
                while ((OutdoorRuntime.state.value.active || AudioServiceState.status.value != AudioStatus.STOPPED ||
                    runBlocking { AppPreferences(context).startDesired.first() }) &&
                    SystemClock.elapsedRealtime() < deadline) Thread.sleep(20)
                assertFalse(OutdoorRuntime.state.value.active)
                assertFalse(controller.state.value.active)
                assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
                assertFalse(runBlocking { AppPreferences(context).startDesired.first() })
                assertEquals(quality, OutdoorPreferences(context).quality())
            } finally {
                store.save(registration)
                ui.runOnUiThread { ObsControlRuntime.reload() }
                assertTrue("Original registration restoration did not match",
                    registration.json().toString() == RegistrationBundleStore.loadCurrent(context).json().toString())
                invitationFile.delete()
                backup.delete()
                owner.delete()
                ui.runOnUiThread {
                    ui.activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    ui.activity.setShowWhenLocked(false)
                    ui.activity.setTurnScreenOn(false)
                }
            }
        }
    }
}
