package jp.casmate.app.connection

import android.webkit.WebResourceResponse
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

/** A virtual-origin renderer can obtain bytes only through this pinned, authenticated native loader. */
internal class DirectAssets(registration: DirectRegistration, client: okhttp3.OkHttpClient? = null) : AutoCloseable {
    @Volatile private var registration = registration
    private val client = client ?: PinnedPcClient.create(registration.fingerprint) { this.registration.endpoints }
    private val closed = AtomicBoolean(false)
    @Volatile private var candidate = 0
    fun update(next: DirectRegistration) {
        require(next.identity == registration.identity)
        if ((next.update?.revision ?: 0) >= (registration.update?.revision ?: 0)) registration = next
    }
    fun load(url: String, method: String): WebResourceResponse {
        val uri = runCatching { URI(url) }.getOrNull()
        val path = uri?.rawPath ?: ""
        val allowed = method == "GET" && uri?.scheme == "https" && uri.host == "comments.casmate.invalid" && uri.port == -1 && uri.rawUserInfo == null && uri.rawFragment == null &&
            ((path == "/comments" && uri.rawQuery in listOf(null, "embedded=android")) || (uri.rawQuery == null && (path == "/mobile/bootstrap" ||
                path.matches(Regex("/assets/[a-zA-Z0-9_.-]+\\.(?:js|css|png|jpg|jpeg|webp|gif|svg|woff2?|ttf)")) || path.matches(Regex("/mobile/assets/[a-f0-9]{64}")))))
        if (!allowed || closed.get()) return error(403, "表示できない接続先です。")
        val suffix = path + (uri!!.rawQuery?.let { "?$it" } ?: "")
        val registration = this.registration
        for (offset in registration.endpoints.indices) {
            if (closed.get()) return error(503, "表示が変更されました。")
            val index = (candidate + offset) % registration.endpoints.size
            val target = registration.endpoints[index]
            try {
                client.newCall(Request.Builder().url("https://${target.authority}$suffix").header("X-CasMate-Read", "Bearer ${registration.comments.token}").get().build()).execute().use { response ->
                    if (closed.get()) return error(503, "表示が変更されました。")
                    if (response.code != 200) return error(if (response.code == 403) 403 else 503, "PCのコメント表示を取得できません。接続状態と登録を確認してください。")
                    val source = response.body?.source() ?: return error(503, "表示を取得できません。")
                    source.request(4 * 1024 * 1024L + 1); if (source.buffer.size > 4 * 1024 * 1024L) return error(503, "表示のサイズを確認できません。")
                    val bytes = source.readByteArray(); if (closed.get()) return error(503, "表示が変更されました。")
                    candidate = index
                    val type = response.body?.contentType(); return WebResourceResponse(type?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream", "UTF-8", 200, "OK",
                        mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(bytes))
                }
            } catch (error: java.io.IOException) {
                if (error is javax.net.ssl.SSLException) return error(403, "PC確認鍵または証明書を確認できません。共通QRと日時を確認してください。")
            }
        }
        return error(503, "直接接続先を利用できません。全接続先が変わった場合は共通QRを読み直してください。")
    }
    override fun close() { if (closed.compareAndSet(false, true)) PinnedPcClient.release(client) }
    private fun error(status: Int, message: String) = WebResourceResponse("text/plain", "UTF-8", status, "Unavailable", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(message.toByteArray()))
}
