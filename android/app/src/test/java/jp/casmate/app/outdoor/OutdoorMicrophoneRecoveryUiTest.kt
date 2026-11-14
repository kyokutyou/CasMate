package jp.casmate.app.outdoor

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.CasMateTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorMicrophoneRecoveryUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun retryCheckingAndActualRecoveryKeepFollowingControlsAndFocusInPlace() {
        val state = mutableStateOf(lost())
        var retries = 0
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                Column {
                    OutdoorMicrophoneRecovery(state.value, null) { retries++ }
                    OutdoorSenderControls(state.value, "準備済み", null, {}, {}, showVideo = false, showStatus = false,
                        showMicrophoneStatus = false)
                    Slider(value = 100f, onValueChange = {}, valueRange = 0f..200f,
                        modifier = Modifier.testTag("マイク音量スライダー"))
                }
            }
        } }
        val tags = listOf("マイク復旧状態", "マイク入力再開", "カメラ・ミュート", "マイク音量スライダー")
        val original = tags.associateWith { ui.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
        val retry = ui.onNodeWithTag("マイク入力再開").assertIsEnabled()
        retry.performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        retry.performClick()
        ui.runOnIdle { assertEquals(1, retries) }
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        ui.runOnIdle { state.value = state.value.copy(inputPreparing = true, error = "NONE") }
        retry.assertIsNotEnabled().assertIsFocused()
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        ui.runOnIdle { state.value = state.value.copy(inputPreparing = false, inputLost = false) }
        ui.onNodeWithText("マイク入力を再開しました").assertExists()
        retry.assertIsNotEnabled().assertIsFocused()
        for (tag in tags) assertEquals("Recovery cannot move $tag", original[tag], ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle { state.value = lost() }
        retry.assertIsEnabled()
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        for (tag in tags) assertEquals(original[tag], ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
    }

    @Test fun longFailuresAndDoubleTextSizeRetainTheFixedFootprintAndLeavingClearsRecovery() {
        RuntimeEnvironment.setFontScale(2f)
        val state = mutableStateOf(lost())
        val error = mutableStateOf<String?>(null)
        var mounted by mutableStateOf(true)
        ui.setContent { CasMateTheme(AppearanceMode.DARK) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                Column {
                    if (mounted) OutdoorMicrophoneRecovery(state.value, error.value) {}
                    Slider(value = 100f, onValueChange = {}, valueRange = 0f..200f,
                        modifier = Modifier.testTag("マイク音量スライダー"))
                }
            }
        } }
        val block = ui.onNodeWithTag("マイク復旧状態").fetchSemanticsNode().boundsInRoot
        val slider = ui.onNodeWithTag("マイク音量スライダー").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { error.value = "マイクの接続を確認してください。".repeat(80) }
        assertEquals(block, ui.onNodeWithTag("マイク復旧状態").fetchSemanticsNode().boundsInRoot)
        assertEquals(slider, ui.onNodeWithTag("マイク音量スライダー").fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle { error.value = null; state.value = state.value.copy(inputLost = false, error = "NONE") }
        ui.onNodeWithText("マイク入力を再開しました").assertExists()
        assertEquals(slider, ui.onNodeWithTag("マイク音量スライダー").fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle { mounted = false }
        ui.runOnIdle { mounted = true }
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        ui.onNodeWithTag("マイク入力再開").assertDoesNotExist()
        assertTrue(block.height > ui.onNodeWithTag("マイク復旧状態").fetchSemanticsNode().boundsInRoot.height)
    }

    @Test fun failureReportedOnlyByErrorDuringPreparationIsObservedBeforeRealRecovery() {
        val state = mutableStateOf(OutdoorState(active = true, status = "preparing", inputLost = true, error = "NONE"))
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                OutdoorMicrophoneRecovery(state.value, null) {}
            }
        } }
        ui.onNodeWithTag("マイク入力再開").assertDoesNotExist()
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        // The input and preparation flags stay unchanged; only the failure report changes.
        ui.runOnIdle { state.value = state.value.copy(error = "INPUT_LOST") }
        ui.onNodeWithText("接続を確認し、入力を再開してください。映像送信は続いています。").assertExists()
        ui.onNodeWithText("マイク入力を再開しました").assertDoesNotExist()
        ui.runOnIdle { state.value = state.value.copy(inputLost = false, error = "NONE") }
        ui.onNodeWithText("マイク入力を再開しました").assertExists()
    }

    private fun lost() = OutdoorState(active = true, status = "sending", inputLost = true, error = "INPUT_LOST")
}
