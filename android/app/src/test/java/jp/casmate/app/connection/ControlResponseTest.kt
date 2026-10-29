package jp.casmate.app.connection

import jp.casmate.app.obs.ObsControlHttpException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ControlResponseTest {
    @Test fun failedSaveRetriesTheSameSnapshotButAChangedGenerationCancelsIt() = runBlocking<Unit> {
        var saves = 0; var failures = 0
        retryRegistrationSave({ true }, { saves++; check(saves > 1) }, { failures++ })
        assertEquals(2, saves); assertEquals(1, failures)
        var current = true; saves = 0
        val job = launch { retryRegistrationSave({ current }, { saves++; error("disk unavailable") }, {}) }
        delay(50); current = false; job.join()
        assertEquals(1, saves)
    }
    @Test fun lostConfirmationResponseIsUnknownWithoutResendingOrInferringSuccess() = runBlocking<Unit> {
        val response = CompletableDeferred<JSONObject>()
        try { awaitControlResponse("obs.confirm", response); fail("Must expire") }
        catch (error: ObsControlHttpException) { assertEquals("RESULT_UNKNOWN", error.code); assertEquals(504, error.status) }
        assertFalse(response.isCompleted)
    }
}
