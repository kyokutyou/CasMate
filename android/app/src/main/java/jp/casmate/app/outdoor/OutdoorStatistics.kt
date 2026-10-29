package jp.casmate.app.outdoor

data class OutdoorStatistics(val bitrate: Double? = null, val rttMs: Double? = null, val retries: Long = 0,
    val requestedPackets: Int? = null)

class OutdoorStatisticsMeter {
    private var generation: Long? = null
    private var bytes: Long? = null
    private var time = 0L
    private var retries = 0L
    fun retry() { retries++ ; disconnected() }
    fun disconnected(): OutdoorStatistics { bytes = null; return OutdoorStatistics(retries = retries) }
    fun sample(s: com.pedro.common.TransportSnapshot): OutdoorStatistics {
        if (generation != s.generation) { generation = s.generation; bytes = null }
        val result = sample(s.atMs, s.sentBytes, ((s.rttMs ?: 0.0) * 1000).toInt(), s.nakPackets.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        return result.copy(rttMs = s.rttMs.takeIf { s.rttAtMs?.let { at -> s.atMs - at in 0..999 } == true })
    }
    fun sample(nowMs: Long, sentBytes: Long, rttMicros: Int, requestedPackets: Int = 0): OutdoorStatistics {
        val previous = bytes
        val rate = if (previous != null && sentBytes >= previous && nowMs > time)
            (sentBytes - previous).toDouble() * 8000 / (nowMs - time) else null
        bytes = sentBytes; time = nowMs
        return OutdoorStatistics(rate, rttMicros.takeIf { it > 0 }?.div(1000.0), retries, requestedPackets.takeIf { it >= 0 })
    }
}
