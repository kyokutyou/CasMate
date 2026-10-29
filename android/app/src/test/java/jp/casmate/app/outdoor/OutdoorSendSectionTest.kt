package jp.casmate.app.outdoor

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.focusable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
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
@Config(sdk = [35], qualifiers = "w400dp-h900dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorSendSectionTest {
    @get:Rule val compose = createComposeRule()

    private fun sending() = OutdoorState(active = true, status = "sending", muted = false, inputLost = false,
        statistics = OutdoorStatistics(bitrate = 2_400_000.0))

    @Test fun microphonePreparationIsNotAnInputFailure() {
        val state = mutableStateOf(OutdoorState(active = true, status = "preparing", inputPreparing = true))
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface {
            OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, {}, {})
        } } }
        compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク確認中")
        compose.onNodeWithTag("スマホ送信・要約").assertTextContains("送信準備中", substring = true)
        compose.onNode(hasText("マイク入力未確認", substring = true)).assertDoesNotExist()
        assertTrue(state.value.microphoneChecking)
        assertFalse(state.value.inputNeedsAttention)
        for (pending in listOf(true, false)) {
            compose.runOnIdle { state.value = OutdoorState(active = true, status = "preparing", inputPreparing = pending) }
            compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク確認中")
        }
        compose.runOnIdle { state.value = sending() }
        compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク入力あり")
        compose.runOnIdle { state.value = state.value.copy(inputLost = true, error = "INPUT_LOST", inputPreparing = true) }
        compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("入力未確認")
        assertTrue(state.value.inputNeedsAttention)
        compose.onNodeWithTag("スマホ送信・要約").assertTextContains("マイク入力未確認", substring = true)
    }

    @Test fun sectionKeepsTransportRateAndEffectiveMicrophoneSeparate() {
        val state = mutableStateOf(sending())
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface {
            OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, {}, {})
        } } }
        compose.onNodeWithText("スマホの送信").assertIsDisplayed()
        compose.onNodeWithText("映像・マイクをPCへ").assertIsDisplayed()
        compose.onNodeWithText("送信中").assertIsDisplayed()
        compose.onNodeWithTag("スマホ送信・速度").assertTextEquals("2.40 Mbps")
        compose.onNodeWithTag("スマホ送信・要約").assertTextContains("OBSでの表示は未確認です。", substring = true)
        compose.onNodeWithTag("カメラ・ミュート").assertDoesNotExist()
        for (status in listOf("preparing", "connecting", "reconnecting")) {
            compose.runOnIdle { state.value = sending().copy(status = status) }
            compose.onNodeWithTag("スマホ送信・速度").assertTextEquals("未計測")
            compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク入力あり")
        }
        compose.runOnIdle { state.value = sending().copy(active = false, status = "stopped") }
        compose.onNodeWithTag("スマホ送信・速度").assertTextEquals("—")
        compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals("マイク停止中")
        compose.runOnIdle { state.value = sending().copy(statistics = OutdoorStatistics(), peak = .6f) }
        compose.onNodeWithTag("スマホ送信・速度").assertTextEquals("未計測")
        assertEquals(.6f, compose.onNodeWithTag("スマホ送信・音量メーター").fetchSemanticsNode()
            .config[SemanticsProperties.ProgressBarRangeInfo].current, 0f)
        for ((next, label) in listOf(
            sending().copy(manualMute = true, peak = .9f) to "ミュート中",
            sending().copy(inputLost = true, peak = .9f) to "入力未確認",
            sending().copy(volume = 0, peak = .9f) to "音量0%",
        )) {
            compose.runOnIdle { state.value = next }
            compose.onNodeWithTag("スマホ送信・マイク状態").assertTextEquals(label)
            assertEquals(0f, compose.onNodeWithTag("スマホ送信・音量メーター").fetchSemanticsNode()
                .config[SemanticsProperties.ProgressBarRangeInfo].current, 0f)
        }
    }

    @Test fun errorsAndRecoveryKeepActionBoundsScrollAndFocusInBothThemesAndTextScales() {
        val state = mutableStateOf(sending())
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val width = mutableStateOf(320)
        val scale = mutableStateOf(1f)
        val error = mutableStateOf<String?>(null)
        var currentScroll: androidx.compose.foundation.ScrollState? = null
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
                CasMateTheme(mode.value) { Surface {
                    val scroll = rememberScrollState()
                    SideEffect { currentScroll = scroll }
                    Column(Modifier.width(width.value.dp).height(880.dp).verticalScroll(scroll)) {
                        OutdoorSendSection(state.value, "準備済み", error.value, true, {}, {}, {}, {})
                        Text("次の操作", Modifier.fillMaxWidth().height(48.dp).testTag("後続操作"))
                    }
                } }
            }
        }
        val tags = listOf("スマホ送信・状態", "スマホ送信・状態領域", "スマホ送信・要約", "カメラ・送信操作", "後続操作")
        for (appearance in AppearanceMode.entries) for ((screenWidth, fontScale) in listOf(320 to 1f, 320 to 2f, 400 to 1f, 400 to 2f)) {
            compose.runOnIdle { mode.value = appearance; width.value = screenWidth; scale.value = fontScale; state.value = sending(); error.value = null }
            compose.onNodeWithTag("カメラ・送信操作").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            val bounds = tags.associateWith { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
            val scrollState = checkNotNull(currentScroll)
            val scrollBefore = scrollState.value
            val cases = listOf(
                sending().copy(status = "reconnecting"),
                sending().copy(active = false, status = "stopped"),
                sending().copy(inputLost = true, muted = true, error = "INPUT_LOST"),
                sending().copy(clipping = true),
                sending().copy(videoFaults = setOf(OutdoorVideoFault.CAMERA), videoError = "映像を確認してください。".repeat(50)),
                sending().copy(adaptation = OutdoorAdaptationView(500_000, phase = OutdoorAdaptationPhase.HELD, controlStopped = true)),
            )
            for (next in cases) {
                compose.runOnIdle { state.value = next; error.value = if (next.videoFaults.isNotEmpty()) "権限の長い失敗です。".repeat(50) else null }
                tags.forEach { assertEquals("$appearance/$screenWidth/$fontScale/${next.status}:$it", bounds[it],
                    compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
                assertEquals(scrollBefore, scrollState.value)
                compose.onNodeWithTag("カメラ・送信操作").assertIsFocused().assertHeightIsAtLeast(48.dp)
            }
        }
    }

    @Test fun detailsRetainFullErrorsBothRecoveryActionsAndReturnFocus() {
        var videoRetries = 0
        var adaptationRetries = 0
        val inputError = "マイクと権限を確認してください。".repeat(30)
        val videoError = "映像の故障理由を確認してください。".repeat(30)
        val state = sending().copy(inputLost = true, error = "INPUT_LOST", videoFaults = setOf(OutdoorVideoFault.CODEC), videoError = videoError,
            adaptation = OutdoorAdaptationView(500_000, phase = OutdoorAdaptationPhase.HELD, controlStopped = true))
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface {
            OutdoorSendSection(state, "準備済み", inputError, true, {}, {}, {}, {},
                onRetryAdaptation = { adaptationRetries++ }, onRetryVideo = { videoRetries++ })
        } } }
        compose.onNodeWithTag("スマホ送信・詳細").performClick()
        compose.onNodeWithTag("スマホ送信・詳細画面").assertExists()
        val inDetails = hasAnyAncestor(hasTestTag("スマホ送信・詳細画面"))
        compose.onNode(hasText(inputError) and inDetails).assertExists()
        compose.onNode(hasText(videoError, substring = true) and inDetails).assertExists()
        compose.onNode(hasText("復帰試行は自動制御停止中") and inDetails).assertExists()
        compose.onNode(hasText("自動制御を再試行") and inDetails).performScrollTo().performClick()
        compose.onNode(hasText("映像を再試行") and inDetails).performScrollTo().performClick()
        assertEquals(1, adaptationRetries)
        assertEquals(1, videoRetries)
        compose.onNodeWithTag("スマホ送信・詳細を閉じる").performClick()
        compose.onNodeWithTag("スマホ送信・詳細画面").assertDoesNotExist()
        compose.onNodeWithTag("スマホ送信・詳細").assertIsFocused()
    }

    @Test fun compoundFailuresKeepVideoFirstAndAllReasonsScrollableWithoutMovingActions() {
        val base = sending().copy(inputLost = true, muted = true, error = "INPUT_LOST",
            adaptation = OutdoorAdaptationView(500_000, phase = OutdoorAdaptationPhase.HELD, controlStopped = true))
        val state = mutableStateOf(base)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                CasMateTheme(AppearanceMode.LIGHT) { Surface { Column(Modifier.width(280.dp)) {
                    OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, {}, {})
                    Text("OBS相当の操作", Modifier.height(48.dp).testTag("後続操作"))
                } } }
            }
        }
        val tags = listOf("スマホ送信・要約", "カメラ・送信操作", "後続操作")
        val bounds = tags.associateWith { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
        compose.onNodeWithText("回線悪化のため映像を静止中（カメラ取得は継続）", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("マイク入力未確認・自動制御停止中", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        tags.forEach { assertEquals(bounds[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
        compose.runOnIdle { state.value = base.copy(videoFaults = setOf(OutdoorVideoFault.CODEC), videoError = "エンコーダーを再試行してください。") }
        compose.onNodeWithText("映像の操作が必要", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("マイク入力未確認・自動制御停止中", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("エンコーダーを再試行してください。", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        tags.forEach { assertEquals(bounds[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
    }

    @Test fun drawingControlLabelsReserveTheirMaximumHeightAtEveryWidthAndScale() {
        val state = mutableStateOf(sending())
        val width = mutableStateOf(320)
        val scale = mutableStateOf(1f)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
                CasMateTheme(mode.value) { Surface {
                    Column(Modifier.width(width.value.dp).height(880.dp).padding(20.dp).verticalScroll(rememberScrollState())) {
                        OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, {}, {}, showInputControls = true)
                        Text("OBS相当の操作", Modifier.height(48.dp).testTag("後続操作"))
                    }
                } }
            }
        }
        val tags = listOf("カメラ・ミュート", "カメラ・映像切替", "カメラ・送信操作", "後続操作")
        val cases = listOf(
            sending().copy(manualMute = true, muted = true),
            sending().copy(videoHidden = true),
            sending().copy(videoChanging = true),
            sending().copy(inputLost = true, muted = true, error = "INPUT_LOST"),
            sending().copy(manualMute = true, videoHidden = true, inputLost = true, muted = true),
            sending().copy(active = false, status = "stopped"),
        )
        for (appearance in AppearanceMode.entries) for (screenWidth in listOf(320, 360, 400)) for (fontScale in listOf(1f, 1.5f, 2f)) {
            compose.runOnIdle { mode.value = appearance; width.value = screenWidth; scale.value = fontScale; state.value = sending() }
            val bounds = tags.associateWith { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
            for (next in cases) {
                compose.runOnIdle { state.value = next }
                tags.forEach { assertEquals("$appearance/$screenWidth/$fontScale/${next.manualMute}/${next.videoHidden}/${next.videoChanging}:$it",
                    bounds[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
            }
        }
    }

    @Test fun drawingControlsStayIndependentAndOnlyConfirmedStopInvokesServiceAction() {
        var starts = 0
        var stops = 0
        var mutes = 0
        var videoChanges = 0
        val state = mutableStateOf(sending())
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface {
            OutdoorSendSection(state.value, "準備済み", null, true, { starts++ }, { stops++ }, { mutes++ }, { videoChanges++ },
                showInputControls = true)
        } } }
        compose.onNodeWithTag("カメラ・ミュート").performClick()
        compose.onNodeWithTag("カメラ・映像切替").performClick()
        assertEquals(1, mutes); assertEquals(1, videoChanges)
        assertEquals(0, starts); assertEquals(0, stops)
        compose.onNodeWithTag("カメラ・送信操作").assertTextEquals("送信を停止").performClick()
        compose.onNodeWithText("スマホの映像・マイク音声を止めます。OBS配信・コメント・読み上げは継続します。").assertIsDisplayed()
        compose.onNodeWithText("キャンセル").performClick()
        assertEquals(0, stops)
        compose.onNodeWithTag("カメラ・送信操作").performClick()
        compose.onNodeWithTag("送信停止確認・実行").performClick()
        assertEquals(1, stops)
        compose.runOnIdle { state.value = state.value.copy(active = false, status = "stopped") }
        compose.onNodeWithTag("カメラ・送信操作").assertTextEquals("送信を開始").performClick()
        assertEquals(1, starts)
        compose.onAllNodesWithContentDescription("送信音量メーター").assertCountEquals(1)
    }

    @Test fun cameraAndMicrophoneSettingsKeepTheirExistingControls() {
        var mutes = 0
        var videoChanges = 0
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface { Column {
            OutdoorSenderControls(sending(), "準備済み", null, {}, { videoChanges++ }, showMute = false, showStatus = false)
            OutdoorSenderControls(sending(), "準備済み", null, { mutes++ }, {}, showVideo = false, showStatus = false)
        } } } }
        compose.onAllNodesWithTag("カメラ・ミュート").assertCountEquals(1)
        compose.onAllNodesWithTag("カメラ・映像切替").assertCountEquals(1)
        compose.onNodeWithTag("カメラ・ミュート").performClick()
        compose.onNodeWithTag("カメラ・映像切替").performClick()
        assertEquals(1, mutes); assertEquals(1, videoChanges)
        compose.onAllNodesWithContentDescription("送信音量メーター").assertCountEquals(1)
        compose.onNodeWithTag("カメラ状態").assertDoesNotExist()
        compose.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
        compose.onNodeWithText("スマホの送信").assertDoesNotExist()
    }

    @Test fun disablingFocusedDrawingControlsKeepsFocusAndBlocksCallbacks() {
        val state = mutableStateOf(sending())
        var inputMode: InputModeManager? = null
        var muteCalls = 0
        var videoCalls = 0
        compose.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface {
                OutdoorSendSection(state.value, "準備済み", null, true, {}, {}, { muteCalls++ }, { videoCalls++ },
                    showInputControls = true)
            } }
        }
        for ((tag, disabledState) in listOf(
            "カメラ・ミュート" to sending().copy(active = false, status = "stopped"),
            "カメラ・映像切替" to sending().copy(active = false, status = "stopped"),
            "カメラ・映像切替" to sending().copy(videoChanging = true),
        )) {
            compose.runOnIdle { state.value = sending(); checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
            compose.onNodeWithTag(tag).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            compose.onNodeWithTag(tag).assertIsFocused()
            compose.runOnIdle { state.value = disabledState }
            compose.onNodeWithTag(tag).assertIsNotEnabled().assertIsFocused().performTouchInput { click() }
            compose.onNodeWithTag(tag).performSemanticsAction(SemanticsActions.OnClick) { it() }
            compose.onNodeWithTag(tag).performKeyInput { pressKey(Key.Enter) }
            assertEquals(0, muteCalls)
            assertEquals(0, videoCalls)
            compose.runOnIdle { state.value = sending() }
            compose.onNodeWithTag(tag).assertIsEnabled().assertIsFocused()
        }
    }

    @Test fun initialDisabledControlsRejectAllActionsAndEnabledControlsReceiveKeyboardClicks() {
        val state = mutableStateOf(sending().copy(active = false, status = "stopped"))
        var inputMode: InputModeManager? = null
        var muteCalls = 0
        var videoCalls = 0
        var startCalls = 0
        compose.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface { Column {
                Box(Modifier.size(1.dp).focusable().testTag("試験キー入力"))
                OutdoorSendSection(state.value, "準備済み", null, false, { startCalls++ }, {}, { muteCalls++ }, { videoCalls++ },
                    showInputControls = true)
            } } }
        }
        compose.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        compose.onNodeWithTag("試験キー入力").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        for (tag in listOf("カメラ・ミュート", "カメラ・映像切替", "カメラ・送信操作")) {
            compose.onNodeWithTag(tag).assertIsNotEnabled().assert(isFocused().not()).performTouchInput { click() }
            compose.onNodeWithTag(tag).performSemanticsAction(SemanticsActions.OnClick) { it() }
            compose.onNodeWithTag("試験キー入力").performKeyInput { pressKey(Key.Enter) }
            assertEquals(0, muteCalls)
            assertEquals(0, videoCalls)
            assertEquals(0, startCalls)
        }
        compose.runOnIdle { state.value = sending(); checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        compose.onNodeWithTag("カメラ・ミュート").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("カメラ・ミュート").assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, muteCalls); assertEquals(0, videoCalls)
        compose.onNodeWithTag("カメラ・映像切替").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("カメラ・映像切替").assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, muteCalls); assertEquals(1, videoCalls)
    }

    @Test fun losingStartEligibilityKeepsTheSameActionFocusedAndNeverStartsWhileDisabled() {
        val canStart = mutableStateOf(true)
        var inputMode: InputModeManager? = null
        var startCalls = 0
        compose.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface {
                OutdoorSenderAction(false, canStart.value, { startCalls++ }, {})
            } }
        }
        compose.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        compose.onNodeWithTag("カメラ・送信操作").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("カメラ・送信操作").assertIsFocused()
        val bounds = compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { canStart.value = false }
        compose.onNodeWithTag("カメラ・送信操作").assertIsNotEnabled().assertIsFocused().performTouchInput { click() }
        compose.onNodeWithTag("カメラ・送信操作").performSemanticsAction(SemanticsActions.OnClick) { it() }
        compose.onNodeWithTag("カメラ・送信操作").performKeyInput { pressKey(Key.Enter) }
        assertEquals(0, startCalls)
        assertEquals(bounds, compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { canStart.value = true }
        compose.onNodeWithTag("カメラ・送信操作").assertIsEnabled().assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, startCalls)
        assertEquals(bounds, compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun explicitFocusMovementAfterDisablingAnActionIsNeverOverriddenOnLaterFrames() {
        val canStart = mutableStateOf(true)
        val otherFocus = FocusRequester()
        var inputMode: InputModeManager? = null
        compose.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface { Column {
                OutdoorSenderAction(false, canStart.value, {}, {})
                androidx.compose.material3.Button(onClick = {}, modifier = Modifier.testTag("別の操作")
                    .focusRequester(otherFocus).focusProperties { canFocus = true }) { Text("別の操作") }
            } } }
        }
        compose.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        compose.onNodeWithTag("カメラ・送信操作").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("カメラ・送信操作").assertIsFocused()
        compose.mainClock.autoAdvance = false
        try {
            compose.runOnIdle { canStart.value = false }
            compose.mainClock.advanceTimeByFrame()
            compose.runOnIdle { otherFocus.requestFocus() }
            compose.mainClock.advanceTimeByFrame()
            compose.onNodeWithTag("別の操作").assertIsFocused()
            compose.mainClock.advanceTimeByFrame()
            compose.onNodeWithTag("別の操作").assertIsFocused()
            compose.runOnIdle { canStart.value = true }
            compose.mainClock.advanceTimeByFrame()
            compose.onNodeWithTag("別の操作").assertIsFocused()
        } finally {
            compose.mainClock.autoAdvance = true
        }
    }
}
