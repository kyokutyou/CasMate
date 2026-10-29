package jp.casmate.app.obs

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RegistrationUpdateTest {
    private fun wire(direct: Boolean = false) = JSONObject(javaClass.classLoader!!.getResource(
        if (direct) "direct-registration-v14.json" else "smartphone-registration-v12.json")!!.readText())
    private fun parse(root: JSONObject) = CasMateRegistration.parse(root.toString()).getOrThrow()
    private fun empty() = RegistrationBundle(emptyMap(), null)
    private fun pending(root: JSONObject, revision: Long = 1) = root.apply {
        put("updateRevision", revision); remove("outdoor"); remove("obsControl")
        getJSONObject("preparation").put("video", "preparing").put("obsControl", "disabled")
    }

    @Test fun partialRegistrationIsDurableAndOnlyReadyInformationEnablesStart() {
        for (direct in listOf(false, true)) {
            val initial = empty().mergeEnrolled(parse(pending(wire(direct))))
            val profile = initial.profiles[initial.activeNetwork]!!
            assertEquals(2, profile.protocolVersion); assertFalse(profile.canStartVideo)
            assertTrue(profile.videoPreparationLabel().contains("QRの読み直しは不要"))
            val restored = RegistrationBundle.parse(initial.json())
            assertEquals(2, restored.profiles[restored.activeNetwork]!!.protocolVersion)
            val ready = restored.mergeUpdate(parse(wire(direct).put("updateRevision", 2)))
            assertTrue(ready.profiles[ready.activeNetwork]!!.canStartVideo)
            assertTrue(ready.profiles[ready.activeNetwork]!!.videoPreparationLabel("disconnected").contains("接続状態未確認"))
            assertEquals(initial.activeNetwork, ready.activeNetwork)
        }
    }

    @Test fun unavailableAndRevokedStatesRemainBlockedAfterRestart() {
        val initial = empty().merge(parse(wire()))
        val failed = pending(wire(), 2).apply { getJSONObject("preparation").put("video", "error") }
        val unavailable = RegistrationBundle.parse(initial.mergeUpdate(parse(failed)).json())
        val p = unavailable.profiles[ConnectionNetwork.LAN]!!
        assertFalse(p.canStartVideo); assertNull(p.outdoor)
        assertTrue(p.videoPreparationLabel("disconnected").contains("要確認"))
        val revoked = RegistrationBundle(initial.profiles.mapValues { it.value.revoked() }, initial.activeNetwork, initial.pcId, initial.deviceId)
        val restored = RegistrationBundle.parse(revoked.json())
        assertFalse(restored.profiles[ConnectionNetwork.LAN]!!.canStartVideo)
        assertTrue(runCatching { restored.mergeUpdate(parse(wire().put("updateRevision", 99))) }.isFailure)
    }

    @Test fun staleWrongDeviceWrongCredentialAndChangedPcKeyCannotReplaceSavedInformation() {
        val initial = empty().merge(parse(wire()))
        val variants = listOf(wire(), wire().put("updateRevision", 0), wire().put("updateRevision", 2).put("deviceId", "33333333-3333-4333-8333-333333333333"),
            wire().put("updateRevision", 2).apply { getJSONObject("registrationUpdate").put("token", "a".repeat(64)) })
        for (value in variants) assertTrue(runCatching { initial.mergeUpdate(parse(value)) }.isFailure)
        val direct = empty().merge(parse(wire(true)))
        val changed = wire(true).put("updateRevision", 2).apply { getJSONObject("pcKey").put("fingerprint", "a".repeat(64)) }
        assertTrue(runCatching { direct.mergeUpdate(parse(changed)) }.isFailure)
    }



    @Test fun invitationVersionNegotiatesExactlyAndOldResponseCannotClaimMigration() {
        val old = JSONObject(javaClass.classLoader!!.getResource("common-registration-invitation.json")!!.readText())
        val identity = EnrollmentIdentity("33333333-3333-4333-8333-333333333333", "a".repeat(64))
        assertTrue(SmartphoneInvitation.parse(old.toString()).isFailure)
        val modern = SmartphoneInvitation.parse(old.put("version", 11).toString()).getOrThrow()
        assertEquals(11, modern.request(identity, "phone", empty()).getInt("invitationVersion"))
        val response = JSONObject().put("registration", wire())
        assertNotNull(modern.response(response.toString()).update)
        response.getJSONObject("registration").put("version", 8)
        assertTrue(runCatching { modern.response(response.toString()) }.isFailure)
    }

    @Test fun functionPresenceAndPreparationMustAgreeAndCredentialsNeverAppearInDiagnostics() {
        for (direct in listOf(false, true)) {
            val root = wire(direct)
            assertTrue(CasMateRegistration.parse(JSONObject(root.toString()).apply { remove("outdoor") }.toString()).isFailure)
            assertTrue(CasMateRegistration.parse(JSONObject(root.toString()).apply { getJSONObject("preparation").put("video", "preparing") }.toString()).isFailure)
            val value = parse(root)
            assertFalse(value.update.toString().contains("9".repeat(64)))
        }
    }

    @Test fun directReadTransportIdentityKeepsPreparationAndCandidatesSeparateFromTrustAndCredentials() {
        val ready = parse(wire(true)).direct!!
        val preparing = parse(pending(wire(true), 2)).direct!!
        assertEquals(ready.identity, preparing.identity)
        val changed = wire(true).apply { getJSONArray("endpoints").getJSONObject(0).put("tcpPort", 3005) }
        assertEquals(ready.identity, parse(changed).direct!!.identity)
        val proofChanged = wire(true).apply { getJSONObject("comments").put("revision", 2) }
        assertNotEquals(ready.identity, parse(proofChanged).direct!!.identity)
        val keyChanged = wire(true).apply { getJSONObject("pcKey").put("fingerprint", "0".repeat(64)) }
        assertNotEquals(ready.identity, parse(keyChanged).direct!!.identity)
    }
}
