package jp.casmate.app.outdoor

import android.content.pm.ActivityInfo
import android.graphics.Color
import android.view.MotionEvent
import android.view.Surface
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.pedro.encoder.input.gl.render.RenderMode
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.view.GlStreamInterface
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic GPU source; never starts capture, microphone, SRT or playback services. */
class OutdoorDrawingViewportDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()

    @Test fun enlargedAndPannedTextureShowsInkAtTheTouchedScreenPositionWithoutChangingOutput() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyDrawingUi") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val controller = OutdoorDrawingController()
        val session = controller.beginSession(320, 180)
        controller.cameraReady(session); controller.openMode(session)
        controller.setColor(session, OutdoorDrawingColor.RED)
        controller.setWidth(session, OutdoorDrawingWidth.THICK)
        val gl = GlStreamInterface(context)
        val orientation = ui.activity.requestedOrientation
        var surface: Surface? = null
        lateinit var view: OutdoorPreviewView
        try {
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(true); ui.activity.setTurnScreenOn(true)
                ui.activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                ui.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
            ui.waitUntil(5_000) { ui.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(true); ui.activity.setTurnScreenOn(true)
                ui.activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            gl.autoHandleOrientation = false; gl.setEncoderSize(320, 180); gl.setIsPortrait(false)
            gl.setAspectRatioMode(AspectRatioMode.Adjust); gl.start()
            ui.waitUntil(5_000) { gl.isRunning }
            gl.surfaceTexture.setDefaultBufferSize(320, 180)
            gl.addFilter(OutdoorDrawingFilter(RenderMode.OUTPUT, { controller.snapshot(false) }, { controller.acknowledgeOutput(it) }))
            gl.addFilter(OutdoorDrawingFilter(RenderMode.PREVIEW, { controller.snapshot(true) }))
            ui.setContent {
                AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx -> OutdoorPreviewView(ctx).also {
                    view = it; it.drawingMode = true; it.drawingEnabled = true
                    it.drawingOutputWidth = 320; it.drawingOutputHeight = 180
                    it.drawingViewport = OutdoorDrawingViewport(zoom = 3f, panX = .1f, initialized = true)
                    it.onDrawingStart = { x, y -> controller.beginStroke(session, x, y) }
                    it.onDrawingMove = { x, y -> controller.appendStroke(session, x, y) }
                    it.onDrawingEnd = { controller.endStroke(session) }
                } })
            }
            ui.waitUntil(5_000) { view.isAvailable && view.width > 0 && view.height > 0 }
            ui.runOnUiThread {
                surface = Surface(view.surfaceTexture)
                gl.attachPreview(surface); gl.setPreviewResolution(view.width, view.height)
            }
            fun frame(): android.graphics.Bitmap {
                val latch = CountDownLatch(1)
                var result: android.graphics.Bitmap? = null
                gl.takePhoto { result = it; latch.countDown() }
                val canvas = gl.surface.lockCanvas(null); canvas.drawColor(Color.BLUE); gl.surface.unlockCanvasAndPost(canvas)
                assertTrue(latch.await(5, TimeUnit.SECONDS))
                awaitGlPhotoConsumed(gl)
                return checkNotNull(result)
            }
            repeat(4) { frame().recycle() }
            val x = view.width * .7f; val y = view.height * .5f
            val expected = view.drawingViewport!!.geometry(view.width.toFloat(), view.height.toFloat(), 320, 180).point(x, y)!!
            ui.runOnUiThread {
                for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                    val properties = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER })
                    val coordinates = arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f })
                    val event = MotionEvent.obtain(0, 20, action, 1, properties, coordinates,
                        0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
                    try { assertTrue(view.onTouchEvent(event)) } finally { event.recycle() }
                }
            }
            repeat(3) { frame().recycle() }
            val encoded = frame()
            try {
                assertEquals(320, encoded.width); assertEquals(180, encoded.height)
                val pixel = encoded.getPixel((expected.x * 320).toInt(), (expected.y * 180).toInt())
                assertTrue(Color.red(pixel) > 240 && Color.blue(pixel) < 20)
            } finally { encoded.recycle() }
            val location = IntArray(2)
            ui.runOnUiThread { view.getLocationOnScreen(location) }
            ui.waitUntil(5_000) {
                val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                if (bitmap == null) false else try {
                    val pixel = bitmap.getPixel(location[0] + x.toInt(), location[1] + y.toInt())
                    Color.red(pixel) > 240 && Color.blue(pixel) < 20
                } finally { bitmap.recycle() }
            }
        } finally {
            gl.stop(); surface?.release(); controller.endSession(session)
            ui.runOnUiThread {
                ui.activity.setShowWhenLocked(false); ui.activity.setTurnScreenOn(false)
                ui.activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                ui.activity.requestedOrientation = orientation
            }
        }
    }
}
