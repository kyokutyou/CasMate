package jp.casmate.app.outdoor

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Density
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.ui.CasMateTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OutdoorQualityControlsUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun networkControlsAreVisibleWithoutOpeningTechnicalDetailsAndValuesSurviveEdits() {
        val quality = mutableStateOf(OutdoorQuality(videoCodec = OutdoorVideoCodec.H265,
            latencyMs = 700, audioBitrate = 96000, keyframeSeconds = 4,
            bitrateMode = OutdoorBitrateMode.AUTO, autoMinBitrate = 800000, autoMaxBitrate = 4000000).custom())
        show(quality)
        ui.onNodeWithText("品質プリセット：カスタム").assertExists()
        ui.onNodeWithTag("解像度選択欄").assertTextContains("1280×720")
        ui.onNodeWithTag("フレームレート選択欄").assertTextContains("30fps")
        ui.onNodeWithText("回線が不安定なとき").performScrollTo().assertIsDisplayed()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Heading, Unit))
        ui.onNodeWithText("自動").assertIsSelected()
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsDisplayed().assertIsEnabled()
        ui.onNodeWithTag("通常動画の下限スライダー").assertExists()
        ui.onNodeWithTag("通常動画の上限スライダー").assertExists()
        ui.onNodeWithText("解像度・fpsを変えた後は、OBSの映像と配置を確認してください。").assertExists()
        ui.onNodeWithText("ビットレートはエンコーダーの目標値です。通信量の上限を保証する値ではありません。").assertExists()
        ui.onNodeWithText("映像形式：", substring = true).assertDoesNotExist()
        ui.onNodeWithTag("通信と形式の要約").assertTextContains("H.265（HEVC）・SRT遅延700ms・音声96kbps・キーフレーム4秒")
        details().performScrollTo().assertHasClickAction().assertHeightIsAtLeast(48.dp)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "折りたたみ")).performClick()
        details().assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "展開中"))
        ui.onNodeWithTag("通信と形式の要約").assertDoesNotExist()
        ui.onNodeWithTag("映像形式選択欄").performScrollTo().assertTextContains("H.265（HEVC）")
        choose("SRT遅延バッファ", "800ms")
        ui.onNodeWithTag("SRT遅延バッファ選択欄").assertTextContains("800ms")
        details().assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "展開中"))
        choose("映像形式", "H.264")
        choose("音声ビットレート", "128kbps")
        choose("フレームレート", "60fps")
        details().performScrollTo().performClick()
        ui.onNodeWithTag("通信と形式の要約").assertTextContains("H.264・SRT遅延800ms・音声128kbps・キーフレーム4秒")
        ui.runOnIdle {
            assertEquals(OutdoorVideoCodec.H264, quality.value.videoCodec)
            assertEquals(60, quality.value.fps)
            assertEquals(OutdoorBitrateMode.AUTO, quality.value.bitrateMode)
            assertEquals(800000, quality.value.autoMinBitrate)
            assertEquals(4000000, quality.value.autoMaxBitrate)
        }
    }

    @Test fun networkControlsKeepIndependentTargetsAndDoNotReenableWeakLineOnModeReturn() {
        val quality = mutableStateOf(OutdoorQuality(videoBitrate = 6000000,
            autoMinBitrate = 800000, autoMaxBitrate = 4000000).custom())
        show(quality)
        ui.onNodeWithText("ビットレート制御").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("ビットレート制御：固定").assertDoesNotExist()
        val label = ui.onNodeWithText("映像ビットレート").performScrollTo().fetchSemanticsNode().boundsInRoot
        val value = ui.onNodeWithTag("映像ビットレートの現在値").assertTextEquals("6.0 Mbps")
            .fetchSemanticsNode().boundsInRoot
        assertEquals("The value shares the compact label row", label.top, value.top, 1f)
        assertTrue("The current value stays to the right", label.right <= value.left)
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsNotEnabled().assertIsOff()
        ui.onNodeWithText("弱回線対策は自動モードで利用できます").assertExists()
        ui.onNodeWithText("自動").performScrollTo().performClick()
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsEnabled().performClick().assertIsOn()
        ui.onNodeWithTag("通常動画の下限スライダー").performScrollTo()
            .performSemanticsAction(SemanticsActions.SetProgress) { it(50f) }
        ui.runOnIdle { assertEquals(800000, quality.value.autoMinBitrate) }
        ui.onNodeWithTag("通常動画の下限スライダー")
            .performSemanticsAction(SemanticsActions.SetProgress) { it(10f) }
        ui.runOnIdle { assertEquals(1000000, quality.value.autoMinBitrate) }
        ui.onNodeWithText("固定").performScrollTo().performClick()
        ui.onNodeWithTag("映像ビットレートスライダー").assertExists()
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsNotEnabled().assertIsOff()
        ui.onNodeWithText("自動").performScrollTo().performClick()
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsOff()
        ui.runOnIdle {
            assertEquals(6000000, quality.value.videoBitrate)
            assertEquals(1000000, quality.value.autoMinBitrate)
            assertEquals(4000000, quality.value.autoMaxBitrate)
            assertFalse(quality.value.audioFirst)
        }
    }

    @Test fun activeQualityCanBeInspectedButEverySettingRemainsReadOnly() {
        val original = OutdoorQuality(bitrateMode = OutdoorBitrateMode.AUTO, audioFirst = true)
        val quality = mutableStateOf(original)
        var changes = 0
        show(quality, active = true) { changes++ }
        ui.onNodeWithText("設定を変更するには映像送信を停止してください").assertExists()
        ui.onNodeWithTag("解像度選択欄").performScrollTo().assertTextContains("1280×720").assertIsNotEnabled()
        ui.onNodeWithTag("フレームレート選択欄").performScrollTo().assertIsNotEnabled().performClick()
        ui.onNodeWithText("固定").performScrollTo().assertIsNotEnabled().performClick()
        ui.onNodeWithTag("通常動画の下限スライダー").assertIsNotEnabled()
        ui.onNodeWithTag("通常動画の上限スライダー").assertIsNotEnabled()
        ui.onNodeWithTag("弱回線対策スイッチ").performScrollTo().assertIsNotEnabled().assertIsOn().performClick()
        details().performScrollTo().assertIsEnabled().performClick()
        for (label in listOf("映像形式", "SRT遅延バッファ", "音声ビットレート", "キーフレーム間隔")) {
            ui.onNodeWithTag("${label}選択欄").performScrollTo().assertIsNotEnabled().performClick()
        }
        ui.onNodeWithText("128kbps").assertDoesNotExist()
        ui.runOnIdle { assertEquals(0, changes); assertEquals(original, quality.value) }
    }

    @Test fun unsupportedPresetReasonsRemainOutsideCollapsedTechnicalDetails() {
        val quality = mutableStateOf(OutdoorQuality())
        show(quality)
        // This fixture has no camera; the real capability check must keep its reason visible.
        ui.onNodeWithText("画質優先").assertIsNotEnabled()
        ui.onNodeWithText("画質優先：", substring = true).assertExists()
        ui.onNodeWithTag("品質の非対応理由").assertExists()
        ui.onNodeWithText("映像形式：", substring = true).assertDoesNotExist()
        ui.onNodeWithText("画質優先").performScrollTo().performClick()
        ui.runOnIdle { assertEquals(OutdoorQuality(), quality.value) }
        choose("フレームレート", "60fps")
        ui.onNodeWithTag("品質の非対応理由").assertExists()
        ui.runOnIdle { assertEquals(60, quality.value.fps) }
    }

    @Test fun activeCameraPreparationDoesNotAskTheUserToStartSendingAgain() {
        val active = mutableStateOf(false)
        val camera = mutableStateOf(OutdoorCameraState())
        val scale = mutableStateOf(1f)
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) { Surface {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                OutdoorCameraSettings(camera.value, active = active.value)
            }
            }
        } } }
        ui.onNodeWithText("映像送信を開始してから操作できます").assertIsDisplayed()
        ui.onNodeWithText("カメラを準備しています。準備が終わると操作できます。").assertDoesNotExist()
        ui.runOnIdle { active.value = true }
        ui.onNodeWithText("カメラを準備しています。準備が終わると操作できます。").assertIsDisplayed()
        ui.onNodeWithText("映像送信を開始してから操作できます").assertDoesNotExist()
        val failure = "カメラ調整の対応情報を取得できません。接続と端末の対応状況を確認してください。".repeat(8)
        ui.runOnIdle { camera.value = camera.value.copy(error = failure); scale.value = 2f }
        ui.onNodeWithText("カメラを準備しています。準備が終わると操作できます。").assertDoesNotExist()
        ui.onAllNodesWithText(failure).assertCountEquals(1)
        val reason = ui.onNodeWithTag("カメラ調整の状態").performScrollTo().assertIsDisplayed()
        val scroll = reason.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        assertTrue("The complete camera failure remains readable at double text size", scroll.maxValue() > 0f)
        reason.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, scroll.maxValue()) }
        ui.runOnIdle { assertEquals(scroll.maxValue(), scroll.value(), 0f) }
    }

    @Test fun enclosingPageCanOwnTheLockNoticeWithoutEnablingQualityChanges() {
        val quality = mutableStateOf(OutdoorQuality())
        show(quality, active = true, showLockNotice = false)
        ui.onNodeWithText("設定を変更するには映像送信を停止してください").assertDoesNotExist()
        ui.onNodeWithTag("フレームレート選択欄").performScrollTo().assertIsNotEnabled().performClick()
        details().performScrollTo().performClick()
        ui.onNodeWithTag("映像形式選択欄").performScrollTo().assertTextContains("H.264").assertIsNotEnabled()
        ui.runOnIdle { assertEquals(OutdoorQuality(), quality.value) }
    }

    private fun choose(label: String, value: String) {
        ui.onNodeWithTag("${label}選択欄").performScrollTo().performClick()
        ui.onNodeWithText(value).performScrollTo().performClick()
    }

    @Test fun presetsShowComparableResolutionAndMotionInTwoColumns() {
        show(mutableStateOf(OutdoorQuality()))
        val names = listOf("通信量優先", "標準", "画質優先", "動き優先")
        val descriptions = listOf("480p・30fps", "720p・30fps", "1080p・30fps", "720p・60fps")
        val bounds = names.mapIndexed { index, name ->
            ui.onNodeWithTag("画質プリセット・$name").assertTextContains(descriptions[index])
                .assertHeightIsAtLeast(72.dp).fetchSemanticsNode().boundsInRoot
        }
        assertEquals(bounds[0].top, bounds[1].top, 1f)
        assertEquals(bounds[2].top, bounds[3].top, 1f)
        assertTrue(bounds[0].right <= bounds[1].left)
        assertTrue(bounds[0].bottom <= bounds[2].top)
        ui.onNodeWithText("60fps").assertDoesNotExist()
        ui.onNodeWithTag("フレームレート選択欄").performScrollTo().performClick()
        ui.onNodeWithText("60fps").assertIsDisplayed()
    }

    private fun details() = ui.onNodeWithTag("通信と形式の詳細を開閉")

    private fun show(quality: MutableState<OutdoorQuality>, active: Boolean = false, showLockNotice: Boolean = true,
        changed: () -> Unit = {}) {
        ui.setContent {
            CasMateTheme(AppearanceMode.LIGHT) { Surface {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutdoorQualityControls(quality.value, active, front = false, portrait = false, showLockNotice = showLockNotice) {
                        quality.value = it
                        changed()
                    }
                }
            } }
        }
    }
}
