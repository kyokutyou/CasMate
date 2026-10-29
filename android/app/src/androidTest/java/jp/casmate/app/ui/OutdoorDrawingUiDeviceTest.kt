package jp.casmate.app.ui

import android.graphics.Bitmap
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in synthetic UI session; starts no camera, microphone or transmission services. */
class OutdoorDrawingUiDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()

    @Test fun drawingToolsAt320DpAndDoubleTextRemainUsableInBothThemes() {
        runDrawingToolScenario(320.dp, landscape = false)
    }

    @Test fun landscapeAtDoubleTextUsesTheWholeBodyForVideo() {
        runDrawingToolScenario(760.dp, landscape = true)
    }

    private fun runDrawingToolScenario(width: Dp, landscape: Boolean) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyDrawingUi") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val original = OutdoorRuntime.state.value
        val controller = OutdoorDrawingRuntime.controller
        val session = controller.beginSession(1280, 720)
        controller.cameraReady(session)
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val originalOrientation = ui.activity.requestedOrientation
        var originalWindowFlags = 0
        try {
            ui.runOnUiThread {
                originalWindowFlags = ui.activity.window.attributes.flags
                ui.activity.setShowWhenLocked(true)
                ui.activity.setTurnScreenOn(true)
                ui.activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                ui.activity.requestedOrientation = if (landscape) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
            ui.waitUntil(5_000) { ui.activity.resources.configuration.orientation ==
                if (landscape) Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT }
            // Orientation may recreate this test-only Activity. Apply flags to its
            // current window; the secure lock remains in place throughout the check.
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(true)
                ui.activity.setTurnScreenOn(true)
                ui.activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            ui.waitUntil(5_000) { ui.activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && ui.activity.hasWindowFocus() }
            OutdoorRuntime.update(OutdoorState(active = true, status = "sending", inputLost = false))
            ui.setContent {
                CasMateTheme(appearance.value) {
                    val density = LocalDensity.current
                    CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                        Surface(Modifier.width(width).fillMaxHeight()) {
                            CasMateTabs({ Text("コメント") }, { export -> OutdoorPanel(onOpenConnection = {}, onExportDiagnostics = export) })
                        }
                    }
                }
            }
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            ui.onNodeWithTag("映像・マイク分類・手書き").performScrollTo().performClick()
            for (mode in AppearanceMode.entries) {
                ui.runOnIdle { appearance.value = mode }
                ui.onNodeWithTag("機能タブ").assertDoesNotExist()
                ui.onNodeWithTag("手書きを閉じる").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                ui.onNodeWithTag("手書きヘッダー").assertDoesNotExist()
                for (tag in listOf("ペン", "消しゴム", "色と太さ", "元に戻す", "全体表示", "全消去")) {
                    ui.onNodeWithTag("手書き・$tag").assertIsDisplayed().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
                }
                val body = ui.onNodeWithTag("手書きモード").fetchSemanticsNode().boundsInRoot
                val canvas = ui.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
                assertEquals(body, canvas)
                ui.onNodeWithTag("手書き・全体表示").performClick()
                ui.runOnIdle { assertEquals(1f, previewView()!!.drawingViewport!!.zoom); assertTrue(previewView()!!.drawingViewport!!.nextFill) }
                ui.onNodeWithTag("手書き・全体表示").performClick()
                var initialViewport: OutdoorDrawingViewport? = null
                ui.runOnIdle { initialViewport = previewView()!!.drawingViewport; assertTrue(initialViewport!!.zoom > 1f); assertFalse(initialViewport!!.nextFill) }
                val before = controller.state.value.draftRevision
                ui.onNodeWithTag("映像表示面").performTouchInput {
                    val a = center - androidx.compose.ui.geometry.Offset(50f, 0f)
                    val b = center + androidx.compose.ui.geometry.Offset(50f, 0f)
                    down(0, a); down(1, b)
                    moveTo(0, a - androidx.compose.ui.geometry.Offset(20f, 0f), delayMillis = 16)
                    moveTo(1, b + androidx.compose.ui.geometry.Offset(40f, 0f), delayMillis = 16)
                    up(1); moveTo(0, center); up(0)
                }
                ui.runOnIdle {
                    assertEquals(before, controller.state.value.draftRevision)
                    assertTrue(previewView()!!.drawingViewport!!.zoom > initialViewport!!.zoom)
                }
                for (color in OutdoorDrawingColor.entries) {
                    ui.onNodeWithTag("手書き・色と太さ").performClick()
                    ui.onNodeWithTag("手書き色・${color.label}").performScrollTo().assertIsDisplayed().performClick()
                }
                for (width in OutdoorDrawingWidth.entries) {
                    ui.onNodeWithTag("手書き・色と太さ").performClick()
                    ui.onNodeWithTag("手書き太さ・${width.label}").performScrollTo().assertIsDisplayed().performClick()
                }
                ui.runOnIdle {
                    assertTrue(controller.beginStroke(session, .2f, .2f))
                    assertTrue(controller.appendStroke(session, .7f, .7f))
                    controller.endStroke(session)
                    controller.acknowledgeOutput(controller.snapshot(false)!!)
                    controller.freezeOutput(session)
                    controller.beginStroke(session, .8f, .2f); controller.endStroke(session)
                }
                ui.onNodeWithContentDescription("配信映像への反映待ち").assertIsDisplayed()
                ui.onNodeWithTag("手書き・全消去").assertIsDisplayed().performClick()
                ui.onNodeWithTag("手書き・元に戻す").performClick()
                capture("$mode-${if (landscape) "landscape" else "320dp"}-2x")
                ui.onNodeWithTag("機能操作の入口").performClick()
                ui.onNodeWithTag("カメラ・送信操作").performScrollTo().assertIsDisplayed()
                ui.onNodeWithTag("カメラ・映像切替").performScrollTo().assertIsDisplayed()
                ui.onNodeWithText("戻る").performClick()
                ui.onNodeWithTag("手書き上部操作").assertIsDisplayed()
                assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            }
            ui.onNodeWithTag("手書きを閉じる").performClick()
            ui.onNodeWithTag("カメラ設定の入口").assertIsDisplayed()
            assertTrue(controller.state.value.hasDrawing)
        } finally {
            controller.endSession(session)
            OutdoorRuntime.update(original)
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(false)
                ui.activity.setTurnScreenOn(false)
                if (originalWindowFlags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0) {
                    ui.activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                ui.activity.requestedOrientation = originalOrientation
            }
        }
    }

    private fun capture(name: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.waitForIdle(500, 5_000)
        val bitmap = checkNotNull(automation.takeScreenshot())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.getExternalFilesDir(null), "android-drawing-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun previewView(): OutdoorPreviewView? {
        fun find(view: android.view.View): OutdoorPreviewView? {
            if (view is OutdoorPreviewView) return view
            if (view is android.view.ViewGroup) for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
            return null
        }
        return find(ui.activity.window.decorView)
    }
}
