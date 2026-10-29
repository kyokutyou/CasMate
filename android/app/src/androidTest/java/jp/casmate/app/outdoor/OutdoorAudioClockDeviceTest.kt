package jp.casmate.app.outdoor

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.pedro.common.TimeUtils
import com.pedro.encoder.audio.AudioEncoder
import com.pedro.encoder.audio.GetAudioData
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList

/** Synthetic silence only: never opens a camera, microphone, network, or media file. */
@RunWith(AndroidJUnit4::class)
class OutdoorAudioClockDeviceTest {
    @Test fun audioClockDoesNotFallBehindAfterMicrophoneReplacementGap() {
        val ages = CopyOnWriteArrayList<Long>()
        var origin = 0L
        val encoder = AudioEncoder(object : GetAudioData {
            override fun onAudioFormat(mediaFormat: MediaFormat) {}
            override fun getAudioData(audioBuffer: ByteBuffer, info: MediaCodec.BufferInfo) {
                if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
                    ages.add(TimeUtils.getCurrentTimeMicro() - origin - info.presentationTimeUs)
                }
            }
        })
        assertTrue(encoder.prepareAudioEncoder(64_000, 48_000, false))
        origin = TimeUtils.getCurrentTimeMicro()
        encoder.start(origin)
        fun feed() {
            // Exercise the production PCM timestamp path. Muting before start prevents
            // AudioRecord creation, so the source emits synthetic silence only.
            val source = SelectedMicrophone(InstrumentationRegistry.getInstrumentation().targetContext, -1, {})
            source.mute()
            try {
                source.start(encoder)
                SystemClock.sleep(1000)
            } finally { source.stop() }
        }
        try {
            feed()
            assertTrue("AAC must produce output", ages.size >= 20)
            val before = ages.takeLast(15).sorted()[7]
            val countBeforeReplacement = ages.size
            SystemClock.sleep(500) // stop old recorder / start the selected recorder
            feed()
            assertTrue("Replacement must produce fresh AAC output", ages.size >= countBeforeReplacement + 20)
            val after = ages.takeLast(15).sorted()[7]
            android.util.Log.i("CasMateAudioClockTest", "AAC age before=${before / 1000}ms after=${after / 1000}ms")
            assertTrue("AAC clock gained ${(after - before) / 1000} ms of lag (before=${before / 1000}, after=${after / 1000})",
                after - before < 100_000)
            assertTrue("AAC must remain on the current video clock, age=${after / 1000} ms", after in 0..150_000)
        } finally {
            encoder.stop()
        }
    }
}
