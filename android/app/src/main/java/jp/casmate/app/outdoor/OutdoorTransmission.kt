package jp.casmate.app.outdoor

interface OutdoorTransport {
    /** First call starts capture; later calls reconnect only the network transport. */
    fun connect(events: Events)
    /** Releases capture and transport on explicit stop or an unrecoverable failure. */
    fun close()
    interface Events { fun connected(); fun sending(); fun failed(authentication: Boolean = false) }
}

/** Owns one explicit transmission session. Reporting is an observer, never a prerequisite for transport. */
class OutdoorTransmission(private val transport: OutdoorTransport,
    private val schedule: (Long, () -> Unit) -> (() -> Unit),
    private val onState: (String, String) -> Unit) {
    private val backoff = OutdoorBackoff()
    private var generation = 0
    private var active = false
    private var everConnected = false
    private var connected = false
    private var cancelRetry: (() -> Unit)? = null
    fun start() {
        if (active) return
        active = true; everConnected = false; backoff.reset(); attempt()
    }
    private fun publish(status: String, error: String = "NONE") { runCatching { onState(status, error) } }
    private fun attempt() {
        if (!active) return
        val current = ++generation
        connected = false; publish(if (everConnected) "reconnecting" else "connecting")
        try { transport.connect(object : OutdoorTransport.Events {
            override fun connected() { if (active && current == generation) { connected = true; everConnected = true; backoff.reset() } }
            override fun sending() { if (active && current == generation && connected) publish("sending") }
            override fun failed(authentication: Boolean) {
                if (!active || current != generation) return
                generation++; connected = false
                publish(if (everConnected) "reconnecting" else "connecting", if (authentication) "AUTH_FAILED" else "CONNECTION_FAILED")
                cancelRetry = schedule(backoff.nextMillis()) { cancelRetry = null; attempt() }
            }
        }) } catch (error: Exception) {
            stop()
            publish("actionRequired", if (error is OutdoorPreparationException) error.code else "CAMERA_FAILED")
        }
    }
    fun networkChanged() { if (cancelRetry != null && active) { cancelRetry?.invoke(); cancelRetry = null; attempt() } }
    fun stop() {
        active = false; generation++; connected = false; cancelRetry?.invoke(); cancelRetry = null
        runCatching { transport.close() }; publish("stopped")
    }
}
class OutdoorPreparationException(val code: String) : IllegalStateException(code)
