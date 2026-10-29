package com.pedro.common

import com.pedro.common.frame.MediaFrame
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class TransportObservationTest {
  private var now = 0L
  private fun frame(audio: Boolean = false) = MediaFrame(ByteBuffer.allocate(100),
    MediaFrame.Info(0, 100, 0, false), if (audio) MediaFrame.Type.AUDIO else MediaFrame.Type.VIDEO)

  @Test fun queueAndInFlightAudioRemainVisibleWithoutScanningBuffers() {
    val metrics = TransportObservation { now }
    metrics.beginConnection()
    val video = frame(); val audio = frame(true)
    metrics.queued(video, 1, 0); now = 10; metrics.queued(audio, 0, 0)
    now = 30; metrics.processing(video)
    var s = metrics.snapshot()
    assertEquals(1, s.queuedFrames); assertEquals(100L, s.queuedBytes)
    assertEquals(30L, s.localWaitMs); assertEquals(20L, s.audioWaitMs)
    metrics.sentFrame(); metrics.finished(); metrics.processing(audio)
    now = 40; s = metrics.snapshot()
    assertEquals(0, s.queuedFrames); assertEquals(30L, s.audioWaitMs)
    metrics.sentFrame(); metrics.finished()
    assertEquals(0L, metrics.snapshot().audioWaitMs)
  }

  @Test fun consumingAFrameWithoutPacketsOrWithASendFailureIsNotVideoProgress() {
    val metrics = TransportObservation { now }; metrics.beginConnection()
    val skipped = frame(); metrics.queued(skipped, 1, 2); metrics.processing(skipped); metrics.finished()
    assertEquals(0L, metrics.snapshot().sentVideoFrames)
    assertNull(metrics.snapshot().lastVideoSentAtMs)
    val failed = frame(); metrics.queued(failed, 2, 2); metrics.processing(failed)
    metrics.packetSent(4, 80, 2, 2, false) // Only part of the frame made it to the socket.
    metrics.finished()
    assertEquals(0L, metrics.snapshot().sentLiveVideoId)
    val sent = frame(); metrics.queued(sent, 3, 2); metrics.processing(sent)
    metrics.sentFrame(); metrics.sentFrame(); metrics.finished()
    assertEquals(1L, metrics.snapshot().sentVideoFrames)
    assertEquals(3L, metrics.snapshot().sentLiveVideoId)
  }

  @Test fun onlyNewAcknowledgedPacketsCountAndExpiredPacketsNeverBecomeAcked() {
    val metrics = TransportObservation { now }
    metrics.beginConnection()
    metrics.packetSent(10, 100, 1, 7, true)
    metrics.packetSent(11, 200, 2, 7, true)
    now = 50; metrics.expired(10)
    metrics.acknowledged(12, 40000)
    val s = metrics.snapshot()
    assertEquals(200L, s.ackedBytes); assertEquals(1L, s.expiredPackets)
    assertEquals(7L, s.ackedLiveGeneration); assertEquals(2L, s.ackedLiveVideoId)
    now = 60; metrics.acknowledged(12, 40000); metrics.acknowledged(11, 40000)
    assertEquals(s.ackProgress, metrics.snapshot().ackProgress)
    assertEquals(50L, metrics.snapshot().lastAckAtMs)
  }

  @Test fun cumulativeAckWrapAndFutureAckAreHandled() {
    val metrics = TransportObservation { now }
    metrics.beginConnection()
    metrics.packetSent(0x7fffffff, 100, 4, 2, false)
    metrics.packetSent(0, 200, 4, 2, true)
    metrics.acknowledged(2, null) // never sent: cannot acknowledge future video
    assertEquals(0L, metrics.snapshot().ackedBytes)
    metrics.acknowledged(0, null)
    assertEquals(100L, metrics.snapshot().ackedBytes)
    assertEquals(0L, metrics.snapshot().ackedLiveVideoId) // not the frame's last packet
    metrics.acknowledged(1, null)
    assertEquals(300L, metrics.snapshot().ackedBytes)
    assertEquals(4L, metrics.snapshot().ackedLiveVideoId)
  }

  @Test fun newConnectionDiscardsOldCountersAndWaits() {
    val metrics = TransportObservation { now }
    metrics.beginConnection(); metrics.packetSent(1, 100, 1, 1, true)
    metrics.queued(frame(true), 0, 0)
    val first = metrics.snapshot()
    now = 100; metrics.beginConnection()
    val next = metrics.snapshot()
    assertEquals(first.generation + 1, next.generation)
    assertEquals(0L, next.unackedBytes); assertEquals(0L, next.audioWaitMs)
    assertNull(next.rttMs); assertNull(next.lastAckAtMs)
  }
}
