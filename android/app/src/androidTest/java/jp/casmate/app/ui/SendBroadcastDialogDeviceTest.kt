package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.obs.ObsControlActions
import jp.casmate.app.obs.ObsControlRegistration
import jp.casmate.app.obs.ObsControlUiState
import jp.casmate.app.obs.ObsPrepared
import jp.casmate.app.obs.ObsRemoteState
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.outdoor.OutdoorSendSection
import jp.casmate.app.outdoor.OutdoorState
import jp.casmate.app.outdoor.OutdoorStatistics
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Inspect the actual registered application without starting transmission or changing settings. */
@RunWith(AndroidJUnit4::class)
class SendBroadcastDialogDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun actualMenuDetailsAndTabNavigationKeepStoppedServicesUnchanged() {
        val registration = RegistrationBundleStore.loadCurrent(ui.activity)
        assumeTrue("Existing registration is required", registration.profiles.isNotEmpty())
        val preferences = AppPreferences(ui.activity)
        assumeTrue("Reading must not be requested", !runBlocking { preferences.startDesired.first() })
        val sender = OutdoorRuntime.state.value.active
        val reading = AudioServiceState.status.value
        assumeTrue("Existing transmission or reading must not be interrupted", !sender && !reading.readingActive)
        val appearance = runBlocking { preferences.appearance.first() }

        fun assertStoppedServices() {
            assertEquals(sender, OutdoorRuntime.state.value.active)
            assertEquals(reading, AudioServiceState.status.value)
        }
        ui.onNodeWithTag("画面切替・カメラ").performClick()
        ui.onNode(hasText("!") and hasAnyAncestor(hasContentDescription("スマホ連携")), useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("戻る").assertDoesNotExist()
        ui.onNodeWithTag("カメラ・送信操作").performScrollTo().assertTextContains("送信を開始")
        ui.onNodeWithTag("スマホ送信・詳細").performScrollTo().assertTextContains("詳細").performClick()
        ui.onNodeWithTag("スマホ送信・詳細画面").assertExists()
        ui.onNodeWithTag("スマホ送信・詳細を閉じる").performClick()
        assertStoppedServices()
        ui.onNodeWithTag("OBS配信・詳細").performScrollTo().assertTextContains("詳細").performClick()
        ui.onNodeWithTag("OBS配信・詳細画面").assertExists()
        ui.onNodeWithTag("OBS配信・詳細を閉じる").performClick()
        ui.onNodeWithTag("OBS配信操作").performScrollTo().assertExists()
        ui.onNodeWithTag("OBS映像確認の入口").performScrollTo().assertTextContains("OBS映像を確認")
        ui.onNodeWithText("スマホの送信", useUnmergedTree = true).assertExists()
        ui.onNodeWithText("OBS配信", useUnmergedTree = true).assertExists()
        assertStoppedServices()
        ui.onNode(hasText("閉じる") and hasAnyAncestor(hasTestTag("機能操作メニュー"))).performClick()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.onNodeWithTag("画面切替・コメント").performClick()
        assertStoppedServices()
        ui.onNodeWithTag("画面切替・カメラ").performClick()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithTag("スマホ送信・状態").assertExists()
        ui.onNodeWithText("戻る").assertDoesNotExist()
        androidx.test.espresso.Espresso.pressBack()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        assertStoppedServices()
        assertEquals(appearance, runBlocking { preferences.appearance.first() })
        assertFalse(runBlocking { preferences.startDesired.first() })
        val after = RegistrationBundleStore.loadCurrent(ui.activity)
        assertEquals(registration.pcId, after.pcId)
        assertEquals(registration.deviceId, after.deviceId)
        assertEquals(registration.activeNetwork, after.activeNetwork)
    }
}

/** Native rendering of production components with synthetic state; no Runtime/store is modified. */
@RunWith(AndroidJUnit4::class)
class SendBroadcastComponentsDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()

    @Test fun themesAndEnlargedTextKeepNativeActionsStableAcrossSyntheticStateUpdates() {
        val registration = ObsControlRegistration.parseObject(JSONObject()
            .put("registrationId", "00000000-0000-4000-8000-000000000001").put("revision", 1).put("token", "0".repeat(64))
            .put("endpoints", JSONArray().put(JSONObject().put("network", "lan").put("address", "10.0.0.2").put("port", 3001))))
        fun obs(stream: String = "stopped") = ObsControlUiState(registration = registration,
            network = ObsControlRegistration.Network.LAN,
            remote = ObsRemoteState("synthetic-epoch", 1, "connected", stream, false, null))
        val sending = OutdoorState(active = true, status = "sending", muted = false, inputLost = false,
            peak = 0.35f, statistics = OutdoorStatistics(bitrate = 2_400_000.0))
        val sender = mutableStateOf(sending)
        val remote = mutableStateOf(obs())
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val font = mutableFloatStateOf(1f)
        var requestedActions = 0
        ui.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, font.floatValue)) {
                CasMateTheme(appearance.value) { Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.widthIn(max = 400.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp)) {
                        OutdoorSendSection(sender.value, "合成表示の準備完了", null, true,
                            { requestedActions++ }, { requestedActions++ }, { requestedActions++ }, { requestedActions++ },
                            onRetryAdaptation = {}, onRetryVideo = {})
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        ObsControlActions(remote.value, { requestedActions++ }, { requestedActions++ }, onCancel = {}, onRefresh = {})
                    }
                } }
            }
        }
        val tags = listOf("カメラ・送信操作", "OBS配信操作", "スマホ送信・状態", "OBS配信・状態")
        for (mode in AppearanceMode.entries) for (scale in listOf(1f, 1.5f, 2f)) {
            ui.runOnIdle { appearance.value = mode; font.floatValue = scale; sender.value = sending; remote.value = obs() }
            ui.onNodeWithTag("OBS配信操作").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            val bounds = tags.associateWith { ui.onNodeWithTag(it).getUnclippedBoundsInRoot() }
            ui.runOnIdle { sender.value = OutdoorState(active = true, status = "preparing", inputPreparing = true) }
            ui.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク確認中")
            ui.onNode(hasText("マイク入力未確認", substring = true)).assertDoesNotExist()
            for (tag in tags) assertEquals("$mode/$scale/pending/$tag", bounds[tag], ui.onNodeWithTag(tag).getUnclippedBoundsInRoot())
            if (mode == AppearanceMode.LIGHT && scale == 1f) {
                ui.onNodeWithTag("スマホ送信・状態").performScrollTo()
                val pendingBitmap = ui.onRoot().captureToImage().asAndroidBitmap()
                java.io.File(ui.activity.getExternalFilesDir(null), "send-broadcast-microphone-pending.png")
                    .outputStream().use { pendingBitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                ui.onNodeWithTag("OBS配信操作").performScrollTo()
            }
            val senderStates = listOf(OutdoorState(), OutdoorState(active = true, status = "preparing", inputPreparing = true),
                sending.copy(status = "reconnecting"), sending.copy(status = "actionRequired", error = "CONNECTION_FAILED"))
            val obsStates = listOf(obs("streaming"), obs("starting"), obs("stopping"),
                obs().copy(pending = ObsPrepared("synthetic-confirmation", System.currentTimeMillis() + 10000, "start")),
                obs().copy(working = true), obs("streaming").copy(error = "OBS操作の結果が不明です。".repeat(20)),
                obs().copy(remote = null, error = "接続と操作許可を確認してください。".repeat(20)))
            for (index in 0 until maxOf(senderStates.size, obsStates.size)) {
                ui.runOnIdle { sender.value = senderStates[index % senderStates.size]; remote.value = obsStates[index] }
                for (tag in tags) assertEquals("$mode/$scale/$tag", bounds[tag], ui.onNodeWithTag(tag).getUnclippedBoundsInRoot())
            }
            ui.runOnIdle { sender.value = sending; remote.value = obs("streaming") }
            ui.onNodeWithTag("OBS配信操作").performScrollTo().assertIsDisplayed()
            val bitmap = ui.onRoot().captureToImage().asAndroidBitmap()
            java.io.File(ui.activity.getExternalFilesDir(null), "send-broadcast-synthetic-${mode.storedValue}-$scale.png")
                .outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        assertEquals("Synthetic QA must never request real actions", 0, requestedActions)
    }
}
