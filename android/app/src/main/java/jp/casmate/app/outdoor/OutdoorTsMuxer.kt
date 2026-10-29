package jp.casmate.app.outdoor

import com.pedro.common.AudioCodec
import com.pedro.common.VideoCodec
import com.pedro.common.frame.MediaFrame
import com.pedro.srt.mpeg2ts.MpegTsPacketizer
import com.pedro.srt.mpeg2ts.packets.AacPacket
import com.pedro.srt.mpeg2ts.packets.H264Packet
import com.pedro.srt.mpeg2ts.packets.H265Packet
import com.pedro.srt.mpeg2ts.psi.PsiManager
import com.pedro.srt.mpeg2ts.service.Mpeg2TsService
import com.pedro.srt.utils.chunkPackets
import com.pedro.srt.utils.toCodec
import java.nio.ByteBuffer

internal class OutdoorCodecInfo(val sps: ByteArray, val pps: ByteArray?, val vps: ByteArray?)

/** Reuses only RootEncoder's MPEG-TS packetizer; no Kotlin SRT protocol runs here. */
internal class OutdoorTsMuxer(private val codec: VideoCodec) {
    private val service = Mpeg2TsService().apply {
        addTrack(AudioCodec.AAC.toCodec()); addTrack(codec.toCodec()); generatePmt()
    }
    private val psi = PsiManager(service)
    private val packetizer = MpegTsPacketizer(psi)
    private val audio = AacPacket(1316, psi).apply { sendAudioInfo(48000, false, AudioCodec.AAC) }
    private val video = if (codec == VideoCodec.H265) H265Packet(1316, psi) else H264Packet(1316, psi)
    private var info: OutdoorCodecInfo? = null
    private var initial = true
    fun configure(value: OutdoorCodecInfo?) {
        if (value == null || value === info) return
        val pps = value.pps ?: return
        if (video is H264Packet) video.sendVideoInfo(ByteBuffer.wrap(value.sps), ByteBuffer.wrap(pps))
        if (video is H265Packet) {
            val vps = value.vps ?: return
            video.sendVideoInfo(ByteBuffer.wrap(value.sps), ByteBuffer.wrap(pps), ByteBuffer.wrap(vps))
        }
        info = value
    }
    suspend fun packets(frame: MediaFrame): List<ByteArray> {
        if (frame.type == MediaFrame.Type.VIDEO && info == null) return emptyList()
        val result = mutableListOf<ByteArray>()
        if (initial) {
            val tables = listOfNotNull(psi.getPat(), psi.getPmt(), psi.getSdt())
            result.addAll(packetizer.write(tables).chunkPackets(7)); initial = false
        }
        val producer = if (frame.type == MediaFrame.Type.AUDIO) audio else video
        producer.createAndSendPacket(frame) { packets ->
            result.addAll(psi.checkSendInfo(frame.info.isKeyFrame, packetizer, 7).map { it.buffer })
            result.addAll(packets.map { it.buffer })
        }
        return result
    }
}
