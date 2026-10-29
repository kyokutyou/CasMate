package jp.casmate.app.audio

import android.content.Intent
import android.view.KeyEvent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class MobileAudioButtonReceiverTest {
    @Test fun explicitMediaStartsUseTheProtectedRegistrationInsteadOfBroadcastExtras() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        for (key in listOf(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK)) {
            MobileAudioButtonReceiver().onReceive(app, Intent(Intent.ACTION_MEDIA_BUTTON)
                .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, key))
                .putExtra("comments_url", "http://untrusted.invalid/comments"))
            val started = shadowOf(app).nextStartedService
            assertNotNull(started)
            assertEquals(MobileAudioService::class.java.name, started.component!!.className)
            assertEquals(MobileAudioService.resumeIntent(app).action, started.action)
            assertFalse("A media broadcast cannot supply a connection", started.hasExtra("comments_url"))
        }
    }

    @Test fun ReleasesRepeatsStopsAndMalformedEventsDoNotRestartAudio() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        val ignored = listOf(
            Intent("unrelated.action").putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY)),
            Intent(Intent.ACTION_MEDIA_BUTTON),
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, android.os.Bundle()),
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY)),
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 1)),
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE)),
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_STOP)),
        )
        for (intent in ignored) {
            MobileAudioButtonReceiver().onReceive(app, intent)
            assertNull("Only an explicit start may recreate the service", shadowOf(app).nextStartedService)
        }
    }
}
