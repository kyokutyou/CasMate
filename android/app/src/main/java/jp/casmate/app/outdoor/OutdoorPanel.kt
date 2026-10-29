package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateSwitch as Switch
import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateTextButton as TextButton
import jp.casmate.app.ui.CasMateOutlinedButton as OutlinedButton
import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.os.Build
import android.view.TextureView
import kotlin.math.roundToInt
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable fun OutdoorPanel(
    draft: OutdoorDraft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() },
    onOpenConnection: () -> Unit,
    settingsOnly: Boolean = false,
    onSettingsClosed: () -> Unit = {},
    onExportDiagnostics: (() -> Unit)? = null,
    appearanceContent: @Composable () -> Unit = {},
) {
    val context = LocalContext.current
    val actions = jp.casmate.app.ui.LocalScreenActions.current
    val state by OutdoorRuntime.state.collectAsStateWithLifecycle()
    val drawing by OutdoorDrawingRuntime.state.collectAsStateWithLifecycle()
    val drawingMode = state.active && drawing.modeActive
    var drawingViewport by rememberSaveable(drawing.sessionId, stateSaver = OutdoorDrawingViewport.Saver) {
        mutableStateOf(OutdoorDrawingViewport())
    }
    var drawingPaletteOpen by rememberSaveable(drawing.sessionId) { mutableStateOf(false) }
    LaunchedEffect(drawingMode) { if (!drawingMode) drawingPaletteOpen = false }
    var settingsOpen by remember { mutableStateOf(settingsOnly) }
    var microphoneMenu by remember { mutableStateOf(false) }
    val restored = remember { runCatching { jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(context) } }
    var savedBundle by remember { mutableStateOf(restored.getOrNull()) }
    val savedProfile = savedBundle?.profiles?.get(savedBundle?.activeNetwork)
    val registered = savedProfile?.canStartVideo == true
    val updateStates by jp.casmate.app.connection.SmartphoneControlConnection.registrationStatus.collectAsStateWithLifecycle()
    val preparationLabel = savedProfile?.videoPreparationLabel(updateStates[savedBundle?.activeNetwork]) ?: "PCのネットワークをONにして、スマホ連携から共通QRを登録してください。"
    var error by remember { mutableStateOf(if (restored.isFailure) "資格情報を復元できません。スマホ連携からPCのQRを再登録してください。" else null) }
    var portrait by draft.portrait
    var front by draft.front
    var devices by remember { mutableStateOf(SelectedMicrophone.inputs(context)) }
    var device by draft.device
    var showPreview by rememberSaveable { mutableStateOf(true) }
    var diagnosticsVisible by rememberSaveable { mutableStateOf(false) }
    val preferences = remember { OutdoorPreferences(context) }
    val savedQuality = remember { runCatching { preferences.quality() } }
    var quality by remember { mutableStateOf(savedQuality.getOrDefault(OutdoorQuality())) }
    var volume by remember { mutableIntStateOf(runCatching { preferences.volume() }.getOrDefault(100)) }
    var qualityError by remember { mutableStateOf(if (savedQuality.isFailure) "送信品質を復元できません。品質を選び直してください。" else null) }
    var statisticsOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(settingsOpen, actions.settingsOpen, statisticsOpen) {
        if (settingsOpen || actions.settingsOpen || statisticsOpen) jp.casmate.app.obs.ObsControlRuntime.cancel()
    }
    val exportDiagnostics = if (settingsOnly) ({}) else onExportDiagnostics ?: rememberOutdoorDiagnosticExporter()
    val registrationRevision by jp.casmate.app.obs.RegistrationBundleStore.revision.collectAsStateWithLifecycle()
    LaunchedEffect(draft.revision.intValue, registrationRevision) {
        if (device == -1) device = devices.firstOrNull()?.id ?: -1
        savedBundle = runCatching { jp.casmate.app.obs.RegistrationBundleStore.loadCurrent(context) }.getOrNull()
        runCatching { preferences.quality() }.onSuccess { quality = it; qualityError = null }
        runCatching { preferences.volume() }.onSuccess { volume = it }
    }
    LaunchedEffect(state.active, state.deviceId) {
        if (state.active && state.deviceId >= 0) {
            devices = SelectedMicrophone.inputs(context)
            device = state.deviceId
        }
    }
    LaunchedEffect(state.active) {
        if (state.active) draft.timestampOverlay.value = false
        else diagnosticsVisible = false
    }
    LaunchedEffect(state.active, state.volume) {
        if (state.active) volume = state.volume
        else runCatching { preferences.volume() }.onSuccess { volume = it }
            .onFailure { error = "音量を復元できません。音量を選び直してください。" }
    }
    val visibleQuality = if (state.active) state.quality else quality
    val visiblePortrait = if (state.active) state.portrait else portrait
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        error = if (it.values.all { granted -> granted }) null else "カメラ・マイク・通知・LANへのアクセス許可を確認してください。"
    }
    if (!settingsOnly) {
        val previewAspect = if (visiblePortrait) visibleQuality.height.toFloat() / visibleQuality.width
            else visibleQuality.width.toFloat() / visibleQuality.height
        // Moving this content between normal, diagnostic and drawing layouts preserves
        // the TextureView and its surface instead of detaching a live preview.
        val retainedPreview = remember { movableContentOf<OutdoorPreviewPresentation> { preview ->
            OutdoorDiagnosticPreview(preview.state, preview.aspect, preview.compact, preview.modifier,
                false, preview.fillAvailable, preview.drawingMode, preview.drawingEnabled, preview.sessionId,
                preview.viewport, preview.onViewportChange, preview.viewportEnabled) {}
        } }
        @Composable fun Preview(modifier: Modifier, compact: Boolean = false, fillAvailable: Boolean = true) {
            retainedPreview(OutdoorPreviewPresentation(state, previewAspect, compact, modifier, fillAvailable,
                drawingMode, drawingMode && drawing.editEnabled && !state.videoHidden && !state.videoChanging && !state.videoRecovering &&
                    state.videoFaults.isEmpty() && !actions.open && !drawingPaletteOpen, drawing.sessionId, drawingViewport,
                { drawingViewport = it }, drawingMode && !actions.open && !drawingPaletteOpen && !state.videoHidden))
        }
        OutdoorCameraLayout {
            if (drawingMode) {
                OutdoorDrawingPanel(drawing, state, actions.open, drawingPaletteOpen, { drawingPaletteOpen = it },
                    drawingViewport, { drawingViewport = it }) { modifier -> Preview(modifier) }
            } else if (showPreview && state.active && diagnosticsVisible) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(8.dp)) {
                    if (visiblePortrait) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Preview(Modifier.weight(0.45f), compact = true, fillAvailable = false)
                        Column(Modifier.weight(0.55f)) { OutdoorDiagnosticSummary(state, Modifier.fillMaxWidth()) }
                    } else {
                        Preview(Modifier.fillMaxWidth(), compact = true, fillAvailable = false)
                        OutdoorDiagnosticSummary(state, Modifier.fillMaxWidth())
                    }
                }
            } else {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant)) {
                    if (showPreview && state.active) Preview(Modifier.fillMaxSize())
                    else Text(if (showPreview) "カメラ停止中" else "プレビュー非表示",
                        Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutdoorPreviewBadges(state, front, error ?: qualityError, preparationLabel,
                        overPreview = showPreview && state.active)
                }
            }
        }
        // Keep the input controls when a service failure ends drawing in the background.
        val menuInputControls = remember(actions.open) { drawingMode }
        jp.casmate.app.obs.ObsControlPanel(actionsContent = { obsActions ->
            if (actions.open) jp.casmate.app.ui.ScreenActionsDialog("送信・配信", actions.dismiss) {
                OutdoorSendSection(state, preparationLabel, error ?: qualityError, registered && qualityError == null,
                    onStart = {
                        val needed = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
                        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
                        val address = runCatching { OutdoorStore(context).load()?.address }.getOrNull()
                        if (address != null && jp.casmate.app.connection.LocalNetworkAccess.needsPermission(address)) needed.add(Manifest.permission.ACCESS_LOCAL_NETWORK)
                        if (needed.any { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }) permissions.launch(needed.toTypedArray())
                        else if (!context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) error = "Android設定で通知を許可してください。"
                        else if (!requestOutdoorServiceStart(context, draft, portrait, front, device) { serviceContext, intent -> ContextCompat.startForegroundService(serviceContext, intent) })
                            error = "前面サービスを開始できません。画面を開いた状態で再試行してください。"
                        else error = null
                    },
                    onStop = { context.startService(Intent(context, OutdoorService::class.java).setAction("STOP")) },
                    onToggleMute = { OutdoorRuntime.service?.toggleManualMute() },
                    onToggleVideo = { OutdoorRuntime.service?.toggleVideoVisibility() },
                    showInputControls = menuInputControls,
                    connectionUnconfirmed = savedProfile != null && updateStates[savedBundle?.activeNetwork] != "confirmed")

                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outline)
                obsActions()
                TextButton(onClick = { actions.dismiss(); jp.casmate.app.obs.ObsProgramPreviewRuntime.open() },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("OBS映像確認の入口")) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("OBS映像を確認", Modifier.weight(1f))
                        Text("›", Modifier.padding(start = 8.dp))
                    }
                }
            }
        })
    }
    if (!settingsOnly) OutdoorDiagnosticPanel(state.copy(quality = visibleQuality, portrait = visiblePortrait), statisticsOpen,
        onDismiss = { statisticsOpen = false }, onExport = exportDiagnostics)
    val closeSettings: () -> Unit = {
        settingsOpen = false
        draft.revision.intValue++
        actions.closeSettings()
        onSettingsClosed()
    }
    if (settingsOpen || actions.settingsOpen) OutdoorSettingsMenu(
        onClose = closeSettings,
        onOpenDiagnostics = { closeSettings(); statisticsOpen = true },
        onOpenDrawing = { closeSettings(); OutdoorDrawingRuntime.controller.openMode(drawing.sessionId) },
        drawingEnabled = state.active && drawing.active,
        drawingDisabledReason = if (!state.active) "映像送信を開始すると利用できます" else "手書きの準備中です",
    ) { category ->
        when (category) {
            OutdoorSettingsCategory.CAMERA -> {
                val visibleFront = if (state.active) state.front else front
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !visibleFront, enabled = !state.videoHidden && !state.videoChanging && !state.cameraLocked, onClick = {
                        if (state.active) { if (visibleFront) OutdoorRuntime.service?.switchCamera() } else front = false
                    }, label = { Text("背面") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = visibleFront, enabled = !state.videoHidden && !state.videoChanging && !state.cameraLocked, onClick = {
                        if (state.active) { if (!visibleFront) OutdoorRuntime.service?.switchCamera() } else front = true
                    }, label = { Text("前面") }, modifier = Modifier.weight(1f))
                }
                OutdoorCameraSettings(state.camera, state.cameraLocked)
                OutdoorSenderControls(state, preparationLabel, error,
                    onToggleMute = { OutdoorRuntime.service?.toggleManualMute() },
                    onToggleVideo = { OutdoorRuntime.service?.toggleVideoVisibility() },
                    showMute = false, showStatus = false)
                OutdoorPlaceholderSettings(state.active)
                Text("診断用の映像時刻", style = MaterialTheme.typography.titleMedium)
                val timestampOverlayEnabled = if (state.active) state.timestampOverlay else draft.timestampOverlay.value
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("診断用時刻を映像に表示")
                        Text("端末の現地時刻を秒まで表示します。", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(
                        checked = timestampOverlayEnabled,
                        enabled = !state.active,
                        onCheckedChange = { draft.timestampOverlay.value = it },
                        modifier = Modifier.testTag("診断用時刻スイッチ"),
                    )
                }
                Text("時刻は映像へ焼き込まれ、プレビュー・SRT映像とOBS録画・配信に表示されます。", style = MaterialTheme.typography.bodySmall)
                if (state.active) Text("送信中は変更できません", style = MaterialTheme.typography.bodySmall)
            }
            OutdoorSettingsCategory.MICROPHONE -> {
                Text("配信マイク", style = MaterialTheme.typography.titleMedium)
                Text("読み上げの回り込みを避けるためイヤホンを利用してください。", style = MaterialTheme.typography.bodySmall)
                val visibleDevice = if (state.active) state.deviceId else device
                Box(Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { devices = SelectedMicrophone.inputs(context); microphoneMenu = true },
                        enabled = !state.inputPreparing, modifier = Modifier.fillMaxWidth()) {
                        Text("${devices.firstOrNull { it.id == visibleDevice }?.let { "${it.productName}（${microphoneTypeLabel(it.type)}）" } ?: "マイクを選択"} ▾")
                    }
                    DropdownMenu(expanded = microphoneMenu, onDismissRequest = { microphoneMenu = false }) {
                        if (devices.isEmpty()) DropdownMenuItem(text = { Text("利用可能な入力がありません",
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }, onClick = {}, enabled = false)
                        devices.forEach { input ->
                            DropdownMenuItem(text = { Text("${input.productName}（${microphoneTypeLabel(input.type)}）") }, onClick = {
                                device = input.id; microphoneMenu = false
                                if (state.active) OutdoorRuntime.service?.reselectMicrophone(input.id)
                            })
                        }
                    }
                }
                OutdoorSenderControls(state, preparationLabel, error,
                    onToggleMute = { OutdoorRuntime.service?.toggleManualMute() },
                    onToggleVideo = { OutdoorRuntime.service?.toggleVideoVisibility() },
                    showVideo = false, showStatus = false)
                Row(Modifier.fillMaxWidth().height(64.dp * androidx.compose.ui.platform.LocalDensity.current.fontScale),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState())) {
                        Text(error ?: when {
                            state.inputPreparing -> "マイクの接続を確認中…"
                            state.active && state.inputLost -> "マイク入力を確認できません"
                            else -> ""
                        }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    if (state.active && state.inputLost && !state.inputPreparing) TextButton(onClick = {
                        OutdoorRuntime.service?.reselectMicrophone(visibleDevice)
                    }, modifier = Modifier.heightIn(min = 48.dp)) { Text("入力再開") }
                }
                Text("配信マイク音量：${if (state.active) state.volume else volume}%")
                Slider(value = (if (state.active) state.volume else volume).toFloat(), valueRange = 0f..200f, steps = 199,
                    onValueChange = { value ->
                        if (state.active) OutdoorRuntime.service?.setVolume(value.roundToInt())
                        else try { preferences.saveVolume(value.roundToInt()); volume = value.roundToInt() }
                        catch (_: Exception) { error = "音量を保存できません" }
                    })
            }
            OutdoorSettingsCategory.QUALITY -> {
                Text("映像の向き")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !visiblePortrait, enabled = !state.active, onClick = { portrait = false },
                        label = { Text("横向き") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = visiblePortrait, enabled = !state.active, onClick = { portrait = true },
                        label = { Text("縦向き") }, modifier = Modifier.weight(1f))
                }
                Text(if (visiblePortrait) "縦${visibleQuality.height}×${visibleQuality.width}" else "横${visibleQuality.width}×${visibleQuality.height}",
                    style = MaterialTheme.typography.bodySmall)
                if (state.active) Text("映像の向きは送信停止後に変更できます", style = MaterialTheme.typography.bodySmall)
                Box(Modifier.fillMaxWidth().height(64.dp * androidx.compose.ui.platform.LocalDensity.current.fontScale)
                    .verticalScroll(rememberScrollState())) {
                    Text(listOfNotNull(qualityError, preferences.resetNotice).joinToString("\n"),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                OutdoorQualityControls(visibleQuality, state.active, if (state.active) state.front else front, visiblePortrait) { next ->
                    try { preferences.saveQuality(next); quality = next; qualityError = null }
                    catch (_: Exception) { qualityError = "送信品質を保存できません" }
                }
            }
            OutdoorSettingsCategory.DISPLAY -> {
                Text("このスマホの画面", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { showPreview = !showPreview },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(if (showPreview) "プレビューを閉じる" else "プレビューを表示")
                }
                TextButton(onClick = { diagnosticsVisible = !diagnosticsVisible }, enabled = state.active,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("診断表示切替")) {
                    Text(if (diagnosticsVisible) "診断要約を隠す" else "診断表示")
                }
                Text("この画面の表示だけを変更します。OBSに送る映像は変わりません。",
                    style = MaterialTheme.typography.bodySmall)
            }
            OutdoorSettingsCategory.OTHER -> {
                appearanceContent()
                Text("スマホ連携", style = MaterialTheme.typography.titleMedium)
                Text(preparationLabel, style = MaterialTheme.typography.bodySmall)
                OutlinedButton(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), onClick = {
                    closeSettings(); onOpenConnection()
                }) { Text("スマホ連携を開く") }
                TextButton(onClick = { actions.openRecognition(); settingsOpen = false; draft.revision.intValue++ },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("配信者音声認識") }
            }
        }
    }
}

internal fun createOutdoorStartIntent(
    context: Context,
    portrait: Boolean,
    front: Boolean,
    device: Int,
    timestampOverlay: Boolean,
): Intent = Intent(context, OutdoorService::class.java).setAction("START")
    .putExtra("portrait", portrait)
    .putExtra("front", front)
    .putExtra("device", device)
    .putExtra("timestampOverlay", timestampOverlay)

internal fun requestOutdoorServiceStart(
    context: Context,
    draft: OutdoorDraft,
    portrait: Boolean,
    front: Boolean,
    device: Int,
    startForegroundService: (Context, Intent) -> Unit,
): Boolean {
    val intent = createOutdoorStartIntent(context, portrait, front, device, draft.timestampOverlay.value)
    return try {
        startForegroundService(context, intent)
        draft.timestampOverlay.value = false
        true
    } catch (_: Exception) {
        false
    }
}

@Composable
private fun OutdoorDiagnosticPreview(
    state: OutdoorState,
    aspect: Float,
    compact: Boolean,
    modifier: Modifier,
    showToggle: Boolean,
    fillAvailable: Boolean = false,
    drawingMode: Boolean = false,
    drawingEnabled: Boolean = false,
    drawingSession: Long = 0,
    viewport: OutdoorDrawingViewport = OutdoorDrawingViewport(),
    onViewportChange: (OutdoorDrawingViewport) -> Unit = {},
    viewportEnabled: Boolean = false,
    onToggle: () -> Unit,
) {
    val onFlick = jp.casmate.app.ui.LocalHorizontalFlick.current
    val inputRegions = LocalOutdoorDrawingInputRegions.current
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp
    BoxWithConstraints(modifier.testTag("外配信プレビュー")) {
        val naturalHeight = maxWidth / aspect
        val previewHeight = if (fillAvailable) minOf(naturalHeight, maxHeight) else if (compact) minOf(naturalHeight, screenHeight * 0.5f) else naturalHeight
        val previewWidth = previewHeight * aspect
        val surfaceModifier = if (drawingMode) Modifier.fillMaxSize() else Modifier.width(previewWidth).height(previewHeight)
        Box(if (fillAvailable) Modifier.fillMaxSize() else Modifier.fillMaxWidth().height(previewHeight), contentAlignment = Alignment.Center) {
            if (state.videoHidden) Box(surfaceModifier.background(Color.Black).testTag("映像表示面"), contentAlignment = Alignment.Center) {
                Box(Modifier.width(previewWidth).height(previewHeight).testTag("非表示映像の表示枠")) {
                    OutdoorPlaceholderPreview(state.videoBlack, aspect)
                }
            } else AndroidView(modifier = surfaceModifier.testTag("映像表示面"), factory = { ctx ->
                OutdoorPreviewView(ctx).apply {
                    surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) { OutdoorRuntime.service?.attachPreview(this@apply) }
                        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) { OutdoorRuntime.service?.resizePreview(this@apply, width, height) }
                        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
                        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean { OutdoorRuntime.service?.detachPreview(this@apply); return true }
                    }
                }
            }, update = { view ->
                view.drawingInputRegions = inputRegions
                view.drawingSession = drawingSession
                view.drawingMode = drawingMode
                view.drawingOutputWidth = if (state.portrait) state.quality.height else state.quality.width
                view.drawingOutputHeight = if (state.portrait) state.quality.width else state.quality.height
                view.onViewportChange = onViewportChange
                view.drawingViewport = if (drawingMode) viewport else null
                view.viewportInputEnabled = viewportEnabled
                view.drawingEnabled = drawingEnabled
                view.onDrawingStart = { x, y -> OutdoorDrawingRuntime.controller.beginStroke(drawingSession, x, y) }
                view.onDrawingMove = { x, y -> OutdoorDrawingRuntime.controller.appendStroke(drawingSession, x, y) }
                view.onDrawingEnd = { OutdoorDrawingRuntime.controller.endStroke(drawingSession) }
                view.onHorizontalFlick = if (drawingMode) null else onFlick
                view.isClickable = !drawingMode && state.camera.ready && state.camera.focusSupported && !state.cameraLocked
                view.contentDescription = if (drawingMode) "手書きプレビュー" else if (view.isClickable)
                    "カメラプレビュー（タップでピント合わせ）" else "カメラプレビュー"
            }, onRelease = { view -> view.drawingEnabled = false; OutdoorRuntime.service?.detachPreview(view) })
            if (showToggle) TextButton(onClick = onToggle,
                modifier = Modifier.align(Alignment.TopEnd).heightIn(min = 48.dp).testTag("診断表示切替"),
                colors = ButtonDefaults.textButtonColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f))) {
                Text(if (compact) "診断を閉じる" else "診断表示")
            }
        }
    }
}

private data class OutdoorPreviewPresentation(
    val state: OutdoorState,
    val aspect: Float,
    val compact: Boolean,
    val modifier: Modifier,
    val fillAvailable: Boolean,
    val drawingMode: Boolean,
    val drawingEnabled: Boolean,
    val sessionId: Long,
    val viewport: OutdoorDrawingViewport,
    val onViewportChange: (OutdoorDrawingViewport) -> Unit,
    val viewportEnabled: Boolean,
)

private fun microphoneTypeLabel(type: Int): String = when (type) {
    android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC -> "本体"
    android.media.AudioDeviceInfo.TYPE_USB_DEVICE, android.media.AudioDeviceInfo.TYPE_USB_HEADSET -> "USB"
    android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET -> "有線"
    else -> "Bluetooth"
}
