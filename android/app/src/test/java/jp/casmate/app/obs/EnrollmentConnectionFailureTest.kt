package jp.casmate.app.obs

import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.*
import org.junit.Test

class EnrollmentConnectionFailureTest {
    @Test fun wifiTimeoutExplainsTheAcceptedQrAndAConditionalNetworkWorkaround() {
        val message = registrationFailureMessage(directEnrollmentConnectionFailure(SocketTimeoutException(), true))
        assertEquals("QRは読み取れましたが、PCに接続できませんでした。\n自宅のWi-Fiでは、直接接続できない場合があります。携帯回線か、携帯回線を使ったテザリングで試してください。\nPC版の起動・「直接接続」ONも確認してください。", message)
    }

    @Test fun cellularFailureKeepsThePcChecksWithoutWifiSpecificAdviceOrSecrets() {
        val message = registrationFailureMessage(directEnrollmentConnectionFailure(IOException("secret-token https://private.example"), false))
        assertTrue(message.contains("PCに接続できませんでした"))
        assertTrue(message.contains("起動") && message.contains("直接接続"))
        assertFalse(message.contains("公開IP") || message.contains("TCPポート"))
        assertFalse(message.contains("自宅のWi-Fi"))
        assertFalse(message.contains("secret-token") || message.contains("private.example"))
    }

    @Test fun identityFailureNeverSuggestsBypassingPcVerificationWithAnotherNetwork() {
        val message = registrationFailureMessage(directEnrollmentConnectionFailure(SSLHandshakeException("secret"), true))
        assertTrue(message.contains("PCの本人確認"))
        assertTrue(message.contains("日時") && message.contains("共通QR"))
        assertFalse(message.contains("テザリング") || message.contains("携帯回線") || message.contains("secret"))
    }

    @Test fun nonTimeoutWifiFailureDoesNotClaimATimeoutOrAProvenRouterFault() {
        val message = registrationFailureMessage(directEnrollmentConnectionFailure(IOException(), true))
        assertTrue(message.contains("PCに接続できませんでした"))
        assertFalse(message.contains("時間切れ"))
        assertTrue(message.contains("場合があります"))
    }

    @Test fun overallCallTimeoutUsesTheSameSimpleConnectionGuidance() {
        val timeout = registrationFailureMessage(directEnrollmentConnectionFailure(InterruptedIOException("timeout"), false))
        assertTrue(timeout.contains("PCに接続できませんでした"))
        val interrupted = registrationFailureMessage(directEnrollmentConnectionFailure(InterruptedIOException("interrupted"), false))
        assertFalse(interrupted.contains("時間切れ"))
        assertEquals(timeout, interrupted)
    }
}
