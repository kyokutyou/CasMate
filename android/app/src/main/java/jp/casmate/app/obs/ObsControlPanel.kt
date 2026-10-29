package jp.casmate.app.obs

import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateButton
import jp.casmate.app.ui.SendBroadcastSectionHeading
import jp.casmate.app.ui.rememberControlFocusModifier
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.platform.testTag
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun ObsControlPanel(modifier: Modifier = Modifier, actionsContent: @Composable (actions: @Composable () -> Unit) -> Unit = { it() }) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val state by ObsControlRuntime.state.collectAsStateWithLifecycle()
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    DisposableEffect(context, lifecycleOwner) {
        ObsControlRuntime.initialize(context)
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> ObsControlRuntime.startForegroundSubscription()
                Lifecycle.Event.ON_STOP -> {
                    ObsControlRuntime.cancel()
                    ObsControlRuntime.stopForegroundSubscription()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) ObsControlRuntime.startForegroundSubscription()
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            ObsControlRuntime.cancel()
            ObsControlRuntime.stopForegroundSubscription()
        }
    }
    androidx.compose.runtime.LaunchedEffect(state.pending) {
        while (state.pending != null) {
            clock = System.currentTimeMillis()
            kotlinx.coroutines.delay(250)
        }
    }
    // Subscription and pending confirmation outlive the temporary action menu.
    actionsContent { ObsControlActions(state, { ObsControlRuntime.begin("start") }, { ObsControlRuntime.begin("stop") }, modifier) }
    ObsProgramPreviewDialog()
    state.pending?.let { pending ->
        val remaining = ((pending.expiresAt - clock) / 1000).coerceAtLeast(0)
        val endpoint = state.registration?.endpoint(state.network ?: ObsControlRegistration.Network.LAN)
        val remote = state.remote
        AlertDialog(
            onDismissRequest = { ObsControlRuntime.cancel() },
            title = { Text(if (pending.action == "start") "OBS配信を開始しますか？" else "OBS配信を終了しますか？") },
            text = { Text("PC：${endpoint?.address ?: "不明"}:${endpoint?.port ?: 0}\nOBS：${remote?.connectionLabel() ?: "状態不明"}・${remote?.streamLabel() ?: "状態不明"}\n残り${remaining}秒です。" + if (pending.action == "stop") "\nスマホの映像・音声送信は続きます。" else "\nOBSの映像と音声メーターを確認してください。") },
            confirmButton = { TextButton(enabled = remaining > 0 && !state.working, onClick = { ObsControlRuntime.confirm() }) { Text("実行する") } },
            dismissButton = { TextButton(onClick = { ObsControlRuntime.cancel() }) { Text("キャンセル") } },
        )
    }
}

/** Only presentation changes here: the camera owns the subscription and confirmation flow. */
@Composable
internal fun ObsControlActions(
    state: ObsControlUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    onCancel: () -> Unit = { ObsControlRuntime.cancel() },
    onRefresh: suspend () -> Unit = { ObsControlRuntime.refresh() },
) {
    var detailsOpen by remember { mutableStateOf(false) }
    var restoreDetailsFocus by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshFailure by remember { mutableStateOf<String?>(null) }
    val detailsFocus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    val stop = state.remote?.stream in listOf("streaming", "reconnecting", "stopping")
    val stream = if (state.remote?.connection == "connected") state.remote.streamLabel() else "状態不明"
    val connection = state.remote?.connectionLabel() ?: "状態不明"
    val reason = state.operationReason(refreshing, refreshFailure)
    val executing = state.working && state.pending != null || state.remote?.let { it.busy && it.lastOperation?.status == "executing" } == true
    val enabled = state.registration != null && state.network != null && state.remote?.canPrepare(if (stop) "stop" else "start") == true &&
        !state.working && state.pending == null && !refreshing
    val action = when {
        refreshing -> "OBS状態を取得中…"
        executing -> "OBS操作を実行中…"
        state.working -> "確認を準備中…"
        stop -> "OBS配信を終了"
        else -> "OBS配信を開始"
    }
    androidx.compose.runtime.LaunchedEffect(detailsOpen) {
        if (!detailsOpen && restoreDetailsFocus) {
            withFrameNanos { }
            detailsFocus.requestFocus()
            restoreDetailsFocus = false
        }
    }
    fun closeDetails() { detailsOpen = false; restoreDetailsFocus = true }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val statusStyle = MaterialTheme.typography.bodySmall
        val actionStyle = MaterialTheme.typography.labelLarge
        val fullWidth = with(density) { maxWidth.roundToPx() }.coerceAtLeast(1)
        val buttonWidth = with(density) { (maxWidth - 48.dp).roundToPx() }.coerceAtLeast(1)
        fun textHeight(value: String, width: Int, style: androidx.compose.ui.text.TextStyle) = measurer.measure(value, style,
            constraints = Constraints(maxWidth = width)).size.height
        val connectionHeight = OBS_CONNECTIONS.maxOf { textHeight("OBS接続：$it", fullWidth, statusStyle) }
        val reasonHeight = OBS_OPERATION_REASONS.maxOf { textHeight(it, fullWidth, statusStyle) }
        val actionHeight = OBS_ACTIONS.maxOf { textHeight(it, buttonWidth, actionStyle) }
        val informationHeight = with(density) { (connectionHeight + reasonHeight).toDp() + 4.dp }
        val buttonHeight = with(density) { actionHeight.toDp() + 16.dp }.coerceAtLeast(48.dp)
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SendBroadcastSectionHeading(
                title = "OBS配信", description = "OBSから配信先へ", status = stream, statuses = OBS_STREAMS,
                onDetails = { onCancel(); detailsOpen = true }, detailsTag = "OBS配信・詳細", statusTag = "OBS配信・状態",
                statusColor = if (stream == "状態不明") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.focusRequester(detailsFocus),
            )
            Column(Modifier.fillMaxWidth().height(informationHeight).testTag("OBS配信・接続と理由").semantics {
                stateDescription = "OBS配信：$stream\nOBS接続：$connection\n$reason" +
                    state.error?.let { "\n$it" }.orEmpty() + refreshFailure?.let { "\n$it" }.orEmpty()
            }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("OBS接続：$connection", Modifier.height(with(density) { connectionHeight.toDp() }), style = statusStyle,
                    color = if (state.remote?.connection != "connected") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                Text(reason, Modifier.height(with(density) { reasonHeight.toDp() }), style = statusStyle,
                    color = if (state.error != null || refreshFailure != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            CasMateButton(enabled = enabled, onClick = { if (enabled) { if (stop) onStop() else onStart() } },
                modifier = Modifier.fillMaxWidth().height(buttonHeight).rememberControlFocusModifier(enabled).testTag("OBS配信操作"),
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 8.dp),
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                    containerColor = if (stop) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    contentColor = if (stop) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary,
                )) { Text(action, style = actionStyle) }
        }
    }
    if (detailsOpen) AlertDialog(onDismissRequest = ::closeDetails,
        modifier = Modifier.testTag("OBS配信・詳細画面"), title = { Text("OBS配信の状態") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("OBS接続：$connection\nOBS配信：$stream")
            if (state.registration == null) Text("PCのスマホ連携から共通QRを登録してください。")
            Text(reason)
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (refreshFailure != null && refreshFailure != reason) Text(refreshFailure!!, color = MaterialTheme.colorScheme.error)
            if (state.error != null || refreshFailure != null || state.remote?.connection != "connected" || state.remote.stream == "unknown") {
                val canRefresh = state.registration != null && state.network != null && !state.working && !executing && !refreshing
                TextButton(enabled = canRefresh,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).rememberControlFocusModifier(canRefresh)
                        .testTag("OBS配信・状態再取得"), onClick = {
                    if (canRefresh) {
                        onCancel()
                        refreshFailure = null
                        refreshing = true
                        scope.launch {
                            try { onRefresh() }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { refreshFailure = OBS_REFRESH_FAILED }
                            finally { refreshing = false }
                        }
                    }
                    }) { Text(if (refreshing) "状態を取得中…" else "状態を再取得") }
            }
        } }, confirmButton = { TextButton(onClick = ::closeDetails,
            modifier = Modifier.testTag("OBS配信・詳細を閉じる")) { Text("閉じる") } })
}

private val OBS_STREAMS = listOf("配信停止", "配信中", "開始中", "終了中", "再接続中", "状態不明")
private val OBS_CONNECTIONS = listOf("接続済み", "接続中", "無効", "利用不可", "状態不明")
private val OBS_ACTIONS = listOf("OBS配信を開始", "OBS配信を終了", "確認を準備中…", "OBS操作を実行中…", "OBS状態を取得中…")
private const val OBS_REFRESH_FAILED = "OBS状態を取得できません。詳細から再取得してください。"
private val OBS_OPERATION_REASONS = listOf(
    "共通QRでOBS操作を登録してください。", "スマホ連携で接続経路を選択してください。",
    "OBS接続と操作許可を確認してください。", "OBS接続を待っています。", "PCでOBS連携をオンにしてください。",
    "最新の配信状態を確認できていません。", "確認を準備中です。", "OBS操作を実行中です。",
    "確認画面で実行または取消を選択してください。", "別のOBS操作を処理中です。",
    "OBS配信を開始中です。", "OBS配信を終了中です。", "操作結果は要確認です。詳細を開いてください。",
    "操作の前に確認画面を表示します。", "最新状態を取得中です。", OBS_REFRESH_FAILED,
)

private fun ObsControlUiState.operationReason(refreshing: Boolean, refreshFailure: String?): String = when {
    registration == null -> OBS_OPERATION_REASONS[0]
    network == null -> OBS_OPERATION_REASONS[1]
    refreshing -> "最新状態を取得中です。"
    working && pending != null || remote?.let { it.busy && it.lastOperation?.status == "executing" } == true -> "OBS操作を実行中です。"
    working -> "確認を準備中です。"
    pending != null -> "確認画面で実行または取消を選択してください。"
    refreshFailure != null -> refreshFailure
    remote == null -> "OBS接続と操作許可を確認してください。"
    remote.connection == "connecting" -> "OBS接続を待っています。"
    remote.connection == "disabled" -> "PCでOBS連携をオンにしてください。"
    remote.connection != "connected" -> "OBS接続と操作許可を確認してください。"
    remote.busy -> "別のOBS操作を処理中です。"
    remote.stream == "starting" -> "OBS配信を開始中です。"
    remote.stream == "stopping" -> "OBS配信を終了中です。"
    remote.stream == "unknown" -> "最新の配信状態を確認できていません。"
    error != null -> "操作結果は要確認です。詳細を開いてください。"
    else -> "操作の前に確認画面を表示します。"
}

private fun ObsRemoteState.connectionLabel(): String = when (connection) {
    "connected" -> "接続済み"
    "connecting" -> "接続中"
    "disabled" -> "無効"
    else -> "利用不可"
}

private fun ObsRemoteState.streamLabel(): String = when (stream) {
    "streaming" -> "配信中"
    "starting" -> "開始中"
    "stopping" -> "終了中"
    "reconnecting" -> "再接続中"
    "stopped" -> "配信停止"
    else -> "状態不明"
}

private fun ObsRemoteState.canPrepare(action: String): Boolean = connection == "connected" && !busy &&
    ((action == "start" && stream == "stopped") || (action == "stop" && (stream == "streaming" || stream == "reconnecting")))
