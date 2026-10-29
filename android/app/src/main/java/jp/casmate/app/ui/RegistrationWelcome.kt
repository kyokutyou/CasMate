package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateButton as Button
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode

/** A direct QR entry is shown only after protected registration has finished loading. */
@Composable
fun RegistrationWelcome(
    appearance: AppearanceMode,
    onAppearanceChange: (AppearanceMode) -> Unit,
    onScan: () -> Unit,
    onAppSettings: () -> Unit,
    onRecovery: () -> Unit,
    canRecover: Boolean,
    busy: Boolean,
    message: String?,
    error: Boolean,
    appearanceError: String? = null,
    updateNoticeDetails: String? = null, onConfirmUpdateNotice: (String) -> Unit = {},
) {
    var helpOpen by remember { mutableStateOf(false) }
    val fontScale = LocalDensity.current.fontScale
    val notice = appearanceError ?: if (busy) message ?: "PCへ登録しています…"
        else message ?: "PC版の設定 → スマホ連携で、使用するネットワークをオンにして共通QRを表示してください。"
    Column(Modifier.fillMaxSize().padding(24.dp).testTag("初回QR登録")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = {
                onAppearanceChange(if (appearance == AppearanceMode.LIGHT) AppearanceMode.DARK else AppearanceMode.LIGHT)
            }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (appearance == AppearanceMode.LIGHT) "☾ ダークモード" else "☀ ライトモード")
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val compact = maxHeight < 400.dp || fontScale >= 1.5f
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Spacer(Modifier.height(8.dp))
                if (!compact) Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.primary) {
                    Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                        Text("C.", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimary)
                    }
                }
                Text("PCとつなぐ", style = MaterialTheme.typography.headlineMedium)
                Text("QRコードでPCを登録", color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!compact) Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    Box(Modifier.size(128.dp), contentAlignment = Alignment.Center) {
                        Icon(painterResource(jp.casmate.app.R.drawable.ic_qr_scan), contentDescription = null,
                            modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
                // Progress and errors replace the instructions, leaving the fixed QR action in place.
                Box(Modifier.fillMaxWidth().height((96f * fontScale).dp).verticalScroll(rememberScrollState())
                    .testTag("初回登録の状態"), contentAlignment = Alignment.Center) {
                    Text(notice,
                        color = if (error || appearanceError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Column(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            RegistrationNoticeDetails(notice, onConfirmed = { text ->
                updateNoticeDetails?.takeIf { text.contains(it) }?.let(onConfirmUpdateNotice)
            })
            Button(onClick = onScan, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp).testTag("初回QR読取")) {
                Text(if (busy) "PCへ登録中…" else "PCのQRコードを読み取る")
            }
            TextButton(onClick = { helpOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("QRコードの表示場所")
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                TextButton(onClick = onAppSettings, modifier = Modifier.heightIn(min = 48.dp)) { Text("アプリ設定") }
                if (canRecover) TextButton(onClick = onRecovery, enabled = !busy,
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("登録を確認・解除") }
            }
        }
    }
    if (helpOpen) AlertDialog(onDismissRequest = { helpOpen = false },
        title = { Text("QRコードの表示場所") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("1. Windows版きゃすメイトの「設定」を開きます。")
            Text("2. 「スマホ連携」を開き、使用するネットワークをオンにします。")
            Text("3. 表示された共通QRを「PCのQRコードを読み取る」で読み取ります。")
            Text("直接接続で保存した接続先がすべて変わると、PCのQRによる再登録が必要です。外出中に新しいQRを取得できない場合、その場での復旧は保証できません。",
                style = MaterialTheme.typography.bodySmall)
        } },
        confirmButton = { TextButton(onClick = { helpOpen = false }) { Text("閉じる") } })
}
