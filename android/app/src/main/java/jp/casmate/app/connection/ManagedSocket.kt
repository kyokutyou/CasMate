package jp.casmate.app.connection

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.net.Proxy
import java.util.concurrent.TimeUnit

/** A generation-fenced socket. Callers hold topic leases, never an OkHttp connection. */
internal class ManagedSocket(
    private val helloType: String,
    private var version: Int,
    private val onHello: (JSONObject) -> Unit,
    private val onText: (JSONObject) -> Unit,
    private val onBinary: (ByteArray) -> Unit = {},
    private val onState: (String) -> Unit,
    private val factory: WebSocket.Factory = client,
    private val directFactory: (OkHttpClient) -> WebSocket.Factory = { it },
    private val onBinaryRejected: () -> Unit = {},
) {
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var url: String? = null
    private var targets: List<String> = emptyList()
    private var candidate = 0
    private var activeFactory: WebSocket.Factory = factory
    private var directClient: OkHttpClient? = null
    private var directRegistration: DirectRegistration? = null
    private var clientTargets: List<String> = emptyList()
    private var identity: String? = null
    private var headers: Map<String, String> = emptyMap()
    private var generation = 0L
    private var attempt = 0
    private var blocked = false
    private var lastMessage = 0L
    private var retry: Runnable? = null
    private var watchdog: Runnable? = null
    private var networkManager: ConnectivityManager? = null
    private var incoming: SocketInbox? = null
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { handler.post { if (socket == null && !blocked) schedule(true) } }
    }
    var connectionId: String? = null
        private set
    var negotiatedVersion: Int? = null
        private set

    fun protocolVersion(value: Int) { if (version != value) { close(); version = value } }

    fun open(context: Context, target: String, credentials: Map<String, String> = emptyMap()) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (url == target && headers == credentials) return
        close()
        url = target; targets = listOf(target); headers = credentials; blocked = false; attempt = 0; candidate = 0; activeFactory = factory
        networkManager = context.applicationContext.getSystemService(ConnectivityManager::class.java)
        runCatching { networkManager?.registerDefaultNetworkCallback(networkCallback) }
        connect()
    }
    fun openDirect(context: Context, registration: DirectRegistration, path: String, credentials: Map<String, String>) {
        check(path in setOf("/mobile/ws", "/smartphone/ws")); check(Looper.myLooper() == Looper.getMainLooper())
        val next = "${registration.identity}:$path"
        if (identity == next && headers == credentials) {
            if ((registration.update?.revision ?: 0) < (directRegistration?.update?.revision ?: 0)) return
            val active = targets.getOrNull(candidate)
            val updated = registration.endpoints.map { "wss://${it.authority}$path" }
            directRegistration = registration
            if (targets != updated) {
                targets = updated; url = targets.first()
                candidate = if (socket == null) 0 else targets.indexOf(active)
            }
            return
        }
        close(); identity = next; targets = registration.endpoints.map { "wss://${it.authority}$path" }; url = targets.first(); headers = credentials
        directRegistration = registration; candidate = 0; attempt = 0; blocked = false
        networkManager = context.applicationContext.getSystemService(ConnectivityManager::class.java); runCatching { networkManager?.registerDefaultNetworkCallback(networkCallback) }; connect()
    }

    fun close() {
        url = null; targets = emptyList(); identity = null; generation++
        incoming?.close(); incoming = null
        retry?.let(handler::removeCallbacks); retry = null
        watchdog?.let(handler::removeCallbacks); watchdog = null
        socket?.cancel(); socket = null; connectionId = null; negotiatedVersion = null
        val releasedClient = directClient; directClient = null
        directRegistration = null; clientTargets = emptyList()
        releasedClient?.let(PinnedPcClient::release)
        runCatching { networkManager?.unregisterNetworkCallback(networkCallback) }; networkManager = null
    }

    fun retryNow() { if (url != null) { blocked = false; lost(generation); schedule(true) } }
    fun retryIfBlocked() { if (blocked) retryNow() }
    fun send(value: JSONObject): Boolean = connectionId != null && (socket?.send(value.toString()) == true)

    private fun connect() {
        if (url == null) return; val target = targets.getOrNull(candidate) ?: return
        if (blocked || socket != null) return
        val registration = directRegistration
        if (registration != null && (directClient == null || clientTargets != targets)) {
            directClient?.let(PinnedPcClient::release)
            directClient = PinnedPcClient.create(registration.fingerprint, registration.endpoints).newBuilder().readTimeout(0, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build()
            activeFactory = directFactory(directClient!!); clientTargets = targets
        }
        retry = null
        val epoch = ++generation
        val inbox = SocketInbox(handler) { handler.post { lost(epoch) } }.also { incoming = it }
        lastMessage = SystemClock.elapsedRealtime(); onState("connecting")
        val request = Request.Builder().url(target).apply { headers.forEach { (key, value) -> header(key, value) } }.build()
        socket = activeFactory.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (helloType == "control.hello" && (text.length > 32768 || text.toByteArray(Charsets.UTF_8).size > 32768)) {
                    inbox.reject(); webSocket.cancel(); return
                }
                if (!inbox.post(text.length * 2) {
                    if (generation != epoch || socket !== webSocket) return@post
                    val event = runCatching { JSONObject(text) }.getOrNull() ?: return@post
                    lastMessage = SystemClock.elapsedRealtime()
                    if (connectionId == null && event.optString("type") == "mobile.snapshot") {
                        blocked = true; lost(epoch, "version"); return@post
                    }
                    if (event.optString("type") == helloType) {
                        if (connectionId != null) { lost(epoch); return@post }
                        val payload = event.optJSONObject("payload")
                        val announced = payload?.optDouble("protocolVersion", -1.0) ?: -1.0
                        if (payload?.opt("protocolVersion") !is Number || !acceptsSocketVersion(helloType, version, announced)) {
                            blocked = true; lost(epoch, if ((payload?.optDouble("protocolVersion") ?: -1.0) > version) "androidVersion" else "version"); return@post
                        }
                        val id = event.optString("connectionId")
                        if (id.isBlank() || id.length > 64) { lost(epoch); return@post }
                        connectionId = id; negotiatedVersion = announced.toInt(); attempt = 0
                        runCatching { onHello(payload); onState("connected") }.onFailure { lost(epoch) }
                    } else if (event.optString("connectionId") == connectionId) {
                        if (event.optString("type") == "ping") {
                            val nonce = event.optJSONObject("payload")?.optString("nonce")
                            if (nonce.isNullOrEmpty() || nonce.length > 64) lost(epoch)
                            else send(JSONObject().put("type", "pong").put("nonce", nonce))
                        }
                        else runCatching { onText(event) }.onFailure { lost(epoch) }
                    }
                }) webSocket.cancel()
            }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (helloType == "control.hello" && bytes.size > 16420) {
                    // A malformed preview is local to its request, not to every control topic.
                    if (!inbox.postImage(bytes.size, {}, { if (generation == epoch && socket === webSocket) onBinaryRejected() })) webSocket.cancel()
                    return
                }
                if (bytes.size > 16420) { inbox.reject(); webSocket.cancel(); return }
                val deliver = { if (generation == epoch && socket === webSocket && connectionId != null) {
                    lastMessage = SystemClock.elapsedRealtime(); runCatching { onBinary(bytes.toByteArray()) }.onFailure { lost(epoch) }
                } }
                val accepted = if (helloType == "control.hello") inbox.postImage(bytes.size, deliver, onBinaryRejected)
                    else inbox.post(bytes.size, deliver)
                if (!accepted) webSocket.cancel()
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                handler.post {
                    if (generation != epoch) return@post
                    blocked = code == 4403 || code == 4406
                    lost(epoch, if (code == 4403) "auth" else if (code == 4406) "version" else "disconnected")
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handler.post {
                    if (generation != epoch) return@post
                    val pcKey = directClient != null && (t is javax.net.ssl.SSLException || generateSequence(t.cause) { it.cause }.any { it is java.security.cert.CertificateException })
                    val updateProtocol = helloType == "control.hello" && headers.containsKey("X-CasMate-Registration")
                    val rejected = response?.code == 403
                    val revoked = rejected && (!updateProtocol || response.header("X-CasMate-Registration-State") == "revoked")
                    blocked = revoked || pcKey
                    lost(epoch, if (pcKey) "pcKey" else if (revoked) "auth" else if (rejected) "rejected" else "disconnected")
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { handler.post { lost(epoch) } }
        })
        watchdog = object : Runnable {
            override fun run() {
                if (generation != epoch || socket == null) return
                if (SystemClock.elapsedRealtime() - lastMessage >= 4000) lost(epoch)
                else handler.postDelayed(this, 250)
            }
        }.also { handler.postDelayed(it, 250) }
    }

    private fun lost(epoch: Long, state: String = "disconnected") {
        if (epoch != generation || url == null) return
        candidate = if (connectionId != null) 0 else (candidate + 1) % targets.size
        incoming?.close(); incoming = null
        generation++; socket?.cancel(); socket = null; connectionId = null; negotiatedVersion = null
        watchdog?.let(handler::removeCallbacks); watchdog = null
        onState(state); schedule(false)
    }
    private fun schedule(immediate: Boolean) {
        if (url == null || blocked || socket != null) return
        retry?.let(handler::removeCallbacks)
        val delay = if (immediate) 0L else listOf(500L, 1000L, 2000L)[attempt++.coerceAtMost(2)]
        retry = Runnable { connect() }.also { handler.postDelayed(it, delay) }
    }

    companion object {
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .proxy(Proxy.NO_PROXY).connectTimeout(3, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build()
    }
}

/** Version 2 is the explicitly supported control migration peer; other protocols stay exact. */
internal fun acceptsSocketVersion(helloType: String, requested: Int, actual: Double): Boolean =
    actual == requested.toDouble() || helloType == "control.hello" && requested == 3 && actual == 2.0

/** Bound pending main-thread work before decoding JSON or copying audio. Each socket owns a token. */
internal class SocketInbox(private val handler: Handler, private val overflow: () -> Unit) {
    private var imageOverflow = false
    private var imageBytes = 0
    private var imageCount = 0
    private var closed = false
    private var bytes = 0
    private var count = 0
    @Synchronized fun post(size: Int, action: () -> Unit): Boolean {
        if (closed) return false
        if (size < 0 || size > 2 * 1024 * 1024 - bytes || count >= 128) { reject(); return false }
        bytes += size; count++
        handler.postAtTime({
            synchronized(this) { if (closed) return@postAtTime; bytes -= size; count-- }
            action()
        }, this, SystemClock.uptimeMillis())
        return true
    }
    @Synchronized fun postImage(size: Int, action: () -> Unit, rejected: () -> Unit): Boolean {
        if (closed) return false
        if (imageOverflow) return true
        // Reserve the shared queue for control text; a stalled preview cannot consume it.
        if (size !in 0..16420 || imageBytes + size > 256 * 1024 || imageCount >= 16) {
            imageOverflow = true
            handler.postAtTime({ synchronized(this) { if (closed) return@postAtTime; imageOverflow = false }; rejected() }, this, SystemClock.uptimeMillis())
            return true
        }
        imageBytes += size; imageCount++
        handler.postAtTime({
            synchronized(this) { if (closed) return@postAtTime; imageBytes -= size; imageCount-- }
            action()
        }, this, SystemClock.uptimeMillis())
        return true
    }
    @Synchronized fun reject() { if (!closed) { close(); overflow() } }
    @Synchronized fun close() {
        closed = true; handler.removeCallbacksAndMessages(this); bytes = 0; count = 0; imageBytes = 0; imageCount = 0; imageOverflow = false
    }
}
