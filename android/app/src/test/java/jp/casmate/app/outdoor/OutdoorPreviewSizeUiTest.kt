package jp.casmate.app.outdoor

import android.app.Activity
import android.graphics.Matrix
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.encoder.utils.gl.SizeCalculator
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.CasMateTabs
import jp.casmate.app.ui.CasMateTheme
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.min

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorPreviewSizeUiTest {
    @get:Rule val ui = createComposeRule()
    @After fun reset() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun normalCameraFitsTheRotatedVideoToTheWholeBodyInEveryDirection() {
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending"))
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { OutdoorPanel(onOpenConnection = {}) })
            }
        } }
        val body = ui.onNodeWithTag("外配信プレビュー").fetchSemanticsNode().boundsInRoot
        val initial = previewView()
        for (portrait in listOf(false, true)) for (rotation in listOf(0, 90, 180, 270)) {
            ui.runOnIdle {
                OutdoorRuntime.update(OutdoorRuntime.state.value.copy(portrait = portrait))
                initial.previewRotation = rotation
            }
            ui.runOnIdle {
                val view = previewView()
                assertSame(initial, view)
                val outputWidth = if (portrait) 720 else 1280
                val outputHeight = if (portrait) 1280 else 720
                val fitted = SizeCalculator.calculateViewPort(AspectRatioMode.Adjust,
                    view.width, view.height, outputWidth, outputHeight)
                val video = RectF(fitted.x.toFloat(), (view.height - fitted.y - fitted.height).toFloat(),
                    (fitted.x + fitted.width).toFloat(), (view.height - fitted.y).toFloat())
                view.getTransform(Matrix()).mapRect(video)
                val rotatedWidth = if (rotation % 180 == 0) outputWidth else outputHeight
                val rotatedHeight = if (rotation % 180 == 0) outputHeight else outputWidth
                val fit = min(body.width / rotatedWidth, body.height / rotatedHeight)
                assertEquals("Video width: portrait=$portrait rotation=$rotation", rotatedWidth * fit, video.width(), 2f)
                assertEquals("Video height: portrait=$portrait rotation=$rotation", rotatedHeight * fit, video.height(), 2f)
                assertTrue(video.left >= -1f && video.top >= -1f)
                assertTrue(video.right <= view.width + 1f && video.bottom <= view.height + 1f)
                assertEquals(portrait, OutdoorRuntime.state.value.portrait)
                assertEquals(OutdoorQuality(), OutdoorRuntime.state.value.quality)
            }
            assertEquals(body, ui.onNodeWithTag("外配信プレビュー").fetchSemanticsNode().boundsInRoot)
        }
    }

    private fun previewView(): OutdoorPreviewView {
        fun find(view: View): OutdoorPreviewView? {
            if (view is OutdoorPreviewView) return view
            if (view is ViewGroup) for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
            return null
        }
        val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single() as Activity
        return checkNotNull(find(activity.window.decorView))
    }
}
