package jp.casmate.app.obs

import jp.casmate.app.connection.LocalNetworkAccess
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SmartphoneInvitationTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()
    private fun qr() = JSONObject(fixture("common-registration-invitation.json")).put("version", 11)
    private fun registration() = JSONObject(fixture("smartphone-registration-v12.json"))
    @Test fun commonQrAndResponseUseOneValidatedPcNetworkAndFixedEnrollmentPath() {
        val value = SmartphoneInvitation.parse(qr().toString()).getOrThrow()
        assertEquals("http://192.168.1.2:3001/smartphone/enroll", value.enrollmentUrl)
        val response = JSONObject().put("registration", JSONObject(fixture("smartphone-registration-v12.json")))
        assertEquals(value.pcId, value.response(response.toString()).pcId)
        assertFalse(value.toString().contains(value.token))
        response.getJSONObject("registration").put("pcId", "11111111-1111-4111-8111-111111111111")
        assertTrue(runCatching { value.response(response.toString()) }.isFailure)
    }
    @Test fun rejectsUnknownKeysPublicTargetsWrongRoutesInvalidTokensAndOversizedQr() {
        for (bad in listOf(qr().put("url", "http://example.com/"), qr().put("network", "tailscale"),
            qr().put("registrationPort", 1.5), qr().put("token", "invalid"), qr().put("version", "6"))) {
            assertTrue(SmartphoneInvitation.parse(bad.toString()).isFailure)
        }
        val public = qr(); public.getJSONObject("comments").put("url", "http://8.8.8.8:3000/comments")
        assertTrue(SmartphoneInvitation.parse(public.toString()).isFailure)
        val lowPort = qr(); lowPort.getJSONObject("comments").put("url", "http://192.168.1.2:80/comments")
        assertTrue(SmartphoneInvitation.parse(lowPort.toString()).isFailure)
        assertTrue(SmartphoneInvitation.parse(" ".repeat(4097) + qr()).isFailure)
    }
    @Test fun sendsExistingCredentialsAsProofAndRejectsAnotherPcBeforeNetworkAccess() {
        val invite = SmartphoneInvitation.parse(qr().toString()).getOrThrow()
        val incoming = CasMateRegistration.parse(registration().toString()).getOrThrow()
        val previous = RegistrationBundle(emptyMap(), null).merge(incoming)
        val identity = EnrollmentIdentity("11111111-1111-4111-8111-111111111111", "a".repeat(64))
        val request = invite.request(identity, "Pixel", previous)
        assertEquals(identity.id, request.getString("clientId"))
        assertEquals(2, request.getJSONObject("previous").getJSONArray("proofs").length())
        val another = RegistrationBundle(previous.profiles, previous.activeNetwork, "11111111-1111-4111-8111-111111111111", previous.deviceId)
        assertTrue(runCatching { invite.request(identity, "Pixel", another) }.exceptionOrNull() is RegistrationMismatch)
    }

    @Test fun localNetworkPermissionAppliesToAndroid17LanAndNotToOlderDevicesOrTailscale() {
        assertTrue(LocalNetworkAccess.needsPermission("192.168.1.2", 37))
        assertTrue(LocalNetworkAccess.needsPermission("10.0.0.2", 37))
        assertFalse(LocalNetworkAccess.needsPermission("192.168.1.2", 36))
        assertFalse(LocalNetworkAccess.needsPermission("100.64.0.1", 37))
    }
}
