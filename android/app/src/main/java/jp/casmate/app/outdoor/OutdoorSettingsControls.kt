package jp.casmate.app.outdoor

import jp.casmate.app.ui.CasMateSwitch as Switch
import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

@Composable fun OutdoorQualityControls(quality: OutdoorQuality, active: Boolean, front: Boolean, portrait: Boolean,
    onChange: (OutdoorQuality) -> Unit) {
    val context = LocalContext.current
    Text("送信品質：${quality.preset}", style = MaterialTheme.typography.titleMedium)
    if (active) Text("変更するには映像・音声の送信を停止してください")
    Choice("映像形式", OutdoorVideoCodec.entries, quality.videoCodec, !active, { it.label }) {
        onChange(quality.copy(videoCodec = it))
    }
    Choice("ビットレート制御", OutdoorBitrateMode.entries, quality.bitrateMode, !active, { it.label }) {
        onChange(quality.withMode(it))
    }
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("弱回線対策")
        Switch(checked = quality.audioFirst, enabled = !active && quality.bitrateMode == OutdoorBitrateMode.AUTO,
            modifier = Modifier.testTag("弱回線対策スイッチ"),
            onCheckedChange = { onChange(quality.copy(audioFirst = it)) })
    }
    Text(if (quality.bitrateMode == OutdoorBitrateMode.FIXED) "弱回線対策は自動モードで利用できます" else
        "回線に合わせて映像量を調整します。弱回線対策オンでは低画質の動画を優先し、必要な場合だけ現在画像で静止します。")
    val presets = remember(quality, front, portrait) {
        OutdoorQuality.presets().map { quality.applyPreset(it) }.map { it to OutdoorCapabilities.unsupported(context, it, front, portrait) }
    }
    presets.forEach { (preset, reason) ->
        FilterChip(selected = quality.preset == preset.preset, enabled = !active && reason == null,
            onClick = { onChange(preset) }, label = { Text(preset.preset) })
        if (reason != null) Text("${preset.preset}：$reason", style = MaterialTheme.typography.bodySmall)
    }
    if (quality.bitrateMode == OutdoorBitrateMode.FIXED) {
        BitrateControl("映像ビットレート", quality.videoBitrate, !active) { onChange(quality.copy(videoBitrate = it).custom()) }
    } else {
        BitrateControl("通常動画の下限", quality.autoMinBitrate, !active) {
            if (it <= quality.autoMaxBitrate) onChange(quality.copy(autoMinBitrate = it).custom())
        }
        BitrateControl("通常動画の上限", quality.autoMaxBitrate, !active) {
            if (it >= quality.autoMinBitrate) onChange(quality.copy(autoMaxBitrate = it).custom())
        }
        Text("下限は上限以下に設定してください。表示値はエンコーダー目標値で、通信量の保証ではありません。")
    }
    Choice("解像度", OutdoorQuality.resolutions, quality.width to quality.height, !active,
        { "${it.first}×${it.second}" }) { onChange(quality.copy(width = it.first, height = it.second).custom()) }
    Choice("フレームレート", OutdoorQuality.frameRates, quality.fps, !active, { "${it}fps" }) { onChange(quality.copy(fps = it).custom()) }
    Text("SRT遅延バッファ：${quality.latencyMs}ms")
    Slider(value = quality.latencyMs.toFloat(), valueRange = 200f..3000f, steps = 27, enabled = !active,
        onValueChange = { onChange(quality.copy(latencyMs = (it / 100).roundToInt() * 100).custom()) })
    Choice("音声ビットレート", OutdoorQuality.audioRates, quality.audioBitrate, !active, { "${it / 1000}kbps" }) { onChange(quality.copy(audioBitrate = it).custom()) }
    Choice("キーフレーム間隔", OutdoorQuality.keyframes, quality.keyframeSeconds, !active, { "${it}秒" }) { onChange(quality.copy(keyframeSeconds = it).custom()) }
    val reason = remember(quality, front, portrait) { OutdoorCapabilities.unsupported(context, quality, front, portrait) }
    if (reason != null) Text(reason, color = MaterialTheme.colorScheme.error)
    Text("SRT遅延バッファは要求値で、撮影からOBS表示までの総遅延ではありません。OBS側の受信遅延が大きい場合、Androidだけでは小さくできません。解像度・fps変更後はOBSの受信と配置を確認してください。", style = MaterialTheme.typography.bodySmall)
}

@Composable private fun BitrateControl(label: String, value: Int, enabled: Boolean, change: (Int) -> Unit) {
    Text("$label：${"%.1f".format(value / 1000000.0)}Mbps（エンコーダー目標値）")
    Slider(value = value / 100000f, valueRange = 5f..120f, steps = 114, enabled = enabled,
        onValueChange = { change(it.roundToInt() * 100000) })
}

@Composable private fun <T> Choice(label: String, options: List<T>, selected: T, enabled: Boolean,
    text: (T) -> String, choose: (T) -> Unit) {
    Text("$label：${text(selected)}")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEach { option -> FilterChip(selected = selected == option, enabled = enabled,
            onClick = { choose(option) }, label = { Text(text(option)) }) }
    }
}

@Composable fun OutdoorCameraSettings(state: OutdoorCameraState, locked: Boolean = false) {
    Text("カメラ調整", style = MaterialTheme.typography.titleMedium)
    Text(when { locked -> "映像の静止・復帰試行・故障中はカメラを調整できません"
        !state.ready -> "映像送信を開始してから操作できます"; else -> "" }, modifier = Modifier.height(64.dp))
    Text("ズーム：${"%.1f".format(state.zoom)}倍")
    Slider(value = state.zoom, onValueChange = { OutdoorRuntime.service?.setZoom(it) },
        enabled = state.ready && !locked && state.maxZoom > state.minZoom,
        valueRange = state.minZoom..maxOf(state.maxZoom, state.minZoom + 0.01f))
    if (state.ready && state.maxZoom == state.minZoom) Text("このカメラはズームに対応していません")
    Text("明るさ（露出補正）：${state.exposure}（${"%+.2f".format(state.exposure * state.exposureStep)}EV）")
    Slider(value = state.exposure.toFloat(), onValueChange = { OutdoorRuntime.service?.setExposure(it.roundToInt()) },
        enabled = state.ready && !locked && state.minExposure < state.maxExposure,
        steps = (state.maxExposure - state.minExposure - 1).coerceAtLeast(0),
        valueRange = state.minExposure.toFloat()..maxOf(state.maxExposure, state.minExposure + 1).toFloat())
    if (state.ready && state.maxExposure == state.minExposure) Text("このカメラは露出補正に対応していません")
    Row {
        Text("ライト")
        Switch(checked = state.light, enabled = state.ready && !locked && state.lightSupported,
            onCheckedChange = { OutdoorRuntime.service?.setLight(it) })
    }
    if (state.ready && !state.lightSupported) Text("このカメラにはライトがありません")
    Text(if (state.focusSupported) "プレビューの映像をタップするとピントを合わせます" else "この状態ではタップによるピント合わせを利用できません")
    if (state.error.isNotEmpty()) Text(state.error, color = MaterialTheme.colorScheme.error)
}
