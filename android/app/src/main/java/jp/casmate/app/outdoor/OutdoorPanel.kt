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
import androidx.compose.ui.graphics.luminance
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
        drawingEnabled = state.active && drawing.active && state.camera.ready && !state.videoHidden &&
            state.videoFaults.isEmpty() && state.camera.error.isEmpty() && !state.videoRecovering && !state.videoChanging,
        drawingDisabledReason = when {
            !state.active -> "映像送信を開始すると利用できます"
            state.videoHidden -> "カメラに戻すと利用できます"
            state.videoFaults.isNotEmpty() || state.camera.error.isNotEmpty() -> "カメラの確認が必要です"
            state.videoRecovering -> "映像の復旧後に利用できます"
            state.videoChanging || !state.camera.ready -> "準備完了後に利用できます"
            else -> "手書きの準備中です"
        },
        summaries = mapOf(
            OutdoorSettingsCategory.CAMERA to when {
                state.videoFaults.isNotEmpty() || state.camera.error.isNotEmpty() -> "カメラの確認が必要"
                state.videoRecovering -> "映像を復旧中"
                state.videoChanging -> "カメラ切り替え中"
                state.videoHidden -> "映像非表示"
                state.active && state.status == "preparing" && !state.camera.ready -> "カメラ準備中"
                state.active && !state.camera.ready -> "カメラ未準備"
                else -> "${if (if (state.active) state.front else front) "前面" else "背面"}・${"%.1f".format(state.camera.zoom)}×"
            },
            OutdoorSettingsCategory.MICROPHONE to when {
                state.inputNeedsAttention -> "入力なし・再開が必要"
                state.active && state.manualMute -> "ミュート中"
                state.microphoneChecking -> "マイク確認中"
                else -> "${devices.firstOrNull { it.id == if (state.active) state.deviceId else device }?.let { microphoneTypeLabel(it.type) } ?: "マイク未選択"}・${if (state.active) state.volume else volume}%"
            },
            OutdoorSettingsCategory.QUALITY to "${if (visiblePortrait) "縦向き" else "横向き"}・${visibleQuality.height}p・${visibleQuality.fps}fps",
            OutdoorSettingsCategory.DISPLAY to "プレビュー${if (showPreview) "ON" else "OFF"}・診断表示${if (diagnosticsVisible) "ON" else "OFF"}",
            OutdoorSettingsCategory.OTHER to "${if (MaterialTheme.colorScheme.background.luminance() < .5f) "ダーク" else "ライト"}・連携・音声認識",
        ),
    ) { category, navigate ->
        when (category) {
            OutdoorSettingsCategory.CAMERA -> {
                val visibleFront = if (state.active) state.front else front
                Text("撮影を調整", style = MaterialTheme.typography.titleMedium)
                Text("使用するカメラ")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !visibleFront, enabled = !state.videoHidden && !state.videoChanging && !state.cameraLocked && (!state.active || state.camera.ready), onClick = {
                        if (state.active) { if (visibleFront) OutdoorRuntime.service?.switchCamera() } else front = false
                    }, label = { Text("背面") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = visibleFront, enabled = !state.videoHidden && !state.videoChanging && !state.cameraLocked && (!state.active || state.camera.ready), onClick = {
                        if (state.active) { if (!visibleFront) OutdoorRuntime.service?.switchCamera() } else front = true
                    }, label = { Text("前面") }, modifier = Modifier.weight(1f))
                }
                OutdoorCameraSettings(state.camera, state.cameraLocked, active = state.active)
                Text("OBSへ送る映像", style = MaterialTheme.typography.titleMedium)
                OutdoorSenderControls(state, preparationLabel, error,
                    onToggleMute = { OutdoorRuntime.service?.toggleManualMute() },
                    onToggleVideo = { OutdoorRuntime.service?.toggleVideoVisibility() },
                    showMute = false, showStatus = false)
                Text("映像を隠しても、マイク音声は送信します。", style = MaterialTheme.typography.bodySmall)
                val placeholderImage = remember { OutdoorPlaceholderStore(context).usesImage() }
                OutdoorCategoryEntry("映像を隠したとき", if (placeholderImage) "固定画像" else "黒画面") { navigate(OutdoorSettingsCategory.PLACEHOLDER) }
                OutdoorCategoryEntry("映像への時刻表示", if (if (state.active) state.timestampOverlay else draft.timestampOverlay.value) "ON" else "OFF") {
                    navigate(OutdoorSettingsCategory.TIMESTAMP)
                }
            }
            OutdoorSettingsCategory.PLACEHOLDER -> OutdoorPlaceholderSettings(state.active)
            OutdoorSettingsCategory.TIMESTAMP -> {
                val timestampOverlayEnabled = if (state.active) state.timestampOverlay else draft.timestampOverlay.value
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("映像に時刻を入れる")
                    }
                    Switch(
                        checked = timestampOverlayEnabled,
                        enabled = !state.active,
                        onCheckedChange = { draft.timestampOverlay.value = it },
                        modifier = Modifier.testTag("診断用時刻スイッチ"),
                    )
                }
                Text("OBSの配信・録画にも時刻が表示されます。", style = MaterialTheme.typography.bodySmall)
                if (state.active) Text("変更するには映像送信を停止してください。", style = MaterialTheme.typography.bodySmall)
                Surface(Modifier.fillMaxWidth().height(96.dp).testTag("時刻表示の見本"),
                    shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(if (timestampOverlayEnabled) "表示例 14:32:08" else "時刻表示OFF")
                    }
                }
            }
            OutdoorSettingsCategory.MICROPHONE -> {
                Text("マイク音声", style = MaterialTheme.typography.titleMedium)
                val visibleDevice = if (state.active) state.deviceId else device
                OutdoorSenderControls(state, preparationLabel, error,
                    onToggleMute = { OutdoorRuntime.service?.toggleManualMute() },
                    onToggleVideo = { OutdoorRuntime.service?.toggleVideoVisibility() },
                    showVideo = false, showStatus = false, showMicrophoneStatus = false)
                Row(Modifier.fillMaxWidth()) {
                    Text("マイク音量", Modifier.weight(1f))
                    Text("${if (state.active) state.volume else volume}%")
                }
                Slider(value = (if (state.active) state.volume else volume).toFloat(), valueRange = 0f..200f, steps = 199,
                    modifier = Modifier.testTag("マイク音量スライダー"),
                    onValueChange = { value ->
                        if (state.active) OutdoorRuntime.service?.setVolume(value.roundToInt())
                        else try { preferences.saveVolume(value.roundToInt()); volume = value.roundToInt() }
                        catch (_: Exception) { error = "音量を保存できません" }
                    })
                Text("入力マイク")
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
                OutdoorMicrophoneRecovery(state, error) { OutdoorRuntime.service?.reselectMicrophone(visibleDevice) }
                Text("読み上げ音声の回り込みを防ぐには、イヤホンを使ってください。", style = MaterialTheme.typography.bodySmall)
            }
            OutdoorSettingsCategory.QUALITY -> {
                if (state.active) Text("変更するには映像送信を停止してください。", style = MaterialTheme.typography.bodySmall)
                Text("映像の向き")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !visiblePortrait, enabled = !state.active, onClick = { portrait = false },
                        label = { Text("横向き") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = visiblePortrait, enabled = !state.active, onClick = { portrait = true },
                        label = { Text("縦向き") }, modifier = Modifier.weight(1f))
                }
                Text(if (visiblePortrait) "縦${visibleQuality.height}×${visibleQuality.width}" else "横${visibleQuality.width}×${visibleQuality.height}",
                    style = MaterialTheme.typography.bodySmall)
                Text("スマホを縦・横どちらに持っても、選んだ向きで送信します。はみ出す部分は切り取ります。",
                    style = MaterialTheme.typography.bodySmall)
                OutdoorQualityControls(visibleQuality, state.active, if (state.active) state.front else front, visiblePortrait, showLockNotice = false) { next ->
                    try { preferences.saveQuality(next); quality = next; qualityError = null }
                    catch (_: Exception) { qualityError = "送信品質を保存できません" }
                }
                // Failures follow all setting targets; their arrival cannot move those targets.
                val notice = listOfNotNull(qualityError, preferences.resetNotice).joinToString("\n")
                if (notice.isNotEmpty()) Text(notice, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error)
            }
            OutdoorSettingsCategory.DISPLAY -> {
                Text("スマホだけの表示", style = MaterialTheme.typography.titleMedium)
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("スマホに映像を表示", Modifier.weight(1f))
                    Switch(checked = showPreview, onCheckedChange = { showPreview = it },
                        modifier = Modifier.testTag("プレビュー表示切替"))
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("診断情報を重ねて表示", Modifier.weight(1f))
                    Switch(checked = diagnosticsVisible, onCheckedChange = { diagnosticsVisible = it }, enabled = state.active,
                        modifier = Modifier.testTag("診断表示切替"))
                }
                Text("この画面の表示だけを変更します。OBSに送る映像は変わりません。",
                    style = MaterialTheme.typography.bodySmall)
            }
            OutdoorSettingsCategory.OTHER -> {
                appearanceContent()
                Text("連携", style = MaterialTheme.typography.titleMedium)
                OutdoorCategoryEntry("スマホ連携", "登録・接続先の確認", icon = jp.casmate.app.R.drawable.ic_smartphone_link) {
                    closeSettings(); onOpenConnection()
                }
                OutdoorCategoryEntry("配信者の音声認識", "音声認識の設定を開く") {
                    actions.openRecognition(); settingsOpen = false; draft.revision.intValue++
                }
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
        val surfaceModifier = if (drawingMode || fillAvailable && !state.videoHidden) Modifier.fillMaxSize()
            else Modifier.width(previewWidth).height(previewHeight)
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
