package jp.casmate.app.outdoor

import com.pedro.common.TransportObservation
import com.pedro.common.frame.MediaFrame
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class OutdoorNativeQueueTest {
    private fun frame(audio: Boolean = false, key: Boolean = false, size: Int = 40) = MediaFrame(ByteBuffer.allocate(size),
        MediaFrame.Info(0, size, 1000, key), if (audio) MediaFrame.Type.AUDIO else MediaFrame.Type.VIDEO)
    @Test fun byteAgeBoundsAndAudioPriorityIncludeTheProcessingFrame() {
        var now = 0L; val observation = TransportObservation { now }; observation.beginConnection()
        val queue = OutdoorSendQueue(400, observation, { now }, 100)
        assertTrue(queue.offer(frame(key = true), 1, 1)); val key = queue.take()!!
        assertEquals(1L, key.videoId)
        assertTrue(queue.offer(frame(audio = true), 0, 0))
        assertFalse(queue.offer(frame(), 2, 1)); assertEquals(80, queue.sizeBytes())
        queue.finish(true); assertEquals(MediaFrame.Type.AUDIO, queue.take()!!.frame.type); queue.finish(true)
        assertFalse(queue.offer(frame(), 3, 1))
        assertTrue(queue.offer(frame(key = true), 4, 1)); now = 400; assertNull(queue.take())
        assertTrue(queue.needsKeyframe); assertEquals(0, queue.sizeBytes())
        assertTrue(observation.snapshot().droppedVideoFrames >= 2)
    }
    @Test fun partialVideoEvictionNeverFlushesAudioAndRequiresFreshKeyframe() {
        val observation = TransportObservation { 0 }; observation.beginConnection()
        val queue = OutdoorSendQueue(400, observation, { 0 }, 120)
        queue.offer(frame(key = true), 1, 1); queue.take(); queue.offer(frame(), 2, 1); queue.offer(frame(audio = true), 0, 0)
        queue.finish(false)
        assertEquals(MediaFrame.Type.AUDIO, queue.take()!!.frame.type); queue.finish(true)
        assertNull(queue.take()); assertTrue(queue.needsKeyframe)
    }
    @Test fun receiverEvidenceRequiresMatchingConnectionLiveFrameAndFreshAudio() {
        val observation = TransportObservation { 2000 }; observation.beginConnection()
        val evidence = OutdoorReceiverEvidence("session", 2)
        evidence.sent(1000000, 10, 4, 1000)
        val packet = OutdoorReceiveProgress("session", 2, 1000, 1, 1, 90000)
        assertFalse(evidence.receive(packet.copy(generation = 1), 1500))
        assertEquals(0L, evidence.apply(observation.snapshot()).ackedLiveGeneration)
        assertTrue(evidence.receive(packet, 1500))
        val sample = evidence.apply(observation.snapshot()); assertEquals(4L, sample.ackedLiveGeneration); assertEquals(10L, sample.ackedLiveVideoId)
        assertEquals(1500L, sample.lastAckAtMs)
        evidence.receive(packet, 1900); assertEquals(1500L, evidence.apply(observation.snapshot()).lastAckAtMs)
        assertNull(evidence.apply(observation.snapshot().copy(atMs = 3000)).lastAckAtMs)
        assertFalse(evidence.apply(observation.snapshot().copy(atMs = 3000)).valid)
        assertFalse(evidence.receive(packet.copy(bytes = 10), 2000)); assertEquals(0L, evidence.apply(observation.snapshot()).ackedLiveGeneration)
    }
    @Test fun freshAudioRepliesCannotKeepAnOldVideoAliveAndReceiverDropsReachAdaptation() {
        val observation = TransportObservation { 2200 }; observation.beginConnection()
        val evidence = OutdoorReceiverEvidence("session", 2)
        evidence.sent(1000000, 10, 4, 1000)
        val packet = OutdoorReceiveProgress("session", 2, 1000, 1, 1, 90000)
        evidence.receive(packet, 1100)
        evidence.receive(packet.copy(bytes = 2000, audioFrames = 20, droppedPackets = 3), 2100)
        val sample = evidence.apply(observation.snapshot().copy(valid = true, expiredPackets = 2))
        assertTrue(sample.valid); assertEquals(2100L, sample.lastAckAtMs)
        assertEquals(0L, sample.ackedLiveGeneration); assertEquals(0L, sample.ackedLiveVideoId)
        assertEquals(5L, sample.expiredPackets)
        assertFalse(evidence.apply(sample.copy(atMs = 3100)).valid)
    }
    @Test fun queueOverflowCannotLeaveDependentVideoAheadOfReplacementKeyframe() {
        val observation = TransportObservation { 0 }; observation.beginConnection()
        val queue = OutdoorSendQueue(400, observation, { 0 }, 120)
        queue.offer(frame(key = true), 1, 1); queue.offer(frame(), 2, 1); queue.offer(frame(), 3, 1)
        assertTrue(queue.offer(frame(key = true), 4, 1))
        assertEquals(40, queue.sizeBytes())
        assertEquals(4L, queue.take()!!.videoId); queue.finish(true)
        assertNull(queue.take())
    }
}
