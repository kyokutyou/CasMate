package jp.casmate.app.obs

import android.graphics.Bitmap
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class ObsProgramPreviewControllerTest {
    private fun image() = ObsProgramImage(Bitmap.createBitmap(32, 18, Bitmap.Config.ARGB_8888), "配信", "2026-10-14T00:00:00Z")
    @Test fun openCapturesOnceAndUpdatingDiscardsThePreviousImageEvenOnFailure() = runBlocking {
        var calls = 0; var failed = false
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val controller = ObsProgramPreviewController(scope) { calls++; if (failed) error("failed"); image() }
        try {
            controller.open(); assertEquals(1, calls); assertNotNull(controller.state.value.image)
            controller.open(); assertEquals(1, calls) // Recomposing an already-open screen is not an action.
            failed = true; controller.update(); assertEquals(2, calls); assertNull(controller.state.value.image)
            assertFalse(controller.state.value.working); assertTrue(controller.state.value.message.isNotBlank())
            controller.close(); assertFalse(controller.state.value.open); assertNull(controller.state.value.image)
        } finally { scope.cancel() }
    }
    @Test fun backgroundOrConnectionChangeCancelsWorkAndRequiresManualUpdate() = runBlocking {
        var calls = 0; var cancellations = 0
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val controller = ObsProgramPreviewController(scope) { calls++; try { awaitCancellation() } finally { cancellations++ } }
        try {
            controller.open(); controller.update(); assertEquals(1, calls)
            controller.invalidate(); assertEquals(1, cancellations)
            assertTrue(controller.state.value.open); assertFalse(controller.state.value.working); assertNull(controller.state.value.image)
            yield(); assertEquals(1, calls)
            controller.update(); assertEquals(2, calls)
            controller.close(); assertEquals(2, cancellations); assertFalse(controller.state.value.open)
        } finally { scope.cancel() }
    }
}
