package jp.casmate.app.obs

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NetworkRegistrationTest {
    private fun wire() = JSONObject(javaClass.getResource("/smartphone-registration-v12.json")!!.readText())
    private fun parse(value: JSONObject) = CasMateRegistration.parse(value.toString()).getOrThrow()
    @Test fun independentCurrentRoutesKeepSelectionAndRejectDifferentDevice() {
        val lan = RegistrationBundle(emptyMap(), null).merge(parse(wire()))
        val ts = wire().put("network", "tailscale").apply {
            getJSONObject("comments").put("url", "http://100.64.0.1:3000/comments")
            getJSONObject("control").put("url", "ws://100.64.0.1:3001/smartphone/ws")
            getJSONObject("outdoor").put("address", "100.64.0.1")
        }
        val both = RegistrationBundle.parse(lan.merge(parse(ts)).json())
        assertEquals(ConnectionNetwork.LAN, both.activeNetwork); assertEquals(2, both.profiles.size)
        assertEquals(ConnectionNetwork.TAILSCALE, both.select(ConnectionNetwork.TAILSCALE).activeNetwork)
        assertTrue(runCatching { both.merge(parse(wire().put("deviceId", java.util.UUID.randomUUID().toString()))) }.isFailure)
        val unselected = RegistrationBundle(both.profiles, null, both.pcId, both.deviceId)
        assertNull(RegistrationBundle.parse(unselected.json()).activeNetwork)
    }
    @Test fun retiredAndFutureWireVersionsAreRejected() {
        for (version in listOf(1, 2, 3, 4, 5, 7, 8, 10, 15, 999)) assertTrue(CasMateRegistration.parse(wire().put("version", version).toString()).isFailure)
        for (version in listOf(6, 9, 12, 14, 999)) {
            val invitation = JSONObject(javaClass.getResource("/common-registration-invitation.json")!!.readText()).put("version", version)
            assertTrue(SmartphoneInvitation.parse(invitation.toString()).isFailure)
        }
        assertTrue(SmartphoneInvitation.parse("http://192.168.1.2:3000/comments").isFailure)
    }
    @Test fun controlRouteAndVersionMustMatchTheSelectedPc() {
        for ((key, value) in listOf("protocolVersion" to 1, "url" to "ws://192.168.1.3:3001/smartphone/ws", "url" to "ws://192.168.1.2:3001/obs-control")) {
            val root = wire(); root.getJSONObject("control").put(key, value)
            assertTrue(CasMateRegistration.parse(root.toString()).isFailure)
        }
    }
}
