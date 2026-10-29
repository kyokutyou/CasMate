package jp.casmate.app.outdoor

import android.graphics.Color
import android.graphics.Typeface
import com.pedro.encoder.input.gl.render.RenderMode
import com.pedro.encoder.input.gl.render.filters.`object`.TextFilterRender
import com.pedro.encoder.utils.gl.TranslateTo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Samples the device clock at most once per second. The output filter publishes the
 * frame's label and the preview filter reads that snapshot without sampling time.
 */
internal class OutdoorTimestampClock(
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
    private val elapsedMillis: () -> Long = { android.os.SystemClock.elapsedRealtime() },
    private val localTimeZone: () -> TimeZone = { TimeZone.getDefault() },
) {
    private val formatter = SimpleDateFormat("HH:mm:ss", Locale.ROOT)
    private var displayedSecond = Long.MIN_VALUE
    private var displayedZoneId = ""
    private var lastUpdateElapsed: Long? = null
    private var displayValue = ""
    private var frozenValue: String? = null

    @Synchronized
    fun currentTime(): String {
        frozenValue?.let { return it }
        val now = nowMillis()
        val elapsed = elapsedMillis()
        val lastUpdate = lastUpdateElapsed
        if (displayValue.isNotEmpty() && lastUpdate != null && elapsed - lastUpdate < 1000L) return displayValue

        val zone = localTimeZone()
        val second = Math.floorDiv(now, 1000L)
        val zoneChanged = zone.id != displayedZoneId
        if (displayValue.isEmpty() || second != displayedSecond || zoneChanged) {
            formatter.timeZone = zone
            displayValue = formatter.format(Date(now))
            displayedSecond = second
            displayedZoneId = zone.id
            lastUpdateElapsed = elapsed
        }
        return displayValue
    }

    @Synchronized
    fun currentSnapshot(): String = displayValue

    /** Called on the GL hold acknowledgement, before this frame's overlay passes. */
    @Synchronized
    fun freezeSnapshot() {
        if (frozenValue == null) frozenValue = displayValue.ifEmpty { currentTime() }
    }

    /** Source release starts a probe; its timestamp resumes even while drawings stay pinned. */
    @Synchronized
    fun resumeSnapshot() {
        frozenValue = null
        lastUpdateElapsed = null
    }
}

/** Applies a clock snapshot to one of RootEncoder's output or preview render passes. */
internal class OutdoorTimestampFilter(
    private val clock: OutdoorTimestampClock,
    private val samplesClock: Boolean,
    mode: RenderMode,
) : TextFilterRender() {
    @Volatile private var overlayVisible = true
    private var lastText = "00:00:00"

    init {
        renderMode = mode
        setScale(24f, 6f)
        setPosition(TranslateTo.BOTTOM_LEFT)
        setText(lastText, TEXT_SIZE, Color.WHITE, BACKGROUND, Typeface.MONOSPACE)
        alpha = 0f
    }

    fun setOverlayVisible(visible: Boolean) {
        overlayVisible = visible
    }

    override fun draw() {
        val text = runCatching {
            if (samplesClock) clock.currentTime() else clock.currentSnapshot()
        }.getOrNull()
        alpha = if (overlayVisible && text != null) 1f else 0f
        if (overlayVisible && text != null && text != lastText) {
            try {
                setText(text, TEXT_SIZE, Color.WHITE, BACKGROUND, Typeface.MONOSPACE)
                lastText = text
            } catch (_: RuntimeException) {
                // Keep drawing the source with a transparent overlay if label rendering fails.
                alpha = 0f
            }
        }
        super.draw()
    }

    private companion object {
        const val TEXT_SIZE = 42f
        val BACKGROUND = Color.argb(170, 0, 0, 0)
    }
}
