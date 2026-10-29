package jp.casmate.app.outdoor

import android.os.SystemClock
import com.pedro.library.view.GlStreamInterface

/** The vendored photo API clears its one-shot slot after calling the consumer. Tests must
 * wait for that clearing before scheduling another capture, or the old frame clears it. */
internal fun awaitGlPhotoConsumed(gl: GlStreamInterface) {
    val slot = GlStreamInterface::class.java.getDeclaredField("takePhotoCallback").apply { isAccessible = true }
    val deadline = SystemClock.elapsedRealtime() + 5_000
    while (slot.get(gl) != null) {
        check(SystemClock.elapsedRealtime() < deadline) { "Previous GL photo request was not consumed" }
        Thread.sleep(1)
    }
}
