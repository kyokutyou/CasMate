package jp.casmate.app.obs

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SpeechRecognitionRegistrationTest {
    private fun wire(direct: Boolean) = JSONObject(javaClass.getResource(if (direct) "/direct-registration-v14.json" else "/smartphone-registration-v12.json")!!.readText())
    private fun modern(direct: Boolean) = wire(direct).put("version", if (direct) 16 else 15).put("updateRevision", 2).apply {
        getJSONObject("control").put("protocolVersion", 3)
        put("speechRecognition", JSONObject().put("registrationId", "77777777-7777-4777-8777-777777777777").put("revision", 1).put("token", "d".repeat(64)))
    }
    @Test fun knownRegistrationsAcquireIndependentSpeechAuthorityWithoutReenrollment() {
        for (direct in listOf(false, true)) {
            val old = RegistrationBundle(emptyMap(), null).merge(CasMateRegistration.parse(wire(direct).toString()).getOrThrow())
            val after = old.mergeUpdate(CasMateRegistration.parse(modern(direct).toString()).getOrThrow())
            val restored = RegistrationBundle.parse(after.json()); val profile = restored.profiles[restored.activeNetwork]!!
            assertEquals(old.pcId, restored.pcId); assertEquals(old.deviceId, restored.deviceId); assertEquals(old.activeNetwork, restored.activeNetwork)
            assertEquals(3, profile.protocolVersion); assertEquals("d".repeat(64), profile.speechRecognition!!.token)
            assertEquals(old.outdoor!!.json, restored.outdoor!!.json); assertEquals(old.obs!!.json, restored.obs!!.json)
            assertFalse(profile.toString().contains("d".repeat(64)))
            assertEquals(profile.speechRecognition!!.id, profile.revoked().speechRecognition!!.id)
        }
    }
    @Test fun wrongPurposeDuplicateMissingAndWrongVersionCredentialsAreRejected() {
        for (direct in listOf(false, true)) {
            val missing = modern(direct).apply { remove("speechRecognition") }
            val duplicate = modern(direct).apply { getJSONObject("speechRecognition").put("registrationId", getJSONObject("registrationUpdate").getString("registrationId")) }
            val oldInjection = wire(direct).apply { put("speechRecognition", modern(direct).getJSONObject("speechRecognition")) }
            val mismatched = modern(direct).apply { getJSONObject("control").put("protocolVersion", 2) }
            for (value in listOf(missing, duplicate, oldInjection, mismatched)) assertTrue(CasMateRegistration.parse(value.toString()).isFailure)
        }
    }
}
