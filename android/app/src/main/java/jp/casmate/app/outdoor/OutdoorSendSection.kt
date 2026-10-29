package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.SendBroadcastSectionHeading
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

private val sendStatuses = listOf("停止中", "準備中", "接続中", "送信中", "再接続中", "要確認")
private val microphoneStatuses = listOf("マイク停止中", "ミュート中", "マイク確認中", "入力未確認", "音量0%", "音割れ警告", "マイク入力あり")

/** The short status describes transport; input and video failures retain their own reasons. */
private fun OutdoorState.sendStatus(errorMessage: String?): String = when {
    status == "actionRequired" || !active && (errorMessage != null || error != "NONE") -> "要確認"
    !active -> "停止中"
    status == "preparing" -> "準備中"
    status == "connecting" -> "接続中"
    status == "reconnecting" -> "再接続中"
    status == "sending" -> "送信中"
    else -> "要確認"
}

private fun OutdoorState.sendSummary(preparation: String, errorMessage: String?, connectionUnconfirmed: Boolean): String {
    if (!active) return if (errorMessage != null || error != "NONE")
        "送信を開始できません。詳細で理由を確認してください。" else preparation
    val attention = buildList {
        if (connectionUnconfirmed) add("PC接続未確認")
        if (errorMessage != null || error !in setOf("NONE", "INPUT_LOST") && status != "reconnecting") add("送信に要確認")
        if (inputNeedsAttention) add("マイク入力未確認")
        if (clipping) add("音割れ警告")
        if (adaptation.controlStopped) add("自動制御停止中")
        if (warning.isNotEmpty()) add("端末状態に要確認")
    }
    return listOfNotNull(videoStatusText(), attention.takeIf { it.isNotEmpty() }?.joinToString("・"),
        "OBSでの表示は未確認です。".takeIf { attention.isEmpty() }).distinct().joinToString("\n")
}

/** Presentation only: the owner supplies the same service actions used before the redesign. */
@Composable
internal fun OutdoorSendSection(
    state: OutdoorState,
    preparation: String,
    error: String?,
    canStart: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleVideo: () -> Unit,
    showInputControls: Boolean = false,
    onRetryAdaptation: () -> Unit = { OutdoorRuntime.service?.retryAdaptation() },
    onRetryVideo: () -> Unit = { OutdoorRuntime.service?.retryVideo() },
    connectionUnconfirmed: Boolean = false,
) {
    var detailsOpen by remember { mutableStateOf(false) }
    var restoreDetailsFocus by remember { mutableStateOf(false) }
    val detailsFocus = remember { FocusRequester() }
    val shortStatus = state.sendStatus(error)
    val attention = connectionUnconfirmed || error != null || state.error != "NONE" && state.status != "reconnecting" ||
        (state.inputNeedsAttention || state.active && (state.clipping || state.videoFault.isNotEmpty() || state.adaptation.controlStopped || state.warning.isNotEmpty()))
    val closeDetails = { detailsOpen = false; restoreDetailsFocus = true }
    LaunchedEffect(detailsOpen, restoreDetailsFocus) {
        if (!detailsOpen && restoreDetailsFocus) {
            withFrameNanos {}
            detailsFocus.requestFocus()
            restoreDetailsFocus = false
        }
    }
    Column(Modifier.fillMaxWidth().testTag("スマホ送信区画"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SendBroadcastSectionHeading(
            title = "スマホの送信", description = "映像・マイクをPCへ", status = shortStatus,
            statuses = sendStatuses, onDetails = { jp.casmate.app.obs.ObsControlRuntime.cancel(); detailsOpen = true },
            detailsTag = "スマホ送信・詳細", statusTag = "スマホ送信・状態",
            statusColor = when {
                shortStatus == "要確認" -> MaterialTheme.colorScheme.error
                state.active -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }, modifier = Modifier.focusRequester(detailsFocus),
        )
        BoxWithConstraints(Modifier.fillMaxWidth().testTag("スマホ送信・状態領域")) {
            val density = LocalDensity.current
            val measurer = rememberTextMeasurer()
            val style = MaterialTheme.typography.bodySmall
            val width = with(density) { maxWidth.roundToPx() }.coerceAtLeast(1)
            val microphoneHeight = with(density) {
                microphoneStatuses.maxOf { measurer.measure(it, style, constraints = Constraints(maxWidth = width)).size.height }.toDp()
            }
            // Three text lines are reserved before live state arrives, at this width and text scale.
            val summaryHeight = with(density) {
                measurer.measure("送信状態\n映像とマイクの状態\nOBSでの表示は未確認です。", style,
                    maxLines = 3, constraints = Constraints(maxWidth = width)).size.height.toDp()
            }
            val rateStyle = MaterialTheme.typography.bodyMedium
            val labelWidth = with(density) { measurer.measure("実送信", style).size.width.toDp() }
            val valueWidth = with(density) { (maxWidth - labelWidth - 8.dp).roundToPx() }.coerceAtLeast(1)
            val rateHeight = with(density) {
                listOf("999.99 Mbps", "未計測", "—").maxOf {
                    measurer.measure(it, rateStyle, constraints = Constraints(maxWidth = valueWidth)).size.height
                }.toDp()
            }
            val rate = if (!state.active) "—" else if (state.status == "sending") state.statistics.bitrate.asBitrate() else "未計測"
            val summary = state.sendSummary(preparation, error, connectionUnconfirmed)
            val fullReasons = listOf(summary, state.statusMessages(), error.orEmpty(), if (!state.active) preparation else "")
                .filter { it.isNotBlank() }.distinct().joinToString("\n")
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth().height(rateHeight).testTag("スマホ送信・実送信"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("実送信", Modifier.width(labelWidth), style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(rate, Modifier.weight(1f).testTag("スマホ送信・速度"), style = rateStyle,
                        textAlign = androidx.compose.ui.text.style.TextAlign.End)
                }
                Text(state.microphoneStatusLabel(), Modifier.fillMaxWidth().height(microphoneHeight).testTag("スマホ送信・マイク状態"),
                    style = style, color = if ((state.inputNeedsAttention || state.active && state.clipping)) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant)
                LinearProgressIndicator(progress = {
                    if (state.active && !state.muted && !state.manualMute && !state.inputLost && state.volume > 0)
                        state.peak.coerceIn(0f, 1f) else 0f
                }, modifier = Modifier.fillMaxWidth().height(4.dp).testTag("スマホ送信・音量メーター")
                    .semantics { contentDescription = "送信音量メーター" })
                Box(Modifier.fillMaxWidth().height(summaryHeight).testTag("スマホ送信・要約")
                    .semantics(mergeDescendants = true) { contentDescription = fullReasons }) {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                        fullReasons.lineSequence().forEach { reason ->
                            Text(reason, style = style,
                                color = if (attention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (showInputControls) OutdoorSenderControls(state, preparation, error, onToggleMute, onToggleVideo,
            showStatus = false, showMicrophoneStatus = false)
        OutdoorSenderAction(state.active, canStart, onStart, onStop)
    }
    if (detailsOpen) AlertDialog(onDismissRequest = closeDetails, modifier = Modifier.testTag("スマホ送信・詳細画面"),
        title = { Text("スマホの送信") },
        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            OutdoorVideoStatus(state, onRetryAdaptation, onRetryVideo)
            if (connectionUnconfirmed) Text("PCとの接続状態が未確認です。", color = MaterialTheme.colorScheme.error)
            if (!state.active) Text(preparation, style = MaterialTheme.typography.bodySmall,
                color = if (connectionUnconfirmed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton(onClick = closeDetails,
            modifier = Modifier.testTag("スマホ送信・詳細を閉じる")) { Text("閉じる") } })
}
