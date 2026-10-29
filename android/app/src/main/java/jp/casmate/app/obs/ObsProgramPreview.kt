package jp.casmate.app.obs

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import jp.casmate.app.connection.SmartphoneControlConnection
import jp.casmate.app.ui.CasMateTextButton as TextButton
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal data class ObsProgramPreviewState(val open: Boolean = false, val working: Boolean = false,
    val image: ObsProgramImage? = null, val message: String = "")

/** Activity recreation retains the open screen, but never triggers another capture. */
internal class ObsProgramPreviewController(private val scope: CoroutineScope, private val capture: suspend () -> ObsProgramImage) {
    private val mutable = MutableStateFlow(ObsProgramPreviewState())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var revision = 0L

    fun open() {
        if (mutable.value.open) return
        mutable.value = ObsProgramPreviewState(open = true)
        update()
    }

    fun update() {
        if (!mutable.value.open || mutable.value.working) return
        val current = ++revision
        mutable.value = ObsProgramPreviewState(open = true, working = true, message = "OBS映像を取得中…")
        job = scope.launch {
            try {
                val image = capture()
                if (current == revision && mutable.value.open) mutable.value = ObsProgramPreviewState(open = true, image = image)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (current == revision && mutable.value.open) mutable.value = ObsProgramPreviewState(open = true,
                    message = if (error is ObsControlHttpException) error.message else "OBS映像を取得できません。接続・操作許可を確認し、更新してください。")
            }
        }
    }

    fun invalidate(message: String = "接続状態が変わりました。接続後に更新してください。") {
        revision++; job?.cancel(); job = null
        if (mutable.value.open) mutable.value = ObsProgramPreviewState(open = true, message = message)
    }

    fun close() { invalidate(); mutable.value = ObsProgramPreviewState() }
}

internal object ObsProgramPreviewRuntime {
    private val controller = ObsProgramPreviewController(CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate), SmartphoneControlConnection::captureProgram)
    val state = controller.state
    fun open() { ObsControlRuntime.cancel(); controller.open() }
    fun update() = controller.update()
    fun invalidate() = controller.invalidate()
    fun close() = controller.close()
}

@Composable
internal fun ObsProgramPreviewDialog() {
    val state by ObsProgramPreviewRuntime.state.collectAsStateWithLifecycle()
    val obs by ObsControlRuntime.state.collectAsStateWithLifecycle()
    val supported by SmartphoneControlConnection.captureSupported.collectAsStateWithLifecycle()
    if (state.open) Dialog(onDismissRequest = { ObsProgramPreviewRuntime.close() },
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        ObsProgramPreviewContent(state, supported == true && obs.remote?.connection == "connected",
            if (supported == false) "OBS映像の確認にはPC版の更新が必要です。" else if (obs.remote?.connection != "connected")
                "PCとOBSへの接続、AndroidからのOBS操作の許可を確認してください。" else null,
            ObsProgramPreviewRuntime::update, ObsProgramPreviewRuntime::close)
    }
}

@Composable
internal fun ObsProgramPreviewContent(state: ObsProgramPreviewState, canUpdate: Boolean, unavailable: String?,
    onUpdate: () -> Unit, onClose: () -> Unit) {
    Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(8.dp),
        color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.large) {
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("OBS映像を確認", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp).testTag("OBS画像・閉じる")) { Text("閉じる") }
            }
            Box(Modifier.weight(1f).fillMaxWidth().testTag("OBS画像領域"), contentAlignment = Alignment.Center) {
                state.image?.let { Image(it.bitmap.asImageBitmap(), contentDescription = "OBSで合成した映像の静止画",
                    modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
            }
            // The status scrolls within a stable font-scaled area, never moving either action.
            Column(Modifier.fillMaxWidth().heightIn(min = 112.dp, max = 160.dp).weight(0.35f, fill = true)
                .testTag("OBS画像・状態").verticalScroll(rememberScrollState())) {
                val image = state.image
                if (image != null) {
                    Text("シーン：${image.sceneName}")
                    val time = remember(image.capturedAt) {
                        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(image.capturedAt))
                    }
                    Text("取得時刻（PC）：$time")
                } else Text(unavailable ?: state.message)
                Text("取得時点の静止画です。", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onUpdate, enabled = canUpdate && !state.working,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("OBS画像・更新")) { Text("更新") }
        }
    }
}
