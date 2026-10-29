package jp.casmate.app.obs

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.CasMateTheme
import jp.casmate.app.ui.readingActive
import jp.casmate.app.MainActivity
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.audio.AudioServiceState
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** Isolated synthetic-image device QA. Never reads or changes saved registration or starts services. */
@RunWith(AndroidJUnit4::class)
class ObsProgramPreviewDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    @Test fun nativeJpegAssemblyAndBothThemesKeepButtonsStableAtDoubleText() {
        val bitmap = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(40, 100, 160)) }
        val bytes = ByteArrayOutputStream().apply { bitmap.compress(Bitmap.CompressFormat.JPEG, 75, this) }.toByteArray()
        val id = "abcdefghijklmnopqrstuvwx"
        val meta = org.json.JSONObject().put("imageId", id).put("sceneName", "確認用の合成映像").put("capturedAt", "2026-10-14T00:00:00Z")
            .put("width", 640).put("height", 360).put("byteLength", bytes.size).put("mimeType", "image/jpeg")
        val receiver = ObsProgramImageReceiver(7); receiver.begin(meta)
        var complete = false
        bytes.asList().chunked(1024).forEachIndexed { index, chunk ->
            complete = receiver.accept(ByteBuffer.allocate(36 + chunk.size).putInt(0x434d4931).putInt(7).putInt(index * 1024)
                .put(id.toByteArray(Charsets.US_ASCII)).put(chunk.toByteArray()).array())
        }
        assertTrue(complete); val image = receiver.decode(); assertEquals(640, image.bitmap.width)
        val state = mutableStateOf(ObsProgramPreviewState(open = true, working = true, message = "OBS映像を取得中…"))
        val appearance = mutableStateOf(AppearanceMode.LIGHT); val font = mutableFloatStateOf(1f)
        var updates = 0; var closes = 0
        ui.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, font.floatValue)) {
                CasMateTheme(appearance.value) { Surface(Modifier.fillMaxSize()) {
                    ObsProgramPreviewContent(state.value, true, null, { updates++ }, { closes++ })
                } }
            }
        }
        for (mode in AppearanceMode.entries) for (scale in listOf(1f, 2f)) {
            ui.runOnIdle { appearance.value = mode; font.floatValue = scale; state.value = ObsProgramPreviewState(open = true, working = true, message = "OBS映像を取得中…") }
            val update = ui.onNodeWithTag("OBS画像・更新").fetchSemanticsNode().boundsInRoot
            val close = ui.onNodeWithTag("OBS画像・閉じる").fetchSemanticsNode().boundsInRoot
            ui.onNodeWithTag("OBS画像・更新").assertIsNotEnabled()
            for (result in listOf(ObsProgramPreviewState(open = true, image = image),
                ObsProgramPreviewState(open = true, message = "取得できません。接続と操作許可を確認してください。".repeat(10)))) {
                ui.runOnIdle { state.value = result }
                ui.onNodeWithTag("OBS画像・更新").assertIsDisplayed().assertIsEnabled()
                ui.onNodeWithTag("OBS画像・閉じる").assertIsDisplayed()
                assertEquals(update, ui.onNodeWithTag("OBS画像・更新").fetchSemanticsNode().boundsInRoot)
                assertEquals(close, ui.onNodeWithTag("OBS画像・閉じる").fetchSemanticsNode().boundsInRoot)
            }
            ui.runOnIdle { state.value = ObsProgramPreviewState(open = true, image = image) }
            ui.onNodeWithContentDescription("OBSで合成した映像の静止画").assertIsDisplayed()
            ui.waitForIdle()
            val screenshot = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            java.io.File(context.getExternalFilesDir(null), "obs-preview-${mode.storedValue}-$scale.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            ui.onNodeWithTag("OBS画像・更新").performClick(); ui.onNodeWithTag("OBS画像・閉じる").performClick()
        }
        assertEquals(4, updates); assertEquals(4, closes)
    }
}

/** Actual application entry. Does not register a PC or start/stop any transmission. */
@RunWith(AndroidJUnit4::class)
class ObsProgramPreviewEntryDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun senderMenuOpensThePreviewAndClosingKeepsServicesUnchanged() {
        org.junit.Assume.assumeTrue(RegistrationBundleStore.loadCurrent(ui.activity)?.profiles?.isNotEmpty() == true)
        val sender = OutdoorRuntime.state.value.active
        val reading = AudioServiceState.status.value.readingActive
        org.junit.Assume.assumeTrue(!sender && !reading)
        ui.onNodeWithText("カメラ", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("機能操作の入口").performClick()
        ui.onNodeWithTag("OBS映像確認の入口").performScrollTo().performClick()
        ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        ui.onNodeWithTag("OBS画像・閉じる").assertIsDisplayed()
        ui.onNodeWithTag("OBS画像・更新").assertIsDisplayed()
        ui.onNodeWithTag("OBS画像・閉じる").performClick()
        ui.onNodeWithTag("OBS画像領域").assertDoesNotExist()
        assertEquals(sender, OutdoorRuntime.state.value.active)
        assertEquals(reading, AudioServiceState.status.value.readingActive)
    }
}
