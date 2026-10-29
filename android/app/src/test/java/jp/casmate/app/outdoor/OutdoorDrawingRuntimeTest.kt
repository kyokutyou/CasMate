package jp.casmate.app.outdoor

import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorDrawingRuntimeTest {
    private fun draw(controller: OutdoorDrawingController, session: Long, color: OutdoorDrawingColor,
        y: Float = .5f): OutdoorDrawingSnapshot {
        controller.cameraReady(session)
        assertTrue(controller.setColor(session, color))
        assertTrue(controller.beginStroke(session, .1f, y))
        assertTrue(controller.appendStroke(session, .9f, y))
        assertTrue(controller.endStroke(session))
        return checkNotNull(controller.snapshot(false))
    }

    @Test fun cameraFaultOnlyPinClearsOnActualCameraReadyAndSubsequentStrokesStayLive() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        // An opaque interior pixel isolates publication from the narrow brush's edge alpha.
        controller.setWidth(session, OutdoorDrawingWidth.THICK)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        controller.setVideoHidden(session, false)
        val faultToken = controller.freezeOutput(session, published, OutdoorDrawingHoldReason.CAMERA_FAULT)
        assertFalse(controller.networkRecoveryPending(session))
        assertFalse(controller.state.value.editEnabled)
        assertFalse(controller.confirmLive(session, faultToken))
        assertTrue(controller.cameraReady(session))
        assertTrue(controller.state.value.editEnabled)
        assertTrue(controller.clear(session))
        assertFalse(controller.state.value.pending)
        assertEquals(Color.TRANSPARENT, controller.snapshot(false)!!.bitmap.getPixel(200, 100))
        val next = draw(controller, session, OutdoorDrawingColor.BLUE)
        assertEquals(Color.BLUE, next.bitmap.getPixel(200, 100))
        assertTrue(controller.acknowledgeOutput(next))
        assertSame(next.bitmap, controller.snapshot(true)!!.bitmap)
    }

    @Test fun cameraFaultReasonCannotReplaceAnExistingNetworkPin() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        val networkToken = controller.freezeOutput(session, published)
        controller.clear(session)
        controller.setVideoHidden(session, false)
        val faultToken = controller.freezeOutput(session, published, OutdoorDrawingHoldReason.CAMERA_FAULT)
        assertTrue(controller.networkRecoveryPending(session))
        controller.cameraReady(session)
        assertTrue(controller.state.value.pending)
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertFalse(controller.confirmLive(session, networkToken))
        assertTrue(controller.confirmLive(session, faultToken))
        assertEquals(Color.TRANSPARENT, controller.snapshot(false)!!.bitmap.getPixel(200, 100))
    }

    @Test fun editorWaitsForRealCameraReadinessAndFaultRepairDoesNotUnlockPendingDrawing() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        assertFalse(controller.state.value.editEnabled)
        assertFalse(controller.beginStroke(session, .1f, .5f))
        controller.cameraReady(session)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        val token = controller.freezeOutput(session, published)
        controller.clear(session)
        controller.setVideoHidden(session, false) // Camera fault, rather than manual hide.
        assertFalse(controller.state.value.editEnabled)
        assertFalse(controller.confirmLive(session, token))
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        controller.cameraReady(session)
        assertTrue(controller.state.value.editEnabled)
        assertTrue(controller.state.value.pending)
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertEquals(Color.TRANSPARENT, controller.snapshot(true)!!.bitmap.getPixel(200, 100))
    }

    @Test fun livePreviewUsesLastAcknowledgedOutputEvenWhenNewInputArrivesBetweenPasses() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        assertTrue(controller.openMode(session))
        val first = draw(controller, session, OutdoorDrawingColor.RED)
        assertTrue(controller.acknowledgeOutput(first))
        val second = draw(controller, session, OutdoorDrawingColor.BLUE, .7f)
        assertTrue(second.revision > first.revision)
        assertSame(first.bitmap, controller.snapshot(true)!!.bitmap)
        assertFalse(controller.state.value.pending)
        assertTrue(controller.acknowledgeOutput(second))
        assertSame(second.bitmap, controller.snapshot(true)!!.bitmap)
        assertTrue(controller.closeMode(session))
        assertTrue(controller.state.value.hasDrawing)
        assertSame(second.bitmap, controller.snapshot(false)!!.bitmap)
    }

    @Test fun heldDraftStaysPrivateAcrossCloseReopenFailedProbeAndOnlyMatchingSuccessPublishes() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        val initialToken = controller.freezeOutput(session, published)
        assertTrue(controller.clear(session))
        assertTrue(controller.state.value.pending)
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertEquals(Color.TRANSPARENT, controller.snapshot(true)!!.bitmap.getPixel(200, 100))
        controller.closeMode(session)
        assertSame(published.bitmap, controller.snapshot(true)!!.bitmap)
        controller.openMode(session)
        assertEquals(Color.TRANSPARENT, controller.snapshot(true)!!.bitmap.getPixel(200, 100))
        val retryToken = controller.freezeOutput(session, controller.snapshot(false))
        assertFalse(controller.confirmLive(session, initialToken))
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        // A normal camera-ready callback/recreated GL context is not network recovery success.
        controller.cameraReady(session)
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertTrue(controller.confirmLive(session, retryToken))
        val restored = controller.snapshot(false)!!
        assertEquals(Color.TRANSPARENT, restored.bitmap.getPixel(200, 100))
        controller.acknowledgeOutput(restored)
        assertSame(restored.bitmap, controller.snapshot(true)!!.bitmap)
        assertFalse(controller.state.value.pending)
    }

    @Test fun manualHidePreservesDocumentRejectsLateProbeAndReturnWaitsForActualCameraReadiness() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        val token = controller.freezeOutput(session, published)
        controller.clear(session)
        controller.setVideoHidden(session, true)
        assertNull(controller.snapshot(false)); assertNull(controller.snapshot(true))
        assertFalse(controller.state.value.editEnabled)
        assertFalse(controller.beginStroke(session, .5f, .5f))
        assertFalse(controller.confirmLive(session, token))
        assertFalse(controller.cameraReady(session))
        controller.setVideoHidden(session, false)
        assertNull(controller.snapshot(false))
        assertFalse(controller.state.value.editEnabled)
        assertTrue(controller.cameraReady(session))
        assertTrue(controller.state.value.editEnabled)
        assertEquals(Color.TRANSPARENT, controller.snapshot(false)!!.bitmap.getPixel(200, 100))
        assertFalse(controller.state.value.pending)
    }

    @Test fun oldSessionInputsUploadsErrorsAndCompletionCannotAffectNewTransmission() {
        val controller = OutdoorDrawingController()
        val firstSession = controller.beginSession(200, 200)
        controller.openMode(firstSession)
        val oldSnapshot = draw(controller, firstSession, OutdoorDrawingColor.RED)
        val oldHold = controller.freezeOutput(firstSession, oldSnapshot)
        controller.endSession(firstSession)
        assertFalse(controller.state.value.active)
        assertFalse(controller.state.value.modeActive)
        val current = controller.beginSession(200, 200)
        assertTrue(current > firstSession)
        controller.openMode(current)
        assertFalse(controller.appendStroke(firstSession, .5f, .5f))
        assertFalse(controller.endSession(firstSession))
        assertFalse(controller.confirmLive(firstSession, oldHold))
        assertFalse(controller.acknowledgeOutput(oldSnapshot))
        assertFalse(controller.fail(firstSession, "old failure"))
        assertFalse(controller.state.value.hasDrawing)
        assertEquals("", controller.state.value.error)
        assertEquals(OutdoorDrawingColor.WHITE, controller.state.value.color)
        assertEquals(OutdoorDrawingWidth.MEDIUM, controller.state.value.width)
    }

    @Test fun errorKeepsLastSuccessfulOutputAndExplicitRetryFencesOldFailureWithoutUnlockingHold() {
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(400, 200)
        controller.openMode(session)
        val published = draw(controller, session, OutdoorDrawingColor.RED)
        controller.acknowledgeOutput(published)
        val token = controller.freezeOutput(session, published)
        controller.clear(session)
        assertTrue(controller.fail(session, "更新失敗", published.retryGeneration))
        assertFalse(controller.state.value.editEnabled)
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertSame(published.bitmap, controller.snapshot(true)!!.bitmap)
        assertTrue(controller.retry(session))
        assertTrue(controller.state.value.editEnabled)
        assertTrue(controller.state.value.pending)
        assertFalse(controller.fail(session, "old failure", published.retryGeneration))
        assertFalse(controller.acknowledgeOutput(published))
        assertSame(published.bitmap, controller.snapshot(false)!!.bitmap)
        assertTrue(controller.confirmLive(session, token))
        assertEquals(Color.TRANSPARENT, controller.snapshot(false)!!.bitmap.getPixel(200, 100))
    }

    @Test fun allocationFailureIsLocalAndRetryCanCreateDocumentWithoutRestartingSession() {
        var attempts = 0
        val controller = OutdoorDrawingController { width, height ->
            if (attempts++ == 0) throw OutOfMemoryError("injected drawing allocation failure")
            OutdoorDrawingDocument(width, height)
        }
        val session = controller.beginSession(200, 200)
        assertTrue(controller.state.value.active)
        assertTrue(controller.state.value.error.isNotEmpty())
        controller.openMode(session)
        assertFalse(controller.state.value.editEnabled)
        assertNull(controller.snapshot(false))
        assertTrue(controller.retry(session))
        controller.cameraReady(session)
        assertEquals(session, controller.state.value.sessionId)
        assertEquals("", controller.state.value.error)
        assertTrue(controller.state.value.editEnabled)
    }
}
