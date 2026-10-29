package jp.casmate.app.obs

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import jp.casmate.app.connection.PinnedPcClient
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resumeWithException

internal class EnrollmentFailure(val userMessage: String) : Exception(userMessage)

/** The installation identity is durably saved before a request can allocate a PC device. */
suspend fun enrollSmartphone(context: Context, invitation: SmartphoneInvitation, progress: (String) -> Unit = {}): String? {
    progress(if (invitation.direct != null) "QRは読み取れました。PCの本人確認を行っています…" else "QRは読み取れました。PCへ接続しています…")
    val (before, incoming) = withContext(Dispatchers.IO) {
        val before = RegistrationBundleStore.loadCurrent(context)
        if (before.pcId != null && before.pcId != invitation.pcId) throw RegistrationMismatch()
        val identity = EnrollmentIdentityStore(context).loadOrCreate()
        val client = invitation.direct?.let { PinnedPcClient.create(it.fingerprint, it.endpoints).newBuilder().eventListener(object : okhttp3.EventListener() {
            override fun secureConnectEnd(call: okhttp3.Call, handshake: okhttp3.Handshake?) { progress("PC確認済み。PCの受信・公開の準備と登録応答を待っています…") }
        }).build() } ?: OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(5, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS).build()
        try {
            val payload = invitation.request(identity, Build.MODEL, before).toString(); require(payload.toByteArray().size <= 8192)
            val urls = invitation.direct?.endpoints?.map { "https://${it.authority}/smartphone/enroll" } ?: listOf(invitation.enrollmentUrl)
            var response: okhttp3.Response? = null
            for (url in urls) { try { val request = Request.Builder().url(url).header("Authorization", "Bearer ${invitation.token}")
                    .header("X-CasMate-Control-Version", jp.casmate.app.compatibility.CompatibilityPolicy.CONTROL_PROTOCOL.toString())
                    .post(payload.toRequestBody("application/json".toMediaType())).build(); response = awaitEnrollmentResponse(client, request); break
                } catch (error: java.io.IOException) { if (error is javax.net.ssl.SSLException || url == urls.last()) throw error; coroutineContext.ensureActive() } }
            requireNotNull(response).use { result ->
                val body = result.body ?: throw EnrollmentFailure("PCから登録情報を受け取れません。共通QRを読み直してください。")
                val maximum = 16384L
                val source = body.source(); source.request(maximum + 1)
                require(source.buffer.size <= maximum)
                val text = source.readUtf8()
                if (!result.isSuccessful) {
                    val code = runCatching { JSONObject(text).optString("code") }.getOrNull()
                    throw EnrollmentFailure(when (code) {
                        "INVITATION_EXPIRED" -> "このQRは無効です。PCで共通QRを開き直して読み取ってください。"
                        "REGISTRATION_MISMATCH" -> "保存済みの登録と一致しません。PCの登録を確認し、必要ならAndroidの登録を解除して読み直してください。"
                        "UNSUPPORTED_VERSION" -> "PCとAndroidを更新して最新の共通QRを読み取ってください。"
                        "PREPARATION_FAILED" -> "PCの受信・公開の準備が未完了です。PCで権限要求とTCP・UDPの状態を確認し、同じQRで再試行してください。"
                        else -> "PCの登録待受を利用できません。スマホ連携の接続状態を確認してください。"
                    })
                }
                coroutineContext.ensureActive()
                before to invitation.response(text)
            }
        } catch (error: java.io.IOException) {
            if (invitation.direct != null) throw directEnrollmentConnectionFailure(error, usingWifi(context))
            throw EnrollmentFailure("PCに接続できません。LANのアクセス許可、選択したネットワーク、PCの起動とファイアウォールを確認して読み直してください。")
        } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
    }
    progress("登録情報を確認済み。端末内へ保護保存しています…")
    return saveEnrolledRegistration(context, before, incoming)
}

private fun usingWifi(context: Context): Boolean = runCatching {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    connectivity?.getNetworkCapabilities(connectivity.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
}.getOrDefault(false)

private suspend fun awaitEnrollmentResponse(client: OkHttpClient, request: Request): okhttp3.Response = suspendCancellableCoroutine { continuation ->
    val call = client.newCall(request)
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : okhttp3.Callback {
        override fun onFailure(call: okhttp3.Call, error: java.io.IOException) { continuation.resumeWithException(error) }
        override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
            continuation.resume(response) { _, abandoned, _ -> abandoned.close() }
        }
    })
}
