package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import jp.casmate.app.ui.ScreenActionsDialog

internal enum class OutdoorSettingsCategory(val title: String, val summary: String) {
    CAMERA("カメラ", "前面／背面・ズーム・明るさ・ライト"),
    MICROPHONE("マイク", "ミュート・音量・入力マイク"),
    QUALITY("画質と向き", "縦／横・画質・弱回線対策"),
    DISPLAY("スマホの表示", "プレビュー・診断表示"),
    OTHER("アプリと連携", "配色・スマホ連携・音声認識"),
    PLACEHOLDER("映像を隠したとき", "黒画面・固定画像"),
    TIMESTAMP("映像への時刻表示", "配信・録画にも表示"),
}

/** Navigation changes only the visible category, never sender or microphone state. */
@Composable
internal fun OutdoorSettingsMenu(
    onClose: () -> Unit,
    onOpenDiagnostics: () -> Unit,
    onOpenDrawing: () -> Unit = {},
    drawingEnabled: Boolean = false,
    drawingDisabledReason: String = "映像送信を開始すると利用できます",
    summaries: Map<OutdoorSettingsCategory, String> = emptyMap(),
    content: @Composable ColumnScope.(OutdoorSettingsCategory, (OutdoorSettingsCategory) -> Unit) -> Unit,
) {
    var category by remember { mutableStateOf<OutdoorSettingsCategory?>(null) }
    ScreenActionsDialog(category?.title ?: "カメラ設定", onClose,
        onBack = if (category != null) ({ category = when (category) {
            OutdoorSettingsCategory.PLACEHOLDER, OutdoorSettingsCategory.TIMESTAMP -> OutdoorSettingsCategory.CAMERA
            else -> null
        } }) else null) {
        val current = category
        if (current == null) {
            Column(Modifier.fillMaxWidth().testTag("カメラ設定分類一覧")) {
                Text("撮影と音声", Modifier.padding(top = 4.dp, bottom = 4.dp), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                listOf(OutdoorSettingsCategory.CAMERA, OutdoorSettingsCategory.MICROPHONE).forEach { next ->
                    OutdoorCategoryEntry(next.title, summaries[next] ?: next.summary, icon = when (next) {
                        OutdoorSettingsCategory.CAMERA -> jp.casmate.app.R.drawable.ic_settings_camera
                        else -> jp.casmate.app.R.drawable.ic_settings_microphone
                    }) { category = next }
                }
                OutdoorCategoryEntry("手書き", if (drawingEnabled) "文字や線を重ねる" else drawingDisabledReason,
                    enabled = drawingEnabled, icon = jp.casmate.app.R.drawable.ic_drawing_pen, onClick = onOpenDrawing)
                Text("送信と表示", Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                listOf(OutdoorSettingsCategory.QUALITY, OutdoorSettingsCategory.DISPLAY).forEach { next ->
                    OutdoorCategoryEntry(next.title, summaries[next] ?: next.summary, icon = when (next) {
                        OutdoorSettingsCategory.QUALITY -> jp.casmate.app.R.drawable.ic_camera_actions
                        else -> jp.casmate.app.R.drawable.ic_smartphone_link
                    }) { category = next }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                OutdoorCategoryEntry("通信と診断", "状態・履歴・書き出し", icon = jp.casmate.app.R.drawable.ic_settings_diagnostics,
                    onClick = onOpenDiagnostics)
                val other = OutdoorSettingsCategory.OTHER
                OutdoorCategoryEntry(other.title, summaries[other] ?: other.summary,
                    icon = jp.casmate.app.R.drawable.ic_comment_settings) { category = other }
            }
        } else key(current) { content(current) { category = it } }
    }
}

@Composable
internal fun OutdoorCategoryEntry(title: String, summary: String, enabled: Boolean = true, icon: Int? = null, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)
        .testTag("映像・マイク分類・$title"), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (icon != null) Icon(painterResource(icon), null, Modifier.size(22.dp), tint = if (enabled)
                MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("›", style = MaterialTheme.typography.titleLarge)
        }
    }
}
