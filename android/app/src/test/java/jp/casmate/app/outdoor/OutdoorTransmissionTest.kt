package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

class OutdoorTransmissionTest {
    @Test fun preparationErrorsKeepTheirActionableCause() {
        val states = mutableListOf<Pair<String, String>>()
        val transport = object : OutdoorTransport {
            override fun connect(events: OutdoorTransport.Events) { throw OutdoorPreparationException("QUALITY_UNSUPPORTED") }
            override fun close() {}
        }
        val session = OutdoorTransmission(transport, { _, _ -> error("must not retry") }, { status, code -> states.add(status to code) })
        session.start(); assertEquals("actionRequired" to "QUALITY_UNSUPPORTED", states.last())
    }
    private class Fake : OutdoorTransport {
        val attempts = mutableListOf<OutdoorTransport.Events>()
        var closes = 0
        override fun connect(events: OutdoorTransport.Events) { attempts.add(events) }
        override fun close() { closes++ }
    }
    @Test fun explicitStartAndStopInvalidateOldSrtCallbacksAndCancelRetries() {
        val fake = Fake(); val pending = mutableListOf<() -> Unit>(); val states = mutableListOf<String>()
        val session = OutdoorTransmission(fake, { _, task -> pending.add(task); { pending.remove(task); Unit } }, { state, _ -> states.add(state) })
        assertTrue(fake.attempts.isEmpty()); session.start(); session.start(); assertEquals(1, fake.attempts.size)
        val first = fake.attempts.last(); first.connected(); first.sending(); assertEquals("sending", states.last())
        first.failed(); assertEquals("reconnecting", states.last()); assertEquals(1, pending.size)
        session.stop(); assertTrue(pending.isEmpty()); first.connected(); first.sending(); first.failed()
        assertEquals("stopped", states.last()); assertEquals(1, fake.attempts.size)
    }
    @Test fun retriesRetainCaptureResourcesAndBackOffUntilANewConnectionWorks() {
        val fake = Fake(); val delays = mutableListOf<Long>(); var pending: (() -> Unit)? = null; val states = mutableListOf<String>()
        val session = OutdoorTransmission(fake, { time, task -> delays.add(time); pending = task; { pending = null } }, { state, _ -> states.add(state) })
        session.start()
        repeat(7) { fake.attempts.last().failed(); assertEquals("connecting", states.last()); pending!!() }
        assertEquals(listOf(500L, 1000L, 2000L, 2000L, 2000L, 2000L, 2000L), delays)
        assertEquals(0, fake.closes)
        val old = fake.attempts.first(); old.connected(); old.sending(); assertEquals("connecting", states.last())
        fake.attempts.last().connected(); fake.attempts.last().sending(); fake.attempts.last().failed()
        assertEquals("reconnecting", states.last()); assertEquals(500L, delays.last())
        session.stop()
        assertEquals(1, fake.closes)
    }
    @Test fun statusReportFailureDoesNotPreventTransportOrNetworkRecovery() {
        val fake = Fake(); var pending: (() -> Unit)? = null
        val session = OutdoorTransmission(fake, { _, task -> pending = task; { pending = null } }, { _, _ -> throw IllegalStateException("fake PC unavailable") })
        session.start(); fake.attempts.last().connected(); fake.attempts.last().sending(); fake.attempts.last().failed()
        assertNotNull(pending); session.networkChanged(); assertEquals(2, fake.attempts.size); assertNull(pending)
        session.stop(); session.networkChanged(); assertEquals(2, fake.attempts.size)
    }
    @Test fun authenticationRetryKeepsCaptureAndIgnoresCallbacksFromPreviousAttempt() {
        val fake = Fake(); var pending: (() -> Unit)? = null
        val states = mutableListOf<Pair<String, String>>()
        val session = OutdoorTransmission(fake, { _, task -> pending = task; { pending = null } },
            { state, error -> states.add(state to error) })
        session.start()
        val first = fake.attempts.last()
        first.connected(); first.sending(); first.failed(authentication = true)
        assertEquals("reconnecting" to "AUTH_FAILED", states.last())
        assertEquals(0, fake.closes)
        pending!!()
        first.connected(); first.sending(); first.failed()
        assertEquals("reconnecting" to "NONE", states.last())
        fake.attempts.last().connected(); fake.attempts.last().sending()
        assertEquals("sending" to "NONE", states.last())
        assertEquals(0, fake.closes)
        session.stop()
        assertEquals(1, fake.closes)
    }
}
