package jp.casmate.app.outdoor

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.MediaCodecList
import android.media.MediaCodecInfo
import android.util.Size
import com.pedro.encoder.utils.CodecUtil

object OutdoorCapabilities {
    // Match RootEncoder 2.8.1's HARDWARE/SURFACE selection order. Checking a later
    // capable codec would falsely accept a quality the selected codec cannot encode.
    internal fun videoUnsupported(quality: OutdoorQuality, portrait: Boolean): Boolean {
        val mime = quality.videoCodec.mime
        val selected = CodecUtil.getAllHardwareEncoders(mime, true).firstOrNull { codec ->
            CodecUtil.getCapabilities(codec, mime)?.colorFormats?.contains(
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface) == true
        } ?: return true
        if (!selected.isHardwareAccelerated) return true
        val caps = CodecUtil.getCapabilities(selected, mime)?.videoCapabilities ?: return true
        val width = if (portrait) quality.height else quality.width
        val height = if (portrait) quality.width else quality.height
        val minimum = quality.initialBitrate
        val maximum = if (quality.bitrateMode == OutdoorBitrateMode.AUTO) quality.autoMaxBitrate else quality.videoBitrate
        return !caps.areSizeAndRateSupported(width, height, quality.fps.toDouble()) ||
            !caps.bitrateRange.contains(minimum) || !caps.bitrateRange.contains(maximum)
    }
    fun selectedMinimum(quality: OutdoorQuality, name: String): Int {
        val selected = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { it.name == name }
            ?: error("QUALITY_UNSUPPORTED")
        val range = selected.getCapabilitiesForType(quality.videoCodec.mime).videoCapabilities?.bitrateRange
            ?: error("QUALITY_UNSUPPORTED")
        check(range.contains(quality.initialBitrate) && range.contains(if (quality.bitrateMode == OutdoorBitrateMode.AUTO)
            quality.autoMaxBitrate else quality.videoBitrate)) { "QUALITY_UNSUPPORTED" }
        return range.lower
    }
    fun characteristics(context: Context, front: Boolean): CameraCharacteristics {
        val manager = context.getSystemService(CameraManager::class.java)
        val facing = if (front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
        val id = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == facing }
            ?: error("選択したカメラを利用できません")
        return manager.getCameraCharacteristics(id)
    }
    fun unsupported(context: Context, quality: OutdoorQuality, front: Boolean, portrait: Boolean): String? = try {
        val c = characteristics(context, front)
        val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val size = Size(quality.width, quality.height)
        val duration = if (map?.getOutputSizes(SurfaceTexture::class.java)?.contains(size) == true)
            map.getOutputMinFrameDuration(SurfaceTexture::class.java, size) else -1
        val rates = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        when {
            duration < 0 -> "このカメラは${quality.width}×${quality.height}に対応していません"
            rates?.any { it.contains(quality.fps) } != true || (duration > 0 && 1e9 / duration + 0.01 < quality.fps) ->
                "このカメラは選択解像度の${quality.fps}fpsに対応していません"
            videoUnsupported(quality, portrait) -> "${quality.videoCodec.label}のハードウェアエンコーダーが選択した解像度・fps・映像ビットレートに対応していません"
            !MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { codec -> codec.isEncoder && runCatching {
                val caps = codec.getCapabilitiesForType("audio/mp4a-latm").audioCapabilities
                caps != null && caps.isSampleRateSupported(48000) && caps.bitrateRange.contains(quality.audioBitrate)
            }.getOrDefault(false) } -> "選択した音声ビットレートに対応するAACエンコーダーがありません"
            else -> null
        }
    } catch (_: Exception) { "カメラ・エンコーダーの対応品質を確認できません" }
}
