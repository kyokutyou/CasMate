package jp.casmate.app.obs

import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class ObsControlNetworkTest {
    @Test fun closingTheCameraCancelsPendingAndPreparingButKeepsSentConfirmation() {
        val registration = CasMateRegistration.parse(javaClass.classLoader!!.getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
        val field = ObsControlRuntime.javaClass.getDeclaredField("mutable").apply { isAccessible = true }
        val confirming = ObsControlRuntime.javaClass.getDeclaredField("confirming").apply { isAccessible = true }
        val generation = ObsControlRuntime.javaClass.getDeclaredField("foregroundGeneration").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val state = field.get(null) as MutableStateFlow<ObsControlUiState>
        val previous = state.value
        try {
            confirming.setBoolean(null, false)
            for (pending in listOf(null, ObsPrepared("confirmation", System.currentTimeMillis() + 10000, "start"))) {
                state.value = ObsControlUiState(registration = registration, network = ObsControlRegistration.Network.LAN,
                    pending = pending, working = pending == null)
                val before = generation.getLong(null)
                ObsControlRuntime.cancel()
                assertNull(state.value.pending)
                assertFalse(state.value.working)
                assertTrue(generation.getLong(null) > before)
            }
            val sent = ObsControlUiState(registration = registration, network = ObsControlRegistration.Network.LAN,
                pending = ObsPrepared("sent", System.currentTimeMillis() + 10000, "stop"), working = true)
            state.value = sent
            confirming.setBoolean(null, true)
            ObsControlRuntime.cancel()
            assertEquals(sent, state.value)
        } finally { confirming.setBoolean(null, false); state.value = previous }
    }
    @Test fun lostConfirmationRemainsUnknownAcrossReconnectAndCurrentStateUpdates() {
        val confirming = ObsControlRuntime.javaClass.getDeclaredField("confirming").apply { isAccessible = true }
        val unknown = ObsControlRuntime.javaClass.getDeclaredField("resultUnknown").apply { isAccessible = true }
        try {
            confirming.setBoolean(null, true)
            ObsControlRuntime.observeRemote(null, "切断")
            ObsControlRuntime.observeRemote(null, "再接続中")
            ObsControlRuntime.observeRemote(ObsRemoteState("epoch", 10, "connected", "streaming", false, null), null)
            assertTrue(ObsControlRuntime.state.value.error!!.contains("結果が不明"))
            assertEquals("streaming", ObsControlRuntime.state.value.remote!!.stream)
        } finally { confirming.setBoolean(null, false); unknown.setBoolean(null, false) }
    }
    @Test fun switchingNetworkReleasesAnOperationWaitingForTheOldEndpoint() {
        val registration = CasMateRegistration.parse(javaClass.classLoader!!.getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
        // Install the state held while an HTTP request is pending; no network is used.
        val field = ObsControlRuntime.javaClass.getDeclaredField("mutable").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val state = field.get(null) as MutableStateFlow<ObsControlUiState>
        val previous = state.value
        try {
            state.value = ObsControlUiState(registration = registration, network = ObsControlRegistration.Network.LAN, working = true)
            ObsControlRuntime.applyRegistration(registration, ObsControlRegistration.Network.TAILSCALE)
            assertFalse(ObsControlRuntime.state.value.working)
            assertNull(ObsControlRuntime.state.value.pending)
            assertNull(ObsControlRuntime.state.value.remote)
            assertEquals(ObsControlRegistration.Network.TAILSCALE, ObsControlRuntime.state.value.network)
        } finally { state.value = previous }
    }
}
