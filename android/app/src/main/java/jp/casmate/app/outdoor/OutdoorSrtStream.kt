package jp.casmate.app.outdoor

import android.content.Context
import android.media.MediaCodec
import android.os.SystemClock
import com.pedro.common.AudioCodec
import com.pedro.common.VideoCodec
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.audio.AudioSource
import com.pedro.encoder.input.sources.video.VideoSource
import com.pedro.library.base.StreamBase
import com.pedro.library.util.streamclient.StreamBaseClient
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicLong

/** Capture/codecs survive reconnection; native sender owns only encoded frames and its socket. */
class OutdoorSrtStream(context: Context, checker: ConnectChecker, video: VideoSource, audio: AudioSource) :
    StreamBase(context, video, audio) {
    private val client = OutdoorNativeSender(checker) { requestRecoveryKeyframe() }
    private val streamClient = OutdoorStreamClient(client)
    private val videoId = AtomicLong()
    val frameEvidence = OutdoorFrameEvidence()
    @Volatile var liveGeneration = 1L
    val lastVideoAt = AtomicLong()
    val lastKeyframeAt = AtomicLong()
    val keyframePeakBytes = AtomicLong()
    private val lastAudioAt = AtomicLong()
    private val requestedKeyframeAt = AtomicLong(-1)
    fun requestRecoveryKeyframe() {
        val now = SystemClock.elapsedRealtime()
        while (true) {
            val previous = requestedKeyframeAt.get()
            if (previous >= 0 && now - previous < 500) return
            if (requestedKeyframeAt.compareAndSet(previous, now)) { requestKeyframe(); return }
        }
    }
    override fun getStreamClient(): StreamBaseClient = streamClient
    fun configure(registration: OutdoorRegistration, session: String, latency: Int) { client.configure(registration, session, latency) }
    fun reconnect(registration: OutdoorRegistration? = null) { client.connect(registration) }
    override fun setVideoCodecImp(codec: VideoCodec) { client.codec = codec }
    override fun setAudioCodecImp(codec: AudioCodec) { require(codec == AudioCodec.AAC) }
    override fun onAudioInfoImp(sampleRate: Int, isStereo: Boolean) { require(sampleRate == 48000 && !isStereo) }
    override fun startStreamImp(endPoint: String) { client.connect() }
    override fun stopStreamImp() { client.close() }
    override fun onVideoInfoImp(sps: ByteBuffer, pps: ByteBuffer?, vps: ByteBuffer?) { client.videoInfo(sps, pps, vps) }
    override fun getVideoDataImp(videoBuffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        lastVideoAt.set(SystemClock.elapsedRealtime())
        if (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) {
            lastKeyframeAt.set(SystemClock.elapsedRealtime())
            keyframePeakBytes.accumulateAndGet(info.size.toLong(), ::maxOf)
        }
        client.offer(videoBuffer, info, false, videoId.incrementAndGet(), frameEvidence.encoded(encodedVideoSourceTimestampUs()))
    }
    override fun getAudioDataImp(audioBuffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        lastAudioAt.set(SystemClock.elapsedRealtime()); client.offer(audioBuffer, info, true)
    }
    fun observation() = client.observation()
}
