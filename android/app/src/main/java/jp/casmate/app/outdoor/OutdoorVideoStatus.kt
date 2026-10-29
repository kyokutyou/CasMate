package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

internal fun OutdoorAdaptationView.recoveryHint(): String {
    if (phase != OutdoorAdaptationPhase.HELD) return ""
    return when {
        controlStopped || diagnostics.reason == OutdoorAdaptationReason.CONTROL_STOPPED -> "復帰試行は自動制御停止中"
        diagnostics.nextProbeInMs != null && diagnostics.comparable ->
            "復帰試行まで最短あと${(diagnostics.nextProbeInMs + 999) / 1000}秒（新しい安定観測が必要・OBS表示未確認）"
        else -> "復帰試行は新しい安定観測待ち（OBS表示未確認）"
    }
}

internal fun OutdoorState.videoStatusText(): String {
    val state = this
    val adaptation = state.adaptation
    return when {
        !state.active -> "停止中"
        state.videoRecovering -> "映像だけを復旧中"
        state.videoFault.isNotEmpty() -> "映像の操作が必要"
        state.videoHidden -> "手動非表示を維持"
        adaptation.pending?.kind == OutdoorAdaptationOperation.HOLD -> "回線悪化のため現在画像を保持中"
        adaptation.phase == OutdoorAdaptationPhase.HELD -> "回線悪化のため映像を静止中（カメラ取得は継続）"
        adaptation.phase == OutdoorAdaptationPhase.PROBING -> "低ビットレートで動画の復帰試行中"
        adaptation.phase == OutdoorAdaptationPhase.LOW_VIDEO -> "緊急低ビットレートの動画を継続中"
        state.status == "preparing" -> "送信準備中"
        state.status == "connecting" -> "接続中"
        state.status == "reconnecting" -> "再接続中（映像目標を維持）"
        state.status != "sending" -> state.label
        adaptation.diagnostics.reason == OutdoorAdaptationReason.AUDIO_DROPPED ->
            "音声フレームを破棄しています（OBS受信未確認）"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.AUDIO_STALLED ->
            "音声送出が停滞中（OBS受信未確認）"
        (adaptation.diagnostics.videoWriteStalledForMs ?: 0L) >= 1000L ->
            "送信器の映像書込が停滞中（OBS表示未確認）"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.CONTROL_STOPPED -> "自動制御を停止中"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.NOT_STARTED ||
            adaptation.diagnostics.reason == OutdoorAdaptationReason.BASELINE -> "計測準備中"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.UNAVAILABLE -> "送信側の品質計測が途切れています"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.REBASELINE ||
            adaptation.diagnostics.reason == OutdoorAdaptationReason.COUNTER_RESET -> "品質計測をやり直しています"
        adaptation.diagnostics.reason == OutdoorAdaptationReason.QUEUE_CONGESTION ||
            adaptation.diagnostics.reason == OutdoorAdaptationReason.NETWORK_PRESSURE ->
            "回線悪化候補を観測中（OBS表示未確認）"
        state.quality.bitrateMode == OutdoorBitrateMode.FIXED -> "固定ビットレートで送信中"
        state.quality.bitrateMode == OutdoorBitrateMode.AUTO && adaptation.target >= state.quality.autoMaxBitrate -> "映像目標値は設定上限"
        state.quality.bitrateMode == OutdoorBitrateMode.AUTO -> when (adaptation.trend) {
            OutdoorBitrateTrend.STARTING -> "低い目標値で開始"
            OutdoorBitrateTrend.REDUCED -> "映像目標値を抑制中"
            OutdoorBitrateTrend.RECOVERING -> "映像目標値を引き上げた状態（OBS表示未確認）"
        }
        else -> "通常動画"
    }
}

internal fun OutdoorState.statusMessages(): String = listOf(
    if (microphoneChecking) "配信マイクの接続を確認中です。Bluetooth接続には最大30秒かかります。"
    else if (inputNeedsAttention) "配信マイクの入力を確認できません。外配信設定で入力を再選択してください。" else "",
    when (error) {
        "NONE" -> ""
        "INPUT_LOST" -> "選択入力を利用できません。マイクを確認してください。"
        "QUALITY_UNSUPPORTED" -> "選択品質に対応するカメラ・ハードウェアエンコーダーを利用できません。"
        "PERMISSION_REQUIRED" -> "カメラ・マイク・通知の権限を確認してください。"
        "CAMERA_FAILED" -> "カメラを開始できません。ほかのアプリの使用や権限を確認してください。"
        "AUTH_FAILED" -> "SRT認証を確認できません。OBSとAndroidの設定を更新してください。"
        "CONNECTION_FAILED" -> "接続を再試行中です。Tailscale、OBS入力設定、受信許可の順に確認してください。"
        else -> "OSまたは送信サービスが継続できません。前面画面から再開始してください。"
    }, detail, videoError, adaptation.message, warning,
).filter { it.isNotEmpty() }.distinct().joinToString("\n")

@Composable fun OutdoorVideoStatus(
    state: OutdoorState,
    onRetryAdaptation: () -> Unit = { OutdoorRuntime.service?.retryAdaptation() },
    onRetryVideo: () -> Unit = { OutdoorRuntime.service?.retryVideo() },
) {
    val adaptation = state.adaptation
    val fontScale = LocalDensity.current.fontScale
    // Reserve text and action slots independently; asynchronous changes never move the next control.
    Column(Modifier.fillMaxWidth().height(96.dp * fontScale).testTag("映像適応状態").verticalScroll(rememberScrollState())) {
        Text("${state.quality.bitrateMode.label}：${state.videoStatusText()}", style = MaterialTheme.typography.bodySmall)
        Text("実送信 ${if (state.active) state.statistics.bitrate.asBitrate() else "停止中"}", style = MaterialTheme.typography.bodyMedium)
        if (state.active && !state.videoHidden && adaptation.phase == OutdoorAdaptationPhase.HELD) {
            Text(adaptation.recoveryHint(), style = MaterialTheme.typography.bodySmall)
        }
        if (adaptation.increaseBlocked) Text("映像量の低下が不十分です。画質増加を保留しています。", style = MaterialTheme.typography.bodySmall)
        val messages = state.statusMessages()
        if (messages.isNotEmpty()) Text(messages, color = if (state.microphoneChecking && state.error == "NONE" &&
            state.videoError.isEmpty() && state.videoFault.isEmpty() && state.warning.isEmpty() && !adaptation.controlStopped &&
            adaptation.message.isEmpty() && state.detail.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant
            else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
    Row(Modifier.fillMaxWidth().height(56.dp * fontScale), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f).fillMaxHeight()) {
            if (state.active && adaptation.controlStopped) TextButton(
                modifier = Modifier.fillMaxSize(),
                onClick = onRetryAdaptation,
                enabled = !state.videoRecovering && !state.videoChanging,
            ) { Text("自動制御を再試行") }
        }
        Box(Modifier.weight(1f).fillMaxHeight()) {
            if (state.active && state.videoFault.isNotEmpty()) TextButton(
                modifier = Modifier.fillMaxSize(),
                onClick = onRetryVideo,
                enabled = !state.videoRecovering && !state.videoChanging && !(state.videoHidden && state.videoFault == "CAMERA"),
            ) { Text("映像を再試行") }
        }
    }
}
