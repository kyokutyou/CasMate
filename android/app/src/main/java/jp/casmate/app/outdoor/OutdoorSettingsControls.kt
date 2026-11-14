package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateSwitch as Switch
import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

@Composable fun OutdoorQualityControls(quality: OutdoorQuality, active: Boolean, front: Boolean, portrait: Boolean,
    showLockNotice: Boolean = true, onChange: (OutdoorQuality) -> Unit) {
    val context = LocalContext.current
    var technicalExpanded by rememberSaveable { mutableStateOf(false) }
    val presets = remember(context, quality, front, portrait) {
        OutdoorQuality.presets().map { quality.applyPreset(it) }.map { it to OutdoorCapabilities.unsupported(context, it, front, portrait) }
    }
    val reason = remember(context, quality, front, portrait) { OutdoorCapabilities.unsupported(context, quality, front, portrait) }

    Text("品質プリセット：${quality.preset}", style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() })
    if (active && showLockNotice) Text("設定を変更するには映像送信を停止してください")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        presets.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pair.forEach { (preset, unsupported) ->
                    FilterChip(selected = quality.preset == preset.preset, enabled = !active && unsupported == null,
                        modifier = Modifier.weight(1f).heightIn(min = 72.dp).testTag("画質プリセット・${preset.preset}"),
                        onClick = { onChange(preset) }, label = {
                            Column(Modifier.padding(vertical = 8.dp)) {
                                Text(preset.preset)
                                Text("${preset.height}p・${preset.fps}fps", style = MaterialTheme.typography.labelSmall)
                            }
                        })
                }
            }
        }
    }
    presets.forEach { (preset, unsupported) ->
        if (unsupported != null) Text("${preset.preset}：$unsupported", style = MaterialTheme.typography.bodySmall)
    }
    SettingSelect("解像度", OutdoorQuality.resolutions, quality.width to quality.height, !active,
        { "${it.first}×${it.second}" }) { onChange(quality.copy(width = it.first, height = it.second).custom()) }
    SettingSelect("フレームレート", OutdoorQuality.frameRates, quality.fps, !active, { "${it}fps" }) { onChange(quality.copy(fps = it).custom()) }
    Text("解像度・fpsを変えた後は、OBSの映像と配置を確認してください。", style = MaterialTheme.typography.bodySmall)
    if (reason != null) Text(reason, color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("品質の非対応理由"))

    Text("回線が不安定なとき", style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() })
    Choice("ビットレート制御", OutdoorBitrateMode.entries, quality.bitrateMode, !active, { it.label }) {
        onChange(quality.withMode(it))
    }
    if (quality.bitrateMode == OutdoorBitrateMode.FIXED) {
        BitrateControl("映像ビットレート", quality.videoBitrate, !active) { onChange(quality.copy(videoBitrate = it).custom()) }
        Text("固定では目標値を維持し、回線悪化による自動低下や静止は行いません。", style = MaterialTheme.typography.bodySmall)
    } else {
        BitrateControl("通常動画の下限", quality.autoMinBitrate, !active) {
            if (it <= quality.autoMaxBitrate) onChange(quality.copy(autoMinBitrate = it).custom())
        }
        BitrateControl("通常動画の上限", quality.autoMaxBitrate, !active) {
            if (it >= quality.autoMinBitrate) onChange(quality.copy(autoMaxBitrate = it).custom())
        }
        Text("下限は上限以下に設定してください。", style = MaterialTheme.typography.bodySmall)
    }
    Text("ビットレートはエンコーダーの目標値です。通信量の上限を保証する値ではありません。", style = MaterialTheme.typography.bodySmall)
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("弱回線対策", Modifier.weight(1f))
        Switch(checked = quality.audioFirst, enabled = !active && quality.bitrateMode == OutdoorBitrateMode.AUTO,
            modifier = Modifier.testTag("弱回線対策スイッチ"),
            onCheckedChange = { onChange(quality.copy(audioFirst = it)) })
    }
    Text(if (quality.bitrateMode == OutdoorBitrateMode.FIXED) "弱回線対策は自動モードで利用できます" else
        "回線に合わせて映像量を調整します。弱回線対策オンでは低画質の動画を優先し、必要な場合だけ現在画像で静止します。")

    TextButton(onClick = { technicalExpanded = !technicalExpanded },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("通信と形式の詳細を開閉")
            .semantics { stateDescription = if (technicalExpanded) "展開中" else "折りたたみ" }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("通信と形式の詳細", modifier = Modifier.weight(1f))
            Text(if (technicalExpanded) "閉じる" else "開く")
        }
    }
    if (technicalExpanded) {
        SettingSelect("映像形式", OutdoorVideoCodec.entries, quality.videoCodec, !active, { it.label }) {
            onChange(quality.copy(videoCodec = it))
        }
        SettingSelect("SRT遅延バッファ", (200..3000 step 100).toList(), quality.latencyMs, !active, { "${it}ms" }) {
            onChange(quality.copy(latencyMs = it).custom())
        }
        Text("SRT遅延バッファは要求値で、撮影からOBS表示までの総遅延ではありません。OBS側の受信遅延が大きい場合、Androidだけでは小さくできません。", style = MaterialTheme.typography.bodySmall)
        SettingSelect("音声ビットレート", OutdoorQuality.audioRates, quality.audioBitrate, !active, { "${it / 1000}kbps" }) { onChange(quality.copy(audioBitrate = it).custom()) }
        SettingSelect("キーフレーム間隔", OutdoorQuality.keyframes, quality.keyframeSeconds, !active, { "${it}秒" }) { onChange(quality.copy(keyframeSeconds = it).custom()) }
    } else {
        Text("${quality.videoCodec.label}・SRT遅延${quality.latencyMs}ms・音声${quality.audioBitrate / 1000}kbps・キーフレーム${quality.keyframeSeconds}秒",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("通信と形式の要約"))
    }
}

@Composable private fun <T> SettingSelect(label: String, options: List<T>, value: T, enabled: Boolean,
    text: (T) -> String, choose: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(enabled) { if (!enabled) expanded = false }
    Text(label)
    Box(Modifier.fillMaxWidth()) {
        jp.casmate.app.ui.CasMateOutlinedButton(onClick = { expanded = true }, enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("${label}選択欄")
                .semantics { stateDescription = text(value) }) {
            Text(text(value), Modifier.weight(1f))
            Text("▾")
        }
        DropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = { Text(text(option)) },
                    modifier = Modifier.semantics { selected = option == value },
                    onClick = { if (enabled) { expanded = false; choose(option) } })
            }
        }
    }
}

@Composable private fun BitrateControl(label: String, value: Int, enabled: Boolean, change: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f))
        Text("${"%.1f".format(value / 1000000.0)} Mbps", Modifier.testTag("${label}の現在値"))
    }
    Slider(value = value / 100000f, valueRange = 5f..120f, steps = 114, enabled = enabled,
        modifier = Modifier.testTag("${label}スライダー"),
        onValueChange = { change(it.roundToInt() * 100000) })
}

@Composable private fun <T> Choice(label: String, options: List<T>, selected: T, enabled: Boolean,
    text: (T) -> String, choose: (T) -> Unit) {
    Text(label)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEach { option -> FilterChip(selected = selected == option, enabled = enabled,
            onClick = { choose(option) }, label = { Text(text(option)) }) }
    }
}

@Composable fun OutdoorCameraSettings(state: OutdoorCameraState, locked: Boolean = false, active: Boolean = false) {
    val reason = when { state.error.isNotEmpty() -> state.error
        locked -> "映像の静止・復帰試行・故障中はカメラを調整できません"
        !state.ready && active -> "カメラを準備しています。準備が終わると操作できます。"
        !state.ready -> "映像送信を開始してから操作できます"; else -> "" }
    Row(Modifier.fillMaxWidth()) {
        Text("ズーム", Modifier.weight(1f))
        Text("${"%.1f".format(state.zoom)}×")
    }
    Slider(value = state.zoom, onValueChange = { OutdoorRuntime.service?.setZoom(it) },
        enabled = state.ready && !locked && state.maxZoom > state.minZoom,
        valueRange = state.minZoom..maxOf(state.maxZoom, state.minZoom + 0.01f))
    if (state.ready && state.maxZoom == state.minZoom) Text("このカメラはズームに対応していません")
    Row(Modifier.fillMaxWidth()) {
        Text("明るさ", Modifier.weight(1f))
        Text("${"%+.1f".format(state.exposure * state.exposureStep)} EV")
    }
    Slider(value = state.exposure.toFloat(), onValueChange = { OutdoorRuntime.service?.setExposure(it.roundToInt()) },
        enabled = state.ready && !locked && state.minExposure < state.maxExposure,
        steps = (state.maxExposure - state.minExposure - 1).coerceAtLeast(0),
        valueRange = state.minExposure.toFloat()..maxOf(state.maxExposure, state.minExposure + 1).toFloat())
    if (state.ready && state.maxExposure == state.minExposure) Text("このカメラは露出補正に対応していません")
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("ライト", Modifier.weight(1f))
        Switch(checked = state.light, enabled = state.ready && !locked && state.lightSupported,
            onCheckedChange = { OutdoorRuntime.service?.setLight(it) })
    }
    if (state.ready && !state.lightSupported) Text("このカメラにはライトがありません")
    Box(Modifier.fillMaxWidth().height(48.dp * LocalDensity.current.fontScale)
        .verticalScroll(rememberScrollState()).testTag("カメラ調整の状態")) {
        Text(reason.ifEmpty { if (state.focusSupported) "映像をタップしてピント合わせ" else "タップによるピント合わせは利用できません" },
            style = MaterialTheme.typography.bodySmall,
            color = if (state.error.isNotEmpty()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
