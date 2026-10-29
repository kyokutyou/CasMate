package jp.casmate.app.connection

import okhttp3.OkHttpClient
import java.net.Proxy
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Date
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

internal class PinnedPcTrustManager(private val fingerprint: String, private val now: () -> Date = { Date() }) : X509TrustManager {
    fun verify(cert: X509Certificate) {
        cert.checkValidity(now())
        val actual = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
        val expected = fingerprint.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        if (!MessageDigest.isEqual(actual, expected) || cert.subjectX500Principal != cert.issuerX500Principal) throw CertificateException("PC_KEY_MISMATCH")
        cert.verify(cert.publicKey)
    }
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) { if (chain == null || chain.size != 1 || authType.isNullOrBlank()) throw CertificateException("PC_CERTIFICATE"); verify(chain[0]) }
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) { throw CertificateException("NO_CLIENT_CERTIFICATE") }
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
internal object PinnedPcClient {
    /** TLS close can write close_notify; never drain a private client on the UI thread. */
    fun release(client: OkHttpClient) {
        val executor = client.dispatcher.executorService
        executor.execute {
            try {
                client.dispatcher.cancelAll()
                client.connectionPool.evictAll()
            } finally { executor.shutdown() }
        }
    }

    fun create(fingerprint: String, endpoints: List<DirectEndpoint>): OkHttpClient = create(fingerprint) { endpoints }

    fun create(fingerprint: String, endpoints: () -> List<DirectEndpoint>): OkHttpClient {
        val manager = PinnedPcTrustManager(fingerprint)
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }
        return OkHttpClient.Builder().sslSocketFactory(ssl.socketFactory, manager)
            .hostnameVerifier { host, session -> host.removePrefix("[").removeSuffix("]") in endpoints().map { it.address } && runCatching { manager.verify(session.peerCertificates.single() as X509Certificate); true }.getOrDefault(false) }
            .proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false).cache(null)
            .cookieJar(okhttp3.CookieJar.NO_COOKIES).connectTimeout(3, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS).build()
    }
}
