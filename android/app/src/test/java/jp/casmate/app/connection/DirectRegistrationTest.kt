package jp.casmate.app.connection

import jp.casmate.app.obs.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat

class DirectRegistrationTest {
    private fun fixture(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())
    @Test fun pinnedNativeProfileKeepsIndependentChannelsAndOldRoutesWithoutLeakingDirectProofs() {
        val invitation = SmartphoneInvitation.parse(fixture("direct-invitation-v13.json").toString()).getOrThrow()
        val wire = fixture("direct-registration-v14.json")
        val registration = invitation.response(JSONObject().put("registration", wire).toString())
        val legacy = CasMateRegistration.parse(fixture("smartphone-registration-v12.json").toString()).getOrThrow()
        val before = RegistrationBundle(emptyMap(), null).merge(legacy)
        val after = before.mergeEnrolled(registration)
        assertEquals(ConnectionNetwork.LAN, after.activeNetwork)
        assertEquals(legacy.outdoor!!.json, after.outdoor!!.json)
        val selected = after.select(ConnectionNetwork.DIRECT)
        assertEquals("https://comments.casmate.invalid/comments", selected.connection!!.commentsUrl)
        assertEquals(2, selected.connection!!.direct!!.endpoints.size)
        assertEquals("2001:4860:4860::8888", selected.outdoor!!.address)
        assertEquals(jp.casmate.app.compatibility.CompatibilityPolicy.ANDROID_REGISTRATION_STORE, selected.json().getInt("version"))
        assertTrue(RegistrationBundle.parse(selected.json()).sameActive(selected))
        assertFalse(selected.toString().contains(registration.direct!!.comments.token))
        val oldQr = SmartphoneInvitation.parse(fixture("common-registration-invitation.json").put("version", 11).toString()).getOrThrow()
        val identity = EnrollmentIdentity("11111111-1111-4111-8111-111111111111", "a".repeat(64))
        val oldRequest = oldQr.request(identity, "phone", selected).toString()
        assertFalse(oldRequest.contains(registration.direct!!.comments.token)); assertFalse(oldRequest.contains(registration.direct!!.outdoor!!.token)); assertFalse(oldRequest.contains(registration.direct!!.obs!!.token))
        assertTrue(invitation.request(identity, "phone", selected).toString().contains(registration.direct!!.comments.token))
        assertTrue(ConnectionUrl.parse(selected.connection!!.commentsUrl).isFailure)
    }
    @Test fun rejectsUntrustedKeysEndpointSubstitutionMalformedQualificationsAndPrivateAddresses() {
        val invitation = SmartphoneInvitation.parse(fixture("direct-invitation-v13.json").toString()).getOrThrow()
        val changed = fixture("direct-registration-v14.json"); changed.getJSONObject("pcKey").put("fingerprint", "0".repeat(64))
        assertTrue(runCatching { invitation.response(JSONObject().put("registration", changed).toString()) }.isFailure)
        for (field in listOf("revision", "protocolVersion")) {
            val bad = fixture("direct-registration-v14.json"); bad.getJSONObject("comments").put(field, 1.5)
            assertTrue(CasMateRegistration.parse(bad.toString()).isFailure)
        }
        for ((family, address) in listOf("ipv4" to "192.168.1.2", "ipv4" to "100.64.0.1", "ipv6" to "2001::1", "ipv6" to "2001:db8::1", "ipv6" to "2606:4700:4700:0:0:0:0:1111")) assertFalse(isDirectPublicAddress(family, address))
        assertTrue(isDirectPublicAddress("ipv6", "2606:4700:4700::1111"))
        val swap = fixture("direct-registration-v14.json"); swap.getJSONArray("endpoints").getJSONObject(0).put("tcpPort", 3999)
        assertTrue(runCatching { invitation.response(JSONObject().put("registration", swap).toString()) }.isFailure)
        val before = RegistrationBundle(emptyMap(), null).merge(invitation.response(JSONObject().put("registration", fixture("direct-registration-v14.json")).toString()))
        val newer = fixture("direct-registration-v14.json").apply { getJSONObject("comments").put("revision", 2) }
        assertFalse(before.sameActive(before.merge(CasMateRegistration.parse(newer.toString()).getOrThrow())))
        val wrongDevice = fixture("direct-registration-v14.json").put("deviceId", "33333333-3333-4333-8333-333333333333")
        assertTrue(runCatching { before.mergeEnrolled(CasMateRegistration.parse(wrongDevice.toString()).getOrThrow()) }.exceptionOrNull() is RegistrationMismatch)
    }
    @Test fun trustRequiresMatchingSpkiSelfSignatureAndCurrentValidityBeforeAcceptingThePc() {
        val data = fixture("direct-test-certificates.json")
        fun cert(key: String) = CertificateFactory.getInstance("X.509").generateCertificate(data.getString(key).byteInputStream()) as X509Certificate
        val current = SimpleDateFormat("yyyy-MM-dd").parse("2026-03-01")!!
        val manager = PinnedPcTrustManager(data.getString("fingerprint")) { current }
        manager.checkServerTrusted(arrayOf(cert("certificate")), "ECDSA")
        assertTrue(runCatching { manager.checkServerTrusted(arrayOf(cert("otherCertificate")), "ECDSA") }.isFailure)
        assertTrue(runCatching { PinnedPcTrustManager(data.getString("fingerprint")) { SimpleDateFormat("yyyy-MM-dd").parse("2030-01-01")!! }.checkServerTrusted(arrayOf(cert("certificate")), "ECDSA") }.isFailure)
        assertTrue(runCatching { manager.checkServerTrusted(arrayOf(cert("certificate"), cert("otherCertificate")), "ECDSA") }.isFailure)
    }
}
