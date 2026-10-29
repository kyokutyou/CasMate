package jp.casmate.app.outdoor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import jp.casmate.app.R
import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateTextButton as TextButton
import kotlinx.coroutines.delay

private val floatingBackground = Color(0xE815251F)
private val selectedBackground = Color(0xFF078955)

/** Compose overlays never enter the camera's GL texture or the encoded output. */
@Composable
internal fun OutdoorDrawingPanel(
    drawing: OutdoorDrawingState,
    video: OutdoorState,
    menuOpen: Boolean,
    paletteOpen: Boolean,
    onPaletteOpen: (Boolean) -> Unit,
    viewport: OutdoorDrawingViewport,
    onViewportChange: (OutdoorDrawingViewport) -> Unit,
    preview: @Composable (Modifier) -> Unit,
) {
    val editable = drawing.editEnabled && !video.videoHidden && !video.videoChanging && !video.videoRecovering && video.videoFaults.isEmpty() && !menuOpen
    val enabled = editable && !paletteOpen
    val controller = OutdoorDrawingRuntime.controller
    val session = drawing.sessionId
    val paletteFocus = remember { FocusRequester() }
    var restorePaletteFocus by remember { mutableStateOf(false) }
    var area by remember { mutableStateOf(IntSize.Zero) }
    LaunchedEffect(area, session, viewport.initialized) {
        if (!viewport.initialized && area.width > 0 && area.height > 0) {
            val outWidth = if (video.portrait) video.quality.height else video.quality.width
            val outHeight = if (video.portrait) video.quality.width else video.quality.height
            onViewportChange(OutdoorDrawingViewport.centeredFill(area.width.toFloat(), area.height.toFloat(), outWidth, outHeight))
        }
    }
    val closePalette: () -> Unit = { onPaletteOpen(false); restorePaletteFocus = true }
    LaunchedEffect(editable) { if (!editable && paletteOpen) closePalette() }
    LaunchedEffect(paletteOpen, restorePaletteFocus, editable) {
        if (!paletteOpen && restorePaletteFocus) {
            if (editable) { withFrameNanos { }; paletteFocus.requestFocus() }
            restorePaletteFocus = false
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().onSizeChanged { area = it }.testTag("手書きモード")) {
        preview(Modifier.fillMaxSize())
        Row(Modifier.align(Alignment.BottomCenter).padding(horizontal = 8.dp, vertical = 12.dp)
            .widthIn(max = 352.dp).fillMaxWidth().height(56.dp)
            .background(floatingBackground, RoundedCornerShape(20.dp)).testTag("手書き編集操作").drawingInputRegion()
            .pointerInput(Unit) { detectTapGestures {} }.padding(4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            DrawingFloatingAction("ペン", "手書き・ペン", enabled, drawing.tool == OutdoorDrawingTool.PEN,
                Modifier.weight(1f), { controller.setTool(session, OutdoorDrawingTool.PEN) }) { DrawingIcon(R.drawable.ic_drawing_pen) }
            DrawingFloatingAction("消しゴム", "手書き・消しゴム", enabled, drawing.tool == OutdoorDrawingTool.ERASER,
                Modifier.weight(1f), { controller.setTool(session, OutdoorDrawingTool.ERASER) }) { DrawingIcon(R.drawable.ic_drawing_eraser) }
            DrawingFloatingAction("色と太さ。${drawing.color.label}、${drawing.width.label}", "手書き・色と太さ", enabled,
                modifier = Modifier.weight(1f).focusRequester(paletteFocus), onClick = { onPaletteOpen(true) }) {
                Box(Modifier.size(24.dp)) {
                    Box(Modifier.align(Alignment.TopCenter).size(19.dp).background(Color(drawing.color.argb), CircleShape)
                        .border(BorderStroke(1.dp, Color.White), CircleShape))
                    Box(Modifier.align(Alignment.BottomCenter).width(22.dp).height(when (drawing.width) {
                        OutdoorDrawingWidth.THIN -> 1.dp; OutdoorDrawingWidth.MEDIUM -> 2.dp; OutdoorDrawingWidth.THICK -> 4.dp
                    }).background(Color(drawing.color.argb), RoundedCornerShape(3.dp)))
                }
            }
            DrawingFloatingAction("元に戻す", "手書き・元に戻す", enabled && drawing.canUndo,
                modifier = Modifier.weight(1f), onClick = { controller.undo(session) }) { DrawingIcon(R.drawable.ic_drawing_undo) }
            DrawingFloatingAction(if (viewport.nextFill) "映像中央を表示領域いっぱいに拡大" else "送信映像全体を表示",
                "手書き・全体表示", !menuOpen && !paletteOpen && !video.videoHidden && area.width > 0 && area.height > 0,
                modifier = Modifier.weight(1f), onClick = {
                    val outWidth = if (video.portrait) video.quality.height else video.quality.width
                    val outHeight = if (video.portrait) video.quality.width else video.quality.height
                    onViewportChange(viewport.toggled(area.width.toFloat(), area.height.toFloat(), outWidth, outHeight))
                }) { DrawingIcon(R.drawable.ic_drawing_view) }
            DrawingFloatingAction("全消去。元に戻せます", "手書き・全消去", enabled && drawing.hasDrawing,
                modifier = Modifier.weight(1f), onClick = { controller.clear(session) }) { DrawingIcon(R.drawable.ic_drawing_clear) }
        }
        val status = when {
            drawing.error.isNotEmpty() -> drawing.error
            video.videoHidden -> "映像非表示中"
            video.videoFaults.isNotEmpty() -> "映像の復旧後に手書きできます"
            video.videoChanging || video.videoRecovering || !drawing.editEnabled -> "カメラの準備中"
            drawing.pending -> "反映待ち"
            else -> ""
        }
        if (status.isNotEmpty()) {
            val error = drawing.error.isNotEmpty()
            Row(Modifier.align(Alignment.TopCenter).padding(start = if (error) 12.dp else 64.dp,
                end = if (error) 12.dp else 64.dp, top = if (error) 64.dp else 8.dp)
                .heightIn(max = (maxHeight - 144.dp).coerceAtLeast(48.dp))
                .background(if (error) Color(0xED581F29) else floatingBackground, RoundedCornerShape(12.dp))
                .testTag("手書き状態欄").drawingInputRegion().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(status, Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).testTag("手書き状態")
                    .semantics { contentDescription = if (drawing.pending && !error) "配信映像への反映待ち" else status },
                    style = MaterialTheme.typography.bodySmall, color = Color.White)
                if (error) TextButton(onClick = { controller.retry(session) }, enabled = !menuOpen && !paletteOpen,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("手書き・再試行")) { Text("再試行", color = Color.White) }
            }
        }
    }
    if (paletteOpen) DrawingPalette(drawing, closePalette,
        onColor = { controller.setColor(session, it); controller.setTool(session, OutdoorDrawingTool.PEN); closePalette() },
        onWidth = { controller.setWidth(session, it); closePalette() })
}

@Composable
internal fun OutdoorDrawingTopControls(onClose: () -> Unit, onSending: () -> Unit,
    actionFocus: FocusRequester, sendingStatus: String, modifier: Modifier = Modifier, needsAttention: Boolean = false) {
    Row(modifier.fillMaxWidth().testTag("手書き上部操作"), horizontalArrangement = Arrangement.SpaceBetween) {
        DrawingFloatingAction("手書きを閉じる", "手書きを閉じる", modifier = Modifier.width(48.dp)
            .background(floatingBackground, RoundedCornerShape(16.dp)), onClick = onClose) { DrawingIcon(R.drawable.ic_drawing_close) }
        DrawingFloatingAction("送信・配信", "機能操作の入口", modifier = Modifier.width(48.dp)
            .background(if (needsAttention) MaterialTheme.colorScheme.surface else floatingBackground, RoundedCornerShape(16.dp)).focusRequester(actionFocus)
            .semantics { stateDescription = sendingStatus }, onClick = onSending) {
            Box(Modifier.size(24.dp)) {
                DrawingIcon(R.drawable.ic_send_broadcast, if (needsAttention) MaterialTheme.colorScheme.error else Color.White)
                if (needsAttention) Text("!", Modifier.align(Alignment.TopEnd),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun DrawingIcon(resource: Int, tint: Color = Color.White) { Icon(painterResource(resource), null, Modifier.size(24.dp), tint = tint) }

@Composable
private fun DrawingFloatingAction(label: String, tag: String, enabled: Boolean = true, checked: Boolean? = null,
    modifier: Modifier = Modifier, onClick: () -> Unit, content: @Composable () -> Unit) {
    var tooltip by remember { mutableStateOf(false) }
    LaunchedEffect(tooltip) { if (tooltip) { delay(1400); tooltip = false } }
    Box(modifier.height(48.dp).drawingInputRegion().focusProperties { canFocus = enabled }
        .combinedClickable(enabled = enabled, role = Role.Button, onClickLabel = label, onLongClickLabel = label,
            onClick = onClick, onLongClick = { tooltip = true }).testTag(tag)
        .semantics { contentDescription = label; if (checked != null) selected = checked }.clip(RoundedCornerShape(13.dp))
        .then(if (checked == true) Modifier.background(selectedBackground) else Modifier), contentAlignment = Alignment.Center) {
        Box(Modifier.alpha(if (enabled) 1f else .38f)) { content() }
        if (tooltip) Popup(alignment = Alignment.TopCenter, properties = PopupProperties(focusable = false)) {
            Surface(shape = RoundedCornerShape(8.dp), color = floatingBackground) {
                Text(label, Modifier.padding(8.dp), color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun DrawingPalette(drawing: OutdoorDrawingState, onClose: () -> Unit,
    onColor: (OutdoorDrawingColor) -> Unit, onWidth: (OutdoorDrawingWidth) -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)
            .pointerInput(onClose) { detectTapGestures { onClose() } }.padding(horizontal = 8.dp), contentAlignment = Alignment.BottomCenter) {
            Surface(Modifier.padding(bottom = 80.dp).widthIn(max = 480.dp).fillMaxWidth()
                .heightIn(max = (maxHeight - 88.dp).coerceAtLeast(48.dp)).testTag("手書き色太さパネル")
                .pointerInput(Unit) { detectTapGestures {} }, shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("色と太さ", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        DrawingFloatingAction("パネルを閉じる", "手書き色太さを閉じる", modifier = Modifier.width(48.dp), onClick = onClose) {
                            Icon(painterResource(R.drawable.ic_drawing_close), null, tint = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    Text("色", style = MaterialTheme.typography.labelLarge)
                    OutdoorDrawingColor.entries.chunked(3).forEach { colors ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            colors.forEach { color -> FilterChip(drawing.color == color, { onColor(color) },
                                label = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Box(Modifier.size(16.dp).background(Color(color.argb), CircleShape).border(BorderStroke(1.dp, MaterialTheme.colorScheme.onSurface), CircleShape))
                                    Text(color.label)
                                } }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("手書き色・${color.label}")) }
                        }
                    }
                    Text("太さ", style = MaterialTheme.typography.labelLarge)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        OutdoorDrawingWidth.entries.forEach { width -> FilterChip(drawing.width == width, { onWidth(width) },
                            label = { Text(width.label) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("手書き太さ・${width.label}")) }
                    }
                }
            }
        }
    }
}
