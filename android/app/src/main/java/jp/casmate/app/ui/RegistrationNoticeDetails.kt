package jp.casmate.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** A reserved action slot keeps controls still; the reader retains the explicitly opened notice. */
@Composable
internal fun RegistrationNoticeDetails(message: String, actionLabel: String = "全文を見る", onConfirmed: (String) -> Unit = {}) {
    var openedMessage by remember { mutableStateOf<String?>(null) }
    val actionHeight = with(LocalDensity.current) { MaterialTheme.typography.labelLarge.lineHeight.toDp() + 16.dp }.coerceAtLeast(48.dp)
    Box(Modifier.fillMaxWidth().height(actionHeight), contentAlignment = Alignment.CenterEnd) {
        CasMateTextButton(onClick = { openedMessage = message.ifBlank { "現在、案内はありません。" } }) {
            Text(actionLabel)
        }
    }
    openedMessage?.let { text ->
        AlertDialog(
            onDismissRequest = { openedMessage = null },
            title = { Text("案内の全文") },
            text = { Text(text, Modifier.verticalScroll(rememberScrollState()).testTag("登録案内の全文")) },
            confirmButton = { CasMateTextButton(onClick = { onConfirmed(text); openedMessage = null }, modifier = Modifier.testTag("登録案内の全文を閉じる")) { Text("閉じる") } },
        )
    }
}
