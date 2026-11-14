package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateOutlinedButton as OutlinedButton
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable fun OutdoorPlaceholderSettings(active: Boolean) {
    val context = LocalContext.current
    val store = remember { OutdoorPlaceholderStore(context) }
    val scope = rememberCoroutineScope()
    var usesImage by remember { mutableStateOf(store.usesImage()) }
    var bitmap by remember { mutableStateOf(runCatching { store.image() }.getOrNull()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Keep the small preview bitmap alive for Compose; the sending source owns a separate bitmap.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null && !OutdoorRuntime.state.value.active) scope.launch {
            busy = true
            try {
                withContext(Dispatchers.IO) { store.importImage(uri) }
                bitmap = store.image(); usesImage = store.usesImage(); error = null
            } catch (_: Exception) { error = "画像を読み込めません。別の画像を選んでください。" }
            finally { busy = false }
        }
    }
    Text("隠している間に送る映像", style = MaterialTheme.typography.bodyMedium)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = !usesImage, enabled = !active && !busy, onClick = {
            runCatching { store.selectImage(false) }.onSuccess { usesImage = false; error = null }
                .onFailure { error = "表示方法を保存できません" }
        }, label = { Text("黒画面") }, modifier = Modifier.weight(1f))
        FilterChip(selected = usesImage, enabled = !active && !busy, onClick = {
            if (bitmap == null) picker.launch("image/*")
            else runCatching { store.selectImage(true) }.onSuccess { usesImage = true; error = null }
                .onFailure { error = "表示方法を保存できません" }
        }, label = { Text("固定画像") }, modifier = Modifier.weight(1f))
    }
    if (usesImage) {
        OutlinedButton(enabled = !active && !busy, onClick = { picker.launch("image/*") },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("画像を選択") }
        bitmap?.let { Image(it.asImageBitmap(), "固定画像の見本", Modifier.fillMaxWidth().height(96.dp), contentScale = ContentScale.Fit) }
    } else {
        Box(Modifier.fillMaxWidth().height(96.dp).background(Color.Black)
            .semantics { contentDescription = "黒画面の見本" })
    }
    Text("「映像を隠す」を押したときに使います。マイク音声は送信を続けます。", style = MaterialTheme.typography.bodySmall)
    if (busy) Text("画像を保存中…", style = MaterialTheme.typography.bodySmall)
    if (active) Text("変更するには映像送信を停止してください。", style = MaterialTheme.typography.bodySmall)
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable fun OutdoorPlaceholderPreview(black: Boolean, aspectRatio: Float) {
    val context = LocalContext.current
    val image = remember(black) { if (black) null else runCatching { OutdoorPlaceholderStore(context).image() }.getOrNull() }
    Box(Modifier.fillMaxWidth().aspectRatio(aspectRatio).background(Color.Black)
        .semantics { contentDescription = if (black || image == null) "送信中の黒画面" else "送信中の固定画像" }) {
        image?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
    }
}
