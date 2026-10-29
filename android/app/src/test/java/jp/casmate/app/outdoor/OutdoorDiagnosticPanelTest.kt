package jp.casmate.app.outdoor

import android.net.Uri
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityOptionsCompat
import jp.casmate.app.ui.CasMateTabs
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorDiagnosticPanelTest {
    @get:Rule val compose = createComposeRule()
    private val sending = OutdoorState(active = true, status = "sending", inputLost = false,
        quality = OutdoorQuality(bitrateMode = OutdoorBitrateMode.AUTO, audioFirst = true),
        statistics = OutdoorStatistics(bitrate = 2100000.0),
        adaptation = OutdoorAdaptationView(700000, acceptedTarget = 500000, generatedBitrate = 420000,
            diagnostics = OutdoorAdaptationDiagnostics(reason = OutdoorAdaptationReason.STABLE, comparable = true)))

    @After fun reset() {
        RuntimeEnvironment.setFontScale(1f)
        OutdoorDiagnosticExport.save(RuntimeEnvironment.getApplication().contentResolver, null)
        OutdoorDiagnosticHistory.begin(0, OutdoorQuality(), false, false)
        OutdoorRuntime.update(OutdoorState())
    }

    @Composable private fun Host(state: OutdoorState = sending) {
        var open by rememberSaveable { mutableStateOf(false) }
        Button(onClick = { open = true }) { Text("通信詳細") }
        OutdoorDiagnosticPanel(state, open, { open = false }, {})
    }

    private fun open() = compose.onNodeWithText("通信詳細").performClick()
    private fun row(label: String) = compose.onNodeWithTag("診断項目・$label")
    private fun scrollValue(tab: String) = compose.onNodeWithTag("診断本文・$tab").fetchSemanticsNode()
        .config[SemanticsProperties.VerticalScrollAxisRange].value()
    private fun assertTextFits(text: String) {
        val results = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        assertTrue("Text layout missing: $text", results.isNotEmpty())
        results.forEach { assertFalse("Text clipped: $text", it.hasVisualOverflow) }
    }
    private fun capture(name: String) {
        val file = java.io.File("build/reports/layout/$name.png")
        checkNotNull(file.parentFile).mkdirs()
        file.outputStream().use { compose.onNodeWithTag("通信診断パネル").captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun categoryAndIndependentScrollPositionsSurviveCloseAndRecreation() {
        val restore = StateRestorationTester(compose)
        restore.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { Host() } }
        open()
        compose.onNodeWithText("概要").assertIsSelected()
        compose.onNodeWithText("自動調整").performClick()
        row("受付済み映像目標").performScrollTo().assertTextContains("0.50 Mbps")
        row("要求した映像目標").performScrollTo().assertTextContains("0.70 Mbps")
        row("映像生成量").performScrollTo().assertTextContains("0.42 Mbps")
        row("試行動画のPC受信").performScrollTo()
        val adaptationScroll = scrollValue("自動調整")
        compose.onNodeWithText("通信").performClick()
        row("音声破棄（増分）").performScrollTo()
        val transportScroll = scrollValue("通信")
        assertTrue(transportScroll > 0)
        compose.onNodeWithText("診断を閉じる").performClick()
        open()
        compose.onNodeWithText("通信").assertIsSelected()
        assertEquals(transportScroll, scrollValue("通信"))
        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("通信").assertIsSelected()
        assertEquals(transportScroll, scrollValue("通信"))
        compose.onNodeWithText("自動調整").performClick()
        assertEquals(adaptationScroll, scrollValue("自動調整"))
    }

    @Test fun panelCanDismissWithBackOutsideTapAndDownwardSwipe() {
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { Host() } }
        open()
        compose.runOnIdle { (ShadowDialog.getLatestDialog() as androidx.activity.ComponentDialog).onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithTag("通信診断パネル").assertDoesNotExist()
        open()
        compose.onNode(isDialog()).performTouchInput { click(androidx.compose.ui.geometry.Offset(width / 2f, 2f)) }
        compose.onNodeWithTag("通信診断パネル").assertDoesNotExist()
        open()
        compose.onNodeWithText("通信・診断").performTouchInput {
            swipe(center, center + androidx.compose.ui.geometry.Offset(0f, 1200f), 300)
        }
        compose.onNodeWithTag("通信診断パネル").assertDoesNotExist()
    }

    @Test fun largeTextAndLongErrorsKeepHeaderReachableAndPreserveScrollOnLiveUpdates() {
        RuntimeEnvironment.setFontScale(2f)
        val current = mutableStateOf(sending)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { Host(current.value) }
            }
        }
        open()
        val closeBounds = compose.onNodeWithText("診断を閉じる").fetchSemanticsNode().boundsInRoot
        row("実送信ビットレート").performScrollTo().assertTextContains("2.10 Mbps")
        val scroll = scrollValue("概要")
        compose.runOnIdle { current.value = current.value.copy(videoError = "映像処理の長い失敗説明です。".repeat(40),
            statistics = OutdoorStatistics(bitrate = 10500000.0), videoFaults = setOf(OutdoorVideoFault.CODEC)) }
        assertEquals(closeBounds, compose.onNodeWithText("診断を閉じる").fetchSemanticsNode().boundsInRoot)
        assertEquals(scroll, scrollValue("概要"))
        row("実送信ビットレート").assertTextContains("10.50 Mbps")
        capture("outdoor-diagnostic-large-text")
        compose.onNodeWithText("履歴").performClick()
        compose.onNodeWithText("数値診断を書き出す").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("診断を閉じる").assertIsDisplayed()
    }

    @Test fun stoppedSessionKeepsHistoryAndDeveloperScenarioIsCollapsed() {
        OutdoorDiagnosticHistory.begin(1000, OutdoorQuality(), false, false)
        OutdoorDiagnosticHistory.record(1250, null, OutdoorAdaptationView(500000), false, null)
        OutdoorDiagnosticHistory.stop(1500)
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { Host(OutdoorState()) } }
        open()
        row("実送信ビットレート").performScrollTo().assertTextContains("停止中")
        compose.onNodeWithText("履歴").performClick()
        row("数値履歴").performScrollTo().assertTextContains("1件")
        row("対象期間（開始から）").performScrollTo().assertTextContains("0.3秒 ～ 0.3秒")
        compose.onNodeWithText("数値診断を書き出す").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("開発用：低下・静止・復帰を確認").assertDoesNotExist()
        compose.onNodeWithText("開発用").performScrollTo().performClick()
        compose.onNodeWithText("開発用：低下・静止・復帰を確認").performScrollTo().assertIsNotEnabled()
    }

    @Test fun documentResultSurvivesPanelClosureTabChangeAndRecreation() {
        val registry = object : ActivityResultRegistry() {
            var request = -1
            override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
                request = requestCode
            }
        }
        val owner = object : ActivityResultRegistryOwner { override val activityResultRegistry = registry }
        OutdoorDiagnosticHistory.begin(1000, OutdoorQuality(), false, false)
        OutdoorDiagnosticHistory.record(1250, null, OutdoorAdaptationView(500000), false, null)
        val restore = StateRestorationTester(compose)
        restore.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { CasMateTabs( { Text("コメント本文") }, { export ->
                    OutdoorPanel(onOpenConnection = {}, onExportDiagnostics = export)
                }) }
            }
        }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").performScrollTo().performClick()
        compose.onNodeWithText("履歴").performClick()
        compose.onNodeWithText("数値診断を書き出す").performScrollTo().performClick()
        assertTrue(OutdoorDiagnosticExport.state.value.busy)
        assertTrue(registry.request >= 0)
        compose.onNodeWithText("書き出し中").assertIsNotEnabled()
        compose.onNodeWithText("診断を閉じる").performClick()
        compose.onNodeWithText("コメント").performClick()
        restore.emulateSavedInstanceStateRestore()
        compose.runOnIdle { registry.dispatchResult<Uri?>(registry.request, null) }
        compose.waitForIdle()
        assertFalse(OutdoorDiagnosticExport.state.value.busy)
        assertNotNull(OutdoorDiagnosticHistory.capture())
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").performScrollTo().performClick()
        compose.onNodeWithText("履歴").assertIsSelected()
        compose.onNodeWithText("書き出しをキャンセルしました").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("数値診断を書き出す").assertIsEnabled()
        // A real write uses the immutable picker-time copy even if observation continues.
        val output = java.io.File(RuntimeEnvironment.getApplication().cacheDir, "diagnostic-panel-test.json")
        compose.onNodeWithText("数値診断を書き出す").performClick()
        compose.runOnIdle {
            OutdoorDiagnosticHistory.record(1500, null, OutdoorAdaptationView(400000), false, null)
            registry.dispatchResult(registry.request, Uri.fromFile(output))
        }
        compose.waitUntil(10000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            !OutdoorDiagnosticExport.state.value.busy
        }
        assertEquals("数値診断を保存しました", OutdoorDiagnosticExport.state.value.message)
        assertEquals(1, org.json.JSONObject(output.readText()).getJSONArray("observations").length())
        assertEquals(2, OutdoorDiagnosticHistory.capture()!!.observations.size)
        // A directory cannot be an output file. Failure must leave the history retryable.
        compose.onNodeWithText("数値診断を書き出す").performScrollTo().performClick()
        compose.runOnIdle { registry.dispatchResult(registry.request, Uri.fromFile(RuntimeEnvironment.getApplication().cacheDir)) }
        compose.waitUntil(10000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            !OutdoorDiagnosticExport.state.value.busy
        }
        assertEquals("保存できませんでした。もう一度お試しください。", OutdoorDiagnosticExport.state.value.message)
        assertEquals(2, OutdoorDiagnosticHistory.capture()!!.observations.size)
        compose.onNodeWithText("数値診断を書き出す").assertIsEnabled()
    }

    @Test fun sharedHeaderDoesNotMoveForDisconnectedOrLongConnectionLabels() {
        RuntimeEnvironment.setFontScale(2f)
        val connection = mutableStateOf("Tailscale・接続済み")
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) {
            CasMateTabs({ Text("コメント本文") }, { Text("映像本文") }, connectionLabel = connection.value)
        } }
        val initial = compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
        val tabs = compose.onNodeWithTag("機能タブ").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { connection.value = "Tailscale・接続待ち・長い失敗説明".repeat(80) }
        assertEquals(initial, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(tabs, compose.onNodeWithTag("機能タブ").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { connection.value = "Tailscale・接続済み" }
        assertEquals(initial, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun overlappingFailuresKeepEachRetryInItsOwnPositionAtLargeFontSize() {
        RuntimeEnvironment.setFontScale(2f)
        val current = mutableStateOf(sending.copy(videoFaults = setOf(OutdoorVideoFault.CODEC)))
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                OutdoorVideoStatus(current.value)
                Button(onClick = {}) { Text("後続の操作") }
            }
        } }
        val video = compose.onNodeWithText("映像を再試行").fetchSemanticsNode().boundsInRoot
        val next = compose.onNodeWithText("後続の操作").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(controlStopped = true)) }
        val adaptation = compose.onNodeWithText("自動制御を再試行").fetchSemanticsNode().boundsInRoot
        assertEquals(video, compose.onNodeWithText("映像を再試行").fetchSemanticsNode().boundsInRoot)
        assertTextFits("自動制御を再試行")
        assertTextFits("映像を再試行")
        compose.runOnIdle { current.value = current.value.copy(videoFaults = emptySet()) }
        assertEquals(adaptation, compose.onNodeWithText("自動制御を再試行").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { current.value = current.value.copy(videoFaults = setOf(OutdoorVideoFault.CODEC),
            adaptation = current.value.adaptation.copy(controlStopped = false)) }
        assertEquals(video, compose.onNodeWithText("映像を再試行").fetchSemanticsNode().boundsInRoot)
        assertEquals(next, compose.onNodeWithText("後続の操作").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun longDiagnosticValueFitsAtLargeFontSizeWithoutMovingFollowingRows() {
        RuntimeEnvironment.setFontScale(2f)
        val current = mutableStateOf(sending)
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) { Host(current.value) } }
        open()
        compose.onNodeWithText("自動調整").performClick()
        row("画質増加").performScrollTo()
        val original = row("画質増加").fetchSemanticsNode().boundsInRoot
        val scroll = scrollValue("自動調整")
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(increaseBlocked = true)) }
        assertTextFits("映像量の低下が不十分・保留中")
        assertEquals(original, row("画質増加").fetchSemanticsNode().boundsInRoot)
        assertEquals(scroll, scrollValue("自動調整"))
        capture("outdoor-diagnostic-large-value")
    }

    @Test fun previewSummaryAndNormalScreenUseTheAppThemeWithoutStartingTransmission() {
        OutdoorRuntime.update(sending.copy(videoHidden = true, muted = false, statistics = OutdoorStatistics(bitrate = 2100000.0),
            adaptation = sending.adaptation.copy(diagnostics = sending.adaptation.diagnostics.copy(queued = 5, rttMs = 62.5,
                ackDelta = 3, droppedAudioDelta = 0))))
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) {
            Surface {
                CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(onOpenConnection = {}, onExportDiagnostics = export) })
            }
        } }
        fun openDisplay() {
            compose.onNodeWithTag("カメラ設定の入口").performClick()
            compose.onNodeWithTag("映像・マイク分類・画面表示").performScrollTo().performClick()
        }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
        val canvas = compose.onNodeWithTag("カメラ本文").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("2.10 Mbps", substring = true).assertExists()
        compose.onNodeWithTag("機能操作の入口").performClick()
        val stop = compose.onNodeWithTag("カメラ・送信操作").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("閉じる").performClick()
        openDisplay()
        compose.onNodeWithText("プレビューを閉じる").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()
        assertEquals(canvas, compose.onNodeWithTag("カメラ本文").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithTag("機能操作の入口").performClick()
        compose.onNodeWithTag("スマホ送信・速度").assertTextEquals("2.10 Mbps")
        assertEquals(stop, compose.onNodeWithTag("カメラ・送信操作").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("閉じる").performClick()
        openDisplay()
        compose.onNodeWithText("プレビューを表示").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithText("自動制御を再試行").assertDoesNotExist()
        compose.onNodeWithText("映像を再試行").assertDoesNotExist()
        fun screen(name: String) {
            val file = java.io.File("build/reports/layout/" + name + ".png")
            checkNotNull(file.parentFile).mkdirs()
            file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
        screen("outdoor-normal-cleanup")
        openDisplay()
        compose.onNodeWithTag("診断表示切替").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithText("PC受信確認 進行あり").assertExists()
        compose.onNodeWithText("音声破棄 +0フレーム").assertExists()
        screen("outdoor-preview-diagnostics-cleanup")
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(portrait = true)) }
        screen("outdoor-preview-diagnostics-portrait")
        assertEquals(true, OutdoorRuntime.state.value.active)
        assertEquals(true, OutdoorRuntime.state.value.videoHidden)
    }

    @Test fun previewScrollDoesNotJumpWhenRecoveryHintDisappears() {
        RuntimeEnvironment.setFontScale(2f)
        val current = mutableStateOf(sending.copy(portrait = true, adaptation = sending.adaptation.copy(
            phase = OutdoorAdaptationPhase.HELD,
            diagnostics = sending.adaptation.diagnostics.copy(nextProbeInMs = 4500))))
        compose.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) {
            OutdoorDiagnosticSummary(current.value, Modifier.width(144.dp).heightIn(max = 500.dp))
        } }
        val body = compose.onNodeWithTag("診断表示要約・本文")
        body.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 10000f) }
        compose.waitForIdle()
        fun range() = body.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        val scroll = range().value()
        val maximum = range().maxValue()
        assertTrue(scroll > 0)
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(phase = OutdoorAdaptationPhase.PROBING)) }
        compose.onNodeWithTag("診断表示要約・復帰試行").assertDoesNotExist()
        assertEquals(scroll, range().value())
        assertEquals(maximum, range().maxValue())
        compose.runOnIdle { current.value = current.value.copy(videoHidden = true) }
        assertEquals(scroll, range().value())
        assertEquals(maximum, range().maxValue())
    }
}
