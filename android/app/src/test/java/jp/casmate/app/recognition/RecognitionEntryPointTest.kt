package jp.casmate.app.recognition

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.*
import jp.casmate.app.ui.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RecognitionEntryPointTest {
    @get:Rule val ui = createComposeRule()
    @After fun cleanup() { SpeechRecognitionRuntime.stop(); OutdoorRuntime.update(OutdoorState()) }

    @Test fun cameraMenuAndBothSettingsOpenOneDialogWithoutChangingSending() {
        val sending = OutdoorState(active = true, status = "sending")
        OutdoorRuntime.update(sending)
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                val draft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() }
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, {}, onExportDiagnostics = export) },
                    commentsSettingsContent = { close ->
                        val actions = LocalScreenActions.current
                        AlertDialog(onDismissRequest = close, confirmButton = { TextButton(onClick = close) { Text("閉じる") } },
                            text = { TextButton(onClick = actions.openRecognition) { Text("配信者音声認識") } })
                    })
            }
        } }
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
        ui.onNodeWithText("配信者音声認識").performScrollTo().performClick()
        checkDialog(sending)
        ui.onNodeWithTag("カメラ設定の入口").performClick()
        ui.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
        ui.onNodeWithText("配信者音声認識").performScrollTo().performClick()
        checkDialog(sending)
        ui.onNodeWithTag("画面切替・コメント").performClick()
        ui.onNodeWithTag("コメント設定の入口").performClick()
        ui.onNodeWithText("配信者音声認識").performClick()
        checkDialog(sending)
        ui.onNodeWithTag("コメント・読み上げ操作").assertExists()
        ui.onNodeWithTag("機能操作の入口").assertDoesNotExist()
        ui.onNodeWithText("コメント本文").assertIsDisplayed()
    }

    private fun checkDialog(sending: OutdoorState) {
        ui.onNodeWithText("配信者音声認識").assertIsDisplayed()
        ui.onNodeWithTag("音声認識本番切替").assertIsNotEnabled()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithTag("音声認識本番切替").assertDoesNotExist()
    }
}
