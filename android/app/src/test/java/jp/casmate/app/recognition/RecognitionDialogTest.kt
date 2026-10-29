package jp.casmate.app.recognition

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.CasMateTheme
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
class RecognitionDialogTest {
    @get:Rule val ui = createComposeRule()
    @Test fun controlsUseSavedStateAndRemainDisabledUntilThePcIsSynchronized() {
        val state = mutableStateOf(RecognitionUiState(remote = RecognitionRemoteState.parse(recognitionState())))
        var toggles = 0; var selections = 0; var closes = 0
        ui.setContent { MaterialTheme { RecognitionDialogContent(state.value, { toggles++ }, { selections++ }, {}, { closes++ }) } }
        ui.onNodeWithText("配信に使う").assertIsDisplayed()
        ui.onNodeWithText("本番利用").assertDoesNotExist()
        val toggle = ui.onNodeWithTag("音声認識本番切替")
        toggle.assertIsOff().performClick(); assertEquals(1, toggles); toggle.assertIsOff()
        ui.onNodeWithTag("音声認識入力・phone").assertIsEnabled().performScrollTo().performClick()
        assertEquals(1, selections)
        ui.runOnIdle { state.value = state.value.copy(working = true) }
        toggle.assertIsNotEnabled(); ui.onNodeWithTag("音声認識入力・phone").assertIsNotEnabled()
        ui.runOnIdle { state.value = RecognitionUiState(error = "PCへ再接続しています") }
        toggle.assertIsNotEnabled(); ui.onNodeWithTag("音声認識再試行").assertIsNotEnabled()
        ui.onNodeWithText("閉じる").performClick(); assertEquals(1, closes)
        assertEquals(1, toggles); assertEquals(1, selections)
    }
    @Test fun waitingAndLongErrorsKeepTheStatusOuterBoundsInBothThemesWithEnlargedText() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val state = mutableStateOf(RecognitionUiState(remote = RecognitionRemoteState.parse(recognitionState(2, true, "smartphone", "waitingForInput"))))
        ui.setContent { CasMateTheme(mode.value) { RecognitionDialogContent(state.value, {}, {}, {}, {}) } }
        ui.onNodeWithTag("音声認識状態").performScrollTo()
        for (appearance in AppearanceMode.entries) {
            ui.onNodeWithTag("音声認識状態").performScrollTo()
            val initial = ui.onNodeWithTag("音声認識状態").getUnclippedBoundsInRoot()
            ui.runOnIdle { mode.value = appearance; state.value = state.value.copy(error = "保存できません。PCとスマホの接続、保存領域と設定を確認してください。".repeat(8)) }
            val updated = ui.onNodeWithTag("音声認識状態").getUnclippedBoundsInRoot()
            assertEquals(initial.top, updated.top); assertEquals(initial.bottom - initial.top, updated.bottom - updated.top)
            ui.onNodeWithTag("音声認識入力・phone").performScrollTo().assertIsSelected().assertIsEnabled()
            ui.onNodeWithText("閉じる").assertIsDisplayed()
        }
    }
}
