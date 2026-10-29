package jp.casmate.app.obs

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.outdoor.OutdoorRuntime
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Opt-in synthetic OBS fixture only. Keeps images in memory and restores the saved registration. */
class IsolatedObsProgramPreviewDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun commonInvitationReEnrollmentKeepsOneDeviceAndDoesNotStartMedia() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("isolatedObsUrl")
        assumeNotNull(base)
        assertFalse(OutdoorRuntime.state.value.active)
        assertFalse(AppPreferences(ui.activity).startDesired.first())
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        fun get(route: String): JSONObject = client.newCall(Request.Builder().url(base + route).build()).execute().use {
            check(it.isSuccessful); JSONObject(it.body.string())
        }
        val fixture = get("/fixture")
        check(fixture.getString("kind") == "isolated-loopback-obs")
        val invitation = SmartphoneInvitation.parse(fixture.getJSONObject("invitation").toString()).getOrThrow()
        val store = RegistrationBundleStore(ui.activity)
        val original = RegistrationBundleStore.loadCurrent(ui.activity)
        try {
            store.save(RegistrationBundle(emptyMap(), null))
            assertNull(enrollSmartphone(ui.activity, invitation))
            val enrolled = RegistrationBundleStore.loadCurrent(ui.activity)
            val count = get("/stats").getInt("devices")
            assertEquals(invitation.pcId, enrolled.pcId)
            assertNull(enrollSmartphone(ui.activity, invitation))
            assertEquals(enrolled.deviceId, RegistrationBundleStore.loadCurrent(ui.activity).deviceId)
            assertEquals("Re-enrollment must not allocate another PC device", count, get("/stats").getInt("devices"))
            val beforeInvalid = RegistrationBundleStore.loadCurrent(ui.activity).json().toString()
            val invalid = JSONObject(fixture.getJSONObject("invitation").toString()).put("token", "0".repeat(64))
            val rejected = runCatching { enrollSmartphone(ui.activity, SmartphoneInvitation.parse(invalid.toString()).getOrThrow()) }
            assertTrue("An invalid invitation must be rejected", rejected.isFailure || rejected.getOrNull() != null)
            assertTrue("Failed enrollment preserves the current registration without exposing credentials", beforeInvalid == RegistrationBundleStore.loadCurrent(ui.activity).json().toString())
            assertFalse(OutdoorRuntime.state.value.active)
            assertFalse(AppPreferences(ui.activity).startDesired.first())
        } finally {
            store.save(original)
            ui.runOnUiThread { ObsControlRuntime.reload() }
            assertTrue("Original registration must be restored without exposing credentials", original.json().toString() == RegistrationBundleStore.loadCurrent(ui.activity).json().toString())
            client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
        }
    }

    @Test fun realProgramImageRequiresExplicitRefreshAfterRecreationBackgroundAndPermissionChanges() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getArguments().getString("isolatedObsUrl")
        assumeNotNull(base)
        assertFalse("Do not interrupt existing camera transmission", OutdoorRuntime.state.value.active)
        assertFalse("Do not redirect existing reading", AppPreferences(ui.activity).startDesired.first())
        val client = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
        fun get(route: String): JSONObject = client.newCall(Request.Builder().url(base + route).build()).execute().use {
            check(it.isSuccessful); JSONObject(it.body.string())
        }
        fun captureCount() = get("/stats").getJSONObject("calls").getInt("capture")
        fun awaitConnection() = ui.waitUntil(10_000) { ObsControlRuntime.state.value.remote?.connection == "connected" }
        fun awaitImage() {
            ui.waitUntil(10_000) { ObsProgramPreviewRuntime.state.value.image != null }
            val image = requireNotNull(ObsProgramPreviewRuntime.state.value.image)
            assertEquals("AuditProgram", image.sceneName)
            assertEquals(640, image.bitmap.width); assertEquals(360, image.bitmap.height)
            assertTrue("Empty program scene must decode as black", android.graphics.Color.red(image.bitmap.getPixel(320, 180)) < 8)
            ui.onNodeWithContentDescription("OBSで合成した映像の静止画").assertIsDisplayed()
        }
        val fixture = get("/fixture")
        check(fixture.getString("kind") == "isolated-loopback-obs")
        val store = RegistrationBundleStore(ui.activity)
        val original = RegistrationBundleStore.loadCurrent(ui.activity)
        try {
            val registration = CasMateRegistration.parse(fixture.getJSONObject("registration").toString()).getOrThrow()
            store.save(RegistrationBundle(emptyMap(), null).merge(registration))
            ui.runOnUiThread { ObsControlRuntime.reload() }
            ui.waitUntil(10_000) { ui.onAllNodesWithTag("画面切替・カメラ").fetchSemanticsNodes().isNotEmpty() }
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            awaitConnection()
            val before = captureCount()
            ui.runOnUiThread { ObsControlRuntime.begin("start") }
            ui.waitUntil(5_000) { ObsControlRuntime.state.value.pending != null }
            ui.runOnUiThread { ObsProgramPreviewRuntime.open() }
            awaitImage()
            assertNull("Opening preview cancels unconfirmed OBS operations", ObsControlRuntime.state.value.pending)
            assertEquals(before + 1, captureCount())
            assertEquals("stopped", get("/stats").getString("stream"))

            ui.activityRule.scenario.recreate()
            awaitConnection()
            assertTrue(ObsProgramPreviewRuntime.state.value.open)
            assertNull("Recreation discards the old image", ObsProgramPreviewRuntime.state.value.image)
            Thread.sleep(500)
            assertEquals("Recreation must not capture automatically", before + 1, captureCount())
            ui.onNodeWithTag("OBS画像・更新").performClick()
            awaitImage()

            ui.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            assertNull("Backgrounding discards the image", ObsProgramPreviewRuntime.state.value.image)
            ui.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            awaitConnection()
            Thread.sleep(500)
            assertEquals("Foregrounding must not capture automatically", before + 2, captureCount())
            ui.onNodeWithTag("OBS画像・更新").performClick()
            awaitImage()

            get("/permission/off")
            ui.waitUntil(5_000) { ObsControlRuntime.state.value.remote?.connection != "connected" && ObsProgramPreviewRuntime.state.value.image == null }
            get("/permission/on")
            awaitConnection()
            Thread.sleep(500)
            assertEquals("Permission recovery must not capture automatically", before + 3, captureCount())
            ui.onNodeWithTag("OBS画像・更新").performClick()
            awaitImage()
            ui.onNodeWithTag("OBS画像・閉じる").performClick()
            assertFalse(ObsProgramPreviewRuntime.state.value.open)
            assertNull(ObsProgramPreviewRuntime.state.value.image)
            assertEquals(before + 4, captureCount())
            assertFalse(OutdoorRuntime.state.value.active)
            assertFalse(AppPreferences(ui.activity).startDesired.first())
        } finally {
            try { get("/permission/on") } finally {
                ui.runOnUiThread { ObsProgramPreviewRuntime.close() }
                store.save(original)
                ui.runOnUiThread { ObsControlRuntime.reload() }
                assertTrue("Original registration must be restored without exposing credentials", original.json().toString() == RegistrationBundleStore.loadCurrent(ui.activity).json().toString())
                client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
            }
        }
    }
}
