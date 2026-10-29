package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import jp.casmate.app.ui.ScreenActionsDialog

internal enum class OutdoorSettingsCategory(val title: String, val summary: String) {
    CAMERA("カメラ", "前面／背面・ズーム・明るさ・ライト"),
    MICROPHONE("マイク", "ミュート・音量・入力マイク"),
    QUALITY("送信品質", "縦／横・画質・弱回線対策"),
    DISPLAY("画面表示", "プレビュー・診断要約"),
    OTHER("その他", "配色・スマホ連携・配信者音声認識"),
}

/** Navigation changes only the visible category, never sender or microphone state. */
@Composable
internal fun OutdoorSettingsMenu(
    onClose: () -> Unit,
    onOpenDiagnostics: () -> Unit,
    onOpenDrawing: () -> Unit = {},
    drawingEnabled: Boolean = false,
    drawingDisabledReason: String = "映像送信を開始すると利用できます",
    content: @Composable ColumnScope.(OutdoorSettingsCategory) -> Unit,
) {
    var category by remember { mutableStateOf<OutdoorSettingsCategory?>(null) }
    ScreenActionsDialog(category?.title ?: "映像・マイク", onClose,
        onBack = if (category != null) ({ category = null }) else null) {
        val current = category
        if (current == null) {
            OutdoorSettingsCategory.entries.filter { it != OutdoorSettingsCategory.OTHER }.forEach { next ->
                OutdoorCategoryEntry(next.title, next.summary) { category = next }
                if (next == OutdoorSettingsCategory.CAMERA) OutdoorCategoryEntry("手書き",
                    if (drawingEnabled) "プレビューに文字や落書きを重ねる" else drawingDisabledReason,
                    enabled = drawingEnabled, onClick = onOpenDrawing)
            }
            OutdoorCategoryEntry("通信・診断", "接続状態・詳しい数値・履歴", onClick = onOpenDiagnostics)
            OutdoorCategoryEntry(OutdoorSettingsCategory.OTHER.title, OutdoorSettingsCategory.OTHER.summary) {
                category = OutdoorSettingsCategory.OTHER
            }
        } else content(current)
    }
}

@Composable
private fun OutdoorCategoryEntry(title: String, summary: String, enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)
        .testTag("映像・マイク分類・$title"), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("›", style = MaterialTheme.typography.titleLarge)
        }
    }
}
