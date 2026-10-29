package jp.casmate.app.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import java.io.File
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.obs.RegistrationBundleStore
import jp.casmate.app.outdoor.OutdoorRuntime
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in: confirms the existing completed notice, preserving registration and starting no services. */
class RegistrationNoticeDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun confirmedUpdateStaysHiddenAfterReopeningAndRecreatingButRemainsInHelp() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyRegistrationNotice") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = RegistrationBundleStore(context)
        val registration = store.load()!!.json().toString()
        assumeTrue(store.resetNotice != null)
        val details = store.resetNotice!!
        ui.onNodeWithContentDescription("スマホ連携").performClick()
        if (store.pendingResetNotice != null) {
            ui.onNodeWithText("全文を見る").performScrollTo().performClick()
            ui.onNodeWithTag("登録案内の全文").assertTextContains(details)
            ui.onNodeWithTag("登録案内の全文を閉じる").performClick()
        }
        ui.onNodeWithText(details, substring = true).assertDoesNotExist()
        ui.onNodeWithText("閉じる").performClick()
        ui.onNodeWithContentDescription("スマホ連携").performClick()
        ui.onNodeWithTag("登録案内の全文").assertDoesNotExist()
        ui.onNodeWithText("使い方・注意点").performScrollTo().performClick()
        ui.onNodeWithText("登録情報の更新案内").performScrollTo().performClick()
        ui.onNodeWithTag("登録案内の全文").assertTextContains(details)
        ui.onNodeWithTag("登録案内の全文を閉じる").performClick()
        ui.onNodeWithText("閉じる").performClick()
        ui.activityRule.scenario.recreate()
        ui.waitUntil(10_000) { ui.onAllNodesWithContentDescription("スマホ連携").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithContentDescription("スマホ連携").performClick()
        ui.onNodeWithTag("登録案内の全文").assertDoesNotExist()
        val restarted = RegistrationBundleStore(context); restarted.load()
        assertNull(restarted.pendingResetNotice)
        assertEquals(details, restarted.resetNotice)
        assertTrue("確認操作は登録を変更しない", registration == restarted.load()!!.json().toString())
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val directory = context.getExternalFilesDir("registration-notice-check")!!
        check(directory.exists() || directory.mkdirs())
        File(directory, "confirmed-after-recreate.png").outputStream().use { output ->
            check(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, output))
        }
    }
}
