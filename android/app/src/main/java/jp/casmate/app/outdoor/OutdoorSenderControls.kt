package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateOutlinedButton as OutlinedButton
import jp.casmate.app.ui.CasMateButton as Button
import jp.casmate.app.ui.rememberControlFocusModifier
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

internal fun OutdoorState.microphoneStatusLabel(): String = when {
    !active -> "マイク停止中"
    manualMute -> "ミュート中"
    microphoneChecking -> "マイク確認中"
    inputLost -> "入力未確認"
    volume == 0 -> "音量0%"
    clipping -> "音割れ警告"
    else -> "マイク入力あり"
}

/** The camera page owns sender controls; navigation never invokes these callbacks. */
@Composable
internal fun OutdoorSenderControls(
    state: OutdoorState,
    preparation: String,
    error: String?,
    onToggleMute: () -> Unit,
    onToggleVideo: () -> Unit,
    onRetryAdaptation: () -> Unit = { OutdoorRuntime.service?.retryAdaptation() },
    onRetryVideo: () -> Unit = { OutdoorRuntime.service?.retryVideo() },
    showMute: Boolean = true,
    showVideo: Boolean = true,
    showStatus: Boolean = true,
    showMicrophoneStatus: Boolean = true,
) {
    var statusOpen by remember { mutableStateOf(false) }
    val fontScale = LocalDensity.current.fontScale
    if (showMicrophoneStatus && (showMute || showStatus)) Row(Modifier.fillMaxWidth().heightIn(min = 28.dp * fontScale), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LinearProgressIndicator(progress = { if (state.active) state.peak else 0f },
            modifier = Modifier.weight(1f).height(4.dp).semantics { contentDescription = "送信音量メーター" })
        Text(state.microphoneStatusLabel(), style = MaterialTheme.typography.labelSmall,
            color = if ((state.inputNeedsAttention || state.active && state.clipping)) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (showMute || showVideo) BoxWithConstraints(Modifier.fillMaxWidth()) {
        val density = LocalDensity.current
        val measurer = androidx.compose.ui.text.rememberTextMeasurer()
        val style = MaterialTheme.typography.labelLarge
        val count = (if (showMute) 1 else 0) + (if (showVideo) 1 else 0)
        val width = with(density) { ((maxWidth - 8.dp * (count - 1)) / count - 16.dp).roundToPx() }.coerceAtLeast(1)
        val labels = buildList {
            if (showMute) addAll(listOf("マイクミュート", "ミュート解除"))
            if (showVideo) addAll(listOf("切替中…", "カメラに戻す", "映像を隠す"))
        }
        val height = with(density) { labels.maxOf {
            measurer.measure(it, style, constraints = androidx.compose.ui.unit.Constraints(maxWidth = width)).size.height
        }.toDp() + 16.dp }.coerceAtLeast(48.dp * fontScale)
        val muteEnabled = state.active && state.status != "preparing"
        val videoEnabled = state.active && !state.videoChanging && state.status != "preparing"
        Row(Modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showMute) OutlinedButton(onClick = { if (muteEnabled) onToggleMute() }, enabled = muteEnabled,
            modifier = Modifier.weight(1f).fillMaxHeight().testTag("カメラ・ミュート").rememberControlFocusModifier(muteEnabled),
            contentPadding = PaddingValues(8.dp),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (state.manualMute)
                MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface)) {
            Text(if (state.manualMute) "ミュート解除" else "マイクミュート", style = style)
        }
        if (showVideo) OutlinedButton(onClick = { if (videoEnabled) onToggleVideo() }, enabled = videoEnabled,
            modifier = Modifier.weight(1f).fillMaxHeight().testTag("カメラ・映像切替").rememberControlFocusModifier(videoEnabled),
            contentPadding = PaddingValues(8.dp),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (state.videoHidden)
                MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface)) {
            Text(if (state.videoChanging) "切替中…" else if (state.videoHidden) "カメラに戻す" else "映像を隠す", style = style)
        }
        }
    }
    // This existing status row has a fixed footprint, including errors and recovery states.
    if (showStatus) Row(Modifier.fillMaxWidth().height(96.dp * fontScale).testTag("カメラ状態"), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()), contentAlignment = Alignment.CenterStart) {
            Column {
                Text(error ?: if (state.active) state.videoStatusText() else preparation,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (error != null || state.videoFault.isNotEmpty() || state.inputNeedsAttention)
                        MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.active) {
                    Text("実送信 ${state.statistics.bitrate.asBitrate()}", style = MaterialTheme.typography.labelSmall)
                    if (!state.videoHidden && state.adaptation.phase == OutdoorAdaptationPhase.HELD)
                        Text(state.adaptation.recoveryHint(), style = MaterialTheme.typography.bodySmall)
                    else if (state.adaptation.controlStopped)
                        Text("自動制御停止中", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        }
        Column(Modifier.weight(0.65f).fillMaxHeight().verticalScroll(rememberScrollState())) {
            TextButton(onClick = { jp.casmate.app.obs.ObsControlRuntime.cancel(); statusOpen = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("状態詳細") }
            if (state.active && state.adaptation.controlStopped) TextButton(onClick = onRetryAdaptation,
                enabled = !state.videoRecovering && !state.videoChanging,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("自動制御を再試行") }
            if (state.active && state.videoFault.isNotEmpty()) TextButton(onClick = onRetryVideo,
                enabled = !state.videoRecovering && !state.videoChanging && !(state.videoHidden && state.videoFault == "CAMERA"),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("映像を再試行") }
        }
    }
    if (statusOpen) AlertDialog(onDismissRequest = { statusOpen = false }, title = { Text("カメラ・送信の状態") },
        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            OutdoorVideoStatus(state, onRetryAdaptation, onRetryVideo)
            if (!state.active) Text(preparation, style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton(onClick = { statusOpen = false }) { Text("閉じる") } })
}

@Composable
internal fun OutdoorSenderAction(active: Boolean, canStart: Boolean, onStart: () -> Unit, onStop: () -> Unit) {
    var confirmStop by remember { mutableStateOf(false) }
    val enabled = active || canStart
    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val density = LocalDensity.current
    val style = MaterialTheme.typography.labelLarge
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val width = with(density) { (maxWidth - 32.dp).roundToPx() }.coerceAtLeast(1)
    val height = with(density) { listOf("送信を停止", "送信を開始").maxOf {
        measurer.measure(it, style, constraints = androidx.compose.ui.unit.Constraints(maxWidth = width)).size.height
    }.toDp() + 16.dp }.coerceAtLeast(48.dp)
    Button(onClick = { if (enabled) {
        if (active) { jp.casmate.app.obs.ObsControlRuntime.cancel(); confirmStop = true } else onStart()
    } }, enabled = enabled,
        modifier = Modifier.fillMaxWidth().height(height).rememberControlFocusModifier(enabled).testTag("カメラ・送信操作"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (active) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            contentColor = if (active) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary)) {
        Text(if (active) "送信を停止" else "送信を開始", style = style)
    }
    }
    if (confirmStop && active) AlertDialog(onDismissRequest = { confirmStop = false },
        title = { Text("映像・音声の送信を停止しますか？") },
        text = { Text("スマホの映像・マイク音声を止めます。OBS配信・コメント・読み上げは継続します。") },
        confirmButton = { TextButton(onClick = { confirmStop = false; onStop() },
            modifier = Modifier.testTag("送信停止確認・実行")) { Text("送信を停止") } },
        dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("キャンセル") } })
    LaunchedEffect(active) { if (!active) confirmStop = false }
}

/** The camera canvas uses all available space; actions live in the top menu. */
@Composable
internal fun OutdoorCameraLayout(body: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().testTag("カメラ本文")) { body() }
}

@Composable
internal fun BoxScope.OutdoorPreviewBadges(state: OutdoorState, front: Boolean, error: String?, preparation: String,
    overPreview: Boolean = state.active) {
    val textColor = if (overPreview) Color.White else MaterialTheme.colorScheme.onSurface
    val warningColor = if (overPreview) Color(0xFFFFD28A) else MaterialTheme.colorScheme.error
    val shadow = if (overPreview) with(LocalDensity.current) {
        Shadow(Color.Black, Offset(0f, 1.dp.toPx()), 2.dp.toPx())
    } else null
    val labelStyle = MaterialTheme.typography.labelSmall.copy(shadow = shadow)
    val fontScale = LocalDensity.current.fontScale
    val attention = error != null || state.error != "NONE" || state.warning.isNotEmpty() || state.status == "actionRequired" || state.videoFault.isNotEmpty() ||
        state.adaptation.controlStopped || (state.inputNeedsAttention || state.active && state.clipping)
    // Reuse the authoritative video/adaptation decision; keeping bitrate on its own line avoids truncating it.
    val status = error ?: if (state.error != "NONE" && state.status != "reconnecting") "要確認・操作メニューを開く"
        else if (state.active) state.videoStatusText() else "送信停止中"
    val mic = state.microphoneStatusLabel()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Column(Modifier.align(Alignment.TopStart).widthIn(max = 280.dp).fillMaxWidth()
            .heightIn(max = maxHeight * 0.7f).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            @Composable fun Badge(value: String, description: String = value, warning: Boolean = false) {
                Surface(color = Color.Transparent, contentColor = textColor,
                    modifier = Modifier.fillMaxWidth().height(32.dp * fontScale).testTag("プレビューカメラ表示")
                        .semantics { contentDescription = description }) {
                    Box(Modifier.padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                        Text(value, style = labelStyle, maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            color = if (warning) warningColor else textColor)
                    }
                }
            }
            Badge((if (if (state.active) state.front else front) "前面" else "背面") + "カメラ・" + String.format(java.util.Locale.ROOT, "%.1f", state.camera.zoom) + "×")
            Surface(color = Color.Transparent, contentColor = textColor,
                modifier = Modifier.fillMaxWidth().height(64.dp * fontScale).testTag("プレビュー送信状態")
                    .semantics { contentDescription = error ?: if (state.active) state.videoStatusText() + "\n" + state.statusMessages() else preparation }) {
                Column(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalArrangement = Arrangement.Center) {
                    Text((if (state.status == "reconnecting") "再接続待ち" else state.label) + "・" +
                        (if (state.active) state.statistics.bitrate.asBitrate() else "—"),
                        style = labelStyle, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    Text(status, style = labelStyle, maxLines = 2,
                        modifier = Modifier.testTag("プレビュー映像理由"), overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        color = if (attention) warningColor else textColor)
                }
            }
            Surface(color = Color.Transparent, contentColor = textColor, modifier = Modifier.testTag("プレビューマイク表示")) {
                Row(Modifier.fillMaxWidth().height(32.dp * fontScale).padding(horizontal = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LinearProgressIndicator(progress = { if (state.active) state.peak else 0f },
                        color = if (overPreview) Color.White else MaterialTheme.colorScheme.primary,
                        trackColor = if (overPreview) Color.Black.copy(alpha = 0.4f) else MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.width(48.dp).height(4.dp)
                        .semantics { contentDescription = "送信音量メーター" })
                    Text(mic, style = labelStyle, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        color = if ((state.inputNeedsAttention || state.active && state.clipping)) warningColor else textColor)
                }
            }
        }
        Surface(Modifier.align(Alignment.BottomStart).padding(12.dp).testTag("プレビューOBS表示"),
            color = Color.Transparent, contentColor = textColor) {
            Text(if (state.videoHidden) "カメラ停止中・OBS表示未確認" else "OBS表示未確認",
                Modifier.padding(8.dp), style = labelStyle)
        }
    }
}
