package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.activity.compose.BackHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import jp.casmate.app.outdoor.OutdoorDrawingRuntime

/** Navigation owns only presentation; explicit controls own service actions. */
@Composable
fun CasMateTabs(
    commentsContent: @Composable () -> Unit,
    outdoorContent: @Composable (onExportDiagnostics: () -> Unit) -> Unit,
    settingsContent: (@Composable (onClose: () -> Unit) -> Unit)? = null,
    commentsSettingsContent: @Composable (onClose: () -> Unit) -> Unit = {},
    connectionLabel: String = "接続待ち",
    onOpenConnection: () -> Unit = {},
    gesturesEnabled: Boolean = true,
    onScreenChanged: (Int) -> Unit = {},
    cameraActionStatus: String = "",
    commentsActionStatus: String = "",
    cameraNeedsAttention: Boolean = false,
    commentsNeedAttention: Boolean = false,
    readingActive: Boolean = false,
    readingRegistered: Boolean = false,
    onToggleReading: () -> Unit = {},
) {
    val connectionConfirmed = connectionLabel.contains("接続済み")
    val sendingNeedsAttention = cameraNeedsAttention || !connectionConfirmed
    val sendingStatus = listOf(cameraActionStatus, connectionLabel).filter { it.isNotBlank() }.joinToString("・")
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val drawing by OutdoorDrawingRuntime.state.collectAsStateWithLifecycle()
    val drawingMode = selected == 0 && drawing.modeActive
    var settingsOpen by remember { mutableStateOf(false) }
    var actionsOpen by remember { mutableStateOf(false) }
    var recognitionOpen by remember { mutableStateOf(false) }
    var restoreActionFocus by remember { mutableStateOf(false) }
    var restoreSettingsFocus by remember { mutableStateOf(false) }
    val actionFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    val settingsFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    val drawingInputRegions = remember { jp.casmate.app.outdoor.OutdoorDrawingInputRegions() }
    val closeActions: () -> Unit = {
        jp.casmate.app.obs.ObsControlRuntime.cancel()
        actionsOpen = false
        restoreActionFocus = true
    }
    val openSettings: () -> Unit = {
        if (!drawingMode) { closeActions(); settingsOpen = true; restoreSettingsFocus = true }
    }
    val openSending: () -> Unit = {
        jp.casmate.app.obs.ObsControlRuntime.cancel()
        settingsOpen = false; actionsOpen = true; restoreActionFocus = false
    }
    val openRecognition: () -> Unit = {
        val fromSettings = settingsOpen
        closeActions(); settingsOpen = false; recognitionOpen = true; restoreSettingsFocus = fromSettings
    }
    val closeDrawing: () -> Unit = {
        jp.casmate.app.obs.ObsControlRuntime.cancel()
        actionsOpen = false; settingsOpen = false
        OutdoorDrawingRuntime.controller.closeMode(drawing.sessionId)
        restoreSettingsFocus = true; restoreActionFocus = true
    }
    LaunchedEffect(actionsOpen, settingsOpen, recognitionOpen, drawingMode, restoreActionFocus) {
        if (!actionsOpen && !settingsOpen && !recognitionOpen && restoreActionFocus) {
            // Restore after the modal window has been disposed, not while it owns focus.
            withFrameNanos { }
            (if (restoreSettingsFocus && !drawingMode) settingsFocus else actionFocus).requestFocus()
            restoreActionFocus = false
            restoreSettingsFocus = false
        }
    }
    val savedContent = rememberSaveableStateHolder()
    // The document result registration outlives both pages and their dialogs.
    val exportDiagnostics = jp.casmate.app.outdoor.rememberOutdoorDiagnosticExporter()
    val navigationEnabled = gesturesEnabled && !drawingMode && !settingsOpen && !actionsOpen && !recognitionOpen
    val changePage: (Int) -> Unit = { page ->
        if (page != selected) { actionsOpen = false; selected = page; onScreenChanged(page) }
    }
    val flick: (Int) -> Unit = { direction ->
        if (navigationEnabled) {
            if (selected == 0 && direction < 0) changePage(1)
            else if (selected == 1 && direction > 0) changePage(0)
        }
    }
    LaunchedEffect(drawing.modeActive) {
        if (drawing.modeActive) {
            if (selected != 0) { selected = 0; onScreenChanged(0) }
            settingsOpen = false; recognitionOpen = false
        }
    }
    BackHandler(enabled = drawingMode && !actionsOpen) { closeDrawing() }
    Column(Modifier.fillMaxSize().horizontalFlick(navigationEnabled, flick)) {
        if (!drawingMode) BoxWithConstraints(Modifier.fillMaxWidth().testTag("配信共通操作")
            .padding(horizontal = 4.dp, vertical = 4.dp)) {
            val density = LocalDensity.current
            val measurer = rememberTextMeasurer()
            val labels = listOf("カメラ", "コメント")
            val style = MaterialTheme.typography.bodyMedium
            val textWidth = with(density) { ((maxWidth - 152.dp) / 2 - 16.dp).roundToPx() }.coerceAtLeast(1)
            val tabHeight = with(density) { labels.maxOf { measurer.measure(it, style,
                constraints = Constraints(maxWidth = textWidth)).size.height }.toDp() + 16.dp }.coerceAtLeast(48.dp)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(Modifier.weight(1f).testTag("機能タブ").selectableGroup(),
                    horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    labels.forEachIndexed { index, label ->
                        TextButton(onClick = { changePage(index) },
                            modifier = Modifier.weight(1f).height(tabHeight).testTag("画面切替・$label")
                                .semantics { this.selected = selected == index; role = Role.Tab }
                                .background(if (selected == index) MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.background, RoundedCornerShape(12.dp)),
                            contentPadding = PaddingValues(8.dp),
                            colors = ButtonDefaults.textButtonColors(contentColor = if (selected == index)
                                MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)) {
                            Text(label, style = style)
                        }
                    }
                }
                if (selected == 0) IconButton(onClick = {
                    restoreSettingsFocus = false; openSending()
                }, modifier = Modifier.size(48.dp).focusRequester(actionFocus).focusProperties { canFocus = true }
                    .testTag("機能操作の入口").semantics {
                        contentDescription = "送信・配信"
                        stateDescription = sendingStatus
                    }) {
                    Box(Modifier.size(24.dp)) {
                        Icon(painterResource(jp.casmate.app.R.drawable.ic_send_broadcast), null,
                            tint = if (sendingNeedsAttention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                        if (sendingNeedsAttention) Text("!",
                            Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.background),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                    }
                }
                IconButton(onClick = { actionsOpen = false; settingsOpen = false; jp.casmate.app.obs.ObsControlRuntime.cancel(); onOpenConnection() },
                    modifier = Modifier.size(48.dp).semantics {
                        contentDescription = "スマホ連携"
                        stateDescription = connectionLabel
                    }) {
                    Box(Modifier.size(28.dp)) {
                        Icon(painterResource(jp.casmate.app.R.drawable.ic_smartphone_link), null,
                            modifier = Modifier.size(24.dp).testTag("スマホ連携の入口"),
                            tint = MaterialTheme.colorScheme.primary)
                        if (connectionConfirmed) Text("✓",
                            Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.background),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary)
                    }
                }
                IconButton(onClick = { openSettings(); restoreSettingsFocus = true },
                    modifier = Modifier.size(48.dp).focusRequester(settingsFocus).focusProperties { canFocus = true }
                        .testTag(if (selected == 0) "カメラ設定の入口" else "コメント設定の入口")
                        .semantics { contentDescription = if (selected == 0) "映像・マイク" else "コメント設定と状態" }) {
                    Icon(painterResource(if (selected == 0) jp.casmate.app.R.drawable.ic_camera_actions
                        else jp.casmate.app.R.drawable.ic_comment_settings), null,
                        tint = MaterialTheme.colorScheme.primary)
                }
                if (selected == 1) IconToggleButton(checked = readingActive, onCheckedChange = { onToggleReading() },
                    enabled = readingActive || readingRegistered,
                    colors = IconButtonDefaults.iconToggleButtonColors(contentColor = MaterialTheme.colorScheme.primary,
                        checkedContentColor = MaterialTheme.colorScheme.primary,
                        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                    modifier = Modifier.size(48.dp).testTag("コメント・読み上げ操作")
                        .background(if (readingActive) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.background, RoundedCornerShape(12.dp))
                        .semantics {
                            contentDescription = if (readingActive) "読み上げを停止" else "読み上げを聞く"
                            stateDescription = "${if (readingActive) "ON" else "OFF"}・$commentsActionStatus"
                        }) {
                    Box(Modifier.size(24.dp)) {
                        Icon(painterResource(jp.casmate.app.R.drawable.ic_headphones), null)
                        if (commentsNeedAttention || readingActive) Text(if (commentsNeedAttention) "!" else "●",
                            Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.background),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (commentsNeedAttention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        CompositionLocalProvider(LocalHorizontalFlick provides flick,
            jp.casmate.app.outdoor.LocalOutdoorDrawingInputRegions provides drawingInputRegions) {
            Box(Modifier.fillMaxWidth().weight(1f).clipToBounds().testTag("機能画面")) {
                // Keep the document laid out and loaded, but outside the camera's viewport.
                // Retaining only comments leaves the camera preview and OBS observers scoped
                // to the selected camera page as before.
                CompositionLocalProvider(LocalCommentsPageVisible provides (selected == 1),
                    LocalScreenActions provides ScreenActions(false, closeActions, openSettings, openRecognition)) {
                    Box(Modifier.fillMaxSize().graphicsLayer {
                        translationX = if (selected == 1) 0f else size.width
                    }.then(if (selected == 1) Modifier else Modifier.clearAndSetSemantics {})
                        .focusProperties { canFocus = selected == 1 }) {
                        savedContent.SaveableStateProvider(1) { commentsContent() }
                    }
                }
                if (selected == 0) {
                    CompositionLocalProvider(LocalScreenActions provides ScreenActions(actionsOpen, closeActions, openSettings, openRecognition,
                        settingsOpen = settingsOpen && settingsContent == null,
                        closeSettings = { settingsOpen = false; restoreActionFocus = true })) {
                        savedContent.SaveableStateProvider(0) { outdoorContent(exportDiagnostics) }
                    }
                }
                if (drawingMode) jp.casmate.app.outdoor.OutdoorDrawingTopControls(closeDrawing,
                    { restoreSettingsFocus = false; openSending() }, actionFocus, sendingStatus,
                    Modifier.align(Alignment.TopCenter).padding(8.dp), needsAttention = sendingNeedsAttention)
            }
        }
    }
    if (settingsOpen && !drawingMode) {
        CompositionLocalProvider(LocalScreenActions provides ScreenActions(false, closeActions, openSettings, openRecognition)) {
            if (selected == 0) settingsContent?.invoke { settingsOpen = false }
            else commentsSettingsContent { settingsOpen = false }
        }
    }
    if (recognitionOpen) jp.casmate.app.recognition.SpeechRecognitionDialog { recognitionOpen = false }
}
