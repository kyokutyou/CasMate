package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.OutdoorSendSection
import jp.casmate.app.outdoor.OutdoorState
import jp.casmate.app.outdoor.OutdoorDrawingRuntime
import org.junit.Assert.*
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ConnectionWarningUiTest {
    @get:Rule val ui = createComposeRule()
    @After fun resetDrawing() {
        OutdoorDrawingRuntime.controller.endSession(OutdoorDrawingRuntime.state.value.sessionId)
    }

    @Test fun onlySendingWarnsWhenPcConnectionIsUnconfirmed() = verifyHeader(1f)
    @Test fun warningAndRecoveryKeepHeaderPositionsAtDoubleText() = verifyHeader(2f)

    @Test fun handwritingSendingUsesTheSameRedWarningAndRecoversWithoutMoving() {
        val controller = OutdoorDrawingRuntime.controller
        val session = controller.beginSession(1280, 720)
        controller.cameraReady(session)
        controller.openMode(session)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val connection = mutableStateOf("LAN・接続待ち")
        var error = Color.Unspecified
        ui.setContent { CasMateTheme(mode.value) {
            val colors = MaterialTheme.colorScheme
            SideEffect { error = colors.error }
            Surface(Modifier.fillMaxSize()) {
                CasMateTabs({ Text("コメント") }, { Text("カメラ") }, connectionLabel = connection.value)
            }
        } }
        val sender = ui.onNodeWithTag("機能操作の入口")
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; connection.value = "LAN・接続待ち" }
            val bounds = sender.fetchSemanticsNode().boundsInRoot
            ui.onNodeWithContentDescription("スマホ連携").assertDoesNotExist()
            ui.onAllNodesWithText("!", useUnmergedTree = true).assertCountEquals(1)
            assertTrue(pixels(sender, error) > 20)
            ui.runOnIdle { connection.value = "LAN・接続済み" }
            ui.onAllNodesWithText("!", useUnmergedTree = true).assertCountEquals(0)
            assertEquals(0, pixels(sender, error))
            assertEquals(bounds, sender.fetchSemanticsNode().boundsInRoot)
        }
    }

    private fun verifyHeader(fontScale: Float) {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val connection = mutableStateOf("LAN・接続待ち")
        val attention = mutableStateOf(false)
        var error = Color.Unspecified
        var primary = Color.Unspecified
        var registrationOpens = 0
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                CasMateTheme(mode.value) {
                    val colors = MaterialTheme.colorScheme
                    SideEffect { error = colors.error; primary = colors.primary }
                    Surface(Modifier.fillMaxSize()) {
                        CasMateTabs({ Text("コメント") }, { Text("カメラ") }, connectionLabel = connection.value,
                            cameraNeedsAttention = attention.value, onOpenConnection = { registrationOpens++ })
                    }
                }
            }
        }
        val sender = ui.onNodeWithTag("機能操作の入口")
        val registration = ui.onNodeWithContentDescription("スマホ連携")
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; connection.value = "LAN・接続待ち"; attention.value = false }
            val senderBounds = sender.fetchSemanticsNode().boundsInRoot
            val registrationBounds = registration.fetchSemanticsNode().boundsInRoot
            sender.performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            ui.onAllNodesWithText("!", useUnmergedTree = true).assertCountEquals(1)
            ui.onNodeWithText("✓", useUnmergedTree = true).assertDoesNotExist()
            assertTrue("The sending icon must use warning ink", pixels(sender, error) > 20)
            assertEquals("The unconfirmed sending icon must not retain normal ink", 0, pixels(sender, primary))
            assertEquals("Registration must not duplicate the red warning", 0, pixels(registration, error))
            sender.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "LAN・接続待ち"))
            ui.runOnIdle { connection.value = "LAN・接続済み" }
            ui.onAllNodesWithText("!", useUnmergedTree = true).assertCountEquals(0)
            ui.onNodeWithText("✓", useUnmergedTree = true).assertExists()
            assertTrue(pixels(sender, primary) > 20)
            assertEquals(0, pixels(sender, error))
            sender.assertIsFocused()
            ui.runOnIdle { attention.value = true }
            ui.onAllNodesWithText("!", useUnmergedTree = true).assertCountEquals(1)
            assertTrue(pixels(sender, error) > 20)
            assertEquals(senderBounds, sender.fetchSemanticsNode().boundsInRoot)
            assertEquals(registrationBounds, registration.fetchSemanticsNode().boundsInRoot)
            sender.assertIsFocused()
        }
        registration.performClick()
        assertEquals(1, registrationOpens)
    }

    @Test fun unconfirmedConnectionUsesRedSummaryAndDetailsWithoutMovingActions() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val unconfirmed = mutableStateOf(true)
        var error = Color.Unspecified
        ui.setContent {
            CasMateTheme(mode.value) {
                val colors = MaterialTheme.colorScheme
                SideEffect { error = colors.error }
                Surface(Modifier.fillMaxSize()) {
                    OutdoorSendSection(OutdoorState(), if (unconfirmed.value) "接続状態未確認。保存済みの映像情報で接続を試せます。" else "映像準備完了。",
                        null, true, {}, {}, {}, {}, connectionUnconfirmed = unconfirmed.value)
                }
            }
        }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; unconfirmed.value = true }
            val action = ui.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot
            assertTrue(pixels(ui.onNodeWithTag("スマホ送信・要約"), error) > 20)
            ui.onNodeWithTag("スマホ送信・詳細").performClick()
            ui.onNode(hasText("PCとの接続状態が未確認です。") and hasAnyAncestor(hasTestTag("スマホ送信・詳細画面"))).assertExists()
            ui.onNodeWithTag("スマホ送信・詳細を閉じる").performClick()
            ui.runOnIdle { unconfirmed.value = false }
            assertEquals(0, pixels(ui.onNodeWithTag("スマホ送信・要約"), error))
            assertEquals(action, ui.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        }
    }

    @Test fun pendingMicrophoneUsesNeutralInkButRealFailuresAndUnconfirmedConnectionsStayRed() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val state = mutableStateOf(OutdoorState(active = true, status = "preparing", inputPreparing = true))
        val unconfirmed = mutableStateOf(false)
        var error = Color.Unspecified
        ui.setContent { CasMateTheme(mode.value) {
            val colors = MaterialTheme.colorScheme
            SideEffect { error = colors.error }
            Surface(Modifier.fillMaxSize()) {
                OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, {}, {}, connectionUnconfirmed = unconfirmed.value)
            }
        } }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; state.value = OutdoorState(active = true, status = "preparing", inputPreparing = true); unconfirmed.value = false }
            val mic = ui.onNodeWithTag("スマホ送信・マイク状態")
            val summary = ui.onNodeWithTag("スマホ送信・要約")
            val action = ui.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot
            mic.assertTextEquals("マイク確認中")
            assertEquals(0, pixels(mic, error))
            assertEquals(0, pixels(summary, error))
            ui.runOnIdle { unconfirmed.value = true }
            assertTrue(pixels(summary, error) > 20)
            assertEquals(0, pixels(mic, error))
            ui.runOnIdle { unconfirmed.value = false; state.value = state.value.copy(error = "INPUT_LOST") }
            mic.assertTextEquals("入力未確認")
            assertTrue(pixels(mic, error) > 20)
            assertTrue(pixels(summary, error) > 20)
            ui.runOnIdle { state.value = OutdoorState(active = true, status = "sending", inputLost = false, muted = false) }
            mic.assertTextEquals("マイク入力あり")
            assertEquals(0, pixels(mic, error))
            assertEquals(action, ui.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        }
    }

    private fun pixels(node: SemanticsNodeInteraction, color: Color): Int {
        val pixels = node.captureToImage().toPixelMap()
        // Thin vectors and small text blend with the background; verify the visible ink's hue.
        val red = color.red > color.green && color.red > color.blue
        var count = 0
        for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
            val pixel = pixels[x, y]
            if (if (red) pixel.red - pixel.green > .04f && pixel.red - pixel.blue > .04f
                else pixel.green - pixel.red > .04f && pixel.green - pixel.blue > .035f) count++
        }
        return count
    }
}
