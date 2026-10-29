package jp.casmate.app.outdoor

import android.content.Context
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorControlsTest {
    @Test fun automaticSettingsMigrateIndependentlyAndModeChangesDoNotReenableAudioFirst() {
        val migrated = OutdoorQuality(videoBitrate = 6000000, autoMaxBitrate = 6000000)
        assertEquals(OutdoorBitrateMode.FIXED, migrated.bitrateMode)
        assertEquals(6000000, migrated.autoMaxBitrate)
        assertEquals(500000, migrated.autoMinBitrate)
        val auto = migrated.withMode(OutdoorBitrateMode.AUTO).copy(audioFirst = true, autoMinBitrate = 2000000)
        assertEquals(auto, OutdoorQuality.parse(auto.json()))
        val fixed = auto.withMode(OutdoorBitrateMode.FIXED)
        assertFalse(fixed.audioFirst)
        assertFalse(fixed.withMode(OutdoorBitrateMode.AUTO).audioFirst)
        assertEquals(6000000, fixed.videoBitrate)
        val preset = auto.applyPreset(OutdoorQuality.presets().first())
        assertTrue(preset.audioFirst)
        assertEquals(1000000, preset.autoMinBitrate)
        assertEquals(1000000, preset.autoMaxBitrate)
        for ((key, value) in listOf("autoMinBitrate" to 7000000, "autoMaxBitrate" to 550000, "audioFirst" to "true", "bitrateMode" to "other")) {
            val invalid = JSONObject(auto.json()).put(key, value)
            assertThrows(Exception::class.java) { OutdoorQuality.parse(invalid.toString()) }
        }
        assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(audioFirst = true) }
    }
    @Test fun codecSelectionPersistsAndOldSettingsKeepH264() {
        val original = OutdoorQuality(videoBitrate = 6000000)
        val legacy = JSONObject(original.json()).apply { remove("videoCodec") }
        assertThrows(Exception::class.java) { OutdoorQuality.parse(legacy.toString()) }
        val hevc = original.copy(videoCodec = OutdoorVideoCodec.H265)
        assertEquals(hevc, OutdoorQuality.parse(hevc.json()))
        assertThrows(IllegalArgumentException::class.java) {
            OutdoorQuality.parse(legacy.put("videoCodec", "unknown").toString())
        }
        assertThrows(Exception::class.java) {
            OutdoorQuality.parse(legacy.put("videoCodec", JSONObject.NULL).toString())
        }
        assertEquals(OutdoorVideoCodec.H265, hevc.applyPreset(OutdoorQuality.presets().first()).videoCodec)
    }
    @After fun clear() { OutdoorRuntime.update(OutdoorState()) }
    private fun pcm(vararg samples: Int) = samples.flatMap { listOf(it.toByte(), (it shr 8).toByte()) }.toByteArray()
    private fun samples(bytes: ByteArray) = bytes.toList().chunked(2).map { ((it[0].toInt() and 255) or (it[1].toInt() shl 8)).toShort().toInt() }
    @Test fun gainSaturatesBothPolaritiesAndRetainsWarningForOneSecond() {
        val gain = OutdoorMicrophoneGain(200)
        val bytes = pcm(20000, -20000, 1000)
        gain.process(bytes, bytes.size, false, 100)
        assertEquals(listOf(32767, -32768, 2000), samples(bytes))
        assertEquals(1f, gain.meter(100, false).first)
        assertTrue(gain.meter(1099, false).second)
        assertFalse(gain.meter(1100, false).second)
        gain.volume = 10
        val saturatedInput = pcm(32767)
        gain.process(saturatedInput, saturatedInput.size, false, 1200)
        assertTrue(gain.meter(1200, false).second)
    }
    @Test fun volumeZeroMuteAndInputLossRemainIndependent() {
        val gain = OutdoorMicrophoneGain()
        for (volume in listOf(0, 100, 200)) {
            gain.volume = volume
            for (manual in listOf(false, true)) for (lost in listOf(false, true)) {
                gain.manualMute = manual
                val bytes = pcm(1000, -1000)
                gain.process(bytes, bytes.size, lost, 0)
                val silent = volume == 0 || manual || lost
                assertEquals(if (silent) listOf(0, 0) else listOf(10 * volume, -10 * volume), samples(bytes))
                assertEquals(silent, gain.effectivelyMuted(lost))
                if (silent) assertEquals(0f, gain.meter(1, lost).first)
            }
        }
        gain.manualMute = false
        assertTrue(gain.effectivelyMuted(true))
        assertFalse(OutdoorMicrophoneGain(gain.volume).manualMute)
    }
    @Test fun settingsPersistIndependentlyOfEitherQrVersionAndRejectActiveQualityChanges() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("outdoor_controls", Context.MODE_PRIVATE).edit().clear().commit()
        val prefs = OutdoorPreferences(context)
        assertEquals(OutdoorQuality(), prefs.quality()); assertEquals(100, prefs.volume())
        val quality = OutdoorQuality.presets().last().copy(latencyMs = 200, videoCodec = OutdoorVideoCodec.H265).custom()
        prefs.saveQuality(quality); prefs.saveVolume(173)
        val restored = OutdoorPreferences(context)
        assertEquals(quality, restored.quality()); assertEquals(173, restored.volume())
        for (status in listOf("preparing", "connecting", "sending", "reconnecting")) {
            OutdoorRuntime.update(OutdoorState(active = true, status = status))
            assertThrows(IllegalStateException::class.java) { restored.saveQuality(OutdoorQuality()) }
            assertEquals(quality, restored.quality())
        }
    }
    @Test fun allQualityBoundariesAndPresetValuesFollowTheContract() {
        for (bitrate in listOf(500000, 12000000)) for (latency in listOf(200, 3000)) {
            val q = OutdoorQuality(videoBitrate = bitrate, latencyMs = latency).custom()
            assertEquals(q, OutdoorQuality.parse(q.json()))
        }
        for (bitrate in listOf(499999, 550000, 12000001)) assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(videoBitrate = bitrate) }
        for (latency in listOf(199, 250, 3001)) assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(latencyMs = latency) }
        assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(fps = 25) }
        assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(width = 3840, height = 2160) }
        assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(audioBitrate = 48000) }
        assertThrows(IllegalArgumentException::class.java) { OutdoorQuality(keyframeSeconds = 3) }
        val presets = OutdoorQuality.presets()
        assertEquals(listOf(1000000, 2500000, 6000000, 5000000), presets.map { it.videoBitrate })
        assertEquals(listOf(64000, 64000, 128000, 96000), presets.map { it.audioBitrate })
        assertEquals(listOf(30, 30, 30, 60), presets.map { it.fps })
        assertTrue(presets.all { it.latencyMs == 400 && it.keyframeSeconds == 2 })
        assertEquals(1000, OutdoorQuality.parse(OutdoorQuality(latencyMs = 1000).json()).latencyMs)
        assertEquals("カスタム", presets[1].custom().preset)
    }
    @Test fun statisticsUseBytesAndMicrosecondsWithoutStaleDisconnectedValues() {
        val meter = OutdoorStatisticsMeter()
        assertNull(meter.sample(100, 1000, 0).bitrate)
        val stats = meter.sample(1100, 126000, 20500, 7)
        assertEquals(1000000.0, stats.bitrate!!, 0.001)
        assertEquals(20.5, stats.rttMs!!, 0.001)
        assertEquals(7, stats.requestedPackets)
        meter.retry()
        assertEquals(OutdoorStatistics(retries = 1), meter.disconnected())
        assertNull(meter.sample(2200, 100, 0).bitrate)
        assertNull(meter.sample(3200, 50, -1).bitrate)
        assertNull(meter.sample(3200, 60, 0).rttMs)
    }
    @Test fun focusIgnoresLetterboxAndMapsRotationsAndMirroring() {
        assertNull(outdoorFocusPoint(100f, 10f, 200, 200, 160, 90, 0, false))
        assertEquals(0.25f to 0.5f, outdoorFocusPoint(50f, 100f, 200, 200, 160, 90, 0, false))
        assertEquals(0.75f to 0.5f, outdoorFocusPoint(50f, 100f, 200, 200, 160, 90, 0, true))
        assertEquals(0.5f to 0.75f, outdoorFocusPoint(50f, 100f, 200, 200, 160, 90, 90, false))
        assertEquals(0.75f to 0.5f, outdoorFocusPoint(50f, 100f, 200, 200, 160, 90, 180, false))
        assertEquals(0.5f to 0.25f, outdoorFocusPoint(50f, 100f, 200, 200, 160, 90, 270, false))
        assertNull(outdoorFocusPoint(0f, 0f, 0, 0, 160, 90, 0, false))
    }
    @Test fun focusUsesTheActualCameraTextureTransform() {
        // SurfaceTexture's default vertical inversion converts GL to buffer coordinates.
        val texture = floatArrayOf(1f, 0f, 0f, 0f, 0f, -1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 1f)
        assertEquals(0.25f to 0.5f, outdoorTextureFocusPoint(0.25f to 0.5f, 0, texture))
        assertEquals(0.5f to 0.75f, outdoorTextureFocusPoint(0.25f to 0.5f, 90, texture))
        assertEquals(0.5f to 0.25f, outdoorTextureFocusPoint(0.25f to 0.5f, 270, texture))
        texture[0] = -1f; texture[12] = 1f
        assertEquals(0.75f to 0.5f, outdoorTextureFocusPoint(0.25f to 0.5f, 0, texture))
        texture[0] = 0.5f; texture[12] = 0.25f
        assertEquals(0.375f to 0.5f, outdoorTextureFocusPoint(0.25f to 0.5f, 0, texture))
        assertNull(outdoorTextureFocusPoint(0.25f to 0.5f, 0, FloatArray(0)))
    }
}
