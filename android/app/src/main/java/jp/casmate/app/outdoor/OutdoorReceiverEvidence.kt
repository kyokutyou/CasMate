package jp.casmate.app.outdoor

import com.pedro.common.TransportSnapshot

internal data class OutdoorReceiveProgress(val session: String, val generation: Long, val bytes: Long,
    val videoFrames: Long, val audioFrames: Long, val videoPts: Long, val droppedPackets: Long = 0)

/** Correlates receiver PES with this connection's completely submitted live frames. */
internal class OutdoorReceiverEvidence(private val session: String, private val generation: Long) {
    private data class Frame(val id: Long, val live: Long, val at: Long)
    private val sent = LinkedHashMap<Long, Frame>()
    private var previous: OutdoorReceiveProgress? = null
    private var lastResponseAt: Long? = null
    private var lastProgressAt: Long? = null
    private var lastAudioAt: Long? = null
    private var lastVideoAt: Long? = null
    private var receiverDrops = 0L
    private var receivedBytes = 0L
    private var updates = 0L
    private var confirmed = Frame(0, 0, 0)

    @Synchronized fun sent(ptsUs: Long, id: Long, live: Long, now: Long) {
        sent[(ptsUs * 9 / 100) % (1L shl 33)] = Frame(id, live, now)
        while (sent.size > 512 || sent.values.firstOrNull()?.let { now - it.at > 4000 } == true) sent.remove(sent.keys.first())
    }
    @Synchronized fun receive(value: OutdoorReceiveProgress, now: Long): Boolean {
        if (value.session != session || value.generation != generation || value.bytes < 0 || value.videoFrames < 0 || value.audioFrames < 0 || value.droppedPackets < 0 || value.videoPts !in -1 until (1L shl 33)) return false
        val old = previous
        if (old != null && (value.bytes < old.bytes || value.videoFrames < old.videoFrames || value.audioFrames < old.audioFrames || value.droppedPackets < old.droppedPackets)) {
            lastResponseAt = null; lastProgressAt = null; lastAudioAt = null; lastVideoAt = null; confirmed = Frame(0, 0, 0); return false
        }
        previous = value; lastResponseAt = now; receiverDrops = value.droppedPackets
        if (value.bytes > (old?.bytes ?: 0)) { receivedBytes = value.bytes; updates++; lastProgressAt = now }
        if (value.audioFrames > (old?.audioFrames ?: 0)) lastAudioAt = now
        if (value.videoFrames > (old?.videoFrames ?: 0)) sent[value.videoPts]?.let {
            if (it.id > confirmed.id && now - it.at in 0..4000) { confirmed = it; lastVideoAt = now }
        }
        return true
    }
    @Synchronized fun apply(sample: TransportSnapshot): TransportSnapshot {
        val fresh = lastResponseAt?.let { sample.atMs - it in 0 until 1000 } == true
        val liveFresh = fresh && lastVideoAt?.let { sample.atMs - it in 0 until 1000 } == true
        val ackAt = if (fresh && lastProgressAt != null && lastAudioAt != null) minOf(lastProgressAt!!, lastAudioAt!!) else null
        // Count detections at both ends; these are not a count of unique lost packets.
        return sample.copy(valid = sample.valid && fresh, ackedBytes = receivedBytes, ackProgress = updates, lastAckAtMs = ackAt,
            expiredPackets = sample.expiredPackets + receiverDrops,
            ackedLiveGeneration = if (liveFresh) confirmed.live else 0, ackedLiveVideoId = if (liveFresh) confirmed.id else 0)
    }
}
