package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.obs.*
import jp.casmate.app.outdoor.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CompactScreenLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test fun footerFreePagesKeepActionsInTheTopMenuAndRetainConfirmation() = verify(1f)
    @Test fun enlargedTextAndConnectionFailuresKeepTheCanvasAndMenuGeometry() = verify(2f)

    private fun verify(fontScale: Float) {
        org.robolectric.RuntimeEnvironment.setFontScale(fontScale)
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val connection = mutableStateOf("Tailscale・接続済み")
        val audio = mutableStateOf(AudioStatus.WAITING)
        val sender = mutableStateOf(OutdoorState(active = true, status = "sending"))
        val registration = CasMateRegistration.parse(javaClass.classLoader!!.getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
        val obs = mutableStateOf(ObsControlUiState(registration = registration, network = ObsControlRegistration.Network.LAN,
            remote = ObsRemoteState("epoch", 1, "connected", "streaming", false, null)))
        var starts = 0
        var stops = 0
        var senderStops = 0
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
                CasMateTheme(appearance.value) {
                    Surface(Modifier.width(320.dp).height(760.dp), color = MaterialTheme.colorScheme.background) {
                        CasMateTabs(connectionLabel = connection.value,
                            readingActive = audio.value.readingActive, readingRegistered = true,
                            commentsActionStatus = audio.value.label,
                            onToggleReading = { if (audio.value.readingActive) stops++ else starts++ },
                            commentsSettingsContent = { close ->
                                AlertDialog(onDismissRequest = close, title = { Text("コメント設定") },
                                    text = { CommentsReadingStatusDetails(audio.value) },
                                    confirmButton = { TextButton(onClick = close) { Text("閉じる") } })
                            },
                            outdoorContent = {
                                val actions = LocalScreenActions.current
                                OutdoorCameraLayout { Box(Modifier.fillMaxSize()) {
                                    Text("映像プレビュー")
                                    OutdoorPreviewBadges(sender.value, false, null, "準備済み")
                                } }
                                if (actions.open) ScreenActionsDialog("カメラの操作", actions.dismiss) {
                                    OutdoorSenderAction(sender.value.active, true, {}, { senderStops++ })
                                    ObsControlActions(obs.value, {}, {})
                                    OutdoorSenderControls(sender.value, "準備済み", null, {}, {})
                                }
                            }, commentsContent = {
                                Box(Modifier.fillMaxSize()) { Text("コメント本文") }
                            })
                    }
                }
            }
        }
        val header = compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
        val body = compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        assertTrue(header.bottom <= body.top)
        val tags = listOf("画面切替・カメラ", "画面切替・コメント", "機能操作の入口")
        tags.forEach { compose.onNodeWithTag(it).assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp) }
        val camera = compose.onNodeWithTag("画面切替・カメラ").fetchSemanticsNode().boundsInRoot
        val comments = compose.onNodeWithTag("画面切替・コメント").fetchSemanticsNode().boundsInRoot
        val entry = compose.onNodeWithContentDescription("スマホ連携").fetchSemanticsNode().boundsInRoot
        val settings = compose.onNodeWithTag("機能操作の入口").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("カメラ設定の入口").assertWidthIsEqualTo(48.dp).assertHeightIsEqualTo(48.dp)
        val cameraGear = compose.onNodeWithTag("カメラ設定の入口").fetchSemanticsNode().boundsInRoot
        assertTrue(settings.right <= entry.left && entry.right <= cameraGear.left)
        assertTrue(camera.right <= comments.left && comments.right <= settings.left)
        assertEquals(760f, body.bottom)
        compose.onNodeWithTag("カメラ下部操作").assertDoesNotExist()
        compose.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
        if (fontScale == 1f) compose.onNodeWithTag("配信共通操作").assertHeightIsEqualTo(56.dp)
        capture("camera-${fontScale}x-light")
        compose.onNodeWithTag("機能操作の入口").performClick()
        val senderAction = compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot
        if (fontScale == 2f) assertTrue("The modal must use the actual Android font scale", senderAction.height > 48f)
        val obsAction = compose.onNodeWithTag("OBS配信操作").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { connection.value = "直接接続・接続待ち"; obs.value = obs.value.copy(remote = null, error = "通信失敗の詳しい説明".repeat(40)) }
        assertEquals(header, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(body, compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
        assertEquals(senderAction, compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(obsAction, compose.onNodeWithTag("OBS配信操作").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("OBS配信を開始").assertIsNotEnabled()
        compose.onNodeWithTag("OBS配信・詳細").performScrollTo().performClick()
        compose.onNodeWithText("通信失敗の詳しい説明".repeat(40)).assertExists()
        closeDetails()
        compose.onNodeWithTag("カメラ・送信操作").performClick()
        assertEquals(0, senderStops)
        compose.onNodeWithTag("送信停止確認・実行").performClick()
        assertEquals(1, senderStops)
        capture("camera-menu-${fontScale}x")
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithTag("機能操作の入口").assertIsFocused()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithTag("コメント下部操作").assertDoesNotExist()
        compose.onNodeWithTag("コメント・読み上げ操作").assertIsDisplayed().assertIsOn()
        assertEquals(body, compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
        capture("comments-${fontScale}x-light")
        val reading = compose.onNodeWithTag("コメント・読み上げ操作").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("コメント・読み上げ操作").assertWidthIsEqualTo(48.dp).assertHeightIsEqualTo(48.dp)
        compose.onNodeWithTag("コメント設定の入口").assertWidthIsEqualTo(48.dp).assertHeightIsEqualTo(48.dp)
        val gear = compose.onNodeWithTag("コメント設定の入口").fetchSemanticsNode().boundsInRoot
        assertEquals(cameraGear, reading)
        val commentsConnection = compose.onNodeWithContentDescription("スマホ連携").fetchSemanticsNode().boundsInRoot
        assertTrue(comments.right <= commentsConnection.left && commentsConnection.right <= gear.left && gear.right <= reading.left)
        for (status in AudioStatus.entries) {
            compose.runOnIdle { audio.value = status }
            assertEquals(reading, compose.onNodeWithTag("コメント・読み上げ操作").fetchSemanticsNode().boundsInRoot)
            assertEquals(header, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
            assertEquals(body, compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
            if (status.readingActive) compose.onNodeWithTag("コメント・読み上げ操作").assertIsOn()
            else compose.onNodeWithTag("コメント・読み上げ操作").assertIsOff()
        }
        compose.runOnIdle { audio.value = AudioStatus.NETWORK_PERMISSION_REQUIRED }
        compose.onNodeWithTag("コメント設定の入口").performClick()
        compose.onNodeWithText("読み上げの状態：${AudioStatus.NETWORK_PERMISSION_REQUIRED.label}").assertIsDisplayed()
        val details = compose.onNodeWithTag("読み上げ状態の詳細").fetchSemanticsNode().boundsInRoot
        val close = compose.onNodeWithText("閉じる").fetchSemanticsNode().boundsInRoot
        for (status in AudioStatus.entries) {
            compose.runOnIdle { audio.value = status }
            assertEquals(details, compose.onNodeWithTag("読み上げ状態の詳細").fetchSemanticsNode().boundsInRoot)
            assertEquals(close, compose.onNodeWithText("閉じる").fetchSemanticsNode().boundsInRoot)
        }
        closeDetails()
        compose.onNodeWithTag("コメント設定の入口").assertIsFocused()
        compose.onNodeWithTag("コメント・読み上げ操作").performClick()
        assertEquals(1, starts)
        compose.runOnIdle { audio.value = AudioStatus.WAITING; appearance.value = AppearanceMode.DARK }
        compose.onNodeWithTag("コメント・読み上げ操作").performClick()
        assertEquals(1, stops)
        compose.onNodeWithText("コメントの操作").assertDoesNotExist()
        compose.onNodeWithText("コメント設定").assertDoesNotExist()
        assertEquals(reading, compose.onNodeWithTag("コメント・読み上げ操作").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("読み上げを停止しました", substring = true).assertDoesNotExist()
        capture("comments-${fontScale}x-dark")
        compose.onNodeWithTag("機能画面").performTouchInput { swipeRight() }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        assertEquals(1, starts); assertEquals(1, stops); assertEquals(1, senderStops)
    }

    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/android-no-footer-$name.png")
        checkNotNull(file.parentFile).mkdirs()
        file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun closeDetails() {
        val buttons = compose.onAllNodesWithText("閉じる")
        buttons[buttons.fetchSemanticsNodes().lastIndex].performClick()
    }
}
