package com.pedro.common

import com.pedro.common.frame.MediaFrame
import java.util.IdentityHashMap

/** CasMate numeric observations. No media, endpoints, or error text leave this collector. */
data class TransportSnapshot(
  val generation: Long, val atMs: Long, val valid: Boolean,
  val queuedFrames: Int, val queuedBytes: Long, val processingBytes: Long,
  val localWaitMs: Long, val audioWaitMs: Long,
  val unackedBytes: Long, val unackedAgeMs: Long,
  val ackedBytes: Long, val ackProgress: Long, val lastAckAtMs: Long?,
  val ackedLiveGeneration: Long, val ackedLiveVideoId: Long,
  val generatedVideoBytes: Long, val generatedVideoFrames: Long, val generatedAudioFrames: Long,
  val lastVideoAtMs: Long?, val lastAudioAtMs: Long?,
  val sentVideoFrames: Long, val sentAudioFrames: Long,
  val lastVideoSentAtMs: Long?, val lastAudioSentAtMs: Long?,
  val sentLiveGeneration: Long, val sentLiveVideoId: Long,
  val droppedVideoFrames: Long, val droppedAudioFrames: Long,
  val expiredPackets: Long, val expiredBytes: Long,
  val retransmittedPackets: Long, val retransmittedBytes: Long, val sentBytes: Long,
  val nakPackets: Long, val rttMs: Double?, val rttAtMs: Long?, val keyframePeakBytes: Long,
  val generatedLiveGeneration: Long = 0, val generatedLiveVideoId: Long = 0,
  val lastLiveVideoAtMs: Long? = null, val lastLiveVideoSentAtMs: Long? = null,
)

/** One short lock covers all numeric state. Snapshot reads never walk a media or packet queue. */
class TransportObservation(private val clock: () -> Long = TimeUtils::getCurrentTimeMillis) {
  data class FrameIdentity(val videoId: Long = 0, val liveGeneration: Long = 0)
  private data class Local(val order: Long, val at: Long, val size: Int, val audio: Boolean,
    val identity: FrameIdentity, var sent: Boolean = false)
  private data class Packet(val at: Long, val size: Int, val identity: FrameIdentity, val last: Boolean)
  private val frames = IdentityHashMap<MediaFrame, Local>()
  private val waiting = LinkedHashMap<Long, Local>()
  private val waitingAudio = LinkedHashMap<Long, Local>()
  private val packets = LinkedHashMap<Int, Packet>()
  private var inFlight: Local? = null
  private var order = 0L
  private var generation = 0L
  private var valid = true
  private var queueBytes = 0L
  private var unackedBytes = 0L
  private var ackedBytes = 0L
  private var ackProgress = 0L
  private var lastAckAt: Long? = null
  private var lastAckSequence: Int? = null
  private var lastSentSequence: Int? = null
  private var ackedIdentity = FrameIdentity()
  private var sentIdentity = FrameIdentity()
  private var generatedIdentity = FrameIdentity()
  private var lastLiveAt: Long? = null
  private var lastLiveSentAt: Long? = null
  private var videoBytes = 0L
  private var videoFrames = 0L
  private var audioFrames = 0L
  private var lastVideoAt: Long? = null
  private var lastAudioAt: Long? = null
  private var sentVideo = 0L
  private var sentAudio = 0L
  private var lastVideoSentAt: Long? = null
  private var lastAudioSentAt: Long? = null
  private var droppedVideo = 0L
  private var droppedAudio = 0L
  private var expiredPackets = 0L
  private var expiredBytes = 0L
  private var retransmittedPackets = 0L
  private var retransmittedBytes = 0L
  private var sentBytes = 0L
  private var nakPackets = 0L
  private var rttMs: Double? = null
  private var rttAt: Long? = null
  private var keyframePeak = 0L

  @Synchronized fun beginConnection() {
    generation++; valid = true; clearLocal()
    packets.clear(); unackedBytes = 0; ackedBytes = 0; ackProgress = 0
    lastAckAt = null; lastAckSequence = null; lastSentSequence = null
    ackedIdentity = FrameIdentity(); sentIdentity = FrameIdentity()
    generatedIdentity = FrameIdentity(); lastLiveAt = null; lastLiveSentAt = null
    videoBytes = 0; videoFrames = 0; audioFrames = 0; lastVideoAt = null; lastAudioAt = null
    sentVideo = 0; sentAudio = 0; lastVideoSentAt = null; lastAudioSentAt = null
    droppedVideo = 0; droppedAudio = 0; expiredPackets = 0; expiredBytes = 0
    retransmittedPackets = 0; retransmittedBytes = 0; sentBytes = 0; nakPackets = 0
    rttMs = null; rttAt = null; keyframePeak = 0
  }

  @Synchronized fun invalidate() { valid = false }

  @Synchronized fun generated(size: Int, audio: Boolean, keyframe: Boolean = false,
    videoId: Long = 0, liveGeneration: Long = 0) {
    if (audio) { audioFrames++; lastAudioAt = clock() }
    else {
      videoFrames++; videoBytes += size; lastVideoAt = clock()
      if (liveGeneration > 0) { generatedIdentity = FrameIdentity(videoId, liveGeneration); lastLiveAt = clock() }
      if (keyframe) keyframePeak = maxOf(keyframePeak, size.toLong())
    }
  }

  @Synchronized fun queued(frame: MediaFrame, videoId: Long, liveGeneration: Long) {
    val local = Local(++order, clock(), frame.info.size, frame.type == MediaFrame.Type.AUDIO,
      FrameIdentity(videoId, liveGeneration))
    frames[frame] = local; waiting[local.order] = local; queueBytes += local.size
    if (local.audio) waitingAudio[local.order] = local
  }

  @Synchronized fun discarded(frame: MediaFrame) {
    removeWaiting(frame)
    if (frame.type == MediaFrame.Type.AUDIO) droppedAudio++ else droppedVideo++
  }

  private fun removeWaiting(frame: MediaFrame): Local? {
    val local = frames.remove(frame) ?: return null
    if (waiting.remove(local.order) != null) queueBytes -= local.size
    waitingAudio.remove(local.order)
    return local
  }

  @Synchronized fun processing(frame: MediaFrame) { inFlight = removeWaiting(frame) }
  @Synchronized fun cacheRemoved(frame: MediaFrame) { removeWaiting(frame) }
  @Synchronized fun processingIdentity() = inFlight?.identity ?: FrameIdentity()

  /** Packetization/queue consumption alone is not local socket send completion. */
  @Synchronized fun sentFrame() {
    val local = inFlight ?: return
    if (local.sent) return
    local.sent = true
    if (local.audio) { sentAudio++; lastAudioSentAt = clock() }
    else {
      sentVideo++; lastVideoSentAt = clock()
      if (local.identity.liveGeneration > 0) { sentIdentity = local.identity; lastLiveSentAt = clock() }
    }
  }
  @Synchronized fun finished() { inFlight = null }

  @Synchronized fun clearLocal() {
    frames.clear(); waiting.clear(); waitingAudio.clear(); inFlight = null; queueBytes = 0
  }

  @Synchronized fun packetSent(sequence: Int, size: Int, videoId: Long, liveGeneration: Long, last: Boolean) {
    val old = packets.put(sequence, Packet(clock(), size, FrameIdentity(videoId, liveGeneration), last))
    unackedBytes += size - (old?.size ?: 0)
    lastSentSequence = sequence; sentBytes += size
  }

  @Synchronized fun expired(sequence: Int) {
    val packet = packets.remove(sequence) ?: return
    unackedBytes -= packet.size; expiredPackets++; expiredBytes += packet.size
  }

  @Synchronized fun retransmitted(sequence: Int) {
    val packet = packets[sequence] ?: return
    retransmittedPackets++; retransmittedBytes += packet.size; sentBytes += packet.size
  }

  @Synchronized fun nak(count: Int) { if (count > 0) nakPackets += count }

  /** SRT ACK is the next expected sequence. Expiry is deliberately a separate operation. */
  @Synchronized fun acknowledged(nextSequence: Int, rttMicros: Int?) {
    val sent = lastSentSequence ?: return
    val boundary = (sent + 1) and MASK
    if (distance(nextSequence, boundary) in 1 until HALF) return // impossible future ACK
    val previous = lastAckSequence
    if (previous != null && distance(nextSequence, previous) !in 1 until HALF) return
    lastAckSequence = nextSequence
    if (rttMicros != null && rttMicros > 0) { rttMs = rttMicros / 1000.0; rttAt = clock() }
    var count = 0L
    val iterator = packets.iterator()
    while (iterator.hasNext()) {
      val (sequence, packet) = iterator.next()
      if (distance(nextSequence, sequence) !in 1 until HALF) break
      iterator.remove(); unackedBytes -= packet.size; ackedBytes += packet.size; count++
      if (packet.last && packet.identity.liveGeneration > 0 &&
        packet.identity.videoId > ackedIdentity.videoId) ackedIdentity = packet.identity
    }
    if (count > 0) { ackProgress += count; lastAckAt = clock() }
  }

  @Synchronized fun snapshot(): TransportSnapshot {
    val now = clock()
    fun age(at: Long?) = at?.let { (now - it).coerceAtLeast(0) } ?: 0L
    val first = waiting.values.firstOrNull()?.at
    val firstAudio = waitingAudio.values.firstOrNull()?.at
    val localAge = maxOf(age(first), age(inFlight?.at))
    val audioAge = maxOf(age(firstAudio), age(inFlight?.takeIf { it.audio }?.at))
    return TransportSnapshot(generation, now, valid, waiting.size, queueBytes,
      inFlight?.size?.toLong() ?: 0, localAge, audioAge, unackedBytes,
      age(packets.values.firstOrNull()?.at), ackedBytes, ackProgress, lastAckAt,
      ackedIdentity.liveGeneration, ackedIdentity.videoId, videoBytes, videoFrames, audioFrames,
      lastVideoAt, lastAudioAt, sentVideo, sentAudio, lastVideoSentAt, lastAudioSentAt,
      sentIdentity.liveGeneration, sentIdentity.videoId, droppedVideo, droppedAudio,
      expiredPackets, expiredBytes, retransmittedPackets, retransmittedBytes, sentBytes,
      nakPackets, rttMs, rttAt, keyframePeak, generatedIdentity.liveGeneration, generatedIdentity.videoId,
      lastLiveAt, lastLiveSentAt)
  }

  private fun distance(a: Int, b: Int) = (a - b) and MASK
  companion object { private const val MASK = 0x7fffffff; private const val HALF = 0x40000000 }
}
