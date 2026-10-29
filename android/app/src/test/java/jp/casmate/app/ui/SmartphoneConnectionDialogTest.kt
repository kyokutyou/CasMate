package jp.casmate.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import jp.casmate.app.outdoor.OutdoorPanel
import jp.casmate.app.outdoor.OutdoorState
import jp.casmate.app.outdoor.OutdoorRuntime
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.After
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class SmartphoneConnectionDialogTest {
    @get:Rule val compose = createComposeRule()
    @After fun reset() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun confirmedNoticeLeavesTheReservedSlotAndCanBeReadFromHelpAfterReopening() {
        val update = "登録情報を更新しました。QRの読み直しは不要です。\n退避先：/test/registration.backup"
        var message by mutableStateOf<String?>(update)
        var open by mutableStateOf(true)
        var confirmations = 0
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            if (open) SmartphoneConnectionDialog(null, false, null, null, false, false, message, false,
                {}, {}, {}, updateNoticeDetails = update, onConfirmUpdateNotice = { confirmations++; message = null })
        } }
        val qr = compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("全文を見る").performScrollTo().performClick()
        compose.onNodeWithTag("登録案内の全文を閉じる").performClick()
        compose.runOnIdle { assertEquals(1, confirmations) }
        compose.onNodeWithText(update).assertDoesNotExist()
        assertEquals(qr, compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { open = false }; compose.waitForIdle()
        compose.runOnIdle { open = true }
        compose.onNodeWithTag("登録案内の全文").assertDoesNotExist()
        compose.onNodeWithText(update).assertDoesNotExist()
        compose.onNodeWithText("使い方・注意点").performScrollTo().performClick()
        compose.onNodeWithText("登録情報の更新案内").performScrollTo().performClick()
        compose.onNodeWithTag("登録案内の全文").assertTextContains(update)
        compose.onNodeWithTag("登録案内の全文を閉じる").performClick()
        compose.runOnIdle { message = "PCに接続できませんでした。" }
        compose.onNodeWithText("PCに接続できませんでした。").assertExists()
    }

    @Test fun shortSummaryKeepsDetailsBehindAnExplicitToggleAndClearNeedsConfirmation() {
        var scans = 0
        var clears = 0
        val route = jp.casmate.app.obs.ConnectionNetwork.LAN
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            SmartphoneConnectionDialog("http://192.168.1.2:3000/comments", true, null, route,
                false, false, null, false, { scans++ }, {}, {}, registeredNetworks = setOf(route), onClear = { clears++ })
        } }
        compose.onNodeWithText("PCの「スマホ連携」にあるQRを読み取ります。").assertExists()
        compose.onNodeWithText("LAN").assertIsSelected()
        compose.onNodeWithText("Tailscale").assertIsNotEnabled()
        compose.onNodeWithText("コメント接続先：", substring = true).assertDoesNotExist()
        compose.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").assertDoesNotExist()
        val qr = compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("使い方・注意点").performScrollTo().performClick()
        compose.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").assertExists()
        compose.onNodeWithText("コメント接続先：", substring = true).assertExists()
        compose.onNodeWithText("使い方・注意点").performScrollTo().performClick()
        compose.onNodeWithText("PCのQRを読み取る").performScrollTo()
        assertEquals(qr.size, compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot.size)
        compose.onNodeWithText("PCのQRを読み取る").performClick()
        assertEquals(1, scans)
        compose.onNodeWithText("登録を解除").performClick()
        compose.onNodeWithText("すべての登録を解除しますか？").assertIsDisplayed()
        compose.onNodeWithText("キャンセル").performClick()
        assertEquals(0, clears)
        compose.onNodeWithText("登録を解除").performClick()
        compose.onNodeWithTag("スマホ連携の解除確定").performClick()
        assertEquals(1, clears)
    }

    @Test @Config(sdk = [35], qualifiers = "w320dp-h760dp")
    fun longResultsAndBusySendingStatesKeepControlsAndScrollStableAtDoubleText() {
        var result by mutableStateOf<String?>(null)
        var active by mutableStateOf(false)
        var busy by mutableStateOf(false)
        var callbacks = 0
        var mode by mutableStateOf(jp.casmate.app.data.AppearanceMode.LIGHT)
        compose.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current
            CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, 2f)) {
                CasMateTheme(mode) { SmartphoneConnectionDialog(null, false, null, jp.casmate.app.obs.ConnectionNetwork.LAN,
                    active, busy, result, result != null, { callbacks++ }, { callbacks++ }, {},
                    registeredNetworks = setOf(jp.casmate.app.obs.ConnectionNetwork.LAN), onClear = { callbacks++ }) }
            }
        }
        for (appearance in jp.casmate.app.data.AppearanceMode.entries) {
            compose.runOnIdle { mode = appearance; result = null; active = false; busy = false }
            compose.onNodeWithText("PCのQRを読み取る").performScrollTo()
            val tags = listOf("スマホ連携の操作結果", "スマホ連携のネットワーク", "スマホ連携の登録状態")
            val rects = tags.map { compose.onNodeWithTag(it).getUnclippedBoundsInRoot() }
            val qr = compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot
            val close = compose.onNodeWithText("閉じる").fetchSemanticsNode().boundsInRoot
            val scroll = compose.onNodeWithTag("スマホ連携の登録内容").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange].value()
            compose.runOnIdle { result = "保存できませんでした。保護領域を確認してください。".repeat(50); busy = true }
            assertEquals(rects, tags.map { compose.onNodeWithTag(it).getUnclippedBoundsInRoot() })
            assertEquals(qr, compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot)
            assertEquals(close, compose.onNodeWithText("閉じる").fetchSemanticsNode().boundsInRoot)
            assertEquals(scroll, compose.onNodeWithTag("スマホ連携の登録内容").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange].value())
            compose.onNodeWithText("全文を見る").performScrollTo().assertIsDisplayed().performClick()
            compose.onNodeWithTag("登録案内の全文").assertTextContains(result!!)
            compose.runOnIdle { result = "新しい状態" }
            compose.onNodeWithTag("登録案内の全文").assertTextContains("保存できませんでした。保護領域を確認してください。".repeat(50))
            compose.onNodeWithText("案内の全文").assertIsDisplayed()
            compose.onNodeWithTag("登録案内の全文を閉じる").performClick()
            compose.onNodeWithText("PCのQRを読み取る").assertIsNotEnabled().performClick()
            compose.onNodeWithText("LAN").assertIsSelected().assertIsNotEnabled().performClick()
            compose.onNodeWithText("登録を解除").assertIsNotEnabled().performClick()
            compose.runOnIdle { result = null; busy = false; active = true }
            compose.onNodeWithText("PCのQRを読み取る").assertIsNotEnabled()
            compose.onNodeWithText("LAN").assertIsNotEnabled()
            compose.onNodeWithText("使い方・注意点").performScrollTo().performClick()
            compose.onNodeWithText("閉じる").assertIsDisplayed().assertIsEnabled()
            compose.onNodeWithText("使い方・注意点").performScrollTo().performClick()
            assertEquals(0, callbacks)
        }
    }

    @Test fun preparationAndRevocationProblemsRemainVisibleWithDetailsCollapsed() {
        val text = javaClass.getResource("/smartphone-registration-v12.json")!!.readText()
        val bundle = jp.casmate.app.obs.RegistrationBundle(emptyMap(), null)
            .merge(jp.casmate.app.obs.CasMateRegistration.parse(text).getOrThrow())
        val initial = bundle.profiles.getValue(bundle.activeNetwork!!)
        var profile by mutableStateOf(initial)
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            SmartphoneConnectionDialog(profile.commentsUrl, profile.canStartVideo, profile.obs, bundle.activeNetwork,
                false, false, null, false, {}, {}, {}, profiles = mapOf(bundle.activeNetwork to profile), registeredNetworks = bundle.profiles.keys)
        } }
        for (preparation in listOf("preparing", "error", "ready")) {
            compose.runOnIdle { profile = jp.casmate.app.obs.RegistrationProfile(
                if (preparation == "ready") initial.outdoor else null, initial.obs, initial.commentsUrl,
                update = jp.casmate.app.obs.RegistrationUpdate(initial.update!!.credential, 2, preparation, "ready")) }
            compose.onNodeWithText(when(preparation){"preparing"->"準備中";"error"->"要確認";else->"準備完了"}).assertExists()
            if (preparation == "error") compose.onNodeWithText(profile.videoPreparationLabel(null)).assertExists()
            compose.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").assertDoesNotExist()
        }
        compose.runOnIdle { profile = initial.revoked() }
        compose.onNodeWithText(profile.videoPreparationLabel(null)).assertExists()
        compose.onAllNodesWithText("登録無効").assertCountEquals(3)
        for (state in listOf("saveFailed", "revocationSaveFailed", "pcKey", "rejected")) {
            val display = registrationVideoSummary(initial, state, true)
            org.junit.Assert.assertNotNull(display.warning)
            assertEquals(initial.videoPreparationLabel(state), display.warning)
            assertEquals(if (state.endsWith("SaveFailed") || state == "saveFailed") "保存再試行" else "要確認", display.text)
        }
        assertEquals(RegistrationVideoSummary("未登録", null), registrationVideoSummary(null, "pcKey", false))
        for (preparation in listOf("preparing", "error", "disabled", "ready")) {
            val value = jp.casmate.app.obs.RegistrationProfile(
                if (preparation == "ready") initial.outdoor else null, initial.obs, initial.commentsUrl,
                update = jp.casmate.app.obs.RegistrationUpdate(initial.update!!.credential, 2, preparation, "ready"))
            for (state in listOf("pcKey", "rejected")) {
                val display = registrationVideoSummary(value, state, true)
                assertEquals("要確認", display.text)
                org.junit.Assert.assertTrue(display.warning!!.contains(if (state == "pcKey") "PC確認鍵または証明書" else "PCの接続入口"))
                org.junit.Assert.assertTrue(display.warning.contains("共通QRを確認してください。"))
            }
        }
    }

    @Test @Config(sdk = [35], qualifiers = "w320dp-h640dp")
    fun partialRegistrationBecomesReadyWithoutMovingTheQrActionAtLargeText() {
        val text = javaClass.getResource("/smartphone-registration-v12.json")!!.readText()
        val pending = org.json.JSONObject(text).apply {
            remove("outdoor"); getJSONObject("preparation").put("video", "preparing")
        }
        val initial = jp.casmate.app.obs.RegistrationBundle(emptyMap(), null).merge(jp.casmate.app.obs.CasMateRegistration.parse(pending.toString()).getOrThrow())
        val ready = initial.mergeUpdate(jp.casmate.app.obs.CasMateRegistration.parse(org.json.JSONObject(text).put("updateRevision", 2).toString()).getOrThrow())
        var value by mutableStateOf(initial)
        compose.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current
            CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, 1.5f)) {
                MaterialTheme {
                    SmartphoneConnectionDialog(value.commentsUrl, value.profiles[value.activeNetwork]!!.canStartVideo, value.obs, value.activeNetwork,
                        false, false, null, false, {}, {}, {}, profiles = value.profiles, registeredNetworks = value.profiles.keys)
                }
            }
        }
        compose.onNodeWithText("PCのQRを読み取る").performScrollTo().assertIsDisplayed()
        val before = compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { value = ready }
        assertEquals(before, compose.onNodeWithText("PCのQRを読み取る").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("閉じる").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithText("LAN").performScrollTo().assertIsEnabled()
        val capture = java.io.File("build/reports/layout/smartphone-registration-large-text.png")
        checkNotNull(capture.parentFile).mkdirs()
        capture.outputStream().use { compose.onNodeWithTag("スマホ連携の登録内容").captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }



    @Test fun activeTransmissionAllowsInspectionButPreventsRegistration() {
        compose.setContent { MaterialTheme {
            SmartphoneConnectionDialog("http://192.168.1.2:3000/comments", true, null, null, true, false, null, false, {}, {}, {})
        } }
        compose.onNodeWithText("PCのQRを読み取る").assertIsNotEnabled()
        compose.onNodeWithText("コメント用URLを入力").assertDoesNotExist()
        compose.onNodeWithText("閉じる").assertIsEnabled()
    }

    @Test fun busyRegistrationCannotBeSubmittedAgainButCanBeCancelledByClosing() {
        var closes = 0
        compose.setContent { MaterialTheme {
            SmartphoneConnectionDialog(null, false, null, null, false, true, "PC本人確認済み。登録中です…", false, {}, {}, { closes++ })
        } }
        compose.onNodeWithText("PCのQRを読み取る").assertIsNotEnabled()
        compose.onNodeWithText("閉じる").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, closes) }
        compose.onNodeWithText("PC本人確認済み。登録中です…").assertExists()
    }

    @Test fun bothSavedNetworksShareOneSelectionAndSendingDisablesSwitches() {
        var active by mutableStateOf(false)
        var chosen: jp.casmate.app.obs.ConnectionNetwork? = null
        compose.setContent { MaterialTheme {
            SmartphoneConnectionDialog("http://192.168.1.2:3000/comments", true, null, jp.casmate.app.obs.ConnectionNetwork.LAN,
                active, false, null, false, {}, { chosen = it }, {},
                registeredNetworks = jp.casmate.app.obs.ConnectionNetwork.entries.toSet())
        } }
        compose.onNodeWithText("Tailscale").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(jp.casmate.app.obs.ConnectionNetwork.TAILSCALE, chosen); active = true }
        compose.onNodeWithText("Tailscale").assertIsNotEnabled()
        compose.onNodeWithText("LAN").assertIsNotEnabled()
    }

    @Test fun outdoorSettingsCloseBeforeOpeningSharedRegistrationWithoutStoppingTransmission() {
        val state = OutdoorState(active = true, status = "sending")
        OutdoorRuntime.update(state)
        compose.setContent { MaterialTheme {
            var settings by remember { mutableStateOf(true) }
            var connection by remember { mutableStateOf(false) }
            if (settings) OutdoorPanel(onOpenConnection = { connection = true }, settingsOnly = true, onSettingsClosed = { settings = false })
            if (connection) SmartphoneConnectionDialog(null, false, null, null, state.active, false, null, false, {}, {}, { connection = false })
        } }
        compose.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
        compose.onNodeWithText("スマホ連携を開く").performScrollTo().performClick()
        compose.onNodeWithText("外配信設定").assertDoesNotExist()
        compose.onNodeWithText("PCのQRを読み取る").assertIsDisplayed().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(state, OutdoorRuntime.state.value) }
    }
}
