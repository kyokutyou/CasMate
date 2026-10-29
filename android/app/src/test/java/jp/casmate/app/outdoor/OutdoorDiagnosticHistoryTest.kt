package jp.casmate.app.outdoor

import com.pedro.common.TransportObservation
import com.pedro.encoder.video.BitrateChangeResult
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OutdoorDiagnosticHistoryTest {
    @Test fun historySummaryTracksTheRetainedRangeAndResetsOnlyForNewSession() {
        OutdoorDiagnosticHistory.begin(1000, OutdoorQuality(), false, false)
        assertEquals(0, OutdoorDiagnosticHistory.summary.value.count)
        repeat(1300) { n -> OutdoorDiagnosticHistory.record(1000L + n * 250, null, OutdoorAdaptationView(500000), false, null) }
        val summary = OutdoorDiagnosticHistory.summary.value
        assertEquals(1200, summary.count)
        assertEquals(25000L, summary.firstMs)
        assertEquals(324750L, summary.lastMs)
        assertEquals(100L, summary.discardedObservations)
        OutdoorDiagnosticHistory.stop(325750)
        assertEquals(summary.count, OutdoorDiagnosticHistory.summary.value.count)
        assertTrue(OutdoorDiagnosticHistory.available.value)
        OutdoorDiagnosticHistory.begin(400000, OutdoorQuality(), false, false)
        assertEquals(OutdoorDiagnosticHistorySummary(), OutdoorDiagnosticHistory.summary.value)
        assertFalse(OutdoorDiagnosticHistory.available.value)
    }
    @Test fun canceledAndFailedExportsKeepHistoryAndWritingUsesThePickerTimeCopy() {
        OutdoorDiagnosticHistory.begin(1000, OutdoorQuality(), false, false)
        OutdoorDiagnosticHistory.record(1250, null, OutdoorAdaptationView(500000), false, null)
        assertTrue(OutdoorDiagnosticExport.begin())
        assertFalse(OutdoorDiagnosticExport.begin())
        val capture = OutdoorDiagnosticHistory.capture()!!
        OutdoorDiagnosticHistory.record(1500, null, OutdoorAdaptationView(400000), false, null)
        OutdoorDiagnosticExport.save(org.robolectric.RuntimeEnvironment.getApplication().contentResolver, null)
        assertFalse(OutdoorDiagnosticExport.state.value.busy)
        assertEquals(2, OutdoorDiagnosticHistory.capture()!!.observations.size)
        assertFalse(writeOutdoorDiagnostic(capture) { throw java.io.IOException("private destination") })
        assertEquals(2, OutdoorDiagnosticHistory.capture()!!.observations.size)
        val output = java.io.ByteArrayOutputStream()
        assertTrue(writeOutdoorDiagnostic(capture) { output })
        val json = JSONObject(output.toString("UTF-8"))
        assertEquals(1, json.getJSONArray("observations").length())
        assertFalse(output.toString("UTF-8").contains("private destination"))
        OutdoorDiagnosticHistory.begin(2000, OutdoorQuality(), false, false)
    }
    @Test fun boundsBothRingsAndCopySurvivesNewSessionOrMoreSending() {
        val ring = OutdoorDiagnosticRing(); ring.begin(1000, OutdoorQuality(), false, false)
        repeat(1400) { n ->
            val now = 1000L + n * 250
            ring.record(now, null, OutdoorAdaptationView(500000 + n), false, null)
            ring.applied(now, OutdoorAdaptationAction(n.toLong(), OutdoorAdaptationOperation.BITRATE, 500000, now), BitrateChangeResult.ACCEPTED, null, OutdoorAdaptationView(500000))
        }
        val copy = ring.capture()!!
        assertEquals(1200, copy.observations.size); assertEquals(1200, copy.events.size)
        assertEquals(200, copy.discardedObservations)
        assertTrue(copy.discardedEvents >= 1200)
        assertEquals(copy, ring.capture()) // Stopping/reading has no destructive effect.
        ring.begin(900000, OutdoorQuality(), true, true)
        assertNull(ring.capture())
        assertEquals(1200, copy.observations.size)
    }

    @Test fun appliedEventsUseTheCompletionStateAndStopRetainsAnImmutableSession() {
        val ring = OutdoorDiagnosticRing(); ring.begin(0, OutdoorQuality(), false, false)
        ring.record(250, null, OutdoorAdaptationView(500000), false, null)
        ring.applied(300, OutdoorAdaptationAction(1, OutdoorAdaptationOperation.HOLD, 150000, 250), null, true,
            OutdoorAdaptationView(150000, OutdoorAdaptationPhase.HELD))
        assertEquals(OutdoorAdaptationPhase.HELD, ring.capture()!!.events.last().phase)
        ring.stop(400); val stopped = ring.capture()!!
        assertEquals(OutdoorDiagnosticEventKind.STOP, stopped.events.last().kind)
        assertEquals(OutdoorAdaptationPhase.HELD, stopped.events.last().phase)
        ring.stop(500)
        ring.record(500, null, OutdoorAdaptationView(900000), false, null)
        assertEquals(stopped, ring.capture())
    }

    @Test fun exportUsesRelativeTimeExplicitUnitsAndOnlyAllowlistedFields() {
        val ring = OutdoorDiagnosticRing(); ring.begin(1000, OutdoorQuality(), false, false)
        ring.encoder("test.avc.encoder", 400000, 400000); ring.injected()
        val actual = TransportObservation { 1500 }.apply { beginConnection() }.snapshot()
        ring.record(1500, actual.copy(audioWaitMs = 300), OutdoorAdaptationView(500000,
            message = "srt://secret-host:10000?passphrase=SECRET arbitrary exception comment"), true, actual)
        val text = ring.capture()!!.json(); val json = JSONObject(text)
        assertEquals(1, json.getInt("schemaVersion")); assertEquals("actual-and-injected", json.getString("input"))
        val row = json.getJSONArray("observations").getJSONObject(0)
        assertEquals(500, row.getLong("atMs")); assertEquals(500, row.getJSONObject("actualObservation").getLong("atMs"))
        assertEquals(300, row.getJSONObject("observation").getLong("audioWaitMs"))
        assertTrue(row.isNull("generatedBps")); assertTrue(row.has("acceptedBps"))
        for (forbidden in listOf("SECRET", "secret-host", "passphrase", "registrationId", "preset", "message", "stack", "deviceId", "url")) {
            assertFalse(forbidden, text.contains(forbidden))
        }
        assertEquals(400000, json.getJSONObject("quality").getInt("holdBps"))
    }
}
