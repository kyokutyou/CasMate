package jp.casmate.app.outdoor

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.obs.*
import jp.casmate.app.ui.CasMateTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorCameraUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun actualHiddenBlackAndFixedImageKeepBrightStatusTextWithoutCards() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val imageFile = java.io.File(context.filesDir, "outdoor-placeholder.png")
        val original = if (imageFile.exists()) imageFile.readBytes() else null
        val bitmap = android.graphics.Bitmap.createBitmap(320, 560, android.graphics.Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.rgb(32, 76, 122))
        imageFile.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        try {
            OutdoorRuntime.update(OutdoorState(active = true, status = "sending", inputLost = false,
                videoHidden = true, videoBlack = true, portrait = true))
            compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
                Box(Modifier.width(320.dp).height(560.dp)) { OutdoorPanel(onOpenConnection = {}) }
            } }
            for (black in listOf(true, false)) {
                compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoBlack = black)) }
                compose.onNodeWithContentDescription(if (black) "送信中の黒画面" else "送信中の固定画像").assertExists()
                val text = compose.onNodeWithText("背面カメラ・1.0×").fetchSemanticsNode().boundsInRoot
                val rendered = compose.onRoot().captureToImage().asAndroidBitmap()
                var brightPixels = 0
                for (y in text.top.toInt() until text.bottom.toInt()) for (x in text.left.toInt() until text.right.toInt()) {
                    val pixel = rendered.getPixel(x, y)
                    if (android.graphics.Color.red(pixel) > 235 && android.graphics.Color.green(pixel) > 235 && android.graphics.Color.blue(pixel) > 235) brightPixels++
                }
                assertTrue("Actual hidden preview must retain bright camera label ink", brightPixels > 20)
                val status = compose.onNodeWithTag("プレビュー送信状態").fetchSemanticsNode().boundsInRoot
                assertEquals(if (black) android.graphics.Color.BLACK else android.graphics.Color.rgb(32, 76, 122),
                    rendered.getPixel((status.right - 3).toInt(), status.center.y.toInt()))
            }
        } finally {
            OutdoorRuntime.update(OutdoorState())
            if (original == null) imageFile.delete() else imageFile.writeBytes(original)
        }
    }

    @Test fun overlayPaddingRevealsTheUnderlyingBrightAndDarkPreviewInBothThemes() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val background = mutableStateOf(androidx.compose.ui.graphics.Color(0xFF204C7A))
        compose.setContent { CasMateTheme(mode.value) {
            Box(Modifier.width(320.dp).height(760.dp).background(background.value)) {
                OutdoorPreviewBadges(OutdoorState(active = true, status = "sending"), false, null, "準備済み")
            }
        } }
        for (appearance in AppearanceMode.entries) for (color in listOf(
            androidx.compose.ui.graphics.Color(0xFF204C7A), androidx.compose.ui.graphics.Color(0xFFE4D18A))) {
            compose.runOnIdle { mode.value = appearance; background.value = color }
            val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
            for (tag in listOf("プレビューカメラ表示", "プレビュー送信状態", "プレビューマイク表示", "プレビューOBS表示")) {
                val bounds = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
                assertEquals("Status padding must show the preview: $tag", color.toArgb(),
                    bitmap.getPixel((bounds.right - 3).toInt(), bounds.center.y.toInt()))
            }
            val capture = java.io.File("build/reports/layout/camera-transparent-${appearance.storedValue}-${color.toArgb()}.png")
            checkNotNull(capture.parentFile).mkdirs()
            capture.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    @Test fun previewKeepsVideoAndMeasurementReasonsVisibleWithoutMovingTheRateOrCanvas() {
        val base = OutdoorState(active = true, status = "sending", inputLost = false,
            quality = OutdoorQuality(bitrateMode = OutdoorBitrateMode.AUTO),
            statistics = OutdoorStatistics(bitrate = 2100000.0),
            adaptation = OutdoorAdaptationView(500000, diagnostics = OutdoorAdaptationDiagnostics(reason = OutdoorAdaptationReason.STABLE)))
        val state = mutableStateOf(base)
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Box(Modifier.width(320.dp).height(760.dp)) {
            OutdoorPreviewBadges(state.value, false, null, "準備済み")
        } } }
        val bounds = compose.onNodeWithTag("プレビュー送信状態").fetchSemanticsNode().boundsInRoot
        val cases = listOf(
            base.copy(adaptation = base.adaptation.copy(phase = OutdoorAdaptationPhase.LOW_VIDEO)),
            base.copy(adaptation = base.adaptation.copy(trend = OutdoorBitrateTrend.STARTING)),
            base.copy(adaptation = base.adaptation.copy(trend = OutdoorBitrateTrend.REDUCED)),
            base.copy(adaptation = base.adaptation.copy(trend = OutdoorBitrateTrend.RECOVERING)),
            base.copy(adaptation = base.adaptation.copy(target = base.quality.autoMaxBitrate)),
            base.copy(adaptation = base.adaptation.copy(diagnostics = base.adaptation.diagnostics.copy(reason = OutdoorAdaptationReason.NOT_STARTED))),
            base.copy(adaptation = base.adaptation.copy(diagnostics = base.adaptation.diagnostics.copy(reason = OutdoorAdaptationReason.UNAVAILABLE))),
        )
        for (next in cases) {
            compose.runOnIdle { state.value = next }
            compose.onNodeWithTag("プレビュー映像理由").assertTextEquals(next.videoStatusText()).assertIsDisplayed()
            compose.onNodeWithText("送信中・2.10 Mbps").assertIsDisplayed()
            assertEquals(bounds, compose.onNodeWithTag("プレビュー送信状態").fetchSemanticsNode().boundsInRoot)
        }
    }

    @Test fun stopNeedsConfirmationAndNormalControlsNeverAddResultRows() {
        var stops = 0
        var mutes = 0
        var video = 0
        val state = mutableStateOf(OutdoorState(active = true, status = "sending", inputLost = false))
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Column {
            OutdoorSenderControls(state.value, "準備済み", null, { mutes++ }, { video++ })
            OutdoorSenderAction(state.value.active, true, {}, { stops++ })
        } } }
        val action = compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("送信を停止").assertIsDisplayed()
        compose.onNodeWithText("マイクミュート").performClick()
        compose.onNodeWithText("映像を隠す").performClick()
        assertEquals(1, mutes); assertEquals(1, video)
        compose.onNodeWithTag("カメラ・送信操作").performClick()
        assertEquals(0, stops)
        compose.onNodeWithText("キャンセル").performClick()
        assertEquals(0, stops)
        compose.onNodeWithTag("カメラ・送信操作").performClick()
        compose.onNodeWithTag("送信停止確認・実行").performClick()
        assertEquals(1, stops)
        compose.runOnIdle { state.value = state.value.copy(manualMute = true, videoHidden = true) }
        compose.onNodeWithText("ミュート解除").assertExists()
        compose.onNodeWithText("カメラに戻す").assertExists()
        assertEquals(action, compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("読み上げを聞く").assertDoesNotExist()
        compose.onNodeWithText("ミュートしました", substring = true).assertDoesNotExist()
    }

    @Test fun disconnectLongErrorsAndAppearanceDoNotMoveCameraOrObsActions() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val state = mutableStateOf(OutdoorState(active = true, status = "sending", inputLost = false))
        val error = mutableStateOf<String?>(null)
        val registration = CasMateRegistration.parse(javaClass.classLoader!!.getResource("smartphone-registration-v12.json")!!.readText()).getOrThrow().obsControl!!
        val obs = mutableStateOf(ObsControlUiState(registration = registration, network = ObsControlRegistration.Network.LAN,
            remote = ObsRemoteState("epoch", 1, "connected", "streaming", false, null)))
        compose.setContent { CasMateTheme(mode.value) { Surface(color = MaterialTheme.colorScheme.background) {
            Column {
                OutdoorSenderControls(state.value, "準備済み", error.value, {}, {})
                OutdoorSenderAction(state.value.active, true, {}, {})
                ObsControlActions(obs.value, {}, {})
            }
        } } }
        val tags = listOf("カメラ・ミュート", "カメラ・映像切替", "カメラ状態", "カメラ・送信操作", "OBS配信操作")
        val before = tags.associateWith { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
        compose.onNodeWithTag("カメラ・送信操作").assertIsDisplayed()
        compose.onNodeWithText("OBS配信を終了").assertIsEnabled()
        compose.runOnIdle {
            state.value = state.value.copy(status = "reconnecting", inputLost = true)
            error.value = "通信の長い失敗説明です。".repeat(80)
            obs.value = obs.value.copy(remote = null, error = "OBS操作の結果が不明です。".repeat(80))
        }
        compose.onNodeWithText("OBS配信を開始").assertIsNotEnabled()
        tags.forEach { assertEquals(it, before[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
        compose.runOnIdle { mode.value = AppearanceMode.DARK }
        tags.forEach { assertEquals(it, before[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
        val capture = java.io.File("build/reports/layout/android-camera-controls-dark.png")
        checkNotNull(capture.parentFile).mkdirs()
        capture.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        compose.runOnIdle {
            state.value = state.value.copy(status = "sending", inputLost = false)
            error.value = null
            obs.value = obs.value.copy(remote = ObsRemoteState("epoch", 2, "connected", "streaming", false, null), error = null)
        }
        tags.forEach { assertEquals(it, before[it], compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot) }
        // The same controls now live in the temporary menu; geometry is tested above and in CompactScreenLayoutTest.
        compose.onNodeWithTag("カメラ・送信操作").assertIsDisplayed()
    }

    @Test fun heldControlFailureAndRateRemainVisibleWithAnExplicitRetry() {
        var retries = 0
        val state = OutdoorState(active = true, status = "sending", inputLost = false,
            adaptation = OutdoorAdaptationView(target = 1200, phase = OutdoorAdaptationPhase.HELD, controlStopped = true))
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface { Column {
            OutdoorSenderControls(state, "準備済み", null, {}, {}, onRetryAdaptation = { retries++ })
        } } } }
        compose.onNodeWithText("実送信", substring = true).assertIsDisplayed()
        compose.onNodeWithText("復帰試行は自動制御停止中").assertIsDisplayed()
        compose.onNodeWithText("自動制御を再試行").performClick()
        assertEquals(1, retries)
    }
}
