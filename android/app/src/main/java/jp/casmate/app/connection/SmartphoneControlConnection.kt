package jp.casmate.app.connection

import jp.casmate.app.compatibility.CompatibilityPolicy
import android.content.Context
import android.os.Handler
import android.os.Looper
import jp.casmate.app.obs.ObsControlHttpException
import jp.casmate.app.obs.ObsProgramImage
import jp.casmate.app.obs.ObsProgramImageReceiver
import jp.casmate.app.obs.RegistrationBundle
import jp.casmate.app.obs.RegistrationProfile
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.obs.CasMateRegistration
import jp.casmate.app.obs.ConnectionNetwork
import jp.casmate.app.obs.saveRegistrationUpdate
import jp.casmate.app.obs.revokeRegistrationUpdate
import jp.casmate.app.obs.RegistrationUpdateGate
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Private connection; credentials never cross the comment/WebView boundary. */
internal object SmartphoneControlConnection {
    private val main = Handler(Looper.getMainLooper())
    private var profile: RegistrationProfile? = null
    private var signature = ""
    private var obs: ((JSONObject?, String?) -> Unit)? = null
    private var outdoor: ((Boolean) -> Unit)? = null
    private var recognition: ((JSONObject?, String?) -> Unit)? = null
    private var generation = 0L
    private var subscribed = ""
    private var feedback: Feedback? = null
    private var context: Context? = null
    private var bundle: RegistrationBundle? = null
    private val registrationUsers = mutableSetOf<Any>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watch: Job? = null
    private var registrationSave: Job? = null
    private var revocationSave: Job? = null
    private var epoch = 0L
    private val mutableRegistrationStatus = MutableStateFlow<Map<ConnectionNetwork, String>>(emptyMap())
    val registrationStatus = mutableRegistrationStatus.asStateFlow()
    private val pending = linkedMapOf<String, CompletableDeferred<JSONObject>>()
    private val supportedCapture = MutableStateFlow<Boolean?>(null)
    val captureSupported = supportedCapture.asStateFlow()
    private class ImageRequest(val id: String, val generation: Long, val receiver: ObsProgramImageReceiver,
        val complete: CompletableDeferred<Unit> = CompletableDeferred())
    private var imageRequest: ImageRequest? = null
    private val socket = ManagedSocket("control.hello", 1, { hello ->
        generation = 0; subscribed = ""
        val capabilities = hello.optJSONArray("capabilities")
        supportedCapture.value = hello.optInt("protocolVersion") == 3 && capabilities != null &&
            (0 until capabilities.length()).any { capabilities.optString(it) == "obs.captureProgram" }
        subscribe()
    }, ::event, onBinary = ::imageFrame, onBinaryRejected = {
        imageRequest?.complete?.completeExceptionally(ObsControlHttpException(503, "OBS_CAPTURE_INVALID", "OBS画像を確認できません。更新してください。"))
    }, onState = ::state)
    private class Feedback(val session: String, val generation: Long, val listener: (JSONObject?) -> Unit)

    fun observeRegistration(context: Context): AutoCloseable {
        val owner = Any(); registrationUsers.add(owner); watch(context); subscribe()
        return AutoCloseable { registrationUsers.remove(owner); subscribe(); closeIfUnused() }
    }

    private fun watch(context: Context) {
        this.context = context.applicationContext
        if (watch != null) return
        watch = scope.launch {
            RegistrationBundleStore.revision.collectLatest {
                val current = withContext(Dispatchers.IO) { runCatching { RegistrationBundleStore.loadCurrent(context.applicationContext) }.getOrNull() }
                if (current != null && (registrationUsers.isNotEmpty() || obs != null || outdoor != null || recognition != null)) {
                    open(context.applicationContext, current); subscribe()
                }
            }
        }
    }

    fun observeObs(context: Context, bundle: RegistrationBundle, listener: (JSONObject?, String?) -> Unit): AutoCloseable {
        obs = listener
        watch(context)
        open(context, bundle)
        listener(null, if (bundle.controlUrl == null) "共通QRを読み直してください。" else null)
        subscribe()
        return AutoCloseable { if (obs === listener) { obs = null; subscribe(); closeIfUnused() } }
    }

    fun observeOutdoor(context: Context, bundle: RegistrationBundle, listener: (Boolean) -> Unit): AutoCloseable {
        outdoor = listener; watch(context); open(context, bundle); subscribe()
        return AutoCloseable { if (outdoor === listener) { outdoor = null; feedback = null; subscribe(); closeIfUnused() } }
    }

    fun observeRecognition(context: Context, bundle: RegistrationBundle, listener: (JSONObject?, String?) -> Unit): AutoCloseable {
        recognition = listener
        listener(null, if (bundle.controlUrl == null) "スマホ連携で登録済みのネットワークを選択してください。" else null)
        watch(context); open(context, bundle)
        subscribe()
        return AutoCloseable { if (recognition === listener) { recognition = null; subscribe(); closeIfUnused() } }
    }

    /** Safe from a sender worker: closing a previous attempt cannot release its successor. */
    fun feedback(session: String, generation: Long, listener: (JSONObject?) -> Unit): AutoCloseable {
        val value = Feedback(session, generation, listener); val closed = AtomicBoolean(false)
        main.post { if (!closed.get()) { feedback = value; sendFeedbackSubscription() } }
        return AutoCloseable { closed.set(true); main.post { if (feedback === value) { feedback = null; listener(null) } } }
    }

    suspend fun request(type: String, payload: JSONObject): JSONObject = withContext(Dispatchers.Main.immediate) {
        val applicationReady = socket.negotiatedVersion == 2 || profile?.speechRecognition != null
        if (socket.connectionId == null || (type.startsWith("obs.") && (obs == null || !applicationReady)) || (type.startsWith("outdoor.") && (outdoor == null || !applicationReady)) ||
            (type.startsWith("speechRecognition.") && (recognition == null || profile?.speechRecognition == null || socket.negotiatedVersion != 3)))
            throw ObsControlHttpException(503, "DISCONNECTED", "PCへ再接続してから操作してください。")
        check(pending.size < 32)
        val id = UUID.randomUUID().toString(); val result = CompletableDeferred<JSONObject>(); pending[id] = result
        try {
            if (!socket.send(JSONObject().put("type", type).put("id", id).put("generation", generation).put("payload", payload)))
                throw ObsControlHttpException(503, "DISCONNECTED", "操作の結果を確認できません。再接続後に現在の状態を確認してください。")
            awaitControlResponse(type, result)
        } finally { pending.remove(id) }
    }

    internal suspend fun captureProgram(): ObsProgramImage = withContext(Dispatchers.Main.immediate) {
        if (socket.connectionId == null || obs == null) throw ObsControlHttpException(503, "DISCONNECTED", "PCへ再接続してから更新してください。")
        if (supportedCapture.value != true) throw ObsControlHttpException(503, "OBS_CAPTURE_UNSUPPORTED", "OBS映像の確認にはPC版の更新が必要です。")
        check(imageRequest == null)
        val request = ImageRequest(UUID.randomUUID().toString(), generation, ObsProgramImageReceiver(generation))
        imageRequest = request
        try {
            withTimeout(10000) {
                check(socket.send(JSONObject().put("type", "obs.captureProgram").put("id", request.id).put("generation", generation).put("payload", JSONObject())))
                request.complete.await()
                val image = withContext(Dispatchers.IO) { request.receiver.decode() }
                check(imageRequest === request && generation == request.generation && socket.connectionId != null)
                image
            }
        } catch (error: TimeoutCancellationException) {
            throw ObsControlHttpException(504, "OBS_CAPTURE_TIMEOUT", "OBS映像の取得が時間内に完了しませんでした。更新してください。")
        } finally {
            socket.send(JSONObject().put("type", "obs.cancelCapture").put("generation", request.generation)
                .put("payload", JSONObject().put("requestId", request.id)))
            if (imageRequest === request) imageRequest = null
        }
    }

    private fun imageFrame(frame: ByteArray) {
        val request = imageRequest ?: return
        if (request.generation != generation || request.complete.isCompleted) return
        runCatching { request.receiver.accept(frame) }
            .onSuccess {
                request.receiver.acknowledgement()?.let { ack -> socket.send(JSONObject().put("type", "obs.imageAck").put("generation", generation).put("payload", ack)) }
                if (it) request.complete.complete(Unit)
            }
            .onFailure { request.complete.completeExceptionally(ObsControlHttpException(503, "OBS_CAPTURE_INVALID", "OBS画像を確認できません。更新してください。")) }
    }

    private fun open(context: Context, bundle: RegistrationBundle) {
        val next = bundle.profiles[bundle.activeNetwork]
        this.bundle = bundle
        MobileReadConnection.updateDirect(context, next?.direct)
        val nextSignature = listOf(next?.controlUrl, next?.obs?.json, next?.outdoor?.json, next?.direct?.identity,
            next?.update?.credential?.id, next?.update?.credential?.revision, next?.update?.credential?.token, next?.update?.revoked,
            next?.speechRecognition?.id, next?.speechRecognition?.revision, next?.speechRecognition?.token).joinToString("\n")
        if (signature != nextSignature) {
            socket.close(); state("disconnected"); subscribed = ""; signature = nextSignature
        }
        profile = next
        if (next?.update?.let(RegistrationUpdateGate::isRevoked) == true || (next?.update == null && obs == null && outdoor == null)) { socket.close(); return }
        val url = next?.controlUrl ?: return
        socket.protocolVersion(CompatibilityPolicy.CONTROL_PROTOCOL)
        if (next.direct == null && !LocalNetworkAccess.allowedUrl(context, next.commentsUrl ?: return)) {
            obs?.invoke(null, "LANへのアクセス許可が必要です。")
            recognition?.invoke(null, "LANへのアクセス許可が必要です。スマホ連携で権限と接続先を確認してください。")
            return
        }
        val headers = buildMap {
            put("X-CasMate-Control-Version", CompatibilityPolicy.CONTROL_PROTOCOL.toString())
            next.obs?.let { put("X-CasMate-Obs", "Bearer ${it.token}") }
            next.outdoor?.let { put("X-CasMate-Outdoor", "Bearer ${it.token}") }
            next.update?.let { put("X-CasMate-Registration", "Bearer ${it.credential.token}") }
            next.speechRecognition?.let { put("X-CasMate-Speech", "Bearer ${it.token}") }
        }
        if (headers.isEmpty()) return
        if (next.direct != null) socket.openDirect(context, next.direct, "/smartphone/ws", headers) else socket.open(context, url, headers)
        socket.retryIfBlocked()
    }
    private fun closeIfUnused() {
        if (obs == null && outdoor == null && recognition == null && registrationUsers.isEmpty()) {
            epoch++; socket.close(); pendingFailed(); subscribed = ""; signature = ""; profile = null; bundle = null
            watch?.cancel(); watch = null; context = null
        }
    }
    private fun subscribe() {
        if (socket.connectionId == null) return
        val ready = socket.negotiatedVersion == 2 || profile?.speechRecognition != null
        val hasObs = ready && obs != null && profile?.obs != null
        val hasOutdoor = ready && outdoor != null && profile?.outdoor != null
        val hasRecognition = recognition != null && profile?.speechRecognition != null && socket.negotiatedVersion == 3
        val hasRegistration = profile?.update != null && (registrationUsers.isNotEmpty() || obs != null || outdoor != null || recognition != null)
        val desired = "$hasObs:$hasOutdoor:$hasRegistration:$hasRecognition"
        if (subscribed == desired) return
        subscribed = desired; generation++; pendingFailed(); obs?.invoke(null, null)
        recognition?.invoke(null, if (socket.negotiatedVersion == 2) "配信者音声認識の操作にはPC版の更新が必要です。登録はそのまま使えます。" else null)
        val request = controlSubscription(requireNotNull(socket.negotiatedVersion), generation, hasObs, hasOutdoor, hasRegistration, hasRecognition)
        socket.send(request)
        sendFeedbackSubscription()
    }
    private fun sendFeedbackSubscription() {
        val value = feedback ?: return
        if (outdoor != null && (socket.negotiatedVersion == 2 || profile?.speechRecognition != null)) socket.send(JSONObject().put("type", "outdoor.feedbackSubscribe").put("generation", generation)
            .put("payload", JSONObject().put("sessionId", value.session).put("generation", value.generation)))
    }
    private fun event(value: JSONObject) {
        if (value.optLong("generation") != generation) return
        val payload = value.optJSONObject("payload") ?: return
        when (value.optString("type")) {
            "registration.state" -> {
                val app = context ?: return; val expected = bundle ?: return
                val currentEpoch = epoch; val currentGeneration = generation; val connection = socket.connectionId
                val incoming = CasMateRegistration.parse(payload.toString()).getOrNull() ?: return
                val saved = expected.profiles[incoming.network]?.update ?: return
                if (incoming.pcId != expected.pcId || incoming.deviceId != expected.deviceId || incoming.network != expected.activeNetwork ||
                    incoming.update?.sameCredential(saved) != true || incoming.direct?.fingerprint != expected.profiles[incoming.network]?.direct?.fingerprint) return
                if (incoming.update.revision < saved.revision || RegistrationUpdateGate.isRevoked(saved)) return
                val current = { currentEpoch == epoch && currentGeneration == generation && connection == socket.connectionId }
                RegistrationUpdateGate.observe(incoming.update)
                registrationSave?.cancel()
                registrationSave = scope.launch {
                    retryRegistrationSave(current, { saveRegistrationUpdate(app, expected, incoming, current) },
                        { registrationState("saveFailed") })
                    if (current()) registrationState("confirmed")
                }
            }
            "obs.state" -> obs?.invoke(payload, null)
            "obs.captureFailed" -> imageRequest?.takeIf { it.id == payload.optString("requestId") }?.complete?.completeExceptionally(
                ObsControlHttpException(503, "OBS_CAPTURE_INTERRUPTED", "OBS映像の取得が中断されました。更新してください。"))
            "speechRecognition.state" -> recognition?.invoke(payload, null)
            "outdoor.feedback" -> feedback?.listener?.invoke(payload)
            "control.result" -> {
                val image = imageRequest?.takeIf { it.id == payload.optString("id") }
                if (image != null) {
                    runCatching {
                        if (payload.optInt("status", 500) !in 200..299) throw ObsControlHttpException(payload.optInt("status", 500), payload.optString("code"),
                            payload.optString("message", "OBS映像を取得できません。更新してください。"))
                        image.receiver.begin(requireNotNull(payload.optJSONObject("payload")))
                    }.onFailure { image.complete.completeExceptionally(it) }
                    return
                }
                val result = pending.remove(payload.optString("id")) ?: return
                if (payload.optInt("status", 500) in 200..299) result.complete(payload.optJSONObject("payload") ?: JSONObject())
                else result.completeExceptionally(ObsControlHttpException(payload.optInt("status", 500), payload.optString("code"),
                    payload.optString("message", "操作を実行できません。PCの状態を確認してください。")))
            }
        }
    }
    private fun state(value: String) {
        if (value != "connected") supportedCapture.value = null
        if (value != "connected") { epoch++; registrationSave?.cancel(); registrationSave = null }
        registrationState(if (value == "connected") "checking" else value)
        if (value == "auth" && profile?.update != null) {
            val app = context; val expected = bundle
            val issued = profile?.update
            if (app != null && expected != null && issued != null) {
                RegistrationUpdateGate.observe(issued.revoked())
                jp.casmate.app.obs.ObsControlRuntime.reload()
                revocationSave?.cancel()
                revocationSave = scope.launch {
                    retryRegistrationSave({ true }, { revokeRegistrationUpdate(app, expected) }, {
                        if (profile?.update?.sameCredential(issued) == true) registrationState("revocationSaveFailed")
                    })
                    if (profile?.update?.sameCredential(issued) == true) registrationState("auth")
                }
            }
        }
        if (value != "connected") {
            pendingFailed(); subscribed = ""; feedback?.listener?.invoke(null)
            obs?.invoke(null, when (value) {
                "auth" -> "登録が無効です。共通QRを読み直してください。"
                "pcKey" -> "PC確認鍵または証明書を確認できません。共通QRと日時を確認してください。"
                "version", "androidVersion" -> "PCとAndroidを更新して共通QRを読み直してください。"
                else -> "PCへ接続しています。"
            })
            recognition?.invoke(null, when (value) {
                "auth" -> "登録が無効です。共通QRを読み直してください。"
                "pcKey" -> "PC確認鍵または証明書を確認できません。共通QRと日時を確認してください。"
                "version", "androidVersion" -> "PCとAndroidを対応する版へ更新してください。"
                else -> "PCへ接続しています。接続後に状態を確認してから操作できます。"
            })
        }
        outdoor?.invoke(value == "connected" && (socket.negotiatedVersion == 2 || profile?.speechRecognition != null))
    }
    private fun registrationState(value: String) {
        val network = bundle?.activeNetwork ?: return
        mutableRegistrationStatus.value = mutableRegistrationStatus.value + (network to value)
    }
    private fun pendingFailed() {
        val exception = ObsControlHttpException(503, "CONNECTION_CHANGED", "操作の結果を確認できません。再接続後に現在の状態を確認してください。")
        pending.values.toList().forEach { it.completeExceptionally(exception) }; pending.clear()
        imageRequest?.complete?.completeExceptionally(exception)
    }
}

internal fun controlSubscription(version: Int, generation: Long, obs: Boolean, outdoor: Boolean, registration: Boolean, recognition: Boolean): JSONObject =
    JSONObject().put("type", "control.subscribe").put("protocolVersion", version).put("generation", generation)
        .put("obs", obs).put("outdoor", outdoor).put("registration", registration).apply {
            if (version == 3) put("speechRecognition", recognition)
        }

/** Retries the same snapshot without another socket or HTTP polling; callers fence every save. */
internal suspend fun retryRegistrationSave(current: () -> Boolean, save: suspend () -> Any?, failed: () -> Unit) {
    var attempt = 0
    while (current()) {
        try { save(); return }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) {
            if (!current()) return
            failed()
            delay(listOf(1000L, 2000L, 4000L, 10000L, 30000L)[attempt++.coerceAtMost(4)])
        }
    }
}

internal suspend fun awaitControlResponse(type: String, response: CompletableDeferred<JSONObject>): JSONObject = try {
    withTimeout(5000) { response.await() }
} catch (_: TimeoutCancellationException) {
    if (type == "obs.confirm") throw ObsControlHttpException(504, "RESULT_UNKNOWN", "OBS操作の結果が不明です。現在の配信状態を確認してください。")
    throw ObsControlHttpException(504, "RESPONSE_TIMEOUT", "PCからの応答がありません。接続状態を確認してください。")
}
