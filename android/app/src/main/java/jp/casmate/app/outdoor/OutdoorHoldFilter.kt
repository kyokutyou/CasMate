package jp.casmate.app.outdoor

import com.pedro.encoder.input.gl.render.filters.NoFilterRender
import java.util.concurrent.atomic.AtomicReference

/** Holds the filter's raw rendered texture, never an encoded packet or UI capture.
 * The camera and GL presentation clock keep running. All GL work stays on GL's thread. */
open class OutdoorHoldFilter : NoFilterRender() {
    private data class Request(val complete: (Boolean) -> Unit)
    private val pending = AtomicReference<Request?>()
    private val resumed = AtomicReference<((Boolean) -> Unit)?>()
    private var acknowledged: Request? = null
    @Volatile var validFrame = false; private set
    @Volatile var outputLive = false; private set

    fun hold(complete: (Boolean) -> Unit) { resumed.set(null); pending.set(Request(complete)) }
    fun resume(complete: ((Boolean) -> Unit)? = null) { resumed.set(complete); pending.set(null) }
    protected open fun renderLiveFrame() { super.draw() }

    override fun draw() {
        val request = pending.get()
        try {
            outputLive = false
            if (request == null) {
                renderLiveFrame(); validFrame = true; outputLive = true
                resumed.getAndSet(null)?.invoke(true)
            } else if (request !== acknowledged && request === pending.get()) {
                acknowledged = request
                val success = validFrame
                if (!success) {
                    pending.compareAndSet(request, null)
                    renderLiveFrame(); validFrame = true; outputLive = true
                }
                request.complete(success)
            }
        } catch (e: RuntimeException) {
            pending.compareAndSet(request, null)
            throw e
        }
    }
    override fun release() {
        pending.set(null); resumed.set(null); acknowledged = null; validFrame = false; outputLive = false
        super.release()
    }
}
