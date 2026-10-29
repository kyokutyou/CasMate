package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorReporterTest {
    @Test fun reportPayloadContainsOnlyPurposeSpecificStateWithoutCredentialsOrMedia() {
        val registration = jp.casmate.app.obs.CasMateRegistration.parse(javaClass.classLoader!!.getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().outdoor!!
        val body = OutdoorReporter.payload(registration, OutdoorState(active = true, status = "sending"), "session", 1)
        assertEquals(setOf("version", "registrationId", "revision", "sessionId", "sequence", "status", "microphone", "errorCode"), body.keys().asSequence().toSet())
        assertEquals("sending", body.getString("status"))
        assertFalse(body.toString().contains(registration.token)); assertFalse(body.toString().contains(registration.passphrase))
    }
}
