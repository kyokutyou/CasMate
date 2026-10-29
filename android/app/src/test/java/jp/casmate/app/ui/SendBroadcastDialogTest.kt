package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.obs.*
import jp.casmate.app.outdoor.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Exercise the production dialog, rather than assembling a second copy of its layout. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SendBroadcastDialogTest {
    @get:Rule val ui = createComposeRule()
    @After fun reset() {
        org.robolectric.RuntimeEnvironment.setFontScale(1f)
        OutdoorDrawingRuntime.controller.endSession(OutdoorDrawingRuntime.state.value.sessionId)
        OutdoorRuntime.update(OutdoorState())
        ObsControlRuntime.applyRegistration(null, null)
        ObsControlRuntime.stopForegroundSubscription()
        ObsProgramPreviewRuntime.close()
    }

    @Test @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun compactDialogRetainsControlsAcrossLiveStateChanges() = verify(320, 1f)

    @Test @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun compactDialogAtLargeTextRetainsControlsAcrossLiveStateChanges() = verify(320, 1.5f)

    @Test @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun compactDialogAtDoubleTextRetainsControlsAcrossLiveStateChanges() = verify(320, 2f)

    @Test @Config(qualifiers = "w360dp-h760dp-mdpi")
    fun mediumDialogRetainsControlsAcrossLiveStateChanges() = verify(360, 1f)

    @Test @Config(qualifiers = "w360dp-h760dp-mdpi")
    fun mediumDialogAtLargeTextRetainsControlsAcrossLiveStateChanges() = verify(360, 1.5f)

    @Test @Config(qualifiers = "w360dp-h760dp-mdpi")
    fun mediumDialogAtDoubleTextRetainsControlsAcrossLiveStateChanges() = verify(360, 2f)

    @Test fun standardDialogRetainsControlsAcrossLiveStateChanges() = verify(400, 1f)
    @Test fun standardDialogAtLargeTextRetainsControlsAcrossLiveStateChanges() = verify(400, 1.5f)
    @Test fun standardDialogAtDoubleTextRetainsControlsAcrossLiveStateChanges() = verify(400, 2f)

    @Test @Config(qualifiers = "w360dp-h760dp-mdpi")
    fun drawingServiceFailureKeepsTheOpenMenusInputControlsAndActionPositions() {
        org.robolectric.RuntimeEnvironment.setFontScale(1.5f)
        val controller = OutdoorDrawingRuntime.controller
        val session = controller.beginSession(1280, 720)
        controller.cameraReady(session)
        controller.openMode(session)
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", inputLost = false))
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.fillMaxSize()) {
                    CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(onOpenConnection = {}, onExportDiagnostics = export) })
                } }
            }
        }
        ui.onNodeWithTag("機能操作の入口").performClick()
        val tags = listOf("カメラ・ミュート", "カメラ・映像切替", "カメラ・送信操作", "OBS配信操作")
        val positions = tags.associateWith { ui.onNodeWithTag(it).getUnclippedBoundsInRoot() }
        val scroll = scrollPosition()
        ui.runOnIdle {
            controller.endSession(session)
            OutdoorRuntime.update(OutdoorState(error = "PERMISSION_REQUIRED"))
        }
        tags.forEach { assertEquals(it, positions[it], ui.onNodeWithTag(it).getUnclippedBoundsInRoot()) }
        assertEquals(scroll, scrollPosition(), 0.1f)
        ui.onNodeWithTag("カメラ・ミュート").assertIsNotEnabled()
        ui.onNodeWithTag("カメラ・映像切替").assertIsNotEnabled()
        ui.onNodeWithText("戻る").assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.onNodeWithTag("映像・マイク分類・カメラ").assertDoesNotExist()
    }

    private fun verify(width: Int, fontScale: Float) {
        // Android dialogs obtain their density from the window, independently of the outer provider.
        org.robolectric.RuntimeEnvironment.setFontScale(fontScale)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val registration = CasMateRegistration.parse(javaClass.classLoader!!
            .getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
        fun remote(stream: String = "stopped", busy: Boolean = false) = ObsRemoteState("epoch", 1, "connected", stream, busy, null)
        val sending = OutdoorState(active = true, status = "sending", inputLost = false, statistics = OutdoorStatistics(bitrate = 2_400_000.0))
        OutdoorRuntime.update(sending)
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                CasMateTheme(mode.value) { Surface(Modifier.fillMaxSize()) {
                    CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(onOpenConnection = {}, onExportDiagnostics = export) })
                } }
            }
        }
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithText("戻る").assertDoesNotExist()
        ui.runOnIdle {
            ObsControlRuntime.applyRegistration(registration, ObsControlRegistration.Network.LAN)
            ObsControlRuntime.observeRemote(remote(), null)
        }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; OutdoorRuntime.update(sending); ObsControlRuntime.observeRemote(remote(), null) }
            val actionTags = listOf("スマホ送信・詳細", "カメラ・送信操作", "OBS配信・詳細", "OBS配信操作", "OBS映像確認の入口")
            actionTags.forEach { ui.onNodeWithTag(it).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp) }
            if (fontScale == 2f) assertTrue("The production dialog must use the actual Android text scale",
                ui.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot.height > 48f)
            ui.onNodeWithTag("スマホ送信・詳細").performScrollTo().performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            val positions = actionTags.associateWith { ui.onNodeWithTag(it).getUnclippedBoundsInRoot() }
            val scroll = scrollPosition()
            val variants = listOf(
                sending.copy(status = "preparing"), sending.copy(status = "reconnecting", inputLost = true),
                sending.copy(videoHidden = true, manualMute = true), sending.copy(videoFaults = setOf(OutdoorVideoFault.CAMERA)),
                sending.copy(detail = "送信の長い失敗理由です。".repeat(50), error = "CONNECTION_FAILED"), OutdoorState(),
            )
            val obsStates = listOf(remote("streaming"), remote("starting"), remote("stopping"), remote(busy = true), null, remote("unknown"))
            for (index in variants.indices) {
                ui.runOnIdle {
                    OutdoorRuntime.update(variants[index])
                    ObsControlRuntime.observeRemote(obsStates[index], if (obsStates[index] == null) "OBS接続の長い失敗です。".repeat(50) else null)
                }
                actionTags.forEach { assertEquals("$width/$fontScale/$appearance/$index/$it", positions[it], ui.onNodeWithTag(it).getUnclippedBoundsInRoot()) }
                assertEquals(scroll, scrollPosition(), 0.1f)
                ui.onNodeWithTag("スマホ送信・詳細").assertIsFocused()
                if (obsStates[index]?.stream in listOf("starting", "stopping", "unknown") || obsStates[index]?.busy == true || obsStates[index] == null) {
                    ui.onNodeWithTag("OBS配信操作").assertIsNotEnabled()
                }
            }
            ui.runOnIdle { OutdoorRuntime.update(sending); ObsControlRuntime.observeRemote(remote("streaming"), null) }
            ui.onNodeWithTag("OBS配信・状態").assertTextContains("配信中")
            ui.onNodeWithTag("カメラ・送信操作").assertTextContains("送信を停止")
            ui.onNodeWithTag("スマホ送信・詳細").performScrollTo().performClick()
            ui.onNodeWithTag("スマホ送信・詳細画面").assertExists()
            ui.onNodeWithTag("スマホ送信・詳細を閉じる").performClick()
            ui.onNodeWithTag("スマホ送信・詳細").assertIsFocused()
            ui.onNodeWithTag("OBS配信・詳細").performScrollTo().performClick()
            ui.onNodeWithText("OBS配信の状態").assertExists()
            ui.onNodeWithTag("OBS配信・詳細を閉じる").performClick()
            ui.onNodeWithTag("OBS配信・詳細").assertIsFocused()
            ui.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
            ui.onNodeWithTag("スマホ送信・詳細").performScrollTo()
            capture("send-broadcast-$width-${fontScale}x-$appearance")
        }
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("機能操作の入口").assertIsFocused()
        ui.onNodeWithTag("画面切替・コメント").performClick()
        ui.onNodeWithText("コメント本文").assertIsDisplayed()
        ui.onNodeWithTag("画面切替・カメラ").performClick()
        ui.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
    }

    private fun scrollPosition() = ui.onNodeWithTag("機能操作一覧").fetchSemanticsNode()
        .config[SemanticsProperties.VerticalScrollAxisRange].value()

    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
