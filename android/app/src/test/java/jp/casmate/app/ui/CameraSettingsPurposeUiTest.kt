package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
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
class CameraSettingsPurposeUiTest {
    @get:Rule val ui = createComposeRule()
    private val directionCopy = "スマホを縦・横どちらに持っても、選んだ向きで送信します。はみ出す部分は切り取ります。"

    @After fun reset() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun normalMenuShowsAllSevenPurposesAndCurrentValuesWithoutScrollingInBothThemes() {
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        show(appearance = appearance)
        val names = listOf("カメラ", "マイク", "手書き", "画質と向き", "スマホの表示", "通信と診断", "アプリと連携")
        for (mode in AppearanceMode.entries) {
            ui.runOnIdle { appearance.value = mode }
            openMenu()
            var previousBottom = Float.NEGATIVE_INFINITY
            for (name in names) {
                val node = ui.onNodeWithTag("映像・マイク分類・$name")
                    .assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                val bounds = node.fetchSemanticsNode().boundsInRoot
                assertTrue("Categories retain their reading order: $name", previousBottom <= bounds.top)
                previousBottom = bounds.bottom
            }
            val scroll = ui.onNodeWithTag("機能操作一覧").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
            assertEquals("All seven categories fit without scrolling at normal text size", 0f, scroll.maxValue(), 0f)
            ui.onNodeWithText("背面・1.0×").assertIsDisplayed()
            ui.onNodeWithText("横向き・720p・30fps").assertIsDisplayed()
            ui.onNodeWithText("プレビューON・診断表示OFF").assertIsDisplayed()
            ui.onNodeWithTag("映像・マイク分類・送信・配信").assertDoesNotExist()
            capture("camera-settings-purpose-list-$mode")
            ui.onNodeWithText("閉じる").performClick()
        }
    }

    @Test fun hiddenImageAndTimestampUseIndependentPagesAndReturnThroughCamera() {
        val draft = OutdoorDraft()
        show(draft = draft)
        openMenu(); category("カメラ")
        ui.onNodeWithTag("診断用時刻スイッチ").assertDoesNotExist()
        category("映像を隠したとき")
        ui.onNodeWithText("黒画面").assertIsDisplayed()
        ui.onNodeWithTag("診断用時刻スイッチ").assertDoesNotExist()
        ui.onNodeWithText("戻る").performClick()
        ui.onNodeWithText("前面").assertIsDisplayed()
        category("映像への時刻表示")
        ui.onNodeWithText("OBSの配信・録画にも時刻が表示されます。").assertIsDisplayed()
        ui.onNodeWithTag("診断用時刻スイッチ").assertIsOff().performClick().assertIsOn()
        ui.runOnIdle { assertTrue(draft.timestampOverlay.value) }
        ui.onNodeWithText("戻る").performClick()
        ui.onNodeWithText("前面").assertIsDisplayed()
        ui.onNodeWithTag("映像・マイク分類・マイク").assertDoesNotExist()
        ui.onNodeWithText("戻る").performClick()
        ui.onNodeWithTag("映像・マイク分類・マイク").assertIsDisplayed()
        category("画質と向き")
        ui.onNodeWithText(directionCopy).performScrollTo().assertIsDisplayed()
        ui.runOnIdle { assertFalse(OutdoorRuntime.state.value.active) }
    }

    @Test fun sendingLocksTimestampAndDirectionWithoutLosingTheirExplanations() {
        val sending = OutdoorState(active = true, status = "sending", inputLost = false)
        OutdoorRuntime.update(sending)
        show()
        openMenu(); category("画質と向き")
        ui.onNodeWithText(directionCopy).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("横向き").performScrollTo().assertIsNotEnabled()
        ui.onNodeWithText("縦向き").assertIsNotEnabled()
        ui.onNodeWithText("戻る").performClick()
        category("カメラ"); category("映像への時刻表示")
        ui.onNodeWithTag("診断用時刻スイッチ").assertIsNotEnabled()
        ui.onNodeWithText("変更するには映像送信を停止してください。").assertIsDisplayed()
        ui.onNodeWithText("OBSの配信・録画にも時刻が表示されます。").assertIsDisplayed()
        ui.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
    }

    @Test fun rootCameraSummaryDistinguishesPreparationFaultAndRecoveryWithoutChangingQuality() {
        val preparing = OutdoorState(active = true, status = "preparing", inputLost = false,
            quality = OutdoorQuality(width = 1920, height = 1080))
        OutdoorRuntime.update(preparing)
        show(); openMenu()
        val cases = listOf(
            preparing to "カメラ準備中",
            preparing.copy(videoFaults = setOf(OutdoorVideoFault.CAMERA)) to "カメラの確認が必要",
            preparing.copy(camera = OutdoorCameraState(error = "カメラを利用できません")) to "カメラの確認が必要",
            preparing.copy(videoRecovering = true) to "映像を復旧中",
            preparing.copy(videoChanging = true) to "カメラ切り替え中",
            preparing.copy(status = "sending") to "カメラ未準備",
            preparing.copy(status = "sending", front = true, camera = OutdoorCameraState(ready = true, zoom = 1.4f)) to "前面・1.4×",
        )
        for ((state, summary) in cases) {
            ui.runOnIdle { OutdoorRuntime.update(state) }
            ui.onNodeWithText(summary).assertIsDisplayed()
            ui.onNodeWithText("横向き・1080p・30fps").assertIsDisplayed()
            ui.onNodeWithText("プレビューON・診断表示OFF").assertIsDisplayed()
            ui.runOnIdle { assertEquals(state, OutdoorRuntime.state.value) }
        }
    }

    @Test fun displayUsesFixedLabelsAndSwitchesWithImmediatePreviewState() {
        show(); openMenu(); category("スマホの表示")
        ui.onNodeWithText("スマホに映像を表示").assertIsDisplayed()
        ui.onNodeWithText("診断情報を重ねて表示").assertIsDisplayed()
        ui.onNodeWithTag("プレビュー表示切替").assertIsOn().performClick().assertIsOff()
        ui.onNodeWithTag("診断表示切替").assertIsOff().assertIsNotEnabled()
        ui.onNodeWithTag("プレビュー表示切替").performClick().assertIsOn()
        capture("camera-settings-display-refined")
    }

    @Test fun drawingEntryExplainsPreparationAndHiddenVideoAndOnlyEnablesWhenReady() {
        val controller = OutdoorDrawingRuntime.controller
        val session = controller.beginSession(1280, 720)
        try {
            val ready = OutdoorState(active = true, status = "sending", inputLost = false,
                camera = OutdoorCameraState(ready = true))
            OutdoorRuntime.update(ready.copy(camera = OutdoorCameraState(), status = "preparing"))
            show(); openMenu()
            val entry = ui.onNodeWithTag("映像・マイク分類・手書き")
            entry.assertIsNotEnabled()
            ui.onNodeWithText("準備完了後に利用できます").assertIsDisplayed()
            ui.runOnIdle { OutdoorRuntime.update(ready.copy(videoHidden = true)) }
            entry.assertIsNotEnabled()
            ui.onNodeWithText("カメラに戻すと利用できます").assertIsDisplayed()
            ui.runOnIdle { controller.cameraReady(session); OutdoorRuntime.update(ready) }
            entry.assertIsEnabled()
            for (phase in listOf(OutdoorAdaptationPhase.HELD, OutdoorAdaptationPhase.PROBING)) {
                ui.runOnIdle { OutdoorRuntime.update(ready.copy(adaptation = ready.adaptation.copy(phase = phase))) }
                entry.assertIsEnabled()
            }
            ui.runOnIdle { OutdoorRuntime.update(ready.copy(camera = OutdoorCameraState(), status = "preparing")) }
            category("カメラ")
            ui.onNodeWithText("前面").assertIsNotEnabled()
            ui.onNodeWithText("背面").assertIsNotEnabled()
        } finally { controller.endSession(session) }
    }

    @Test fun microphoneNormalControlsPrecedeRecoveryAndDoNotMoveWhenInputIsLost() {
        val normal = OutdoorState(active = true, status = "sending", inputLost = false)
        OutdoorRuntime.update(normal)
        show(); openMenu(); category("マイク")
        ui.onNodeWithTag("マイク入力再開").assertDoesNotExist()
        val mute = ui.onNodeWithTag("カメラ・ミュート").fetchSemanticsNode().boundsInRoot
        val volume = ui.onNodeWithTag("マイク音量スライダー").fetchSemanticsNode().boundsInRoot
        val input = ui.onNodeWithText("入力マイク").fetchSemanticsNode().boundsInRoot
        assertTrue(mute.bottom <= volume.top)
        assertTrue(volume.bottom <= input.top)
        ui.runOnIdle { OutdoorRuntime.update(normal.copy(inputLost = true, error = "INPUT_LOST")) }
        assertEquals(mute, ui.onNodeWithTag("カメラ・ミュート").fetchSemanticsNode().boundsInRoot)
        assertEquals(volume, ui.onNodeWithTag("マイク音量スライダー").fetchSemanticsNode().boundsInRoot)
        assertEquals(input, ui.onNodeWithText("入力マイク").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("マイク入力再開").assertExists()
        ui.runOnIdle { OutdoorRuntime.update(normal) }
        ui.onNodeWithTag("マイク入力再開").assertIsNotEnabled()
    }

    private fun show(draft: OutdoorDraft = OutdoorDraft(), appearance: State<AppearanceMode> = mutableStateOf(AppearanceMode.LIGHT)) {
        ui.setContent { CasMateTheme(appearance.value) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, {}, onExportDiagnostics = export) })
            }
        } }
    }
    private fun openMenu() { ui.onNodeWithTag("カメラ設定の入口").performClick() }
    private fun category(name: String) { ui.onNodeWithTag("映像・マイク分類・$name").performScrollTo().performClick() }
    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/$name.png")
        checkNotNull(file.parentFile).mkdirs()
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
