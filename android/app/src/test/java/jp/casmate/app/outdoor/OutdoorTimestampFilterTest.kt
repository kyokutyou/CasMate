package jp.casmate.app.outdoor

import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Test

class OutdoorTimestampFilterTest {
    @Test fun formatsLocalTwentyFourHourTimeThroughSeconds() {
        val now = Instant.parse("2026-01-02T15:04:05Z").toEpochMilli()
        val clock = OutdoorTimestampClock(
            nowMillis = { now },
            elapsedMillis = { 0L },
            localTimeZone = { TimeZone.getTimeZone("Asia/Tokyo") },
        )

        assertEquals("00:04:05", clock.currentTime())
    }

    @Test fun keepsOutputAndPreviewLabelEqualAcrossWallClockSecondBoundary() {
        var now = Instant.parse("2026-01-02T12:34:56.900Z").toEpochMilli()
        var elapsed = 1000L
        val clock = OutdoorTimestampClock(
            nowMillis = { now },
            elapsedMillis = { elapsed },
            localTimeZone = { TimeZone.getTimeZone("UTC") },
        )

        val outputLabel = clock.currentTime()
        now += 150L // The preview pass can run after the wall clock crosses into the next second.
        elapsed += 150L
        val previewLabel = clock.currentSnapshot()
        assertEquals("12:34:56", outputLabel)
        assertEquals(outputLabel, previewLabel)

        elapsed += 900L
        now += 900L
        assertEquals("12:34:57", clock.currentTime())
    }

    @Test fun cleanCameraHoldPinsTheLastOutputClockUntilTheLiveProbeActuallyReleases() {
        var now = Instant.parse("2026-01-02T12:34:56Z").toEpochMilli()
        var elapsed = 1000L
        val clock = OutdoorTimestampClock({ now }, { elapsed }, { TimeZone.getTimeZone("UTC") })
        assertEquals("12:34:56", clock.currentTime())
        clock.freezeSnapshot()
        now += 5000; elapsed += 5000
        repeat(3) {
            assertEquals("12:34:56", clock.currentTime())
            assertEquals("12:34:56", clock.currentSnapshot())
        }
        clock.resumeSnapshot()
        assertEquals("12:35:01", clock.currentTime())
        assertEquals(clock.currentTime(), clock.currentSnapshot())
        // An unsuccessful recovery freezes the newly generated probe clock, without reusing an old label.
        clock.freezeSnapshot()
        now += 3000; elapsed += 3000
        assertEquals("12:35:01", clock.currentTime())
        clock.resumeSnapshot()
        assertEquals("12:35:04", clock.currentTime())
    }

    @Test fun manualCameraReturnAndGlRepairCanRefreshWithinThePreviousUpdateInterval() {
        var now = Instant.parse("2026-01-02T12:34:56Z").toEpochMilli()
        var elapsed = 1000L
        val clock = OutdoorTimestampClock({ now }, { elapsed }, { TimeZone.getTimeZone("UTC") })
        clock.currentTime(); clock.freezeSnapshot()
        now += 2000; elapsed += 100
        clock.resumeSnapshot()
        assertEquals("12:34:58", clock.currentTime())
    }
}
