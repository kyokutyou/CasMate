package jp.casmate.app.outdoor

/** Legacy SCO captures mono 8 kHz; the AAC input contract remains mono 48 kHz. */
internal class OutdoorScoPcm {
    private var previous: Int? = null
    fun reset() { previous = null }
    fun to48k(input: ByteArray, count: Int): ByteArray {
        val result = ByteArray(count / 2 * 12)
        var output = 0
        for (offset in 0 until count - 1 step 2) {
            val current = ((input[offset].toInt() and 255) or (input[offset + 1].toInt() shl 8)).toShort().toInt()
            val last = previous ?: current
            for (step in 1..6) {
                val value = last + (current - last) * step / 6
                result[output++] = value.toByte()
                result[output++] = (value shr 8).toByte()
            }
            previous = current
        }
        return result
    }
}
