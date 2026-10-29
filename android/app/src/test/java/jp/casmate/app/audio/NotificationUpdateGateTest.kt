package jp.casmate.app.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationUpdateGateTest {
    @Test
    fun publishesOnlyWhenVisibleNotificationStateChanges() {
        val gate = NotificationUpdateGate()

        assertTrue(gate.shouldPublish(AudioStatus.CONNECTING, playing = false))
        assertFalse(gate.shouldPublish(AudioStatus.CONNECTING, playing = false))
        assertTrue(gate.shouldPublish(AudioStatus.WAITING, playing = false))
        assertTrue(gate.shouldPublish(AudioStatus.PLAYING, playing = true))
        assertFalse(gate.shouldPublish(AudioStatus.PLAYING, playing = true))
    }
}
