package jp.casmate.app.connection

import org.junit.Assert.*
import org.junit.Test

class ControlSubscriptionVersionTest {
    @Test fun knownV2NeverReceivesTheNewTopicAndV3RegistrationOnlyCanAcquireAuthority() {
        val old = controlSubscription(2, 1, true, true, true, false)
        assertEquals(2, old.getInt("protocolVersion")); assertFalse(old.has("speechRecognition"))
        assertTrue(old.getBoolean("obs")); assertTrue(old.getBoolean("outdoor"))
        val bootstrap = controlSubscription(3, 2, false, false, true, false)
        assertEquals(3, bootstrap.getInt("protocolVersion")); assertTrue(bootstrap.getBoolean("registration"))
        assertFalse(bootstrap.getBoolean("obs")); assertFalse(bootstrap.getBoolean("outdoor")); assertFalse(bootstrap.getBoolean("speechRecognition"))
        val ready = controlSubscription(3, 3, true, true, true, true)
        assertTrue(ready.getBoolean("speechRecognition")); assertEquals(3L, ready.getLong("generation"))
    }
}
