package jp.casmate.app.outdoor

import com.pedro.common.VideoCodec
import com.pedro.common.frame.MediaFrame
import java.nio.ByteBuffer
import java.time.Duration
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutdoorTsMuxerTest {
    @Test fun videoClockUsesThePresentationTimelineForBothCodecsAndPacketSizes() = runBlocking {
        ShadowSystemClock.advanceBy(Duration.ofHours(1))
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            val mux = muxer(codec)
            for ((size, timestamp, ticks) in listOf(Triple(20, 5_000_000L, 450_000L), Triple(1500, 5_033_333L, 452_999L))) {
                val packets = tsPackets(mux.packets(video(codec, timestamp, size)))
                assertClock(packets, 0xe0, ticks)
                // Serialization time must not replace the encoded frame's capture timeline.
                ShadowSystemClock.advanceBy(Duration.ofSeconds(10))
            }
        }
    }

    @Test fun audioAndVideoKeepTheirOwnPresentationTimesOnTheSameClock() = runBlocking {
        ShadowSystemClock.advanceBy(Duration.ofHours(3))
        val mux = muxer(VideoCodec.H264)
        assertClock(tsPackets(mux.packets(video(VideoCodec.H264, 2_000_000, 20))), 0xe0, 180_000)
        val audio = MediaFrame(ByteBuffer.wrap(ByteArray(20) { 1 }), MediaFrame.Info(0, 20, 2_021_333, false), MediaFrame.Type.AUDIO)
        assertClock(tsPackets(mux.packets(audio)), 0xc0, 181_919)
        assertClock(tsPackets(mux.packets(video(VideoCodec.H264, 2_033_333, 20))), 0xe0, 182_999)
    }

    @Test fun aNewConnectionPreservesTheEncoderTimelineAndWrapsBothWireClocksTogether() = runBlocking {
        ShadowSystemClock.advanceBy(Duration.ofHours(30))
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            val before = muxer(codec)
            assertClock(tsPackets(before.packets(video(codec, 95_443_717_688L, 20))), 0xe0, 8_589_934_591L)
            // OutdoorNativeSender creates a muxer on each SRT connection, without resetting capture.
            val reconnected = muxer(codec)
            val packets = tsPackets(reconnected.packets(video(codec, 95_443_717_700L, 1500)))
            assertTrue("A reconnected stream must advertise its program", packets.any { pid(it) == 0 })
            assertClock(packets, 0xe0, 1)
        }
    }

    private fun muxer(codec: VideoCodec) = OutdoorTsMuxer(codec).apply {
        configure(if (codec == VideoCodec.H264) OutdoorCodecInfo(nal(0x67), nal(0x68), null)
            else OutdoorCodecInfo(nal(0x42), nal(0x44), nal(0x40)))
    }

    // The packetizer requires Annex-B NAL headers; payload bytes need no codec decoder in this wire-level test.
    private fun nal(type: Int, size: Int = 8) = ByteArray(size) { 1 }.apply {
        this[0] = 0; this[1] = 0; this[2] = 0; this[3] = 1; this[4] = type.toByte()
    }
    private fun video(codec: VideoCodec, timestamp: Long, size: Int): MediaFrame {
        val bytes = nal(if (codec == VideoCodec.H264) 0x65 else 0x26, size)
        return MediaFrame(ByteBuffer.wrap(bytes), MediaFrame.Info(0, bytes.size, timestamp, true), MediaFrame.Type.VIDEO)
    }
    private fun tsPackets(datagrams: List<ByteArray>): List<ByteArray> = datagrams.flatMap { bytes ->
        assertEquals("Whole transport packets are required", 0, bytes.size % 188)
        bytes.indices.step(188).map { bytes.copyOfRange(it, it + 188) }
    }
    private fun pid(packet: ByteArray) = ((packet[1].toInt() and 31) shl 8) or (packet[2].toInt() and 255)
    private fun assertClock(packets: List<ByteArray>, streamId: Int, expected90k: Long) {
        val packet = packets.first { packet ->
            val start = payloadOffset(packet)
            packet[1].toInt() and 0x40 != 0 && start + 14 <= 188 &&
                packet[start] == 0.toByte() && packet[start + 1] == 0.toByte() && packet[start + 2] == 1.toByte() &&
                (packet[start + 3].toInt() and 255) == streamId
        }
        fun u(offset: Int) = packet[offset].toLong() and 255
        val start = payloadOffset(packet)
        val p = start + 9
        val pts = (((u(p) shr 1) and 7) shl 30) or (u(p + 1) shl 22) or ((u(p + 2) shr 1) shl 15) or
            (u(p + 3) shl 7) or (u(p + 4) shr 1)
        assertEquals("PES presentation time must remain unchanged", expected90k, pts)
        assertTrue("The PES must carry its clock reference", (packet[3].toInt() and 0x20) != 0 && (packet[5].toInt() and 0x10) != 0)
        val pcr = (u(6) shl 25) or (u(7) shl 17) or (u(8) shl 9) or (u(9) shl 1) or (u(10) shr 7)
        assertEquals("PCR must share the PES timeline, independently of device uptime", expected90k, pcr)
    }
    private fun payloadOffset(packet: ByteArray) = 4 + if (packet[3].toInt() and 0x20 != 0) 1 + (packet[4].toInt() and 255) else 0
}
