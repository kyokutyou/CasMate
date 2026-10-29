package jp.casmate.app.outdoor

import com.pedro.common.TimeUtils
import com.pedro.encoder.Frame
import com.pedro.encoder.audio.AudioEncoder
import com.pedro.encoder.input.audio.GetMicrophoneData
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SelectedMicrophoneClockTest {
    private class Encoder : AudioEncoder(null) {
        fun pts(frame: Frame, origin: Long) = calculatePts(frame, origin)
    }

    private fun nextSilentFrame(): Frame {
        val source = SelectedMicrophone(RuntimeEnvironment.getApplication(), -1, {})
        val frames = ArrayBlockingQueue<Frame>(1)
        source.mute() // No AudioRecord / permission / physical input required.
        try {
            source.start(object : GetMicrophoneData {
                override fun inputPCMData(frame: Frame) { frames.offer(frame) }
            })
            return checkNotNull(frames.poll(2, TimeUnit.SECONDS)) { "PCM source did not produce a frame" }
        } finally { source.stop() }
    }

    @Test fun replacementKeepsTheVideoClockAndIncludesTheInputGap() {
        val encoder = Encoder()
        val origin = TimeUtils.getCurrentTimeMicro()
        ShadowSystemClock.advanceBy(Duration.ofSeconds(1))
        val first = nextSilentFrame()
        assertEquals(TimeUtils.getCurrentTimeMicro(), first.timeStamp)
        val firstPts = encoder.pts(first, origin)
        assertEquals(1_000_000L, firstPts)
        repeat(3) {
            ShadowSystemClock.advanceBy(Duration.ofMillis(500))
            val replacement = nextSilentFrame()
            assertEquals(TimeUtils.getCurrentTimeMicro(), replacement.timeStamp)
            assertEquals(firstPts + (it + 1) * 500_000L, encoder.pts(replacement, origin))
            assertTrue(replacement.buffer.all { byte -> byte == 0.toByte() })
        }
    }
}
