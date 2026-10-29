package jp.casmate.app.outdoor

import kotlin.math.abs
import kotlin.math.roundToInt

/** PCM16 little-endian processing before AAC. Shared by all inputs in one session. */
class OutdoorMicrophoneGain(volume: Int = 100) {
    init { require(volume in 0..200) }
    @Volatile var volume = volume
        set(value) { require(value in 0..200); field = value }
    @Volatile var manualMute = false
    private var peak = 0f
    private var clippedUntil = Long.MIN_VALUE
    @Synchronized fun process(bytes: ByteArray, count: Int, inputLost: Boolean, nowMs: Long) {
        val gain = volume / 100.0
        val silent = manualMute || inputLost
        var bufferPeak = 0
        for (i in 0 until (count - 1) step 2) {
            val input = ((bytes[i].toInt() and 255) or (bytes[i + 1].toInt() shl 8)).toShort().toInt()
            val scaled = (input * gain).roundToInt()
            if (input == -32768 || input == 32767 || scaled !in -32768..32767) clippedUntil = nowMs + 1000
            val output = if (silent) 0 else scaled.coerceIn(-32768, 32767)
            bytes[i] = output.toByte(); bytes[i + 1] = (output shr 8).toByte()
            bufferPeak = maxOf(bufferPeak, abs(output))
        }
        peak = if (silent || volume == 0) 0f else maxOf(peak, bufferPeak / 32768f)
    }
    @Synchronized fun meter(nowMs: Long, inputLost: Boolean): Pair<Float, Boolean> {
        val result = (if (manualMute || inputLost || volume == 0) 0f else peak) to (nowMs < clippedUntil)
        peak = 0f
        return result
    }
    fun effectivelyMuted(inputLost: Boolean) = inputLost || manualMute || volume == 0
}
