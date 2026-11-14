package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.*
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in UI-only checks in the test-manifest Activity; no MainActivity, registration or services. */
class CameraSettingsPurposeDeviceTest {
    @get:Rule val ui = createComposeRule()
    private val directionCopy = "スマホを縦・横どちらに持っても、選んだ向きで送信します。はみ出す部分は切り取ります。"

    @After fun reset() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun purposeListAndIndependentChildPagesRemainUsableInBothThemes() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyPurposeSettings") == "true")
        OutdoorRuntime.update(OutdoorState())
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val draft = OutdoorDraft()
        ui.setContent { CasMateTheme(appearance.value) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, {}, onExportDiagnostics = export,
                    appearanceContent = { AppearanceSettings(appearance.value, { appearance.value = it }) }) })
            }
        } }
        val names = listOf("カメラ", "マイク", "手書き", "画質と向き", "スマホの表示", "通信と診断", "アプリと連携")
        for (mode in AppearanceMode.entries) {
            ui.runOnIdle { appearance.value = mode }
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            var previousBottom = Float.NEGATIVE_INFINITY
            for (name in names) {
                val row = ui.onNodeWithTag("映像・マイク分類・$name").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                val bounds = row.fetchSemanticsNode().boundsInRoot
                assertTrue("Category order: $name", previousBottom <= bounds.top)
                previousBottom = bounds.bottom
            }
            val scroll = ui.onNodeWithTag("機能操作一覧").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
            assertEquals("All seven categories fit in the normal device viewport", 0f, scroll.maxValue(), 0f)
            ui.onNodeWithText("背面・1.0×").assertIsDisplayed()
            ui.onNodeWithText("プレビューON・診断表示OFF").assertIsDisplayed()
            capture("purpose-settings-list-${mode.storedValue}")

            category("画質と向き")
            ui.onNodeWithText(directionCopy).performScrollTo().assertIsDisplayed()
            capture("purpose-settings-quality-${mode.storedValue}")
            ui.onNodeWithTag("フレームレート選択欄").performScrollTo().performClick()
            ui.onNodeWithText("60fps").assertIsDisplayed()
            ui.onAllNodesWithText("24fps").onLast().performClick()
            ui.onNodeWithTag("フレームレート選択欄").assertTextContains("24fps")
            ui.onNodeWithText("回線が不安定なとき").performScrollTo().assertIsDisplayed()
            ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertExists()
            ui.onNodeWithText("戻る").performClick()
            category("カメラ")
            ui.onNodeWithText("撮影を調整").assertIsDisplayed()
            capture("purpose-settings-camera-${mode.storedValue}")
            category("映像を隠したとき")
            ui.onNodeWithText("黒画面").assertIsDisplayed()
            ui.onNodeWithContentDescription("黒画面の見本").assertIsDisplayed()
            capture("purpose-settings-placeholder-${mode.storedValue}")
            ui.onNodeWithTag("診断用時刻スイッチ").assertDoesNotExist()
            ui.onNodeWithText("戻る").performClick()
            ui.onNodeWithText("前面").assertIsDisplayed()
            category("映像への時刻表示")
            ui.onNodeWithTag("診断用時刻スイッチ").assertIsOff().assertIsEnabled()
            ui.onNodeWithText("OBSの配信・録画にも時刻が表示されます。").assertIsDisplayed()
            capture("purpose-settings-clock-${mode.storedValue}")
            ui.onNodeWithText("戻る").performClick()
            ui.onNodeWithText("前面").assertIsDisplayed()
            ui.onNodeWithText("戻る").performClick()
            ui.onNodeWithTag("映像・マイク分類・マイク").assertIsDisplayed()
            category("マイク")
            ui.onNodeWithTag("マイク入力再開").assertDoesNotExist()
            capture("purpose-settings-mic-normal-${mode.storedValue}")
            ui.onNodeWithText("戻る").performClick()
            category("スマホの表示")
            ui.onNodeWithTag("プレビュー表示切替").assertIsOn()
            ui.onNodeWithTag("診断表示切替").assertIsOff().assertIsNotEnabled()
            capture("purpose-settings-display-${mode.storedValue}")
            ui.onNodeWithText("戻る").performClick()
            category("アプリと連携")
            ui.onNodeWithTag("映像・マイク分類・スマホ連携").assertIsDisplayed()
            capture("purpose-settings-app-${mode.storedValue}")
            ui.onNodeWithText("閉じる").performClick()
            ui.runOnIdle { assertFalse(OutdoorRuntime.state.value.active) }
        }
        writeEvidence("purpose-settings-device-result.json", JSONObject()
            .put("themes", "light,dark").put("sevenRowsVisible", true).put("allTargetsAtLeast48dp", true)
            .put("independentChildPages", true).put("directionCopy", directionCopy).put("servicesStarted", false))
    }

    @Test fun microphoneLossCheckingAndRecoveryKeepFollowingDeviceControlsInPlace() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyPurposeSettings") == "true")
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", inputLost = true, error = "INPUT_LOST"))
        var retries = 0
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            val state by OutdoorRuntime.state.collectAsState()
            Surface(Modifier.width(320.dp).height(760.dp)) {
                Column {
                    OutdoorMicrophoneRecovery(state, null) { retries++ }
                    OutdoorSenderControls(state, "準備済み", null, {}, {}, showVideo = false,
                        showStatus = false, showMicrophoneStatus = false)
                    Slider(value = 100f, onValueChange = {}, valueRange = 0f..200f,
                        modifier = Modifier.testTag("マイク音量スライダー"))
                }
            }
        } }
        val tags = listOf("マイク復旧状態", "マイク入力再開", "カメラ・ミュート", "マイク音量スライダー")
        val original = tags.associateWith { ui.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
        ui.onNodeWithTag("マイク入力再開").assertIsEnabled().performClick()
        ui.runOnIdle { assertEquals(1, retries) }
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        ui.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = true, error = "NONE")) }
        ui.onNodeWithTag("マイク入力再開").assertIsNotEnabled()
        for (tag in tags) assertEquals("Checking cannot move $tag", original[tag], ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(inputPreparing = false, inputLost = false)) }
        ui.onNodeWithText("マイク入力を再開しました").assertExists()
        ui.onNodeWithTag("マイク入力再開").assertIsNotEnabled()
        for (tag in tags) assertEquals("Recovery cannot move $tag", original[tag], ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
        capture("purpose-settings-microphone-recovered")
        writeEvidence("purpose-settings-recovery-result.json", JSONObject().put("retryRequests", retries)
            .put("noEarlySuccess", true).put("checkingAndRecoveredBoundsUnchanged", true).put("servicesStarted", false))
    }

    private fun category(name: String) { ui.onNodeWithTag("映像・マイク分類・$name").performScrollTo().performClick() }
    private fun capture(name: String) {
        ui.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.waitForIdle(500, 5_000)
        val bitmap = checkNotNull(automation.takeScreenshot())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.getExternalFilesDir(null), "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun writeEvidence(name: String, evidence: JSONObject) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.getExternalFilesDir(null), name).writeText(evidence.toString(2))
    }
}
