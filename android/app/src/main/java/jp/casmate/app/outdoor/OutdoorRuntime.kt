package jp.casmate.app.outdoor

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class OutdoorVideoFault { CAMERA, CODEC, RENDER }
data class OutdoorState(val active: Boolean = false, val status: String = "stopped", val muted: Boolean = true,
    val error: String = "NONE", val reportOk: Boolean = false, val warning: String = "",
    val volume: Int = 100, val manualMute: Boolean = false, val inputLost: Boolean = true,
    val peak: Float = 0f, val clipping: Boolean = false, val statistics: OutdoorStatistics = OutdoorStatistics(),
    val camera: OutdoorCameraState = OutdoorCameraState(), val quality: OutdoorQuality = OutdoorQuality(),
    val portrait: Boolean = false, val front: Boolean = false, val detail: String = "",
    val inputPreparing: Boolean = false, val deviceId: Int = -1,
    val videoHidden: Boolean = false, val videoChanging: Boolean = false, val videoError: String = "",
    val videoBlack: Boolean = true, val adaptation: OutdoorAdaptationView = OutdoorAdaptationView(2500000),
    val videoFaults: Set<OutdoorVideoFault> = emptySet(), val videoRecovering: Boolean = false,
    val keyframePeakBytes: Long = 0, val timestampOverlay: Boolean = false,
    val observation: com.pedro.common.TransportSnapshot? = null) {
    val videoFault get() = videoFaults.joinToString("+") { it.name }
    val cameraLocked get() = adaptation.locksCamera || videoFault.isNotEmpty() || videoRecovering
    // Pending route verification is silent by design, but is not a failed input.
    val microphoneChecking get() = active && inputLost && error == "NONE" && (inputPreparing || status == "preparing")
    val inputNeedsAttention get() = active && inputLost && !microphoneChecking
    val label get() = when (status) { "preparing" -> "準備中"; "connecting" -> "接続中"; "sending" -> "送信中"
        "reconnecting" -> "再接続中"; "actionRequired" -> "操作が必要"; else -> "停止" }
}
object OutdoorRuntime {
    private val mutable = MutableStateFlow(OutdoorState())
    val state = mutable.asStateFlow()
    fun update(value: OutdoorState) { mutable.value = value }
    var service: OutdoorService? = null
}
class OutdoorBackoff {
    private var attempt = 0
    fun nextMillis(): Long = longArrayOf(500, 1000, 2000)[attempt.coerceAtMost(2)].also { if (attempt < 2) attempt++ }
    fun reset() { attempt = 0 }
}
