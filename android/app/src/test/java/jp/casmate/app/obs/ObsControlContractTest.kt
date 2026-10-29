package jp.casmate.app.obs

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ObsControlContractTest {
    private fun qr(outdoor: Boolean = false): String {
        val obs = JSONObject().put("registrationId", "550e8400-e29b-41d4-a716-446655440000")
            .put("revision", 2).put("token", "a".repeat(64)).put("endpoints", org.json.JSONArray()
                .put(JSONObject().put("network", "lan").put("address", "192.168.1.25").put("port", 3002))
                .put(JSONObject().put("network", "tailscale").put("address", "100.100.20.30").put("port", 3002)))
        val root = JSONObject().put("type", "casmate.outdoor").put("version", 3).put("obsControl", obs)
        if (outdoor) root.put("outdoor", JSONObject().put("registrationId", "outdoor-1").put("revision", 1)
            .put("address", "100.100.20.30").put("obsPort", 10000).put("statusPort", 3001)
            .put("passphrase", "p".repeat(32)).put("token", "b".repeat(64)))
        return root.toString()
    }

    @Test fun parsesBothNetworkEndpointsWithoutExposingTokenInToString() {
        val registration = ObsControlRegistration.parseStored(qr()).getOrThrow()
        assertEquals(2, registration.endpoints.size)
        assertTrue(!registration.toString().contains(registration.token))
        assertEquals(3002, registration.endpoint(ObsControlRegistration.Network.TAILSCALE)!!.port)
    }

    @Test fun rejectsRetiredCombinedRegistrationQr() {
        assertTrue(CasMateRegistration.parse(qr(outdoor = true)).isFailure)
    }

    @Test fun rejectsPublicOrInvalidEndpointAndUnknownFields() {
        val invalid = JSONObject(qr()).getJSONObject("obsControl").getJSONArray("endpoints")
            .getJSONObject(0).put("address", "8.8.8.8")
        val root = JSONObject(qr()).put("obsControl", JSONObject(qr()).getJSONObject("obsControl").put("endpoints", invalid))
        assertTrue(ObsControlRegistration.parseStored(root.toString()).isFailure)
        assertTrue(ObsControlRegistration.parseStored(JSONObject(qr()).put("unexpected", true).toString()).isFailure)
    }

}
