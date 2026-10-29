package jp.casmate.app.audio

class NotificationUpdateGate {
    private var lastState: State? = null

    fun shouldPublish(
        status: AudioStatus,
        playing: Boolean,
    ): Boolean {
        val state = State(status, playing)
        if (state == lastState) return false
        lastState = state
        return true
    }

    private data class State(
        val status: AudioStatus,
        val playing: Boolean,
    )
}
