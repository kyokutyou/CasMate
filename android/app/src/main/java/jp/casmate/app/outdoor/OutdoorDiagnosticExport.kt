package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateTextButton as TextButton
import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.OutputStream

data class OutdoorExportStatus(val busy: Boolean = false, val message: String = "")

internal fun writeOutdoorDiagnostic(capture: OutdoorDiagnosticCapture, open: () -> OutputStream?): Boolean = runCatching {
    val json = capture.json()
    checkNotNull(open()).bufferedWriter(Charsets.UTF_8).use { it.write(json) }
}.isSuccess

/** Activity recreation does not replace the user's chosen immutable export snapshot. */
object OutdoorDiagnosticExport {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutable = MutableStateFlow(OutdoorExportStatus())
    val state = mutable.asStateFlow()
    private var pending: OutdoorDiagnosticCapture? = null
    fun begin(): Boolean {
        if (mutable.value.busy) return false
        pending = OutdoorDiagnosticHistory.capture() ?: return false
        mutable.value = OutdoorExportStatus(true, "保存先を選択してください")
        return true
    }
    fun save(resolver: ContentResolver, uri: Uri?) {
        val capture = pending ?: return
        if (uri == null) { pending = null; mutable.value = OutdoorExportStatus(message = "書き出しをキャンセルしました"); return }
        mutable.value = OutdoorExportStatus(true, "数値診断を書き出しています")
        scope.launch {
            val saved = withContext(Dispatchers.IO) {
                writeOutdoorDiagnostic(capture) { resolver.openOutputStream(uri, "wt") }
            }
            pending = null
            mutable.value = OutdoorExportStatus(message = if (saved) "数値診断を保存しました" else "保存できませんでした。もう一度お試しください。")
        }
    }
}

@Composable
internal fun rememberOutdoorDiagnosticExporter(): () -> Unit {
    val resolver = LocalContext.current.applicationContext.contentResolver
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) {
        OutdoorDiagnosticExport.save(resolver, it)
    }
    return {
        if (OutdoorDiagnosticExport.begin()) runCatching { picker.launch("casmate-outdoor-diagnostics.json") }
            .onFailure { OutdoorDiagnosticExport.save(resolver, null) }
    }
}

@Composable
internal fun OutdoorDiagnosticExportControls(onExport: () -> Unit) {
    val available by OutdoorDiagnosticHistory.available.collectAsStateWithLifecycle()
    val export by OutdoorDiagnosticExport.state.collectAsStateWithLifecycle()
    TextButton(enabled = available && !export.busy, onClick = onExport,
        modifier = Modifier.fillMaxWidth().height(56.dp * LocalDensity.current.fontScale)) {
        Text(if (export.busy) "書き出し中" else "数値診断を書き出す")
    }
    Box(Modifier.fillMaxWidth().height(64.dp * LocalDensity.current.fontScale)) {
        Text(if (!available) "書き出せる数値履歴はありません" else export.message,
            style = MaterialTheme.typography.bodySmall)
    }
}
