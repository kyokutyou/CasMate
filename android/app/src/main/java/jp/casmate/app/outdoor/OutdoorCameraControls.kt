package jp.casmate.app.outdoor

import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.MeteringRectangle
import android.os.Build
import com.pedro.encoder.input.sources.video.Camera2Source
import kotlinx.coroutines.*

data class OutdoorCameraState(val ready: Boolean = false, val zoom: Float = 1f, val minZoom: Float = 1f,
    val maxZoom: Float = 1f, val exposure: Int = 0, val minExposure: Int = 0, val maxExposure: Int = 0,
    val exposureStep: Float = 0f, val lightSupported: Boolean = false, val light: Boolean = false,
    val focusSupported: Boolean = false, val error: String = "")

/** Fit preview -> unrotated sensor coordinates; letterbox taps never focus. */
fun outdoorFocusPoint(x: Float, y: Float, viewWidth: Int, viewHeight: Int, imageWidth: Int, imageHeight: Int,
    rotation: Int, mirrored: Boolean): Pair<Float, Float>? {
    if (viewWidth <= 0 || viewHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null
    val scale = minOf(viewWidth.toFloat() / imageWidth, viewHeight.toFloat() / imageHeight)
    val left = (viewWidth - imageWidth * scale) / 2; val top = (viewHeight - imageHeight * scale) / 2
    var u = (x - left) / (imageWidth * scale); val v = (y - top) / (imageHeight * scale)
    if (u !in 0f..1f || v !in 0f..1f) return null
    if (mirrored) u = 1 - u
    return when ((rotation % 360 + 360) % 360) { 90 -> v to 1 - u; 180 -> 1 - u to 1 - v; 270 -> 1 - v to u; else -> u to v }
}

/** Reverse CameraRender's vertex rotation, then use the exact SurfaceTexture sampling matrix.
 * This includes the camera producer's rotation/crop/mirroring, including front cameras.
 */
fun outdoorTextureFocusPoint(point: Pair<Float, Float>, cameraRotation: Int, texture: FloatArray): Pair<Float, Float>? {
    if (texture.size != 16 || texture.any { !it.isFinite() }) return null
    val (x, y) = point
    val rotated = when ((cameraRotation % 360 + 360) % 360) {
        90 -> y to 1 - x; 180 -> 1 - x to 1 - y; 270 -> 1 - y to x; else -> x to y
    }
    val u = rotated.first; val v = 1 - rotated.second
    val sx = texture[0] * u + texture[4] * v + texture[12]
    val sy = texture[1] * u + texture[5] * v + texture[13]
    return if (sx in 0f..1f && sy in 0f..1f) sx to sy else null
}

class OutdoorCameraControls(private val camera: Camera2Source, private val c: CameraCharacteristics,
    private val scope: CoroutineScope, private val publish: (OutdoorCameraState) -> Unit) {
    private var resetFocus: Job? = null
    private var pendingAfIdle = false
    private var focusId = 0L
    private val sensor = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: Rect()
    private val ratioZoom = Build.VERSION.SDK_INT >= 30 && c.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) != null
    private var crop = Rect(sensor)
    private var state = OutdoorCameraState()
    fun initialize() {
        val zoom = camera.getZoomRange()
        val exposure = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)
        state = OutdoorCameraState(true, 1f.coerceIn(zoom.lower, zoom.upper), zoom.lower, zoom.upper,
            minExposure = exposure?.lower ?: 0, maxExposure = exposure?.upper ?: 0,
            exposureStep = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.toFloat() ?: 0f,
            lightSupported = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true,
            focusSupported = (c.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AF) ?: 0) > 0 &&
                c.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.contains(CaptureRequest.CONTROL_AF_MODE_AUTO) == true)
        adjust {
            check(camera.setCustomRequest { b ->
                b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, 0)
                b.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF)
                if (ratioZoom) b.set(CaptureRequest.CONTROL_ZOOM_RATIO, state.zoom)
                else b.set(CaptureRequest.SCALER_CROP_REGION, sensor)
            })
            if (state.focusSupported) check(camera.enableAutoFocus())
        }
    }
    private fun adjust(action: () -> Unit) {
        try { action(); state = state.copy(error = "") }
        catch (_: Exception) { state = state.copy(error = "カメラ調整に失敗しました。再操作してください。") }
        publish(state)
    }
    fun zoom(value: Float) = adjust {
        require(value.isFinite() && value in state.minZoom..state.maxZoom)
        val next = if (ratioZoom) Rect(sensor) else {
            val w = (sensor.width() / value).toInt(); val h = (sensor.height() / value).toInt()
            Rect(sensor.centerX() - w / 2, sensor.centerY() - h / 2, sensor.centerX() + w / 2, sensor.centerY() + h / 2)
        }
        check(camera.setCustomRequest {
            if (ratioZoom) it.set(CaptureRequest.CONTROL_ZOOM_RATIO, value)
            else it.set(CaptureRequest.SCALER_CROP_REGION, next)
        })
        crop = next; state = state.copy(zoom = value)
    }
    fun exposure(value: Int) = adjust {
        require(value in state.minExposure..state.maxExposure)
        check(camera.setCustomRequest { it.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, value) })
        state = state.copy(exposure = value)
    }
    fun light(enabled: Boolean) = adjust {
        require(state.lightSupported)
        check(camera.setCustomRequest { it.set(CaptureRequest.FLASH_MODE, if (enabled) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF) })
        state = state.copy(light = enabled)
    }
    fun focus(point: Pair<Float, Float>, aspect: Float) = adjust {
        require(state.focusSupported && !sensor.isEmpty)
        // The camera's output uses a centered crop to the selected stream aspect ratio.
        val visible = Rect(crop)
        if (visible.width().toFloat() / visible.height() > aspect) {
            val width = (visible.height() * aspect).toInt(); visible.left = crop.centerX() - width / 2; visible.right = visible.left + width
        } else {
            val height = (visible.width() / aspect).toInt(); visible.top = crop.centerY() - height / 2; visible.bottom = visible.top + height
        }
        val w = minOf(200, visible.width()); val h = minOf(200, visible.height())
        val x = (visible.left + point.first * visible.width() - w / 2).toInt().coerceIn(visible.left, visible.right - w)
        val y = (visible.top + point.second * visible.height() - h / 2).toInt().coerceIn(visible.top, visible.bottom - h)
        val id = ++focusId
        check(camera.setCustomRequest { b ->
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO)
            b.set(CaptureRequest.CONTROL_AF_REGIONS, arrayOf(MeteringRectangle(x, y, w, h, MeteringRectangle.METERING_WEIGHT_MAX)))
            b.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START)
            b.setTag(id)
        })
        pendingAfIdle = true
        resetFocus?.cancel(); resetFocus = scope.launch { delay(3000); adjust { check(camera.enableAutoFocus()) } }
    }
    fun captured(request: CaptureRequest) {
        if (!pendingAfIdle || request.tag != focusId || request.get(CaptureRequest.CONTROL_AF_TRIGGER) != CaptureRequest.CONTROL_AF_TRIGGER_START) return
        pendingAfIdle = false
        adjust { check(camera.setCustomRequest { it.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE) }) }
    }
    fun close() {
        resetFocus?.cancel(); pendingAfIdle = false
        runCatching { camera.setCustomRequest { it.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF) } }
    }
}
