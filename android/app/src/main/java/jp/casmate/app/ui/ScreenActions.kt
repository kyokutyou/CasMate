package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Presentation only: the selected function owns its actions and state. */
internal data class ScreenActions(val open: Boolean = false, val dismiss: () -> Unit = {}, val openSettings: () -> Unit = {},
    val openRecognition: () -> Unit = {},
    val settingsOpen: Boolean = false, val closeSettings: () -> Unit = {})
internal val LocalScreenActions = staticCompositionLocalOf { ScreenActions() }

@Composable
internal fun ScreenActionsDialog(title: String, onDismiss: () -> Unit, onBack: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)
            .pointerInput(onDismiss) { detectTapGestures { onDismiss() } }.padding(8.dp), contentAlignment = Alignment.TopEnd) {
            Surface(Modifier.widthIn(max = 420.dp).fillMaxWidth().heightIn(max = maxHeight * 0.85f)
                .testTag("機能操作メニュー").pointerInput(Unit) { detectTapGestures {} },
                shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline), tonalElevation = 0.dp) {
                Column(Modifier.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (onBack != null) TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text("戻る") }
                        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("閉じる") }
                    }
                    val scroll = key(title) { rememberScrollState() }
                    Column(Modifier.fillMaxWidth().verticalScroll(scroll).testTag("機能操作一覧"),
                        verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
                }
            }
        }
    }
}
