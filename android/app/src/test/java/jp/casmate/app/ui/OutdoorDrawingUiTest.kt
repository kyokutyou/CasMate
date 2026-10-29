package jp.casmate.app.ui

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.ComponentDialog
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorDrawingUiTest {
    @get:Rule val ui = createComposeRule()
    private val controller get() = OutdoorDrawingRuntime.controller

    @After fun reset() {
        controller.endSession(OutdoorDrawingRuntime.state.value.sessionId)
        OutdoorRuntime.update(OutdoorState())
    }

    @Test fun floatingControlsUseTheWholeBodyAndPaletteSelectionsCloseThePanel() {
        startSession(); show(); openDrawing()
        ui.onNodeWithTag("配信共通操作").assertDoesNotExist()
        ui.onNodeWithTag("手書きヘッダー").assertDoesNotExist()
        val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        assertEquals(body, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("手書き編集操作").assertHeightIsEqualTo(56.dp)
        for (tag in listOf("ペン", "消しゴム", "色と太さ", "元に戻す", "全体表示", "全消去")) {
            ui.onNodeWithTag("手書き・$tag").assertIsDisplayed().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        }
        ui.onNodeWithTag("手書き・消しゴム").performClick()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.runOnIdle { assertFalse(previewView()!!.drawingEnabled); assertFalse(previewView()!!.viewportInputEnabled) }
        ui.onNodeWithTag("手書き色・赤").performScrollTo().performClick()
        ui.onNodeWithTag("手書き色太さパネル").assertDoesNotExist()
        ui.onNodeWithTag("手書き・色と太さ").assertIsFocused()
        ui.runOnIdle { assertEquals(OutdoorDrawingTool.PEN, controller.state.value.tool); assertEquals(OutdoorDrawingColor.RED, controller.state.value.color) }
        ui.onNodeWithTag("手書き・消しゴム").performClick()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.onNodeWithTag("手書き太さ・太").performScrollTo().performClick()
        ui.onNodeWithTag("手書き・消しゴム").assertIsSelected()
        ui.onNodeWithTag("手書き色太さパネル").assertDoesNotExist()
    }

    @Test fun aFingerStartingOnAToolCannotBecomeInkOrPinchWithASecondFinger() {
        startSession(); show(); openDrawing()
        val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        val pen = ui.onNodeWithTag("手書き・ペン").fetchSemanticsNode().boundsInRoot.center - body.topLeft
        val center = body.center - body.topLeft
        var initial: OutdoorDrawingViewport? = null
        ui.runOnIdle { initial = previewView()!!.drawingViewport }
        ui.onNodeWithTag("機能画面").performTouchInput {
            down(0, pen); down(1, center); moveTo(1, center + androidx.compose.ui.geometry.Offset(40f, 30f)); up(1); up(0)
        }
        ui.runOnIdle { assertFalse(controller.state.value.hasDrawing); assertEquals(initial, previewView()!!.drawingViewport) }
        ui.onNodeWithTag("機能画面").performTouchInput {
            down(0, center); down(1, pen); moveTo(0, center + androidx.compose.ui.geometry.Offset(40f, 30f)); up(1); up(0)
        }
        ui.runOnIdle { assertFalse(controller.state.value.hasDrawing); assertEquals(initial, previewView()!!.drawingViewport) }
    }

    @Test fun inactiveEntryExplainsWhyItCannotStartDrawing() {
        show()
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・手書き").performScrollTo().assertIsNotEnabled()
        ui.onNodeWithText("映像送信を開始すると利用できます").assertIsDisplayed()
        ui.runOnIdle { assertFalse(OutdoorDrawingRuntime.state.value.modeActive) }
    }

    @Test fun hiddenVideoKeepsTheWholePreviewAndWaitsForCameraBeforeEditingAgain() {
        val session = startSession(); show(); openDrawing()
        var viewport: OutdoorDrawingViewport? = null
        ui.runOnIdle { viewport = previewView()!!.drawingViewport; stroke(session); controller.acknowledgeOutput(controller.snapshot(false)!!) }
        val revision = controller.state.value.draftRevision
        val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { controller.setVideoHidden(session, true); OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = true)) }
        assertEquals(body, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithContentDescription("送信中の黒画面").assertExists()
        ui.onNodeWithTag("手書き・ペン").assertIsNotEnabled()
        ui.onNodeWithTag("手書き・全体表示").assertIsNotEnabled()
        ui.onNodeWithTag("映像表示面").performTouchInput { swipeLeft() }
        ui.runOnIdle { assertEquals(revision, controller.state.value.draftRevision); controller.setVideoHidden(session, false); OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = false)) }
        ui.runOnIdle { assertFalse(previewView()!!.drawingEnabled); assertEquals(viewport, previewView()!!.drawingViewport) }
        ui.runOnIdle { controller.cameraReady(session) }
        ui.runOnIdle { assertTrue(previewView()!!.drawingEnabled); assertEquals(revision, controller.state.value.draftRevision); assertEquals(viewport, previewView()!!.drawingViewport) }
    }

    @Test @Config(qualifiers = "w760dp-h320dp-mdpi")
    fun hiddenPortraitOutputFitsWithoutCroppingInLandscapeDrawingMode() {
        val session = startSession(portrait = true); show(width = 760.dp, height = 320.dp); openDrawing()
        ui.runOnIdle { controller.setVideoHidden(session, true); OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = true, videoBlack = false)) }
        val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        assertEquals(body, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        val image = ui.onNodeWithTag("非表示映像の表示枠").fetchSemanticsNode().boundsInRoot
        assertEquals(body.center, image.center)
        assertEquals(9f / 16f, image.width / image.height, .005f)
        assertTrue(image.width <= body.width && image.height <= body.height)
    }

    @Test fun modeKeepsTheVisiblePreviewAndRestoresDiagnosticsAndHeader() {
        val session = startSession()
        show()
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・画面表示").performScrollTo().performClick()
        ui.onNodeWithTag("診断表示切替").performScrollTo().performClick()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("診断表示要約").assertExists()
        var initial: OutdoorPreviewView? = null
        ui.runOnIdle { initial = previewView() }
        openDrawing()
        ui.onNodeWithTag("機能タブ").assertDoesNotExist()
        ui.onNodeWithTag("診断表示要約").assertDoesNotExist()
        ui.onNodeWithTag("カメラ設定の入口").assertDoesNotExist()
        ui.onNodeWithTag("手書き・ペン").assertIsSelected()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.onNodeWithTag("手書き色・白").assertIsSelected()
        ui.onNodeWithTag("手書き太さ・中").assertIsSelected()
        ui.onNodeWithTag("手書き色太さを閉じる").performClick()
        ui.runOnIdle { assertSame(initial, previewView()); assertTrue(previewView()!!.drawingEnabled) }
        ui.onNodeWithTag("機能画面").performTouchInput { swipeLeft() }
        ui.onNodeWithTag("手書き上部操作").assertIsDisplayed()
        ui.runOnIdle { (activity() as ComponentActivity).onBackPressedDispatcher.onBackPressed() }
        ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        ui.onNodeWithTag("診断表示要約").assertExists()
        ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
        ui.runOnIdle {
            assertSame(initial, previewView())
            assertFalse(OutdoorDrawingRuntime.state.value.modeActive)
            assertEquals(session, OutdoorDrawingRuntime.state.value.sessionId)
            assertTrue(OutdoorRuntime.state.value.active)
        }
    }

    @Test fun hiddenPreviewChoiceAndModeSelectionSurviveRecreation() {
        val session = startSession()
        val restoration = StateRestorationTester(ui)
        restoration.setContent { Content() }
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・画面表示").performScrollTo().performClick()
        ui.onNodeWithText("プレビューを閉じる").performScrollTo().performClick()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithText("プレビュー非表示").assertIsDisplayed()
        openDrawing()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.onNodeWithTag("手書き色・青").performScrollTo().performClick()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.onNodeWithTag("手書き太さ・太").performScrollTo().performClick()
        ui.runOnIdle { stroke(session); controller.acknowledgeOutput(controller.snapshot(false)!!) }
        val revision = controller.state.value.draftRevision
        restoration.emulateSavedInstanceStateRestore()
        ui.onNodeWithTag("手書き上部操作").assertIsDisplayed()
        ui.onNodeWithTag("手書き・色と太さ").performClick()
        ui.onNodeWithTag("手書き色・青").performScrollTo().assertIsSelected()
        ui.onNodeWithTag("手書き太さ・太").assertIsSelected()
        ui.onNodeWithTag("手書き色太さを閉じる").performClick()
        ui.runOnIdle { assertEquals(revision, controller.state.value.draftRevision); assertEquals(session, controller.state.value.sessionId) }
        ui.onNodeWithTag("手書きを閉じる").performClick()
        ui.onNodeWithText("プレビュー非表示").assertIsDisplayed()
        ui.runOnIdle { assertNull(previewView()) }
    }

    @Test fun toolsAndSendingMenuKeepTheirActionsWhileDisablingDrawingBehindTheMenu() {
        val session = startSession()
        show()
        openDrawing()
        ui.onNodeWithTag("手書き・元に戻す").assertIsNotEnabled()
        ui.runOnIdle { stroke(session) }
        ui.onNodeWithTag("手書き・全消去").performClick()
        ui.runOnIdle { assertFalse(controller.state.value.hasDrawing) }
        ui.onNodeWithTag("手書き・元に戻す").performClick()
        ui.runOnIdle { assertTrue(controller.state.value.hasDrawing) }
        ui.onNodeWithTag("手書き・消しゴム").performClick()
        ui.onNodeWithTag("手書き・消しゴム").assertIsSelected()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("送信を停止").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("カメラ・映像切替").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("カメラ・ミュート").performScrollTo().assertIsDisplayed()
        ui.runOnIdle { assertFalse(previewView()!!.drawingEnabled) }
        ui.onNodeWithText("戻る").assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("手書きモード").assertIsDisplayed()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.onNodeWithTag("機能操作の入口").assertIsFocused()
        ui.runOnIdle { assertTrue(previewView()!!.drawingEnabled) }
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.runOnIdle { (ShadowDialog.getLatestDialog() as ComponentDialog).onBackPressedDispatcher.onBackPressed() }
        ui.onNodeWithTag("手書き上部操作").assertExists()
        ui.runOnIdle { assertTrue(controller.state.value.modeActive); assertTrue(OutdoorRuntime.state.value.active) }
    }

    @Test fun pendingAndErrorsFloatWithoutMovingControlsAndModeCloseDoesNotPublishTheDraft() {
        val session = startSession()
        show()
        openDrawing()
        ui.runOnIdle {
            stroke(session); controller.acknowledgeOutput(controller.snapshot(false)!!)
            controller.freezeOutput(session)
        }
        val output = controller.state.value.outputRevision
        val canvas = ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
        val tools = ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("手書き状態欄").assertDoesNotExist()
        ui.runOnIdle { stroke(session, .8f) }
        ui.onNodeWithContentDescription("配信映像への反映待ち").assertIsDisplayed()
        assertEquals(canvas, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        assertEquals(tools, ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("手書きを閉じる").performClick()
        ui.runOnIdle { assertEquals(output, controller.state.value.outputRevision); assertTrue(controller.state.value.pending) }
        openDrawing()
        ui.onNodeWithContentDescription("配信映像への反映待ち").assertIsDisplayed()
        ui.runOnIdle { controller.fail(session, "手書きの更新に失敗しました。最後の正常な線を表示しています。再試行してください。") }
        ui.onNodeWithTag("手書き・再試行").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        ui.onNodeWithTag("手書き・ペン").assertIsNotEnabled()
        assertEquals(canvas, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        assertEquals(tools, ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("手書き・再試行").performClick()
        ui.onNodeWithContentDescription("配信映像への反映待ち").assertIsDisplayed()
        ui.runOnIdle { controller.endSession(session); OutdoorRuntime.update(OutdoorState()) }
        ui.onNodeWithTag("手書きヘッダー").assertDoesNotExist()
        ui.onNodeWithTag("機能タブ").assertExists()
    }

    @Test fun bothThemesAtDoubleTextSizeKeepEveryToolReachable() {
        checkBothThemesAtDoubleTextSize(320.dp)
    }

    @Test @Config(qualifiers = "w400dp-h760dp-mdpi")
    fun fourHundredDpAtDoubleTextSizeKeepsEveryToolReachable() {
        checkBothThemesAtDoubleTextSize(400.dp)
    }

    private fun checkBothThemesAtDoubleTextSize(width: Dp) {
        startSession()
        RuntimeEnvironment.setFontScale(2f)
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        show(appearance, width)
        openDrawing()
        for (mode in AppearanceMode.entries) {
            ui.runOnIdle { appearance.value = mode }
            ui.onNodeWithTag("手書きを閉じる").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            for (label in listOf("ペン", "消しゴム", "元に戻す", "全消去")) {
                ui.onNodeWithTag("手書き・$label").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            }
            for (color in OutdoorDrawingColor.entries) {
                ui.onNodeWithTag("手書き・色と太さ").performClick()
                ui.onNodeWithTag("手書き色・${color.label}").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
            }
            for (width in OutdoorDrawingWidth.entries) {
                ui.onNodeWithTag("手書き・色と太さ").performClick()
                ui.onNodeWithTag("手書き太さ・${width.label}").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
            }
            val canvas = ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
            val viewport = ui.onNodeWithTag("外配信プレビュー").fetchSemanticsNode().boundsInRoot
            assertEquals(viewport.height, canvas.height, 1f)
            assertTrue(canvas.width > 0 && canvas.height > 0)
            capture("android-drawing-$mode-2x")
        }
    }

    @Test fun wholeAndFillAlternateWithoutChangingTheOutputOrPreviewHost() {
        val session = startSession(); show(); openDrawing()
        var initial: OutdoorPreviewView? = null
        var fill: OutdoorDrawingViewport? = null
        ui.runOnIdle { initial = previewView(); fill = initial!!.drawingViewport; assertTrue(fill!!.zoom > 1f) }
        ui.onNodeWithTag("手書き・全体表示").performClick()
        ui.runOnIdle { assertEquals(1f, previewView()!!.drawingViewport!!.zoom); assertTrue(previewView()!!.drawingViewport!!.nextFill) }
        ui.onNodeWithTag("手書き・全体表示").performClick()
        ui.runOnIdle {
            assertEquals(fill, previewView()!!.drawingViewport); assertSame(initial, previewView())
            assertEquals(session, controller.state.value.sessionId)
            assertEquals(OutdoorQuality(), OutdoorRuntime.state.value.quality); assertFalse(controller.state.value.hasDrawing)
        }
    }

    @Test fun pinchPositionAndToggleSequenceSurviveRecreationAndModeCloseButNewSessionStartsAtFill() {
        val session = startSession()
        val restoration = StateRestorationTester(ui)
        restoration.setContent { Content() }; openDrawing()
        ui.onNodeWithTag("手書き・全体表示").performClick()
        ui.onNodeWithTag("映像表示面").performTouchInput {
            val left = center - androidx.compose.ui.geometry.Offset(40f, 0f)
            val right = center + androidx.compose.ui.geometry.Offset(40f, 0f)
            down(0, left); down(1, right)
            moveTo(0, left - androidx.compose.ui.geometry.Offset(60f, 0f), delayMillis = 16)
            moveTo(1, right + androidx.compose.ui.geometry.Offset(100f, 0f), delayMillis = 16)
            up(1); moveTo(0, center); up(0)
        }
        var viewport: OutdoorDrawingViewport? = null
        ui.runOnIdle {
            viewport = previewView()!!.drawingViewport
            assertTrue(viewport!!.panX > 0f); assertTrue(viewport!!.zoom > 1f); assertTrue(viewport!!.nextFill)
            assertFalse(controller.state.value.hasDrawing)
        }
        restoration.emulateSavedInstanceStateRestore()
        ui.runOnIdle { assertEquals(viewport, previewView()!!.drawingViewport) }
        ui.onNodeWithTag("手書きを閉じる").performClick()
        ui.runOnIdle { assertNull(previewView()!!.drawingViewport); assertTrue(previewView()!!.getTransform(android.graphics.Matrix()).isIdentity) }
        openDrawing()
        ui.runOnIdle { assertEquals(viewport, previewView()!!.drawingViewport); assertFalse(controller.state.value.hasDrawing) }
        ui.onNodeWithTag("手書き・全体表示").performClick()
        ui.runOnIdle { assertEquals(0f, previewView()!!.drawingViewport!!.panX); assertFalse(previewView()!!.drawingViewport!!.nextFill) }
        ui.runOnIdle {
            controller.endSession(session)
            val next = controller.beginSession(1280, 720); controller.cameraReady(next); controller.openMode(next)
        }
        ui.runOnIdle { assertTrue(previewView()!!.drawingViewport!!.zoom > 1f); assertEquals(0f, previewView()!!.drawingViewport!!.panX) }
    }

    @Test
    @Config(qualifiers = "w760dp-h320dp-mdpi")
    fun landscapeAtDoubleTextSizeUsesTheWholeBodyAndKeepsEveryActionReachable() {
        val session = startSession()
        RuntimeEnvironment.setFontScale(2f)
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        show(appearance, 760.dp, 320.dp)
        openDrawing()
        var preview: OutdoorPreviewView? = null
        ui.runOnIdle { preview = previewView() }
        for (mode in AppearanceMode.entries) {
            ui.runOnIdle { appearance.value = mode }
            ui.onNodeWithTag("手書きサイドパレット").assertDoesNotExist()
            val body = ui.onNodeWithTag("手書きモード").fetchSemanticsNode().boundsInRoot
            val canvas = ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
            assertEquals(body, canvas)
            val tools = ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot
            val viewport = ui.onNodeWithTag("外配信プレビュー").fetchSemanticsNode().boundsInRoot
            assertEquals(viewport.height, canvas.height, 1f)
            for (label in listOf("ペン", "消しゴム", "元に戻す", "全消去")) {
                ui.onNodeWithTag("手書き・$label").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            }
            for (color in OutdoorDrawingColor.entries) {
                ui.onNodeWithTag("手書き・色と太さ").performClick()
                ui.onNodeWithTag("手書き色・${color.label}").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
            }
            for (width in OutdoorDrawingWidth.entries) {
                ui.onNodeWithTag("手書き・色と太さ").performClick()
                ui.onNodeWithTag("手書き太さ・${width.label}").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
            }
            ui.runOnIdle {
                stroke(session)
                controller.acknowledgeOutput(controller.snapshot(false)!!)
                controller.freezeOutput(session)
                stroke(session, .8f)
            }
            ui.onNodeWithContentDescription("配信映像への反映待ち").assertIsDisplayed()
            assertEquals(canvas, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
            assertEquals(tools, ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot)
            ui.runOnIdle { controller.fail(session, "手書き映像を更新できませんでした。最後の正常な線を表示しています。再試行してください。") }
            ui.onNodeWithTag("手書き・再試行").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            assertEquals(canvas, ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
            assertEquals(tools, ui.onNodeWithTag("手書き編集操作").fetchSemanticsNode().boundsInRoot)
            ui.runOnIdle { assertSame(preview, previewView()) }
            capture("android-drawing-landscape-$mode-2x-error")
            ui.onNodeWithTag("手書き・再試行").performClick()
        }
    }

    private fun startSession(portrait: Boolean = false): Long {
        val session = if (portrait) controller.beginSession(720, 1280) else controller.beginSession(1280, 720)
        controller.cameraReady(session)
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", inputLost = false, portrait = portrait))
        return session
    }
    private fun stroke(session: Long, x: Float = .2f) {
        assertTrue(controller.beginStroke(session, x, .2f))
        assertTrue(controller.appendStroke(session, x, .6f))
        assertTrue(controller.endStroke(session))
    }
    private fun openDrawing() {
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・手書き").performScrollTo().performClick()
        ui.onNodeWithTag("手書きモード").assertIsDisplayed()
    }
    private fun show(appearance: State<AppearanceMode> = mutableStateOf(AppearanceMode.LIGHT), width: Dp = 320.dp, height: Dp = 760.dp) {
        ui.setContent { Content(appearance.value, width, height) }
    }
    @Composable private fun Content(appearance: AppearanceMode = AppearanceMode.LIGHT, width: Dp = 320.dp, height: Dp = 760.dp) {
        CasMateTheme(appearance) {
            Surface(Modifier.width(width).height(height)) {
                val draft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() }
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, {}, onExportDiagnostics = export) })
            }
        }
    }
    private fun activity(): Activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single()
    private fun previewView(): OutdoorPreviewView? {
        fun find(view: View): OutdoorPreviewView? {
            if (view is OutdoorPreviewView) return view
            if (view is ViewGroup) for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
            return null
        }
        return find(activity().window.decorView)
    }
    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
