package jp.casmate.app.outdoor

import jp.casmate.app.obs.CasMateRegistration
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OutdoorContractTest {
    private fun wire() = JSONObject(javaClass.getResource("/smartphone-registration-v12.json")!!.readText())
    @Test fun currentWireKeepsNativeCredentialsAndRejectsMalformedVideo() {
        val value = CasMateRegistration.parse(wire().toString()).getOrThrow().outdoor!!
        assertTrue(value.nativeReceiver); assertFalse(value.toString().contains(value.token))
        for ((field, invalid) in listOf("obsPort" to 1.5, "revision" to 0, "address" to "example.com", "token" to "invalid", "version" to 2)) {
            val root = wire(); root.getJSONObject("outdoor").put(field, invalid)
            assertTrue(CasMateRegistration.parse(root.toString()).isFailure)
        }
    }
}
