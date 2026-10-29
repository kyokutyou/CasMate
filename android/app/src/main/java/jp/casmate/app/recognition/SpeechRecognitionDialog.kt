package jp.casmate.app.recognition

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import jp.casmate.app.ui.CasMateSwitch
import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateFilterChip

@Composable
internal fun SpeechRecognitionDialog(onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state by SpeechRecognitionRuntime.state.collectAsStateWithLifecycle()
    DisposableEffect(context, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) SpeechRecognitionRuntime.start(context)
            else if (event == Lifecycle.Event.ON_STOP) SpeechRecognitionRuntime.stop()
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) SpeechRecognitionRuntime.start(context)
        onDispose { lifecycle.removeObserver(observer); SpeechRecognitionRuntime.stop() }
    }
    RecognitionDialogContent(state, SpeechRecognitionRuntime::setEnabled, SpeechRecognitionRuntime::selectInput, SpeechRecognitionRuntime::retry, onClose)
}

@Composable
internal fun RecognitionDialogContent(state: RecognitionUiState, onEnabled: (Boolean) -> Unit, onInput: (RecognitionInput) -> Unit,
    onRetry: () -> Unit, onClose: () -> Unit) {
    val remote = state.remote
    AlertDialog(onDismissRequest = onClose, title = { Text("配信者音声認識") },
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("配信に使う", Modifier.weight(1f))
                    CasMateSwitch(checked = remote?.enabled == true, onCheckedChange = onEnabled,
                        enabled = state.canOperate, modifier = Modifier.testTag("音声認識本番切替"))
                }
                Text("PCと同じ設定です。選んだ入力の音声をPC内で認識します。")
                // Fixed outer height keeps the input controls stable during notifications and waits.
                Column(Modifier.fillMaxWidth().height(112.dp).verticalScroll(rememberScrollState()).testTag("音声認識状態"),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (state.working) "設定を反映しています…" else remote?.statusLabel ?: "PCの状態を確認中")
                    Text("適用済み入力：${remote?.inputName ?: "確認中"}")
                    (state.error ?: remote?.message)?.let { Text(it, color = if (state.error != null || remote?.status == "unavailable") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Text("認識する入力", style = MaterialTheme.typography.titleSmall)
                remote?.inputs?.forEach { input ->
                    CasMateFilterChip(onClick = { onInput(input) }, selected = input.matches(remote), enabled = state.canOperate,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("音声認識入力・${input.id}"),
                        label = { Text(input.name + if (input.available) "" else if (input.inputSource == "smartphone") "（音声待ち）" else "（利用不可）") })
                }
                Text("スマホ音声はカメラ画面で映像・マイクを送信中に使えます。認識をONにしても送信は開始しません。OBSのミュートとは独立し、送信元スマホの音量・ミュートを反映します。",
                    style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRetry, enabled = state.canOperate && remote?.status == "unavailable",
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("音声認識再試行")) { Text("認識を再試行") }
            }
        })
}
