package jp.casmate.app.obs

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.OutdoorState
import jp.casmate.app.ui.CasMateTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ObsControlActionsTest {
    @get:Rule val ui = createComposeRule()
    private val registration get() = CasMateRegistration.parse(javaClass.classLoader!!
        .getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
    private fun ready(stream: String = "stopped") = ObsControlUiState(registration = registration,
        network = ObsControlRegistration.Network.LAN,
        remote = ObsRemoteState("epoch", 1, "connected", stream, false, null))

    @Test fun operationErrorsKeepLatestStreamStateAndExposeFullDetails() {
        val failure = "OBS操作の結果が不明です。現在の配信状態を確認してください。".repeat(20)
        val state = mutableStateOf(ready("streaming").copy(error = failure))
        var cancelled = 0
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.width(320.dp)) {
            ObsControlActions(state.value, {}, {}, onCancel = { cancelled++ })
        } } }
        ui.onNodeWithTag("OBS配信・状態").assertTextContains("配信中")
        ui.onNodeWithText("OBS接続：接続済み").assertExists()
        ui.onNodeWithText("操作結果は要確認です。詳細を開いてください。").assertExists()
        ui.onNodeWithTag("OBS配信・詳細").performClick()
        assertEquals(1, cancelled)
        ui.onNodeWithText(failure).assertExists()
        ui.onNodeWithTag("OBS配信・詳細を閉じる").performClick()
        ui.onNodeWithTag("OBS配信・詳細").assertIsFocused()
        ui.runOnIdle { state.value = state.value.copy(remote = null) }
        ui.onNodeWithTag("OBS配信・状態").assertTextContains("状態不明")
        ui.onNodeWithTag("OBS配信操作").assertIsNotEnabled()
    }

    @Test fun availabilityReasonsAndProcessingStagesFollowExistingControlState() {
        val state = mutableStateOf(ready())
        var starts = 0; var stops = 0
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.width(320.dp)) {
            ObsControlActions(state.value, { starts++ }, { stops++ }, onCancel = {})
        } } }
        ui.onNodeWithTag("OBS配信操作").assertIsEnabled().performClick()
        assertEquals(1, starts); assertEquals(0, stops)
        val pending = ObsPrepared("confirmation", System.currentTimeMillis() + 10000, "start")
        val blocked = listOf(
            ObsControlUiState() to "共通QRでOBS操作を登録してください。",
            ready().copy(network = null) to "スマホ連携で接続経路を選択してください。",
            ready().copy(remote = null) to "OBS接続と操作許可を確認してください。",
            ready().copy(remote = ready().remote!!.copy(connection = "connecting")) to "OBS接続を待っています。",
            ready().copy(remote = ready().remote!!.copy(connection = "disabled")) to "PCでOBS連携をオンにしてください。",
            ready().copy(remote = ready().remote!!.copy(busy = true)) to "別のOBS操作を処理中です。",
            ready("starting") to "OBS配信を開始中です。",
            ready("stopping") to "OBS配信を終了中です。",
            ready("unknown") to "最新の配信状態を確認できていません。",
            ready().copy(pending = pending) to "確認画面で実行または取消を選択してください。",
            ready().copy(working = true) to "確認を準備中です。",
            ready().copy(pending = pending, working = true) to "OBS操作を実行中です。",
            ready().copy(remote = ready().remote!!.copy(busy = true,
                lastOperation = ObsRemoteOperation("operation", "start", "executing", null))) to "OBS操作を実行中です。",
        )
        for ((value, reason) in blocked) {
            ui.runOnIdle { state.value = value }
            ui.onNodeWithTag("OBS配信操作").assertIsNotEnabled()
            ui.onNodeWithText(reason).assertExists()
        }
        ui.runOnIdle { state.value = ready().copy(working = true) }
        ui.onNodeWithText("確認を準備中…").assertExists()
        ui.runOnIdle { state.value = ready().copy(pending = pending, working = true) }
        ui.onNodeWithText("OBS操作を実行中…").assertExists()
        for (stream in listOf("streaming", "reconnecting")) {
            ui.runOnIdle { state.value = ready(stream) }
            ui.onNodeWithTag("OBS配信操作").assertIsEnabled().assertTextContains("OBS配信を終了").performClick()
        }
        assertEquals(1, starts); assertEquals(2, stops)
    }

    @Test fun focusedActionKeepsKeyboardFocusWhenDisabledAndRejectsCommandsUntilRecovery() {
        val state = mutableStateOf(ready())
        var inputMode: InputModeManager? = null
        var starts = 0; var stops = 0
        ui.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.width(320.dp)) {
                ObsControlActions(state.value, { starts++ }, { stops++ }, onCancel = {})
            } }
        }
        ui.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        ui.onNodeWithTag("OBS配信操作").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        ui.onNodeWithTag("OBS配信操作").assertIsFocused()
        val pending = ObsPrepared("confirmation", System.currentTimeMillis() + 10000, "start")
        val blocked = listOf(ready().copy(working = true), ready().copy(remote = null), ready("starting"), ready("stopping"),
            ready().copy(remote = ready().remote!!.copy(busy = true)), ready().copy(registration = null),
            ready().copy(network = null), ready().copy(pending = pending), ready().copy(pending = pending, working = true))
        for (value in blocked) {
            ui.runOnIdle { state.value = value }
            ui.onNodeWithTag("OBS配信操作").assertIsNotEnabled().assertIsFocused()
                .performSemanticsAction(SemanticsActions.OnClick) { it() }
            ui.onNodeWithTag("OBS配信操作").performKeyInput { pressKey(Key.Enter) }
            ui.onNodeWithTag("OBS配信操作").assertIsFocused()
            assertEquals(0, starts); assertEquals(0, stops)
        }
        ui.runOnIdle { state.value = ready() }
        ui.onNodeWithTag("OBS配信操作").assertIsEnabled().assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, starts); assertEquals(0, stops)
        ui.runOnIdle { state.value = ready("streaming") }
        ui.onNodeWithTag("OBS配信操作").assertIsEnabled().assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, starts); assertEquals(1, stops)
    }

    @Test fun refreshingOnlyReacquiresStateAndRetainsUnknownOperationResult() {
        val unknown = "OBS操作の結果が不明です。現在の配信状態を確認してください。"
        val state = mutableStateOf(ready("streaming").copy(error = unknown))
        val finish = CompletableDeferred<Unit>()
        var refreshed = 0; var cancelled = 0; var actions = 0
        var inputMode: InputModeManager? = null
        ui.setContent {
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.width(320.dp)) {
                ObsControlActions(state.value, { actions++ }, { actions++ }, onCancel = { cancelled++ },
                    onRefresh = { refreshed++; finish.await() })
            } }
        }
        ui.onNodeWithTag("OBS配信・詳細").performClick()
        ui.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsFocused().performKeyInput { pressKey(Key.Enter) }
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsNotEnabled().assertIsFocused()
            .performSemanticsAction(SemanticsActions.OnClick) { it() }
        ui.onNodeWithTag("OBS配信・状態再取得").performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, refreshed); assertEquals(2, cancelled); assertEquals(0, actions)
        ui.runOnIdle { finish.complete(Unit) }
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsEnabled().assertIsFocused()
        ui.onNodeWithText(unknown).assertExists()
        ui.onNodeWithTag("OBS配信・詳細を閉じる").performClick()
        ui.onNodeWithTag("OBS配信・状態").assertTextContains("配信中")
        ui.onNodeWithTag("OBS配信操作").assertTextContains("OBS配信を終了")
        assertEquals(0, actions)
    }

    @Test fun unavailableRegistrationAndProcessingDisableStateRefresh() {
        val state = mutableStateOf(ObsControlUiState(error = "OBS状態を取得できません。"))
        ui.setContent { CasMateTheme(AppearanceMode.DARK) { Surface(Modifier.width(320.dp)) {
            ObsControlActions(state.value, {}, {}, onCancel = {}, onRefresh = {})
        } } }
        ui.onNodeWithTag("OBS配信・詳細").performClick()
        for (value in listOf(ObsControlUiState(error = "取得失敗"), ready().copy(network = null, error = "取得失敗"),
            ready().copy(working = true, error = "取得失敗"),
            ready().copy(pending = ObsPrepared("confirmation", System.currentTimeMillis() + 10000, "start"), working = true, error = "取得失敗"))) {
            ui.runOnIdle { state.value = value }
            ui.onNodeWithTag("OBS配信・状態再取得").assertIsNotEnabled()
        }
        ui.runOnIdle { state.value = ready() }
        ui.onNodeWithTag("OBS配信・状態再取得").assertDoesNotExist()
    }

    @Test fun stateRefreshFailureStaysLocalAndCanBeRetriedWithoutChangingServices() {
        val unknown = "OBS操作の結果が不明です。現在の配信状態を確認してください。"
        val original = ready("streaming").copy(error = unknown)
        val state = mutableStateOf(original)
        val finish = CompletableDeferred<Unit>()
        var attempts = 0; var actions = 0
        val sender = mutableStateOf(OutdoorState(active = true, status = "sending"))
        val originalSender = sender.value
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface(Modifier.width(320.dp)) {
            Column {
                ObsControlActions(state.value, { actions++ }, { actions++ }, onCancel = {}, onRefresh = {
                    attempts++
                    if (attempts == 1) throw IllegalStateException("Private internal failure")
                    finish.await()
                })
                Text("スマホ送信：${sender.value.label}")
            }
        } } }
        ui.onNodeWithTag("OBS配信・詳細").performClick()
        ui.onNodeWithTag("OBS配信・状態再取得").performClick()
        ui.onNode(hasText("OBS状態を取得できません。詳細から再取得してください。") and
            hasAnyAncestor(hasTestTag("OBS配信・詳細画面"))).assertExists()
        ui.onNodeWithText("Private internal failure").assertDoesNotExist()
        ui.onNodeWithText(unknown).assertExists()
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsEnabled()
        assertEquals(original, state.value); assertEquals(0, actions); assertEquals(originalSender, sender.value)
        ui.onNodeWithTag("OBS配信・状態再取得").performClick()
        ui.onNode(hasText("OBS状態を取得できません。詳細から再取得してください。") and
            hasAnyAncestor(hasTestTag("OBS配信・詳細画面"))).assertDoesNotExist()
        ui.onNodeWithText(unknown).assertExists()
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsNotEnabled()
        ui.runOnIdle { finish.complete(Unit) }
        ui.onNodeWithTag("OBS配信・状態再取得").assertIsEnabled()
        assertEquals(2, attempts); assertEquals(original, state.value); assertEquals(0, actions); assertEquals(originalSender, sender.value)
        ui.onNodeWithTag("OBS配信・詳細を閉じる").performClick()
        ui.onNodeWithText("スマホ送信：送信中").assertExists()
    }

    @Test fun everyThemeWidthAndFontScaleKeepStatusActionsScrollAndFocusStable() {
        val state = mutableStateOf(ready())
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val width = mutableIntStateOf(320)
        val scale = mutableFloatStateOf(1f)
        var actualScroll: androidx.compose.foundation.ScrollState? = null
        ui.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, scale.floatValue)) {
                CasMateTheme(mode.value) { Surface(Modifier.width(width.intValue.dp).height(760.dp)) {
                    val scroll = rememberScrollState()
                    SideEffect { actualScroll = scroll }
                    Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
                        Spacer(Modifier.height(40.dp))
                        ObsControlActions(state.value, {}, {}, onCancel = {})
                        Spacer(Modifier.height(800.dp))
                    }
                } }
            }
        }
        val transitions = listOf(ready("streaming"), ready("reconnecting"), ready("starting"), ready("stopping"),
            ready("unknown"), ready().copy(remote = null, error = "OBS失敗の長い説明".repeat(80)),
            ready("streaming").copy(error = "OBS操作の結果が不明です。".repeat(80)),
            ready().copy(working = true),
            ready().copy(pending = ObsPrepared("confirmation", System.currentTimeMillis() + 10000, "start"), working = true),
            ready().copy(remote = ready().remote!!.copy(busy = true)), ObsControlUiState())
        for (appearance in listOf(AppearanceMode.LIGHT, AppearanceMode.DARK))
            for (screenWidth in listOf(320, 360, 400)) for (fontScale in listOf(1f, 1.5f, 2f)) {
                ui.runOnIdle { mode.value = appearance; width.intValue = screenWidth; scale.floatValue = fontScale; state.value = ready() }
                ui.onNodeWithTag("OBS配信・詳細").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
                val tags = listOf("OBS配信・状態", "OBS配信・接続と理由", "OBS配信操作", "OBS配信・詳細")
                val before = tags.associateWith { ui.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
                val scroll = ui.runOnIdle { actualScroll!!.value }
                ui.onNodeWithTag("OBS配信操作").assertHeightIsAtLeast(48.dp)
                ui.onNodeWithTag("OBS配信・詳細").assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
                for (value in transitions) {
                    ui.runOnIdle { state.value = value }
                    for (tag in tags) assertEquals("$appearance/$screenWidth/$fontScale/$tag", before[tag],
                        ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
                    assertEquals(scroll, ui.runOnIdle { actualScroll!!.value })
                    ui.onNodeWithTag("OBS配信・詳細").assertIsFocused()
                }
                ui.onNodeWithTag("OBS配信操作").captureToImage()
            }
    }
}
