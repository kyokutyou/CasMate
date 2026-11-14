package jp.casmate.app.outdoor

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.rememberControlFocusModifier

/** An input request is not success: only the verified input state can report recovery. */
@Composable
internal fun OutdoorMicrophoneRecovery(state: OutdoorState, error: String?, onRetry: () -> Unit) {
    var lossSeen by remember { mutableStateOf(false) }
    var regionSeen by remember { mutableStateOf(false) }
    var recovered by remember { mutableStateOf(false) }
    LaunchedEffect(error, state.inputNeedsAttention) {
        if (error != null || state.inputNeedsAttention) regionSeen = true
    }
    LaunchedEffect(state.active, state.inputLost, state.inputPreparing, state.status, state.error) {
        if (!state.active) { recovered = false }
        else if (state.inputNeedsAttention) { lossSeen = true; recovered = false }
        else if (lossSeen && !state.inputLost && !state.inputPreparing) recovered = true
    }
    val retryEnabled = state.active && state.inputLost && !state.inputPreparing && state.status != "preparing"
    val message = error ?: when {
        state.microphoneChecking || state.active && state.inputPreparing -> "マイクの接続を確認中…"
        state.inputNeedsAttention -> "接続を確認し、入力を再開してください。映像送信は続いています。"
        recovered -> "マイク入力を再開しました"
        else -> ""
    }
    val fontScale = LocalDensity.current.fontScale
    // Recovery follows the ordinary controls: its first appearance cannot move their targets.
    val recoveryVisible = regionSeen || lossSeen || state.inputNeedsAttention || error != null
    Column(Modifier.fillMaxWidth().height((if (recoveryVisible) 128.dp else 28.dp) * fontScale).testTag("マイク復旧状態")) {
        Row(Modifier.fillMaxWidth().height(28.dp * fontScale), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LinearProgressIndicator(progress = { if (state.active) state.peak else 0f },
                modifier = Modifier.weight(1f).height(4.dp).semantics { contentDescription = "送信音量メーター" })
            Text(state.microphoneStatusLabel(), style = MaterialTheme.typography.labelSmall,
                color = if (state.inputNeedsAttention || state.active && state.clipping) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (recoveryVisible) {
        Box(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())) {
            Text(message, style = MaterialTheme.typography.bodySmall,
                color = if (error != null || state.inputNeedsAttention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = { if (retryEnabled) onRetry() }, enabled = retryEnabled,
            modifier = Modifier.fillMaxWidth().height(48.dp * fontScale).testTag("マイク入力再開")
                .rememberControlFocusModifier(retryEnabled), contentPadding = PaddingValues(8.dp)) {
            Text("マイク入力を再開")
        }
        }
    }
}
