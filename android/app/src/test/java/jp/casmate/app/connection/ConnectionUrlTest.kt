package jp.casmate.app.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionUrlTest {
    @Test
    fun acceptsAndNormalizesPrivateAndTailscaleAddresses() {
        val cases = listOf(
            "http://10.0.0.2:3000/comments" to "http://10.0.0.2:3000/comments",
            " HTTP://172.16.1.9:8080/comments " to "http://172.16.1.9:8080/comments",
            "http://192.168.10.20:65535/comments" to "http://192.168.10.20:65535/comments",
            "http://100.127.255.254:3000/comments" to "http://100.127.255.254:3000/comments",
        )

        cases.forEach { (input, expected) ->
            assertEquals(expected, ConnectionUrl.parse(input).getOrThrow().commentsUrl)
        }
    }

    @Test
    fun derivesOnlyProtocolEndpointsFromTheValidatedOrigin() {
        val url = ConnectionUrl.parse("http://100.100.20.30:3000/comments").getOrThrow()
        assertEquals("http://100.100.20.30:3000/comments?embedded=android", url.embeddedCommentsUrl)
        assertEquals("ws://100.100.20.30:3000/mobile/ws", url.websocketUrl)
    }

    @Test
    fun rejectsAddressesAndUrlFeaturesOutsideTheContract() {
        val rejected = listOf(
            "https://192.168.1.2:3000/comments",
            "http://8.8.8.8:3000/comments",
            "http://100.128.0.1:3000/comments",
            "http://example.com:3000/comments",
            "http://[fd00::1]:3000/comments",
            "http://user:pass@192.168.1.2:3000/comments",
            "http://192.168.1.2/comments",
            "http://192.168.1.2:0/comments",
            "http://192.168.1.2:3000/other",
            "http://192.168.1.2:3000/comments?q=1",
            "http://192.168.1.2:3000/comments#fragment",
        )

        rejected.forEach { assertTrue("should reject $it", ConnectionUrl.parse(it).isFailure) }
    }
}
