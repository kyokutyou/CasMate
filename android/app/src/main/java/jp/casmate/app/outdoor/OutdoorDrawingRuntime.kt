package jp.casmate.app.outdoor

import android.graphics.Bitmap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class OutdoorDrawingState(
    val active: Boolean = false,
    val sessionId: Long = 0L,
    val modeActive: Boolean = false,
    val tool: OutdoorDrawingTool = OutdoorDrawingTool.PEN,
    val color: OutdoorDrawingColor = OutdoorDrawingColor.WHITE,
    val width: OutdoorDrawingWidth = OutdoorDrawingWidth.MEDIUM,
    val canUndo: Boolean = false,
    val hasDrawing: Boolean = false,
    val editEnabled: Boolean = false,
    val pending: Boolean = false,
    val error: String = "",
    val draftRevision: Long = 0L,
    val outputRevision: Long = 0L,
    val retryGeneration: Long = 0L,
)

/** Bitmap ownership is immutable; a snapshot can outlive the editor revision or the GL context. */
data class OutdoorDrawingSnapshot(val sessionId: Long, val revision: Long, val bitmap: Bitmap, val retryGeneration: Long)

enum class OutdoorDrawingHoldReason { NETWORK, CAMERA_FAULT }

/** Service-owned session state. Synchronized seams serialize UI input, service lifecycle and GL
 * acknowledgements without retaining a queue of full-frame updates. */
class OutdoorDrawingController internal constructor(
    private val documentFactory: (Int, Int) -> OutdoorDrawingDocument = { width, height -> OutdoorDrawingDocument(width, height) },
) {
    private val mutable = MutableStateFlow(OutdoorDrawingState())
    val state = mutable.asStateFlow()
    private var nextSession = 0L
    private var sessionId = 0L
    private var frameWidth = 0
    private var frameHeight = 0
    private var document: OutdoorDrawingDocument? = null
    private var lastOutput: OutdoorDrawingSnapshot? = null
    private var pinnedOutput: OutdoorDrawingSnapshot? = null
    private var outputLocked = false
    private var networkHold = false
    private var holdToken = 0L
    private var visible = false
    private var cameraPrepared = false
    private var manualReturnArmed = false
    private var manualReturnRequested = false

    @Synchronized fun beginSession(width: Int, height: Int): Long {
        require(width > 0 && height > 0)
        sessionId = ++nextSession
        frameWidth = width; frameHeight = height
        document = null; lastOutput = null; pinnedOutput = null
        outputLocked = false; networkHold = false; holdToken++
        visible = true; cameraPrepared = false; manualReturnArmed = false; manualReturnRequested = false
        mutable.value = OutdoorDrawingState(active = true, sessionId = sessionId)
        attempt { document = documentFactory(width, height); true }
        return sessionId
    }

    @Synchronized fun endSession(id: Long): Boolean {
        if (!matches(id)) return false
        document = null; lastOutput = null; pinnedOutput = null
        outputLocked = false; networkHold = false; visible = false; cameraPrepared = false; holdToken++
        manualReturnArmed = false; manualReturnRequested = false
        sessionId = 0L
        mutable.value = OutdoorDrawingState()
        return true
    }

    @Synchronized fun openMode(id: Long): Boolean {
        if (!matches(id)) return false
        mutable.value = mutable.value.copy(modeActive = true)
        publish()
        return true
    }

    @Synchronized fun closeMode(id: Long): Boolean {
        if (!matches(id)) return false
        attempt { document?.endStroke() ?: false }
        mutable.value = mutable.value.copy(modeActive = false)
        publish()
        return true
    }

    @Synchronized fun setTool(id: Long, tool: OutdoorDrawingTool): Boolean = select(id) { it.copy(tool = tool) }
    @Synchronized fun setColor(id: Long, color: OutdoorDrawingColor): Boolean = select(id) { it.copy(color = color) }
    @Synchronized fun setWidth(id: Long, width: OutdoorDrawingWidth): Boolean = select(id) { it.copy(width = width) }

    @Synchronized fun beginStroke(id: Long, x: Float, y: Float): Boolean = edit(id) {
        it.beginStroke(OutdoorDrawingPoint(x, y), mutable.value.tool, mutable.value.color, mutable.value.width)
    }
    @Synchronized fun appendStroke(id: Long, x: Float, y: Float): Boolean = edit(id) { it.appendStroke(OutdoorDrawingPoint(x, y)) }
    @Synchronized fun endStroke(id: Long): Boolean {
        if (!matches(id)) return false
        return attempt { document?.endStroke() ?: false }
    }
    @Synchronized fun undo(id: Long): Boolean = edit(id) { it.undo() }
    @Synchronized fun clear(id: Long): Boolean = edit(id) { it.clear() }

    /** Called on GL's hold acknowledgement with the snapshot actually drawn in its previous
     * successful OUTPUT pass. Re-holding a failed probe cannot replace that published pin. */
    @Synchronized fun freezeOutput(id: Long, snapshot: OutdoorDrawingSnapshot? = null,
        reason: OutdoorDrawingHoldReason = OutdoorDrawingHoldReason.NETWORK): Long {
        if (!matches(id) || !visible) return 0L
        if (!outputLocked) {
            pinnedOutput = snapshot?.takeIf { it.sessionId == id && it.retryGeneration == mutable.value.retryGeneration }
                ?: lastOutput ?: draftSnapshot()
            outputLocked = true
        }
        if (reason == OutdoorDrawingHoldReason.NETWORK) networkHold = true
        holdToken++
        publish()
        return holdToken
    }

    @Synchronized fun confirmLive(id: Long, token: Long): Boolean {
        if (!matches(id) || !visible || !cameraPrepared || !outputLocked || !networkHold || token != holdToken || manualReturnArmed) return false
        outputLocked = false; networkHold = false; pinnedOutput = null
        publish()
        return true
    }

    @Synchronized fun networkRecoveryPending(id: Long): Boolean = matches(id) && outputLocked && networkHold

    /** A return request keeps both render passes hidden until the actual camera-ready callback. */
    @Synchronized fun setVideoHidden(id: Long, hidden: Boolean): Boolean {
        if (!matches(id)) return false
        attempt { document?.endStroke() ?: false }
        cameraPrepared = false
        if (hidden) {
            visible = false; manualReturnArmed = true; manualReturnRequested = false
            holdToken++ // Invalidates the probe success callback that predates manual hide.
        } else if (manualReturnArmed) {
            manualReturnRequested = true
        }
        publish()
        return true
    }

    @Synchronized fun cameraReady(id: Long): Boolean {
        if (!matches(id)) return false
        if (manualReturnArmed) {
            if (!manualReturnRequested) return false
            visible = true; outputLocked = false; networkHold = false; pinnedOutput = null
            manualReturnArmed = false; manualReturnRequested = false
            holdToken++
        }
        cameraPrepared = true
        // Only a fault-only pin can clear on real camera recovery. A preexisting network pin wins.
        if (outputLocked && !networkHold) {
            outputLocked = false; pinnedOutput = null; holdToken++
        }
        publish()
        return true
    }

    @Synchronized fun snapshot(forPreview: Boolean): OutdoorDrawingSnapshot? {
        if (sessionId == 0L || !visible) return null
        val chosen = if (mutable.value.error.isNotEmpty()) lastOutput
            else if (forPreview && outputLocked && mutable.value.modeActive) draftSnapshot()
            else if (outputLocked) pinnedOutput
            else if (forPreview) lastOutput ?: draftSnapshot()
            else draftSnapshot()
        return (chosen ?: lastOutput)?.let {
            if (it.retryGeneration == mutable.value.retryGeneration) it else it.copy(retryGeneration = mutable.value.retryGeneration)
        }
    }

    @Synchronized fun acknowledgeOutput(snapshot: OutdoorDrawingSnapshot): Boolean {
        if (!matches(snapshot.sessionId) || !visible || snapshot.retryGeneration != mutable.value.retryGeneration) return false
        if (outputLocked && snapshot.revision != pinnedOutput?.revision) return false
        if (!outputLocked && snapshot.revision < (lastOutput?.revision ?: -1L)) return false
        lastOutput = snapshot
        publish()
        return true
    }

    @Synchronized fun fail(id: Long, message: String, retryGeneration: Long? = null): Boolean {
        if (!matches(id) || (retryGeneration != null && retryGeneration != mutable.value.retryGeneration)) return false
        mutable.value = mutable.value.copy(error = message)
        publish()
        return true
    }

    @Synchronized fun retry(id: Long): Boolean {
        if (!matches(id)) return false
        mutable.value = mutable.value.copy(error = "", retryGeneration = mutable.value.retryGeneration + 1L)
        return attempt {
            if (document == null) document = documentFactory(frameWidth, frameHeight) else document!!.rebuild()
            true
        }
    }

    private fun matches(id: Long) = id != 0L && id == sessionId
    private fun select(id: Long, change: (OutdoorDrawingState) -> OutdoorDrawingState): Boolean {
        if (!matches(id)) return false
        attempt { document?.endStroke() ?: false }
        mutable.value = change(mutable.value)
        publish()
        return true
    }
    private fun edit(id: Long, change: (OutdoorDrawingDocument) -> Boolean): Boolean {
        if (!matches(id) || !mutable.value.editEnabled) return false
        return attempt { document?.let(change) ?: false }
    }
    private fun attempt(change: () -> Boolean): Boolean {
        val result = try { change() } catch (_: RuntimeException) {
            mutable.value = mutable.value.copy(error = "手書き映像を更新できませんでした。再試行してください。")
            false
        } catch (_: OutOfMemoryError) {
            mutable.value = mutable.value.copy(error = "手書き映像のメモリを確保できませんでした。再試行してください。")
            false
        }
        publish()
        return result
    }
    private fun draftSnapshot(): OutdoorDrawingSnapshot? {
        var result: OutdoorDrawingSnapshot? = null
        attempt {
            document?.let { result = OutdoorDrawingSnapshot(sessionId, it.revision, it.bitmapSnapshot(), mutable.value.retryGeneration) }
            result != null
        }
        return result
    }
    private fun publish() {
        val current = mutable.value
        val draftRevision = document?.revision ?: 0L
        mutable.value = current.copy(
            canUndo = document?.canUndo == true,
            hasDrawing = document?.hasDrawing == true,
            editEnabled = current.active && current.modeActive && visible && cameraPrepared && current.error.isEmpty() && document != null,
            pending = outputLocked && visible && draftRevision != (pinnedOutput?.revision ?: 0L),
            draftRevision = draftRevision,
            outputRevision = lastOutput?.revision ?: 0L,
        )
    }
}

object OutdoorDrawingRuntime {
    val controller = OutdoorDrawingController()
    val state = controller.state
}
