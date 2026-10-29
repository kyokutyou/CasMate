package jp.casmate.app.connection

import jp.casmate.app.compatibility.CompatibilityPolicy
import android.content.Context
import android.os.SystemClock
import org.json.JSONObject

internal interface MobileAudioListener {
    fun state(value: String)
    fun audio(value: ReceivedAudio)
    fun discard(id: String? = null)
}

/** One public socket shared by the visible comment renderer and the foreground audio service. */
internal object MobileReadConnection {
    private class CommentLease(val url: String, val event: (String) -> Unit)
    private class AudioLease(val url: String, val listener: MobileAudioListener)
    private var endpoint: String? = null
    private var latestDirect: DirectRegistration? = null
    private val comments = linkedMapOf<Any, CommentLease>()
    private var audio: AudioLease? = null
    private var commentsGeneration = 0L
    private var audioGeneration = 0L
    private var commentsSubscribed = false
    private var audioSubscribed = false
    private var audioAvailable = false
    private var status = "disconnected"
    private val assembler = MobileAudioAssembler(SystemClock::elapsedRealtime)
    private val socket = ManagedSocket("mobile.hello", CompatibilityPolicy.MOBILE_PROTOCOL, ::hello, ::event, ::binary, ::state)

    fun comments(context: Context, connection: ConnectionUrl, listener: (String) -> Unit): AutoCloseable {
        val key = Any(); comments[key] = CommentLease(connection.identity, listener)
        open(context, connection)
        listener(connectionEvent(status == "connected"))
        subscribeComments(force = true)
        return AutoCloseable { comments.remove(key); subscribeComments(); closeIfUnused() }
    }

    fun audio(context: Context, connection: ConnectionUrl, listener: MobileAudioListener): AutoCloseable {
        val lease = AudioLease(connection.identity, listener)
        audio?.listener?.discard(); audio = lease
        open(context, connection); listener.state(if (status == "connected" && !audioAvailable) "unavailable" else status)
        socket.retryIfBlocked()
        subscribeAudio()
        return AutoCloseable {
            if (audio === lease) { audio = null; subscribeAudio(); assembler.clear(); closeIfUnused() }
        }
    }

    fun result(type: String, id: String) {
        if (audioSubscribed) socket.send(JSONObject().put("type", type).put("generation", audioGeneration).put("audioId", id))
    }

    private fun open(context: Context, connection: ConnectionUrl) {
        updateDirect(context, connection.direct)
        if (endpoint != connection.identity) {
            socket.close(); reset(); endpoint = connection.identity
        }
        if (connection.direct != null) openDirect(context, latestDirect ?: connection.direct)
        else socket.open(context, connection.websocketUrl)
    }
    fun updateDirect(context: Context, registration: DirectRegistration?) {
        val previous = latestDirect
        if (registration != null && previous?.identity == registration.identity &&
            (registration.update?.revision ?: 0) < (previous.update?.revision ?: 0)) return
        latestDirect = registration
        if (registration != null && endpoint == registration.identity) openDirect(context, registration)
    }
    private fun openDirect(context: Context, registration: DirectRegistration) = socket.openDirect(context, registration, "/mobile/ws",
        mapOf("X-CasMate-Read" to "Bearer ${registration.comments.token}"))
    private fun closeIfUnused() {
        if (comments.isEmpty() && audio == null) { socket.close(); reset(); endpoint = null }
    }
    private fun hello(payload: JSONObject) {
        commentsGeneration = 0; audioGeneration = 0; commentsSubscribed = false; audioSubscribed = false
        audioAvailable = payload.optBoolean("audioAvailable", false)
        subscribeComments(); subscribeAudio()
    }
    private fun subscribeComments(force: Boolean = false) {
        if (socket.connectionId == null) return
        val wanted = comments.values.any { it.url == endpoint }
        if (wanted == commentsSubscribed && !force) return
        commentsSubscribed = wanted; commentsGeneration++
        subscribe("comments", commentsGeneration, wanted)
    }
    private fun subscribeAudio() {
        if (socket.connectionId == null) return
        val wanted = audio?.url == endpoint && audio != null && audioAvailable
        if (wanted == audioSubscribed) return
        audioSubscribed = wanted; audioGeneration++; assembler.clear()
        audio?.listener?.discard(); subscribe("audio", audioGeneration, wanted)
    }
    private fun subscribe(topic: String, generation: Long, enabled: Boolean) {
        socket.send(JSONObject().put("type", "mobile.subscribe").put("protocolVersion", CompatibilityPolicy.MOBILE_PROTOCOL)
            .put("topic", topic).put("generation", generation).put("enabled", enabled))
    }
    private fun event(value: JSONObject) {
        val type = value.optString("type"); val payload = value.optJSONObject("payload") ?: return
        if (type == "mobile.audioAvailabilityChanged") {
            audioAvailable = payload.optBoolean("audioAvailable", false); subscribeAudio()
            audio?.listener?.state(if (audioAvailable) "connected" else "unavailable"); return
        }
        if (type.startsWith("mobile.audio") || type == "mobile.subscription") {
            if (!audioSubscribed || value.optLong("generation") != audioGeneration) return
            val id = payload.optString("audioId")
            when (type) {
                "mobile.audioReady" -> if (!assembler.begin(payload)) result("mobile.audioError", id)
                "mobile.audioDiscard" -> { assembler.discard(id); audio?.listener?.discard(id) }
                "mobile.subscription" -> audio?.listener?.state(if (payload.optString("status") == "started") "connected" else "unavailable")
            }
        } else if (commentsSubscribed && value.optLong("generation") == commentsGeneration && type in commentEvents) {
            val text = value.toString()
            comments.values.filter { it.url == endpoint }.forEach { it.event(text) }
        }
    }
    private fun binary(data: ByteArray) {
        if (!audioSubscribed) return
        assembler.receive(data, audioGeneration) { result("mobile.audioError", it) }?.let { audio?.listener?.audio(it) }
    }
    private fun state(value: String) {
        if (value != "connected") reset()
        status = value
        comments.values.forEach { it.event(connectionEvent(value == "connected")) }
        audio?.listener?.state(if (value == "connected" && !audioAvailable) "unavailable" else value)
    }
    private fun reset() {
        commentsSubscribed = false; audioSubscribed = false; assembler.clear(); audio?.listener?.discard(); status = "disconnected"
    }
    private fun connectionEvent(connected: Boolean) = JSONObject().put("type", "mobile.connection")
        .put("payload", JSONObject().put("connected", connected)).toString()
    private val commentEvents = setOf("mobile.snapshotBegin", "mobile.snapshotChunk", "mobile.snapshotEnd", "comment.received", "comment.removed", "source.activityChanged", "commentList.settingsChanged")
}
