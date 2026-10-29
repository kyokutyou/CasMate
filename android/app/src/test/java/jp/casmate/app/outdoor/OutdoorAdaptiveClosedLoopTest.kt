package jp.casmate.app.outdoor

import org.junit.Assert.*
import org.junit.Test

/** Independent encoder and FIFO link models: accepted requests are NOT actual output rates. */
class OutdoorAdaptiveClosedLoopTest {
    private class Link(val ignoreTargets: Boolean = false) {
        val c = AdaptiveCircuit()
        private data class Packet(val at: Long, var remaining: Double, val id: Long, val live: Long)
        private val wire = ArrayDeque<Packet>()
        private val delayed = ArrayDeque<Int>()
        private var actualBps = 500000.0
        private var acked = 0L
        private var ackBytes = 0L
        private var lastAck: Long? = null
        private var ackLive = 0L
        private var ackId = 0L
        private var expired = 0L
        private var expiredBytes = 0L
        var generated = 0L; private set
        var audioProduced = 0L; private set
        var widestBackoff = 0L; private set
        val phases = mutableSetOf<OutdoorAdaptationPhase>()
        fun tick(capacityBps: Int, jitter: Boolean = false) {
            val now = c.now + 250
            delayed.addLast(c.control.view.acceptedTarget)
            val desired = if (ignoreTargets) 900000 else if (delayed.size > 3) delayed.removeFirst() else 500000
            // Encoder response lags, smooths changes and occasionally overshoots a keyframe.
            actualBps += (desired - actualBps) * 0.35
            val held = c.control.view.phase == OutdoorAdaptationPhase.HELD
            val bytes = (actualBps / 32 * if (held) 0.06 else 1.08).toLong() + if (now % 2000L == 0L) 2500 else 0
            generated += bytes; audioProduced += 2000
            wire.addLast(Packet(now, (bytes + 2000) * 1.12, c.count + 1, if (held) 0 else c.control.view.probeGeneration))
            var available = capacityBps / 32.0 * if (jitter && now % 1000 == 0L) 0.6 else 1.0
            while (wire.isNotEmpty() && available > 0) {
                val head = wire.first(); val used = minOf(available, head.remaining)
                head.remaining -= used; available -= used; ackBytes += used.toLong()
                if (head.remaining <= 0.0) {
                    wire.removeFirst(); acked++; lastAck = now
                    if (head.live > 0) { ackLive = head.live; ackId = head.id }
                }
            }
            while (wire.firstOrNull()?.let { now - it.at >= 1000 } == true) {
                expiredBytes += wire.removeFirst().remaining.toLong(); expired++
            }
            c.step(bytes = bytes, live = !held, transform = { s -> s.copy(
                unackedBytes = wire.sumOf { it.remaining.toLong() }, unackedAgeMs = wire.firstOrNull()?.let { now - it.at } ?: 0,
                ackProgress = acked, ackedBytes = ackBytes, lastAckAtMs = lastAck,
                ackedLiveGeneration = ackLive, ackedLiveVideoId = ackId,
                expiredPackets = expired, expiredBytes = expiredBytes,
                // The sending thread can block behind an overflowing socket even while its queue is empty.
                processingBytes = if (wire.size > 3) bytes else 0,
                localWaitMs = if (wire.size > 3) 300 else 0,
                audioWaitMs = if (wire.size > 3) 300 else 0) })
            phases.add(c.control.view.phase)
            widestBackoff = maxOf(widestBackoff, c.control.view.diagnostics.recoveryWaitMs ?: 0)
        }
    }

    @Test fun prolongedWeakLinkRetreatsAndEventuallyRecoversWithDelayedEncoderAndBursts() {
        val link = Link()
        repeat(100) { link.tick(115000) }
        assertTrue(link.phases.contains(OutdoorAdaptationPhase.HELD))
        assertTrue(link.phases.contains(OutdoorAdaptationPhase.PROBING))
        assertTrue(link.widestBackoff >= 4000)
        assertTrue(link.audioProduced > 0) // Controller never suppresses the independent audio producer.
        repeat(180) { link.tick(3000000, jitter = true) }
        assertTrue(link.c.control.view.phase in setOf(OutdoorAdaptationPhase.LOW_VIDEO, OutdoorAdaptationPhase.VIDEO))
        assertTrue(link.c.control.view.acceptedTarget > 250000)
        assertEquals(0L, link.c.control.view.diagnostics.recoveryWaitMs)
    }

    @Test fun completeOutageAndIgnoredEncoderDoNotFabricateRecovery() {
        val link = Link(ignoreTargets = true)
        repeat(80) { link.tick(0) }
        assertEquals(OutdoorAdaptationPhase.HELD, link.c.control.view.phase)
        assertFalse(link.phases.contains(OutdoorAdaptationPhase.PROBING))
        repeat(80) { link.tick(200000) }
        assertTrue(link.c.control.view.acceptedTarget <= 500000)
        assertTrue(link.c.actions.any { it.kind == OutdoorAdaptationOperation.RELEASE })
        assertTrue(link.c.actions.count { it.kind == OutdoorAdaptationOperation.HOLD } > 1)
    }
}
