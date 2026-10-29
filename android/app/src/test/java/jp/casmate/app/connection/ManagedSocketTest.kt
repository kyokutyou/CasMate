package jp.casmate.app.connection

import android.os.Looper
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class ManagedSocketTest {
    @Test fun candidateOnlyUpdateKeepsHealthyIpv4AndUsesNewCandidatesAfterLoss() {
        val full = org.json.JSONObject(javaClass.getResource("/direct-registration-v14.json")!!.readText())
        val ipv4 = (0 until full.getJSONArray("endpoints").length()).map { full.getJSONArray("endpoints").getJSONObject(it) }.first { it.getString("family") == "ipv4" }
        val previous = DirectRegistration.parse(org.json.JSONObject(full.toString()).put("endpoints", org.json.JSONArray().put(ipv4)))
        full.put("updateRevision", full.getLong("updateRevision") + 1)
        val updated = DirectRegistration.parse(full)
        val peers = mutableListOf<Fake>(); var clients = 0
        val socket = ManagedSocket("mobile.hello", 2, {}, {}, onState = {}, directFactory = {
            clients++; WebSocket.Factory { request, listener -> Fake(request, listener).also(peers::add) }
        })
        val headers = mapOf("X-CasMate-Read" to "Bearer ${previous.comments.token}")
        try {
            socket.openDirect(RuntimeEnvironment.getApplication(), previous, "/mobile/ws", headers)
            peers.first().text("""{"type":"mobile.hello","connectionId":"healthy","payload":{"protocolVersion":2}}""")
            advance(0); assertEquals("healthy", socket.connectionId)
            socket.openDirect(RuntimeEnvironment.getApplication(), updated, "/mobile/ws", headers)
            assertFalse(peers.first().cancelled); assertEquals("healthy", socket.connectionId); assertEquals(1, clients)
            socket.openDirect(RuntimeEnvironment.getApplication(), previous, "/mobile/ws", headers)
            peers.first().listener.onFailure(peers.first(), java.io.IOException("lost"), null)
            advance(500); assertEquals(2, clients); assertEquals(2, peers.size)
            assertTrue(peers.last().request().url.host.contains(':'))
        } finally { socket.close() }
    }
    @Test fun removingTheActiveCandidateWaitsForLossAndKeyOrCredentialChangesStillReconnect() {
        val full = org.json.JSONObject(javaClass.getResource("/direct-registration-v14.json")!!.readText())
        val endpoints = full.getJSONArray("endpoints")
        fun only(family: String) = org.json.JSONObject(full.toString()).put("endpoints", org.json.JSONArray().put(
            (0 until endpoints.length()).map { endpoints.getJSONObject(it) }.first { it.getString("family") == family }))
        val previous = DirectRegistration.parse(only("ipv4"))
        val nextWire = only("ipv6").put("updateRevision", full.getLong("updateRevision") + 1)
        val peers = mutableListOf<Fake>()
        val socket = ManagedSocket("mobile.hello", 2, {}, {}, onState = {}, directFactory = {
            WebSocket.Factory { request, listener -> Fake(request, listener).also(peers::add) }
        })
        val headers = mapOf("X-CasMate-Read" to "Bearer ${previous.comments.token}")
        try {
            socket.openDirect(RuntimeEnvironment.getApplication(), previous, "/mobile/ws", headers)
            peers.first().text("""{"type":"mobile.hello","connectionId":"healthy","payload":{"protocolVersion":2}}""")
            advance(0)
            socket.openDirect(RuntimeEnvironment.getApplication(), DirectRegistration.parse(nextWire), "/mobile/ws", headers)
            assertFalse(peers.first().cancelled); assertEquals("healthy", socket.connectionId)
            peers.first().listener.onFailure(peers.first(), java.io.IOException("lost"), null); advance(500)
            assertEquals(2, peers.size); assertTrue(peers.last().request().url.host.contains(':'))
            val keyChanged = org.json.JSONObject(nextWire.toString()).apply { getJSONObject("pcKey").put("fingerprint", "0".repeat(64)) }
            socket.openDirect(RuntimeEnvironment.getApplication(), DirectRegistration.parse(keyChanged), "/mobile/ws", headers)
            assertTrue(peers[1].cancelled); assertEquals(3, peers.size)
            val proofChanged = org.json.JSONObject(keyChanged.toString()).apply { getJSONObject("comments").put("revision", 2) }
            socket.openDirect(RuntimeEnvironment.getApplication(), DirectRegistration.parse(proofChanged), "/mobile/ws", headers)
            assertTrue(peers[2].cancelled); assertEquals(4, peers.size)
        } finally { socket.close() }
    }
    @Test fun stalledImageQueueHasItsOwnBudgetAndDoesNotRejectControlText() {
        var failed = 0; var imageFailed = 0; var control = 0
        val inbox = SocketInbox(android.os.Handler(Looper.getMainLooper())) { failed++ }
        repeat(128) { assertTrue(inbox.postImage(16420, {}, { imageFailed++ })) }
        assertTrue(inbox.post(100) { control++ })
        advance(0)
        assertEquals(0, failed); assertEquals(1, imageFailed); assertEquals(1, control)
        inbox.close()
    }
    @Test fun oversizedPreviewFailsOnlyItsImageAndKeepsControlAlive() {
        val peers = mutableListOf<Fake>(); var rejected = 0; var delivered = 0
        val socket = ManagedSocket("control.hello", 3, {}, {}, onBinary = { delivered++ }, onState = {},
            factory = WebSocket.Factory { request, listener -> Fake(request, listener).also(peers::add) }, onBinaryRejected = { rejected++ })
        try {
            socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3001/smartphone/ws")
            val peer = peers.last()
            peer.text("""{"type":"control.hello","connectionId":"current","payload":{"protocolVersion":3}}""")
            advance(0)
            repeat(129) { peer.binary(ByteArray(16421)) }; advance(0)
            assertEquals(1, rejected); assertFalse(peer.cancelled); assertEquals("current", socket.connectionId)
            peer.binary(ByteArray(36)); advance(0); assertEquals(1, delivered)
        } finally { socket.close() }
    }
    @Test fun newControlNegotiatesKnownV2PeerAndReportsTheActualHelloVersion() {
        val sockets = mutableListOf<Fake>(); val helloVersions = mutableListOf<Int>()
        val socket = ManagedSocket("control.hello", 3, { helloVersions.add(it.getInt("protocolVersion")) }, {}, onState = {},
            factory = WebSocket.Factory { request, listener -> Fake(request, listener).also(sockets::add) })
        try {
            socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3001/smartphone/ws", mapOf("X-CasMate-Control-Version" to "3"))
            sockets.last().text("""{"type":"control.hello","connectionId":"old-supported","payload":{"protocolVersion":2}}""")
            advance(0); assertEquals(2, socket.negotiatedVersion); assertEquals(listOf(2), helloVersions)
            socket.close(); assertNull(socket.negotiatedVersion)
            socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3001/smartphone/ws")
            sockets.last().text("""{"type":"control.hello","connectionId":"new","payload":{"protocolVersion":3}}""")
            advance(0); assertEquals(3, socket.negotiatedVersion)
            assertFalse(acceptsSocketVersion("control.hello", 3, 1.0)); assertFalse(acceptsSocketVersion("mobile.hello", 3, 2.0))
            assertFalse(acceptsSocketVersion("control.hello", 3, 2.5))
        } finally { socket.close() }
    }
    @Test fun controlV2RequiresMatchingHelloAndOnlyExplicitRevocationPermanentlyBlocks() {
        val sockets = mutableListOf<Fake>(); val states = mutableListOf<String>()
        val socket = ManagedSocket("control.hello", 2, {}, {}, onState = states::add,
            factory = WebSocket.Factory { request, listener -> Fake(request, listener).also(sockets::add) })
        socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3001/smartphone/ws", mapOf("X-CasMate-Registration" to "Bearer fixture"))
        fun reject(revoked: Boolean) {
            val peer = sockets.last()
            val response = okhttp3.Response.Builder().request(peer.original).protocol(okhttp3.Protocol.HTTP_1_1).code(403).message("Forbidden")
                .apply { if (revoked) header("X-CasMate-Registration-State", "revoked") }.build()
            peer.listener.onFailure(peer, java.io.IOException("upgrade rejected"), response)
        }
        try {
            reject(false); advance(500); assertEquals(2, sockets.size); assertTrue(states.contains("rejected"))
            sockets.last().text("""{"type":"control.hello","connectionId":"wrong","payload":{"protocolVersion":1}}""")
            advance(5000); assertNull(socket.connectionId); assertEquals(2, sockets.size); assertTrue(states.contains("version"))
            socket.retryIfBlocked(); advance(0)
            sockets.last().text("""{"type":"control.hello","connectionId":"correct","payload":{"protocolVersion":2}}""")
            advance(0); assertEquals("correct", socket.connectionId)
            reject(true); advance(5000); assertEquals(3, sockets.size); assertTrue(states.contains("auth"))
        } finally { socket.close() }
    }
    @Test fun pausedMainThreadHasBoundedPendingWorkAndClosingDropsEveryOldMessage() {
        val overflow = mutableListOf<Boolean>(); var executed = 0
        val inbox = SocketInbox(android.os.Handler(Looper.getMainLooper())) { overflow.add(true) }
        repeat(128) { assertTrue(inbox.post(16000) { executed++ }) }
        assertFalse(inbox.post(1) { executed++ })
        advance(0); assertEquals(0, executed); assertEquals(1, overflow.size)
        val replacement = SocketInbox(android.os.Handler(Looper.getMainLooper())) { fail() }
        assertTrue(replacement.post(1) { executed++ }); advance(0); assertEquals(1, executed)
        assertTrue(replacement.post(1) { executed++ }); replacement.close(); advance(0); assertEquals(1, executed)
    }
    private class Fake(val original: Request, val listener: WebSocketListener) : WebSocket {
        var cancelled = false
        val sent = mutableListOf<String>()
        override fun request() = original
        override fun queueSize() = 0L
        override fun send(text: String): Boolean { sent.add(text); return true }
        override fun send(bytes: ByteString) = true
        override fun close(code: Int, reason: String?) = true
        override fun cancel() { cancelled = true }
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, ByteString.of(*value))
    }
    private fun advance(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    @Test fun halfOpenIsLostWithinFourSecondsAndOldCallbacksCannotReplaceTheNewConnection() {
        val sockets = mutableListOf<Fake>(); val events = mutableListOf<String>(); val states = mutableListOf<String>()
        val socket = ManagedSocket("mobile.hello", 2, {}, { events.add(it.getString("type")) }, onState = states::add,
            factory = WebSocket.Factory { request, listener -> Fake(request, listener).also(sockets::add) })
        socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3000/mobile/ws")
        try {
            advance(4000); assertTrue(sockets[0].cancelled); assertEquals(1, sockets.size)
            advance(500); assertEquals(2, sockets.size)
            sockets[0].text("""{"type":"mobile.hello","connectionId":"old","payload":{"protocolVersion":2}}""")
            advance(0); assertNull(socket.connectionId)
            sockets[1].text("""{"type":"mobile.hello","connectionId":"new","payload":{"protocolVersion":2}}""")
            advance(0); assertEquals("new", socket.connectionId)
            sockets[1].text("""{"type":"ping","connectionId":"new","payload":{"nonce":"test"}}""")
            advance(0); assertTrue(sockets[1].sent.last().contains("test"))
            sockets[0].text("""{"type":"comment.received","connectionId":"old"}"""); advance(0)
            assertTrue(events.isEmpty())
        } finally { socket.close() }
    }

    @Test fun incompatibleVersionDoesNotReconnectUntilExplicitRetryAndRedirectsAreDisabled() {
        val sockets = mutableListOf<Fake>(); val states = mutableListOf<String>()
        val socket = ManagedSocket("mobile.hello", 2, {}, {}, onState = states::add,
            factory = WebSocket.Factory { request, listener -> Fake(request, listener).also(sockets::add) })
        socket.open(RuntimeEnvironment.getApplication(), "ws://192.168.1.2:3000/mobile/ws")
        try {
            sockets[0].text("""{"type":"mobile.snapshot","payload":{"protocolVersion":1}}""")
            advance(10000); assertEquals(1, sockets.size); assertTrue(states.contains("version"))
            socket.retryIfBlocked(); advance(0); assertEquals(2, sockets.size)
            sockets[1].listener.onClosing(sockets[1], 4403, "ignored")
            advance(10000); assertEquals(2, sockets.size); assertTrue(states.contains("auth"))
        } finally { socket.close() }
    }

    @Test fun directCandidatesAreIndependentOfSrtAndPinnedFailureBlocksRetryUntilRegistrationIsChanged() {
        val registration = DirectRegistration.parse(org.json.JSONObject(javaClass.getResource("/direct-registration-v14.json")!!.readText()))!!
        val sockets = mutableListOf<Fake>(); val states = mutableListOf<String>()
        val socket = ManagedSocket("mobile.hello", 2, {}, {}, onState = states::add,
            directFactory = { client ->
                assertFalse(client.followRedirects); assertFalse(client.followSslRedirects)
                WebSocket.Factory { request, listener -> Fake(request, listener).also(sockets::add) }
            })
        socket.openDirect(RuntimeEnvironment.getApplication(), registration, "/mobile/ws", mapOf("X-CasMate-Read" to "Bearer ${registration.comments.token}"))
        try {
            assertTrue(sockets[0].request().url.host.contains(':'))
            sockets[0].listener.onFailure(sockets[0], java.io.IOException("unreachable"), null)
            advance(500); assertEquals(2, sockets.size); assertEquals("8.8.8.8", sockets[1].request().url.host)
            sockets[1].text("""{"type":"mobile.hello","connectionId":"healthy","payload":{"protocolVersion":2}}""")
            advance(0); assertEquals("healthy", socket.connectionId)
            sockets[0].listener.onFailure(sockets[0], javax.net.ssl.SSLHandshakeException("old"), null)
            advance(0); assertEquals("healthy", socket.connectionId)
            sockets[1].listener.onFailure(sockets[1], javax.net.ssl.SSLHandshakeException("wrong key"), null)
            advance(10000); assertEquals(2, sockets.size); assertTrue(states.contains("pcKey"))
            assertFalse(sockets[1].request().url.toString().contains(registration.comments.token))
        } finally { socket.close() }
    }
}
