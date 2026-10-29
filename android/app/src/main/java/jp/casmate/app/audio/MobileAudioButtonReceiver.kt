package jp.casmate.app.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.KeyEvent
import androidx.core.content.ContextCompat
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Restart only on an explicit media start; old comment audio is never restored. */
class MobileAudioButtonReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MEDIA_BUTTON) return
        val event = intent.mediaButtonEvent() ?: return
        if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return
        if (event.keyCode != KeyEvent.KEYCODE_MEDIA_PLAY &&
            event.keyCode != KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE &&
            event.keyCode != KeyEvent.KEYCODE_HEADSETHOOK) return
        try {
            // Use the normal start path: protected registration, permissions and foreground checks.
            ContextCompat.startForegroundService(context, MobileAudioService.resumeIntent(context))
        } catch (error: RuntimeException) {
            if (error !is SecurityException && error !is IllegalStateException) throw error
            AudioServiceState.update(AudioStatus.FOREGROUND_UNAVAILABLE)
            val pending = goAsync()
            CoroutineScope(Dispatchers.Main.immediate).launch {
                try {
                    runCatching { AppPreferences(context).setStartDesired(false) }
                } finally { pending.finish() }
            }
        }
    }
}

internal fun Intent.mediaButtonEvent(): KeyEvent? = runCatching {
    if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
    else {
        @Suppress("DEPRECATION")
        getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
    }
}.getOrNull()
