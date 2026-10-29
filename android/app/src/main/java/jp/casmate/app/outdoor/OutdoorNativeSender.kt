package jp.casmate.app.outdoor

import android.media.MediaCodec
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.pedro.common.ConnectChecker
import com.pedro.common.TransportObservation
import com.pedro.common.TransportSnapshot
import com.pedro.common.VideoCodec
import com.pedro.common.frame.MediaFrame
import kotlinx.coroutines.*
import java.nio.ByteBuffer

internal class OutdoorNativeSender(private val checker: ConnectChecker, private val keyframe: () -> Unit) {
    private class Attempt(val generation: Long, @Volatile var handle: Long, session: String, latency: Int) {
        val observation = TransportObservation(SystemClock::elapsedRealtime).apply { beginConnection() }
        val queue = OutdoorSendQueue(latency, observation, SystemClock::elapsedRealtime)
        val evidence = OutdoorReceiverEvidence(session, generation)
        @Volatile var connected = false
        @Volatile var cancelled = false
        @Volatile var counters: Pair<Long, LongArray>? = null
        var job: Job? = null
        var feedback: AutoCloseable? = null
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var attempt: Attempt? = null
    @Volatile private var codecInfo: OutdoorCodecInfo? = null
    private var generation = 0L
    private lateinit var registration: OutdoorRegistration
    private var session = ""
    private var latency = 400
    var codec = VideoCodec.H264

    fun configure(registration: OutdoorRegistration, session: String, latency: Int) {
        check(attempt == null); this.registration = registration; this.session = session; this.latency = latency
    }
    fun videoInfo(sps: ByteBuffer, pps: ByteBuffer?, vps: ByteBuffer?) {
        fun copy(value: ByteBuffer) = ByteArray(value.remaining()).also { value.duplicate().get(it) }
        codecInfo = OutdoorCodecInfo(copy(sps), pps?.let(::copy), vps?.let(::copy))
    }
    fun connect(next: OutdoorRegistration? = null) {
        cancelAttempt()
        if (next != null) registration = next
        // Each attempt owns immutable credentials; a later saved update cannot retarget an active send.
        val registration = this.registration; val session = this.session; val latency = this.latency
        var handle = NativeSrt.create(registration.passphrase, latency)
        if (handle == 0L) throw OutdoorPreparationException("SERVICE_FAILED")
        val value = Attempt(++generation, handle, session, latency); attempt = value
        fun current() = attempt === value && !value.cancelled
        fun event(action: () -> Unit) { main.post { if (current()) action() } }
        event { checker.onConnectionStarted("") }
        value.job = scope.launch {
            try {
                val candidates = registration.directEndpoints.map { it.address to it.port }.ifEmpty { listOf(registration.address to registration.obsPort) }
                var result = -1
                for ((index, destination) in candidates.withIndex()) {
                    if (!current() || !isActive) return@launch
                    if (index > 0) { NativeSrt.close(handle); handle = NativeSrt.create(registration.passphrase, latency); value.handle = handle; if (handle == 0L) break }
                    if (!current()) return@launch
                    result = aggregateOutdoorCandidateResult(result, NativeSrt.connect(handle, destination.first, destination.second,
                        "$session:${value.generation}", registration.directEndpoints.isNotEmpty()))
                    if (result == 1) break
                }
                if (!current()) return@launch
                if (result != 1) { event { checker.onConnectionFailed(if (result == -2) "BADSECRET" else "CONNECTION_FAILED") }; return@launch }
                value.connected = true
                event { keyframe(); checker.onConnectionSuccess() }
                value.feedback = jp.casmate.app.connection.SmartphoneControlConnection.feedback(session, value.generation) { payload ->
                    val response = parseOutdoorFeedback(payload)
                    if (current() && response != null) value.evidence.receive(response, SystemClock.elapsedRealtime())
                }
                val mux = OutdoorTsMuxer(codec)
                var statsAt = 0L; var bitrateAt = SystemClock.elapsedRealtime(); var bitrateBytes = 0L
                while (current() && isActive) {
                    val now = SystemClock.elapsedRealtime()
                    if (now - statsAt >= 100) {
                        val stats = NativeSrt.stats(handle) ?: error("DISCONNECTED")
                        value.counters = now to stats; statsAt = now
                        if (now - bitrateAt >= 500) {
                            val bitrate = (stats[0] - bitrateBytes).coerceAtLeast(0) * 8000 / (now - bitrateAt)
                            bitrateAt = now; bitrateBytes = stats[0]; event { checker.onNewBitrate(bitrate) }
                        }
                    }
                    if (value.queue.needsKeyframe) event { keyframe() }
                    val entry = value.queue.take()
                    if (entry == null) { delay(5); continue }
                    var sent = false
                    try {
                        mux.configure(codecInfo)
                        val packets = mux.packets(entry.frame)
                        sent = packets.isNotEmpty()
                        for (packet in packets) {
                            var accepted = false
                            while (current() && isActive && SystemClock.elapsedRealtime() - entry.at < latency) {
                                val count = NativeSrt.send(handle, packet)
                                if (count < 0) error("DISCONNECTED")
                                if (count > 0) { accepted = true; break }
                                delay(2)
                            }
                            if (!accepted) { sent = false; break }
                        }
                        if (sent && entry.frame.type == MediaFrame.Type.VIDEO) value.evidence.sent(entry.frame.info.timestamp,
                            entry.videoId, entry.liveGeneration, SystemClock.elapsedRealtime())
                    } finally { value.queue.finish(sent) }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { event { checker.onConnectionFailed("CONNECTION_FAILED") } }
            finally {
                value.connected = false; value.feedback?.close(); NativeSrt.close(handle); value.queue.clear()
            }
        }
    }
    fun offer(buffer: ByteBuffer, info: MediaCodec.BufferInfo, audio: Boolean, id: Long = 0, live: Long = 0) {
        val value = attempt?.takeIf { it.connected && !it.cancelled } ?: return
        if (info.size <= 0 || info.offset < 0 || info.offset.toLong() + info.size > buffer.capacity()) return
        if (info.size > 4 * 1024 * 1024) {
            // Record the rejected frame without allocating an oversized copy; invalidate its prediction chain.
            value.queue.offer(MediaFrame(ByteBuffer.allocate(0), MediaFrame.Info(0, info.size, info.presentationTimeUs,
                info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0, info.flags), if (audio) MediaFrame.Type.AUDIO else MediaFrame.Type.VIDEO), id, live)
            return
        }
        val copy = ByteArray(info.size)
        buffer.duplicate().apply { clear(); position(info.offset); limit(info.offset + info.size); get(copy) }
        val frame = MediaFrame(ByteBuffer.wrap(copy), MediaFrame.Info(0, copy.size, info.presentationTimeUs,
            info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0, info.flags), if (audio) MediaFrame.Type.AUDIO else MediaFrame.Type.VIDEO)
        if (attempt === value && !value.cancelled) value.queue.offer(frame, id, live)
    }
    fun observation(): TransportSnapshot? {
        val value = attempt ?: return null
        val local = value.observation.snapshot().copy(generation = value.generation)
        val counters = value.counters
        val valid = value.connected && counters != null && local.atMs - counters.first in 0..500
        if (!valid) return local.copy(valid = false)
        val stats = counters.second
        return value.evidence.apply(local.copy(valid = true, unackedBytes = stats[1], unackedAgeMs = stats[2],
            expiredPackets = stats[3], expiredBytes = stats[4], retransmittedPackets = stats[5], retransmittedBytes = stats[6],
            nakPackets = stats[7], sentBytes = stats[0], rttMs = stats[8].takeIf { it > 0 }?.div(1000.0), rttAtMs = counters.first))
    }
    private fun cancelAttempt() {
        val value = attempt ?: return
        attempt = null; value.cancelled = true; value.connected = false
        value.job?.cancel(); value.feedback?.close(); NativeSrt.close(value.handle)
    }
    fun close() { cancelAttempt(); scope.cancel() }
}
