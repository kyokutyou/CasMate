package jp.casmate.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.layout.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import jp.casmate.app.outdoor.OutdoorState
import jp.casmate.app.outdoor.OutdoorPanel
import jp.casmate.app.outdoor.OutdoorRuntime
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class CasMateTabsTest {
    @Test fun cameraSettingsAndActionsMatchCommentsPositionsAndRestoreTheirOwnFocus() {
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { Text("カメラ本文") },
                    settingsContent = { close -> AlertDialog(onDismissRequest = close,
                        confirmButton = { TextButton(onClick = close) { Text("閉じる") } },
                        text = { Text("カメラ設定内容") }) })
            }
        } }
        val cameraGear = compose.onNodeWithTag("カメラ設定の入口")
        cameraGear.assertWidthIsEqualTo(48.dp).assertHeightIsEqualTo(48.dp)
        val gearBounds = cameraGear.fetchSemanticsNode().boundsInRoot
        val actionBounds = compose.onNodeWithTag("機能操作の入口").fetchSemanticsNode().boundsInRoot
        cameraGear.performClick()
        compose.onNodeWithText("カメラ設定内容").assertIsDisplayed()
        compose.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        compose.onNodeWithText("閉じる").performClick()
        cameraGear.assertIsFocused()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        assertEquals(gearBounds, compose.onNodeWithTag("コメント・読み上げ操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(true, actionBounds.right <= gearBounds.left)
    }
    @Test fun headerPaddingFlicksBothWaysWithoutOpeningFunctionActions() {
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { Text("カメラ本文") })
            }
        } }
        compose.onNodeWithTag("配信共通操作").performTouchInput {
            swipe(androidx.compose.ui.geometry.Offset(280f, 2f), androidx.compose.ui.geometry.Offset(40f, 2f), 220)
        }
        compose.onNodeWithText("コメント本文").assertIsDisplayed()
        compose.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
        compose.onNodeWithTag("配信共通操作").performTouchInput {
            swipe(androidx.compose.ui.geometry.Offset(40f, 2f), androidx.compose.ui.geometry.Offset(280f, 2f), 220)
        }
        compose.onNodeWithText("カメラ本文").assertIsDisplayed()
        compose.onNodeWithText("コメント本文").assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun actualCameraMenuScrollsToEveryExistingActionAtDoubleTextSize() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        val sending = OutdoorState(active = true, status = "sending", inputLost = false)
        OutdoorRuntime.update(sending)
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) { OutdoorTestHost() }
        } }
        compose.onNodeWithTag("機能操作の入口").performClick()
        compose.onNodeWithText("送信を停止").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        compose.onNodeWithText("閉じる").performClick()
        openCameraCategory("送信品質")
        compose.onNodeWithText("送信品質：", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("閉じる").performClick()
        compose.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
    }

    @Test
    @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun fullCameraCanvasPreservesTheWholeFrameAndDisconnectDoesNotMoveIt() {
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", videoHidden = true, portrait = false))
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) { OutdoorTestHost() }
        } }
        val canvas = compose.onNodeWithTag("カメラ本文").fetchSemanticsNode().boundsInRoot
        val landscape = compose.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
        assertEquals(1280f / 720, landscape.width / landscape.height, 0.001f)
        assertEquals(320f, landscape.width, 0.01f)
        assertEquals(760f, canvas.bottom, 0.01f)
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(status = "reconnecting")) }
        assertEquals(landscape, compose.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot)
        assertEquals(canvas, compose.onNodeWithTag("カメラ本文").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(portrait = true)) }
        val portrait = compose.onNodeWithTag("映像表示面").fetchSemanticsNode().boundsInRoot
        assertEquals(720f / 1280, portrait.width / portrait.height, 0.001f)
        assertEquals(true, portrait.left >= canvas.left && portrait.right <= canvas.right && portrait.top >= canvas.top && portrait.bottom <= canvas.bottom)
        compose.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
        compose.onNodeWithTag("カメラ下部操作").assertDoesNotExist()
    }
    @Test fun functionTabsAndEntrancesShareACompactHeaderAboveTheBody() {
        compose.setContent { CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("コメント本文") }, { Text("カメラ本文") })
            }
        } }
        val header = compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
        val tabs = compose.onNodeWithTag("機能タブ").fetchSemanticsNode().boundsInRoot
        val body = compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        assertEquals(true, tabs.top >= header.top && tabs.bottom <= header.bottom)
        assertEquals(true, header.bottom <= body.top)
        compose.onNodeWithTag("配信共通操作").assertHeightIsEqualTo(56.dp)
        compose.onNodeWithText("きゃすメイト").assertDoesNotExist()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithText("コメント本文").assertIsDisplayed()
        assertEquals(header, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun automaticUpdatesAndLongVideoErrorsDoNotMoveRecoveryOrFollowingControls() {
        val current = mutableStateOf(OutdoorState(active = true))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
                Button(onClick = {}) { Text("後続操作") }
            } }
        }
        compose.onNodeWithText("映像を再試行").assertDoesNotExist()
        compose.onNodeWithText("自動制御を再試行").assertDoesNotExist()
        val following = compose.onNodeWithText("後続操作").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { current.value = current.value.copy(
            quality = jp.casmate.app.outdoor.OutdoorQuality(bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO),
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(150000, jp.casmate.app.outdoor.OutdoorAdaptationPhase.HELD),
            videoError = "映像処理の長い失敗説明です。".repeat(40),
            videoFaults = setOf(jp.casmate.app.outdoor.OutdoorVideoFault.CODEC)) }
        compose.onNodeWithText("映像を再試行").assertIsDisplayed()
        assertEquals(following, compose.onNodeWithText("後続操作").fetchSemanticsNode().boundsInRoot)
        val capture = java.io.File("build/reports/layout/outdoor-adaptation-status.png")
        checkNotNull(capture.parentFile).mkdirs()
        capture.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
    @Test fun normalStatusShowsRealSendingRateWithoutInternalCounters() {
        val current = mutableStateOf(OutdoorState(active = true, status = "sending",
            statistics = jp.casmate.app.outdoor.OutdoorStatistics(bitrate = 2100000.0),
            keyframePeakBytes = 90000))
        compose.setContent { MaterialTheme { jp.casmate.app.outdoor.OutdoorVideoStatus(current.value) } }
        compose.onNodeWithText("実送信 2.10 Mbps").assertExists()
        compose.onNodeWithText("受付済み映像目標", substring = true).assertDoesNotExist()
        compose.onNodeWithText("API", substring = true).assertDoesNotExist()
        compose.onNodeWithText("キーフレーム", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(statistics = jp.casmate.app.outdoor.OutdoorStatistics()) }
        compose.onNodeWithText("実送信 未計測").assertExists()
        compose.runOnIdle { current.value = current.value.copy(active = false) }
        compose.onNodeWithText("実送信 停止中").assertExists()
    }
    @Test fun heldVideoStatusExplainsRetryGateWithoutMovingControlsOrOverridingManualHide() {
        val current = mutableStateOf(OutdoorState(active = true, status = "sending",
            quality = jp.casmate.app.outdoor.OutdoorQuality(
                bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO, audioFirst = true),
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(150000,
                phase = jp.casmate.app.outdoor.OutdoorAdaptationPhase.HELD,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                    recoveryWaitMs = 8000, nextProbeInMs = 4500, comparable = true))))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
                Button(onClick = {}) { Text("後続操作") }
            } }
        }
        compose.onNodeWithText("復帰試行まで最短あと5秒", substring = true).assertExists()
        val following = compose.onNodeWithText("後続操作").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(
            diagnostics = current.value.adaptation.diagnostics.copy(
                reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.UNAVAILABLE,
                nextProbeInMs = null))) }
        compose.onNodeWithText("復帰試行は新しい安定観測待ち", substring = true).assertExists()
        assertEquals(following, compose.onNodeWithText("後続操作").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(
            increaseBlocked = true)) }
        compose.onNodeWithText("復帰試行は新しい安定観測待ち", substring = true).assertExists()
        compose.runOnIdle { current.value = current.value.copy(adaptation = current.value.adaptation.copy(
            diagnostics = current.value.adaptation.diagnostics.copy(
                reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.CONTROL_STOPPED))) }
        compose.onNodeWithText("復帰試行は自動制御停止中", substring = true).assertExists()
        compose.runOnIdle { current.value = current.value.copy(videoHidden = true) }
        compose.onNodeWithText("手動非表示を維持", substring = true).assertExists()
        compose.onNodeWithText("復帰試行を保留中", substring = true).assertDoesNotExist()
    }
    @Test fun automaticVideoStatusDistinguishesStartingReductionRecoveryAndOverrides() {
        val autoQuality = jp.casmate.app.outdoor.OutdoorQuality(
            bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO,
            autoMinBitrate = 500000,
            autoMaxBitrate = 2500000,
            audioFirst = true,
        )
        val current = mutableStateOf(OutdoorState(
            active = true,
            status = "sending",
            quality = autoQuality,
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                500000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.STARTING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                ),
            ),
        ))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
            } }
        }

        compose.onNodeWithText("低い目標値で開始", substring = true).assertExists()
        compose.onNodeWithText("映像品質を低下中", substring = true).assertDoesNotExist()
        compose.runOnIdle {
            current.value = current.value.copy(adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1200000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.REDUCED,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                ),
            ))
        }
        compose.onNodeWithText("映像目標値を抑制中", substring = true).assertExists()
        compose.runOnIdle {
            current.value = current.value.copy(adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1300000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                ),
            ))
        }
        compose.onNodeWithText("映像目標値を引き上げた状態（OBS表示未確認）", substring = true).assertExists()
        compose.runOnIdle {
            current.value = current.value.copy(adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                2500000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                ),
            ))
        }
        compose.onNodeWithText("映像目標値は設定上限", substring = true).assertExists()

        compose.runOnIdle {
            current.value = current.value.copy(adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1200000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.CONTROL_STOPPED,
                ),
            ))
        }
        compose.onNodeWithText("自動制御を停止中", substring = true).assertExists()

        compose.runOnIdle {
            current.value = current.value.copy(
                videoHidden = true,
                adaptation = current.value.adaptation.copy(trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING),
            )
        }
        compose.onNodeWithText("手動非表示を維持", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
        compose.runOnIdle {
            current.value = current.value.copy(
                videoFaults = setOf(jp.casmate.app.outdoor.OutdoorVideoFault.CODEC),
            )
        }
        compose.onNodeWithText("映像の操作が必要", substring = true).assertExists()
        compose.onNodeWithText("手動非表示を維持", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(videoHidden = false) }
        compose.onNodeWithText("映像の操作が必要", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
        compose.runOnIdle {
            current.value = current.value.copy(
                active = true,
                videoFaults = emptySet(),
                quality = autoQuality.copy(bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.FIXED, audioFirst = false),
                adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                    2500000,
                    trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                    diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                        reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.FIXED,
                    ),
                ),
            )
        }
        compose.onNodeWithText("固定ビットレートで送信中", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(active = false) }
        compose.onNodeWithText("固定：停止中").assertExists()
        compose.onNodeWithText("低い目標値で開始", substring = true).assertDoesNotExist()
    }

    @Test fun networkPressureOverridesAnOldIncreaseDirectionInVideoStatus() {
        val state = OutdoorState(active = true, status = "sending",
            quality = jp.casmate.app.outdoor.OutdoorQuality(
                bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO, audioFirst = true),
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(1200000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.NETWORK_PRESSURE,
                    queued = 0, rttMs = 2500.0, nakDelta = 0)))
        compose.setContent {
            MaterialTheme { jp.casmate.app.outdoor.OutdoorVideoStatus(state) }
        }

        compose.onNodeWithText("回線悪化候補を観測中（OBS表示未確認）", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
    }

    @Test fun videoStatusDoesNotClaimSendingBeforeConnectionOrDuringReconnect() {
        val quality = jp.casmate.app.outdoor.OutdoorQuality(
            bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO,
            autoMinBitrate = 500000,
            autoMaxBitrate = 2500000,
            audioFirst = true,
        )
        val current = mutableStateOf(OutdoorState(
            active = true,
            status = "preparing",
            quality = quality,
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                2500000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                ),
            ),
        ))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
            } }
        }
        compose.onNodeWithText("送信準備中", substring = true).assertExists()
        compose.onNodeWithText("映像目標値は設定上限", substring = true).assertDoesNotExist()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(status = "connecting") }
        compose.onNodeWithText("接続中", substring = true).assertExists()
        compose.onNodeWithText("映像目標値は設定上限", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(status = "reconnecting") }
        compose.onNodeWithText("再接続中（映像目標を維持）", substring = true).assertExists()
        compose.onNodeWithText("映像目標値は設定上限", substring = true).assertDoesNotExist()
        compose.runOnIdle { current.value = current.value.copy(status = "sending") }
        compose.onNodeWithText("映像目標値は設定上限", substring = true).assertExists()
    }

    @Test fun unavailableVideoObservationOverridesOldRecoveryTrend() {
        val state = OutdoorState(
            active = true,
            status = "sending",
            quality = jp.casmate.app.outdoor.OutdoorQuality(
                bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO,
                audioFirst = true,
            ),
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1200000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.UNAVAILABLE,
                ),
            ),
        )
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(state)
            } }
        }

        compose.onNodeWithText("送信側の品質計測が途切れています", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
    }

    @Test fun firstAndRestartedVideoObservationsTakePriorityOverRecoveryTrend() {
        val quality = jp.casmate.app.outdoor.OutdoorQuality(
            bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO,
            audioFirst = true,
        )
        val current = mutableStateOf(OutdoorState(
            active = true,
            status = "sending",
            quality = quality,
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1200000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.BASELINE,
                ),
            ),
        ))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
            } }
        }

        compose.onNodeWithText("計測準備中", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
        compose.runOnIdle {
            current.value = current.value.copy(adaptation = current.value.adaptation.copy(
                diagnostics = current.value.adaptation.diagnostics.copy(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.REBASELINE,
                ),
            ))
        }
        compose.onNodeWithText("品質計測をやり直しています", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()
    }

    @Test fun stalledLocalVideoWriteOverridesRecoveryWithoutClaimingObsReception() {
        val current = mutableStateOf(OutdoorState(
            active = true,
            status = "sending",
            quality = jp.casmate.app.outdoor.OutdoorQuality(
                bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.AUTO,
                audioFirst = true,
            ),
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(
                1300000,
                trend = jp.casmate.app.outdoor.OutdoorBitrateTrend.RECOVERING,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.VIDEO_WRITE_STALLED,
                    videoWriteStalledForMs = 1500,
                ),
            ),
        ))
        compose.setContent {
            MaterialTheme { androidx.compose.foundation.layout.Column {
                jp.casmate.app.outdoor.OutdoorVideoStatus(current.value)
            } }
        }

        compose.onNodeWithText("送信器の映像書込が停滞中（OBS表示未確認）", substring = true).assertExists()
        compose.onNodeWithText("映像目標値を段階的に引き上げ中", substring = true).assertDoesNotExist()

        compose.runOnIdle {
            current.value = current.value.copy(adaptation = current.value.adaptation.copy(diagnostics =
                current.value.adaptation.diagnostics.copy(reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.AUDIO_DROPPED)))
        }
        compose.onNodeWithText("音声フレームを破棄しています（OBS受信未確認）", substring = true).assertExists()
        compose.onNodeWithText("送信器の映像書込が停滞中", substring = true).assertDoesNotExist()

        compose.runOnIdle {
            current.value = current.value.copy(adaptation = current.value.adaptation.copy(diagnostics =
                current.value.adaptation.diagnostics.copy(reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.AUDIO_STALLED)))
        }
        compose.onNodeWithText("音声送出が停滞中（OBS受信未確認）", substring = true).assertExists()
        compose.onNodeWithText("送信器の映像書込が停滞中", substring = true).assertDoesNotExist()

        compose.runOnIdle {
            current.value = current.value.copy(
                quality = current.value.quality.copy(
                    bitrateMode = jp.casmate.app.outdoor.OutdoorBitrateMode.FIXED,
                    audioFirst = false,
                ),
                adaptation = current.value.adaptation.copy(diagnostics =
                    current.value.adaptation.diagnostics.copy(reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.AUDIO_DROPPED)),
            )
        }
        compose.onNodeWithText("音声フレームを破棄しています（OBS受信未確認）", substring = true).assertExists()
        compose.onNodeWithText("送信器の映像書込が停滞中", substring = true).assertDoesNotExist()
        compose.onNodeWithText("固定ビットレートで送信中", substring = true).assertDoesNotExist()
    }

    @Test fun communicationDiagnosticsUseOneWindowAndKeepPanelNavigationFixed() {
        val first = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
            reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.AUDIO_DROPPED,
            comparable = true, windowMs = 520, queued = 5, queuedBytes = 8192,
            rttMs = 512.3, nakDelta = 2, ackDelta = 3, sentAudioDelta = 46,
            droppedAudioDelta = 1, sentVideoDelta = 76, droppedVideoDelta = 3,
            videoWriteStalledForMs = 1500)
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending",
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(500000, diagnostics = first)))
        compose.setContent { MaterialTheme { OutdoorTestHost() } }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").performScrollTo().performClick()
        compose.onNodeWithText("通信").performClick()
        fun row(label: String, value: String) = compose.onNodeWithTag("診断項目・$label")
            .performScrollTo().assertTextContains(value)
        row("直近の観測窓", "520.0 ms")
        row("送信待ちキュー", "5件")
        row("送信待ちバイト量", "8192 B")
        row("判定に使ったRTT", "512.3 ms")
        row("PC受信進行（増分）", "3回")
        row("NAK通知（増分）", "2件")
        row("音声送信（増分）", "46フレーム")
        row("音声破棄（増分）", "1フレーム")
        row("映像送出（増分）", "76フレーム")
        row("映像破棄（増分）", "3フレーム")
        row("映像送出停滞時間", "1.5秒")
        val close = compose.onNodeWithText("診断を閉じる").fetchSemanticsNode().boundsInRoot
        val audioRow = compose.onNodeWithTag("診断項目・音声破棄（増分）").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(adaptation =
            OutdoorRuntime.state.value.adaptation.copy(diagnostics = first.copy(
                queued = 18, queuedBytes = null, rttMs = 814.7, nakDelta = 13, droppedAudioDelta = 100)))) }
        assertEquals(close, compose.onNodeWithText("診断を閉じる").fetchSemanticsNode().boundsInRoot)
        assertEquals(audioRow, compose.onNodeWithTag("診断項目・音声破棄（増分）").fetchSemanticsNode().boundsInRoot)
        row("音声破棄（増分）", "100フレーム")
        row("送信待ちキュー", "18件")
        row("送信待ちバイト量", "未計測")
        row("判定に使ったRTT", "814.7 ms")
        val capture = java.io.File("build/reports/layout/outdoor-diagnostic-panel.png")
        checkNotNull(capture.parentFile).mkdirs()
        capture.outputStream().use { compose.onNodeWithTag("通信診断パネル").captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun unavailableCommunicationDiagnosticsDoNotDisplayUnknownValuesAsZero() {
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending"))
        compose.setContent { MaterialTheme { OutdoorTestHost() } }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").performScrollTo().performClick()
        compose.onNodeWithText("通信").performClick()
        for (label in listOf("観測の有効性", "送信待ちキュー", "PC受信進行（増分）", "音声破棄（増分）", "映像送出（増分）")) {
            compose.onNodeWithTag("診断項目・$label").performScrollTo().assertTextContains("未計測")
        }
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(adaptation =
            OutdoorRuntime.state.value.adaptation.copy(diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.BASELINE,
                observationIssue = jp.casmate.app.outdoor.OutdoorObservationIssue.BASELINE)))) }
        compose.onNodeWithTag("診断項目・観測の有効性").performScrollTo().assertTextContains("比較基準待ち")
    }

    @Test fun codecCanBeSelectedOnlyWhileStoppedWithoutChangingPreset() {
        var quality = jp.casmate.app.outdoor.OutdoorQuality()
        val active = mutableStateOf(false)
        compose.setContent {
            var selection by remember { mutableStateOf(quality) }
            MaterialTheme {
                androidx.compose.foundation.layout.Column {
                    jp.casmate.app.outdoor.OutdoorQualityControls(selection, active.value, false, false) {
                        selection = it; quality = it
                    }
                }
            }
        }
        compose.onNodeWithText("H.265（HEVC）").performClick()
        compose.runOnIdle {
            assertEquals(jp.casmate.app.outdoor.OutdoorVideoCodec.H265, quality.videoCodec)
            assertEquals("標準", quality.preset)
            active.value = true
        }
        compose.onNodeWithText("H.264").assertIsNotEnabled()
        compose.onNodeWithText("H.265（HEVC）").assertIsNotEnabled()
    }
    @Test fun cameraAndCommentsKeepTheirControlsInSeparatePages() {
        var cameraActions = 0
        var readingActions = 0
        compose.setContent {
            MaterialTheme {
                CasMateTabs(commentsContent = {
                    androidx.compose.foundation.layout.Column {
                        Text("コメント本文")
                        Button(onClick = { readingActions++ }) { Text("読み上げを聞く") }
                    }
                }, outdoorContent = {
                    androidx.compose.foundation.layout.Column {
                        Text("プレビュー領域")
                        Button(onClick = { cameraActions++ }) { Text("マイクミュート") }
                        Button(onClick = { cameraActions++ }) { Text("映像を隠す") }
                        Button(onClick = { cameraActions++ }) { Text("映像・音声の送信を停止") }
                    }
                })
            }
        }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithText("読み上げを聞く").assertDoesNotExist()
        compose.onNodeWithText("コメント本文").assertDoesNotExist()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithText("読み上げを聞く").assertIsDisplayed()
        compose.onNodeWithText("マイクミュート").assertDoesNotExist()
        compose.onNodeWithText("映像を隠す").assertDoesNotExist()
        compose.onNodeWithText("映像・音声の送信を停止").assertDoesNotExist()
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.runOnIdle { assertEquals(0, cameraActions); assertEquals(0, readingActions) }
        compose.onNodeWithText("左フリック", substring = true).assertDoesNotExist()
    }

    @Test fun settingsOnlyOpenTheSelectedFunctionsSettings() {
        compose.setContent {
            MaterialTheme {
                CasMateTabs(commentsContent = { TestSettingsMenu("コメント設定") }, outdoorContent = { TestSettingsMenu("カメラ設定") },
                    settingsContent = { close -> AlertDialog(onDismissRequest = close, confirmButton = {
                        TextButton(onClick = close) { Text("閉じる") }
                    }, text = { Text("カメラの設定内容") }) },
                    commentsSettingsContent = { close -> AlertDialog(onDismissRequest = close, confirmButton = {
                        TextButton(onClick = close) { Text("閉じる") }
                    }, text = { Text("コメントの設定内容") }) })
            }
        }
        compose.onNodeWithTag("機能操作の入口").performClick()
        compose.onNodeWithText("カメラ設定").performScrollTo().performClick()
        compose.onNodeWithText("カメラの設定内容").assertIsDisplayed()
        compose.onNodeWithText("コメントの設定内容").assertDoesNotExist()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithTag("コメント設定の入口").performClick()
        compose.onNodeWithText("コメントの設定内容").assertIsDisplayed()
        compose.onNodeWithText("カメラの設定内容").assertDoesNotExist()
    }
    @get:Rule val compose = createComposeRule()
    @After fun resetOutdoor() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun flickNavigationIsGuardedAndNeverWraps() {
        var commands = 0
        compose.setContent {
            MaterialTheme {
                CasMateTabs(commentsContent = { Text("コメント本文") }, outdoorContent = {
                    androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.fillMaxSize()) {
                        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxWidth().weight(1f)) { Text("カメラ操作") }
                        Button(onClick = { commands++ }, modifier = Modifier.fillMaxWidth().height(56.dp).testTag("カメラ操作ボタン")) { Text("操作") }
                    }
                })
            }
        }
        compose.onNodeWithTag("カメラ操作ボタン").performTouchInput { swipeLeft() }
        val buttonCommands = commands
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput { swipeRight() }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput { swipeUp() }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput {
            down(center); moveBy(androidx.compose.ui.geometry.Offset(-12f, 0f)); up()
        }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput {
            down(center); moveBy(androidx.compose.ui.geometry.Offset(-120f, 0f)); cancel()
        }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput {
            down(0, center); down(1, center + androidx.compose.ui.geometry.Offset(10f, 10f))
            moveBy(0, androidx.compose.ui.geometry.Offset(-120f, 0f))
            up(1); up(0)
        }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput { swipeLeft() }
        compose.onNodeWithText("コメント本文").assertIsDisplayed()
        compose.onNodeWithTag("機能画面").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("画面切替・コメント").assertIsSelected()
        compose.onNodeWithTag("機能画面").performTouchInput { swipeRight() }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.runOnIdle { assertEquals(buttonCommands, commands) }
    }
    @Test fun stoppedVolumeReflectsThePersistedValueAfterLiveAdjustment() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        val prefs = jp.casmate.app.outdoor.OutdoorPreferences(context)
        prefs.saveVolume(100)
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", volume = 100))
        compose.setContent { MaterialTheme { OutdoorTestHost() } }
        openCameraCategory("マイク")
        compose.runOnIdle {
            prefs.saveVolume(173)
            OutdoorRuntime.update(OutdoorRuntime.state.value.copy(volume = 173))
        }
        compose.onNodeWithText("配信マイク音量：173%").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { OutdoorRuntime.update(OutdoorState()) }
        compose.onNodeWithText("配信マイク音量：173%").performScrollTo().assertIsDisplayed()
    }

    @Test fun connectionUpdatesAndAppearanceKeepThePageGeometryAndServices() {
        val current = mutableStateOf("Tailscale・接続済み")
        val appearance = mutableStateOf(jp.casmate.app.data.AppearanceMode.LIGHT)
        var changes = 0
        compose.setContent {
            CasMateTheme(appearance.value) {
                CasMateTabs(commentsContent = { Text("コメント本文") }, outdoorContent = { Text("カメラ操作") },
                    connectionLabel = current.value, onScreenChanged = { changes++ })
            }
        }
        val header = compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
        val body = compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
        val tabs = compose.onNodeWithTag("機能タブ").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { current.value = "Tailscale・接続待ち"; appearance.value = jp.casmate.app.data.AppearanceMode.DARK }
        assertEquals(header, compose.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(body, compose.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
        assertEquals(tabs, compose.onNodeWithTag("機能タブ").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.runOnIdle { assertEquals(0, changes) }
    }
    @Test fun tabAndDraftSurviveNavigationAndRestoration() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            MaterialTheme {
                CasMateTabs({ Text("コメント本文") }, {
                    var portrait by rememberSaveable { mutableStateOf(false) }
                    Button(onClick = { portrait = !portrait }) { Text(if (portrait) "縦向き" else "横向き") }
                })
            }
        }
        compose.onNodeWithText("映像・音声の送信を停止").assertDoesNotExist()
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithText("横向き").performClick()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithText("縦向き").assertIsDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithText("縦向き").assertIsDisplayed()
    }

    @Test fun outdoorCameraAndOrientationSelectionsSurviveTabRoundTrip() {
        compose.setContent {
            MaterialTheme {
                OutdoorTestHost()
            }
        }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithText("横1280×720").assertDoesNotExist()
        openCameraCategory("送信品質")
        compose.onNodeWithText("縦向き").performScrollTo().performClick()
        compose.onNodeWithText("戻る").performClick()
        compose.onNodeWithTag("映像・マイク分類・カメラ").performClick()
        compose.onNodeWithText("前面").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithTag("画面切替・コメント").performClick()
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        openCameraCategory("送信品質")
        compose.onNodeWithText("縦720×1280").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("戻る").performClick()
        compose.onNodeWithTag("映像・マイク分類・カメラ").performClick()
        compose.onNodeWithText("前面").assertIsSelected()
    }

    @Test fun settingsCanOpenDuringStreamingWithoutChangingTransmission() {
        val sending = OutdoorState(active = true, status = "sending", muted = false)
        OutdoorRuntime.update(sending)
        compose.setContent { MaterialTheme { OutdoorTestHost() } }
        openCameraCategory("送信品質")
        compose.onNodeWithText("横向き").assertIsNotEnabled()
        compose.onNodeWithText("戻る").performClick()
        compose.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
        compose.onNodeWithText("スマホ連携を開く").assertIsEnabled()
        compose.onNodeWithText("戻る").performClick()
        compose.onNodeWithTag("映像・マイク分類・カメラ").performScrollTo().performClick()
        compose.onNodeWithText("前面").assertIsEnabled()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithText("前面").assertDoesNotExist()
        openCameraCategory("画面表示")
        compose.onNodeWithText("プレビューを閉じる").assertIsDisplayed()
        compose.runOnIdle { assertEquals(sending, OutdoorRuntime.state.value) }
    }

    @Test fun communicationDetailsOpensIndependentPanelWithFourCategories() {
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", muted = false))
        compose.setContent { MaterialTheme { OutdoorTestHost() } }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").performScrollTo().performClick()
        compose.runOnIdle { }
        compose.onNodeWithText("通信・診断").assertIsDisplayed()
        listOf("概要", "自動調整", "通信", "履歴").forEach { compose.onNodeWithText(it).assertIsDisplayed() }
        compose.onNodeWithText("概要").assertIsSelected()
        compose.onNodeWithText("診断を閉じる").performClick()
        compose.onNodeWithText("通信・診断").assertDoesNotExist()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithText("通信・診断").assertExists()
    }

    @Test
    @Config(qualifiers = "w320dp-h760dp-mdpi")
    fun recordingDiagnosticsKeepsPortraitPreviewAndSummaryVisibleTogether() {
        OutdoorRuntime.update(OutdoorState(active = true, status = "sending", portrait = true,
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(500000,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.NETWORK_PRESSURE,
                    queued = 5, queuedBytes = 4096, rttMs = 512.3, nakDelta = 2, droppedAudioDelta = 1,
                ))))
        compose.setContent {
            CasMateTheme(jp.casmate.app.data.AppearanceMode.LIGHT) {
                Surface(modifier = Modifier.width(320.dp).height(760.dp), color = MaterialTheme.colorScheme.background) { OutdoorTestHost() }
            }
        }
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        openCameraCategory("画面表示")
        compose.onNodeWithTag("診断表示切替").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()

        val preview = compose.onNodeWithTag("外配信プレビュー").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val summary = compose.onNodeWithTag("診断表示要約").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertEquals(true, preview.right <= summary.left)
        compose.onNodeWithTag("診断表示要約・目標").assertExists().assertTextEquals("受付済み目標 0.50 Mbps")
        compose.onNodeWithText("送信待ち 5件").assertExists()
        compose.onNodeWithText("往復時間（RTT） 512.3 ms").assertExists()
        compose.onNodeWithText("PC受信確認 未計測").assertExists()
        compose.onNodeWithText("音声破棄 +1フレーム").assertExists()
        compose.onNodeWithText("4096B", substring = true).assertDoesNotExist()

        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(
            adaptation = jp.casmate.app.outdoor.OutdoorAdaptationView(150000,
                phase = jp.casmate.app.outdoor.OutdoorAdaptationPhase.HELD,
                diagnostics = jp.casmate.app.outdoor.OutdoorAdaptationDiagnostics(
                    reason = jp.casmate.app.outdoor.OutdoorAdaptationReason.STABLE,
                    recoveryWaitMs = 8000, nextProbeInMs = 4500, comparable = true)))) }
        compose.onNodeWithTag("外配信プレビュー").assertIsDisplayed()
        compose.onNodeWithTag("診断表示要約・復帰試行").performScrollTo().assertIsDisplayed()
            .assertTextContains("復帰試行まで最短あと5秒", substring = true)
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = true)) }
        compose.onNodeWithTag("診断表示要約・復帰試行").assertDoesNotExist()
        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(videoHidden = false)) }

        compose.runOnIdle { OutdoorRuntime.update(OutdoorRuntime.state.value.copy(portrait = false)) }
        val landscapePreview = compose.onNodeWithTag("外配信プレビュー").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val landscapeSummary = compose.onNodeWithTag("診断表示要約").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertEquals(true, landscapePreview.bottom <= landscapeSummary.top)

        openCameraCategory("画面表示")
        compose.onNodeWithText("プレビューを閉じる").performScrollTo().performClick()
        compose.onNodeWithText("閉じる").performClick()
        openCameraCategory("画面表示")
        compose.onNodeWithText("プレビューを表示").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("診断表示要約").assertDoesNotExist()
        compose.onNodeWithText("プレビューを表示").performClick()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithTag("診断表示要約").assertExists()

        compose.runOnIdle { OutdoorRuntime.update(OutdoorState()) }
        compose.waitForIdle()
        compose.runOnIdle { OutdoorRuntime.update(OutdoorState(active = true, status = "sending", portrait = true)) }
        compose.onNodeWithTag("診断表示要約").assertDoesNotExist()
    }

    private fun openCameraCategory(name: String) {
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithTag("映像・マイク分類・$name").performScrollTo().performClick()
    }
}

@Composable private fun OutdoorTestHost() {
    val draft = rememberSaveable(saver = jp.casmate.app.outdoor.OutdoorDraft.Saver) { jp.casmate.app.outdoor.OutdoorDraft() }
    CasMateTabs({ Text("コメント本文") }, { export -> OutdoorPanel(draft, onOpenConnection = {}, onExportDiagnostics = export) },
        )
}

@Composable private fun TestSettingsMenu(label: String) {
    val actions = LocalScreenActions.current
    if (actions.open) ScreenActionsDialog("操作", actions.dismiss) {
        TextButton(onClick = actions.openSettings) { Text(label) }
    }
}
