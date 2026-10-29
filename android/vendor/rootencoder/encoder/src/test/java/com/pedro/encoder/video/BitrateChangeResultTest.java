package com.pedro.encoder.video;

import org.junit.Test;
import static org.junit.Assert.*;

public class BitrateChangeResultTest {
  private static class Encoder extends VideoEncoder {
    boolean active;
    boolean fail;
    int calls;
    Encoder() { super(null); }
    @Override public boolean isRunning() { return active; }
    @Override protected void applyBitrateParameters(int bitrate) {
      calls++;
      if (fail) throw new IllegalStateException("test only");
    }
  }

  @Test public void stoppedEncoderIsNotReportedAsAccepted() {
    Encoder encoder = new Encoder();
    assertEquals(BitrateChangeResult.NOT_RUNNING, encoder.trySetVideoBitrate(250000));
    assertEquals(0, encoder.calls);
  }

  @Test public void exceptionLeavesLastAcceptedTargetIntact() {
    Encoder encoder = new Encoder(); encoder.active = true;
    assertEquals(BitrateChangeResult.ACCEPTED, encoder.trySetVideoBitrate(500000));
    encoder.fail = true;
    assertEquals(BitrateChangeResult.ERROR, encoder.trySetVideoBitrate(250000));
    assertEquals(500000, encoder.getBitRate());
  }
}
