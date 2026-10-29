package jp.casmate.app.outdoor

import android.media.MediaCodecInfo.CodecCapabilities
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.MediaCodecInfoBuilder
import org.robolectric.shadows.ShadowMediaCodecList

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorCodecCapabilitiesTest {
    @After fun reset() { ShadowMediaCodecList.reset() }

    private fun addCodec(name: String, codec: OutdoorVideoCodec, small: Boolean = false,
        surface: Boolean = true, hardware: Boolean = true, avcLevel: Int? = null) {
        val level = CodecProfileLevel().apply {
            profile = if (codec == OutdoorVideoCodec.H264) CodecProfileLevel.AVCProfileBaseline else CodecProfileLevel.HEVCProfileMain
            this.level = if (codec == OutdoorVideoCodec.H264) {
                avcLevel ?: if (small) CodecProfileLevel.AVCLevel1 else CodecProfileLevel.AVCLevel41
            } else CodecProfileLevel.HEVCMainTierLevel41
        }
        val caps = MediaCodecInfoBuilder.CodecCapabilitiesBuilder.newBuilder()
            .setMediaFormat(MediaFormat.createVideoFormat(codec.mime, 1280, 720))
            .setIsEncoder(true).setProfileLevels(arrayOf(level))
            .setColorFormats(intArrayOf(if (surface) CodecCapabilities.COLOR_FormatSurface else CodecCapabilities.COLOR_FormatYUV420Planar))
            .build()
        ShadowMediaCodecList.addCodec(MediaCodecInfoBuilder.newBuilder().setName(name).setIsEncoder(true)
            .setIsHardwareAccelerated(hardware).setIsSoftwareOnly(!hardware).setCapabilities(caps).build())
    }

    @Test fun missingHevcDoesNotUseAvcOrSoftware() {
        addCodec("test.avc", OutdoorVideoCodec.H264)
        addCodec("test.hevc.software", OutdoorVideoCodec.H265, hardware = false)
        assertFalse(OutdoorCapabilities.videoUnsupported(OutdoorQuality(), false))
        assertTrue(OutdoorCapabilities.videoUnsupported(OutdoorQuality(videoCodec = OutdoorVideoCodec.H265), false))
    }

    @Test fun unsupportedSelectedEncoderCannotBeRescuedByLaterCandidate() {
        addCodec("test.avc.first", OutdoorVideoCodec.H264, small = true)
        addCodec("test.avc.second", OutdoorVideoCodec.H264)
        assertTrue(OutdoorCapabilities.videoUnsupported(OutdoorQuality(), false))
    }

    @Test fun surfaceSelectionAndBothOrientationsUseSelectedFormatCapabilities() {
        addCodec("test.avc.buffer", OutdoorVideoCodec.H264, small = true, surface = false)
        addCodec("test.avc.surface", OutdoorVideoCodec.H264)
        addCodec("test.hevc.surface", OutdoorVideoCodec.H265)
        for (codec in OutdoorVideoCodec.entries) for (portrait in listOf(false, true)) {
            // Fixture limits height to 720: rotated 720x1280 must be rejected.
            assertEquals("$codec portrait=$portrait", portrait,
                OutdoorCapabilities.videoUnsupported(OutdoorQuality(videoCodec = codec), portrait))
        }
    }

    @Test fun selectedEncodersBitrateLimitIsEnforced() {
        addCodec("test.avc.level3", OutdoorVideoCodec.H264, avcLevel = CodecProfileLevel.AVCLevel3)
        val quality = OutdoorQuality(width = 640, height = 360, fps = 15, videoBitrate = 1000000)
        assertFalse(OutdoorCapabilities.videoUnsupported(quality, false))
        // Dimensions/fps are supported, but Level 3's 10Mbps limit excludes 12Mbps.
        assertTrue(OutdoorCapabilities.videoUnsupported(quality.copy(videoBitrate = 12000000), false))
    }
}
