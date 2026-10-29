package jp.casmate.app.ui

import android.Manifest
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.outdoor.OutdoorRuntime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [QrProviderShadow::class])
class SmartphoneRegistrationActivityTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun initialScreen() {
        compose.waitUntil(10000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            compose.onAllNodesWithTag("初回QR登録").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test fun firstLaunchShowsADirectQrEntryWithoutUnusedFunctionControls() {
        initialScreen()
        compose.onNodeWithText("PCとつなぐ").assertIsDisplayed()
        compose.onNodeWithText("QRコードでPCを登録").assertIsDisplayed()
        compose.onNodeWithTag("初回QR読取").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag("機能タブ").assertDoesNotExist()
        compose.onNodeWithText("読み上げを聞く").assertDoesNotExist()
        compose.onNodeWithText("送信を開始").assertDoesNotExist()
        compose.onNodeWithText("コメント用URLを入力").assertDoesNotExist()
        compose.runOnIdle { assertFalse(OutdoorRuntime.state.value.active); assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value) }
    }

    @Test fun qrHelpCanBeClosedAndLeavesTheDirectEntryInPlace() {
        initialScreen()
        val qr = compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("QRコードの表示場所").performClick()
        compose.onNodeWithText("1. Windows版きゃすメイトの「設定」を開きます。").assertIsDisplayed()
        compose.onNodeWithText("閉じる").performClick()
        assertEquals(qr, compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun directScanDoesNotOpenTheRegistrationDialogAndCancelStartsNothing() {
        initialScreen()
        QrProviderShadow.future = com.google.common.util.concurrent.SettableFuture.create()
        shadowOf(compose.activity.application).grantPermissions(Manifest.permission.CAMERA)
        compose.onNodeWithTag("初回QR読取").performClick()
        compose.onNodeWithText("PCのQRを読み取る").assertIsDisplayed()
        compose.onNodeWithTag("スマホ連携の登録内容").assertDoesNotExist()
        compose.onNodeWithText("閉じる").performClick()
        compose.onNodeWithTag("初回QR読取").assertIsDisplayed()
        compose.runOnIdle { assertFalse(OutdoorRuntime.state.value.active); assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value) }
    }

    @Test fun initialAppearanceSwitchDoesNotRevealFunctionControlsOrStartServices() {
        initialScreen()
        compose.onNodeWithText("☾ ダークモード").performClick()
        compose.waitUntil(10000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            compose.onAllNodesWithText("☀ ライトモード").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("機能タブ").assertDoesNotExist()
        compose.onNodeWithTag("初回QR読取").assertIsEnabled()
        compose.runOnIdle { assertFalse(OutdoorRuntime.state.value.active); assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value) }
    }
}
