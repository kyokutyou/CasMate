package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UnifiedCameraMenuTest {
    @get:Rule val ui = createComposeRule()
    @After fun reset() { OutdoorRuntime.update(OutdoorState()); jp.casmate.app.obs.ObsProgramPreviewRuntime.close() }

    @Test fun obsImageEntryClosesTheSenderMenuAndKeepsTheSenderRunning() {
        val initial = OutdoorState(active = true, status = "sending", videoHidden = true)
        OutdoorRuntime.update(initial)
        show()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithTag("OBS映像確認の入口").performScrollTo().performClick()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.onNodeWithTag("OBS画像・閉じる").assertIsDisplayed()
        ui.onNodeWithTag("OBS画像・更新").assertIsNotEnabled()
        ui.runOnIdle { assertEquals(initial, OutdoorRuntime.state.value) }
        ui.onNodeWithTag("OBS画像・閉じる").performClick()
        ui.onNodeWithTag("OBS画像領域").assertDoesNotExist()
    }

    @Test fun senderOpensWithOneTapBeforeConnectionAndRestoresTheCorrectEntry() {
        val initial = OutdoorState(active = true, status = "sending", videoHidden = true)
        OutdoorRuntime.update(initial)
        show()
        val send = ui.onNodeWithTag("機能操作の入口").fetchSemanticsNode().boundsInRoot
        val connection = ui.onNodeWithContentDescription("スマホ連携").fetchSemanticsNode().boundsInRoot
        val menu = ui.onNodeWithTag("カメラ設定の入口").fetchSemanticsNode().boundsInRoot
        assertTrue(send.right <= connection.left && connection.right <= menu.left)
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("送信・配信").assertIsDisplayed()
        ui.onNodeWithText("送信を停止").assertIsDisplayed()
        ui.onNodeWithTag("カメラ・ミュート").assertDoesNotExist()
        ui.onNodeWithTag("カメラ・映像切替").assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("機能操作の入口").assertIsFocused()
        openMenu()
        ui.onNodeWithTag("映像・マイク分類・送信・配信").assertDoesNotExist()
        ui.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("戻る").assertDoesNotExist()
        ui.onNodeWithTag("映像・マイク分類・カメラ").assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("機能操作の入口").assertIsFocused()
        ui.runOnIdle { assertEquals(initial, OutdoorRuntime.state.value) }
    }

    @Test fun categoriesKeepCameraAndQualityChoicesWhileReturningToTheList() {
        show()
        openMenu()
        category("カメラ")
        ui.onNodeWithText("前面").performScrollTo().performClick()
        ui.onNodeWithTag("カメラ・ミュート").assertDoesNotExist()
        ui.onNodeWithText("戻る").performClick()
        category("送信品質")
        ui.onNodeWithText("縦向き").performScrollTo().performClick()
        ui.onNodeWithText("戻る").performClick()
        category("マイク")
        ui.onNodeWithText("配信マイク音量：", substring = true).performScrollTo().assertExists()
        ui.onNodeWithTag("カメラ・映像切替").assertDoesNotExist()
        ui.onNodeWithText("戻る").performClick()
        category("カメラ")
        ui.onNodeWithText("前面").assertIsSelected()
        ui.onNodeWithText("戻る").performClick()
        category("送信品質")
        ui.onNodeWithText("縦向き").assertIsSelected()
        ui.onNodeWithText("閉じる").performClick()
        openMenu()
        ui.onNodeWithTag("映像・マイク分類・カメラ").assertExists()
        ui.runOnIdle { assertFalse(OutdoorRuntime.state.value.active) }
    }

    @Test fun previewControlsAffectTheExistingCanvasAndDiagnosticsRemainReachable() {
        val initial = OutdoorState(active = true, status = "sending", videoHidden = true)
        OutdoorRuntime.update(initial)
        show()
        openMenu()
        category("画面表示")
        ui.onNodeWithText("プレビューを閉じる").performScrollTo().performClick()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithText("プレビュー非表示").assertIsDisplayed()
        openMenu()
        category("画面表示")
        ui.onNodeWithText("プレビューを表示").performClick()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("外配信プレビュー").assertIsDisplayed()
        openMenu()
        category("通信・診断")
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        listOf("概要", "自動調整", "通信", "履歴").forEach { ui.onNodeWithText(it).assertIsDisplayed() }
        ui.onNodeWithText("診断を閉じる").performClick()
        ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
        ui.runOnIdle { assertEquals(initial, OutdoorRuntime.state.value) }
    }

    @Test fun sendingLocksQualityAndKeepsCameraAndMicrophoneActionsInTheirCategories() {
        val initial = OutdoorState(active = true, status = "sending")
        OutdoorRuntime.update(initial)
        show()
        openMenu()
        category("送信品質")
        ui.onNodeWithText("横向き").assertIsNotEnabled()
        ui.onNodeWithText("縦向き").assertIsNotEnabled()
        ui.onNodeWithText("戻る").performClick()
        category("カメラ")
        ui.onNodeWithText("前面").assertIsEnabled()
        ui.onNodeWithTag("カメラ・映像切替").performScrollTo().assertIsEnabled()
        ui.onNodeWithText("戻る").performClick()
        category("マイク")
        ui.onNodeWithTag("カメラ・ミュート").performScrollTo().assertIsEnabled()
        ui.onNodeWithText("戻る").performClick()
        category("その他")
        ui.onNodeWithText("スマホ連携を開く").assertIsEnabled()
        ui.onNodeWithText("配信者音声認識").assertIsEnabled()
        ui.runOnIdle { assertEquals(initial, OutdoorRuntime.state.value) }
    }

    @Test fun listAndEveryCategoryFitBothThemesAtDoubleTextSize() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        show(mode)
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance }
            openMenu()
            capture("unified-camera-list-$appearance")
            for (name in listOf("カメラ", "マイク", "送信品質", "画面表示", "その他")) {
                category(name)
                ui.onNodeWithText("戻る").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                ui.onNodeWithText("閉じる").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                ui.onNodeWithText("戻る").performClick()
            }
            ui.onNodeWithTag("映像・マイク分類・送信・配信").assertDoesNotExist()
            ui.onNodeWithText("閉じる").performClick()
            ui.onNodeWithTag("機能操作の入口").performClick()
            ui.onNodeWithTag("カメラ・送信操作").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            capture("unified-camera-send-$appearance")
            ui.onNodeWithText("閉じる").performClick()
        }
    }

    private fun openMenu() { ui.onNodeWithTag("カメラ設定の入口").performClick() }
    private fun category(name: String) { ui.onNodeWithTag("映像・マイク分類・$name").performScrollTo().performClick() }
    private fun show(mode: State<AppearanceMode> = mutableStateOf(AppearanceMode.LIGHT)) {
        ui.setContent { CasMateTheme(mode.value) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                val draft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() }
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, {}, onExportDiagnostics = export) })
            }
        } }
    }
    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
