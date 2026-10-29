package jp.casmate.app.outdoor

import android.content.Context
import android.view.OrientationEventListener

/** Service-owned physical orientation; independent of Activity rotation locks and recreation. */
internal class OutdoorOrientationMonitor(context: Context, initial: Int, private val publish: (Int) -> Unit) {
    private val tracker = OutdoorOrientationTracker(initial)
    private var running = false
    private val listener = object : OrientationEventListener(context) {
        override fun onOrientationChanged(orientation: Int) {
            if (running) tracker.sample(orientation)?.let(publish)
        }
    }

    fun start() {
        running = true
        publish(tracker.current)
        if (listener.canDetectOrientation()) listener.enable()
    }

    fun stop() {
        running = false
        listener.disable()
    }
}
