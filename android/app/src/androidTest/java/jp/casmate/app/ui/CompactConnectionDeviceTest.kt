package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.OutdoorRuntime
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in inspection. Keeps real registration; never scans a QR, switches a route or confirms clearing. */
class CompactConnectionDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun compactConnectionDetailsAndLockedControlsWorkInBothThemes() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyCompactConnection") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = AppPreferences(context)
        val originalAppearance = runBlocking { preferences.appearance.first() }
        val originalSender = OutdoorRuntime.state.value
        val scale = context.resources.configuration.fontScale
        val originalTouchMode = ui.activity.window.decorView.isInTouchMode
        try {
            for (mode in AppearanceMode.entries) {
                runBlocking { preferences.setAppearance(mode) }
                ui.waitForIdle()
                ui.onNodeWithContentDescription("スマホ連携").performClick()
                ui.onNodeWithText("PCのQRを読み取る").performScrollTo().assertIsDisplayed().assertIsEnabled()
                ui.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").assertDoesNotExist()
                val qr = ui.onNodeWithText("PCのQRを読み取る").getUnclippedBoundsInRoot()
                val routes = ui.onNodeWithTag("スマホ連携のネットワーク").getUnclippedBoundsInRoot()
                val close = ui.onNodeWithText("閉じる").getUnclippedBoundsInRoot()
                instrumentation.setInTouchMode(false)
                val eventTime = android.os.SystemClock.uptimeMillis()
                for (action in listOf(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.ACTION_UP)) {
                    assertTrue(instrumentation.uiAutomation.injectInputEvent(android.view.KeyEvent(eventTime, eventTime,
                        action, android.view.KeyEvent.KEYCODE_TAB, 0, 0, android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,
                        0, 0, android.view.InputDevice.SOURCE_KEYBOARD), true))
                }
                ui.waitForIdle()
                ui.onNodeWithText("閉じる").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus) { it() }
                ui.onNodeWithText("閉じる").assertIsFocused()
                // Presentation-only sending state; no Android sender service is started.
                ui.runOnIdle { OutdoorRuntime.update(originalSender.copy(active = true, status = "sending")) }
                ui.onNodeWithText("PCのQRを読み取る").assertIsNotEnabled().performClick()
                for (label in listOf("LAN", "Tailscale", "直接接続")) ui.onNodeWithText(label).assertIsNotEnabled()
                ui.onNodeWithText("登録を解除").assertIsNotEnabled()
                assertEquals(qr, ui.onNodeWithText("PCのQRを読み取る").getUnclippedBoundsInRoot())
                assertEquals(routes, ui.onNodeWithTag("スマホ連携のネットワーク").getUnclippedBoundsInRoot())
                assertEquals(close, ui.onNodeWithText("閉じる").getUnclippedBoundsInRoot())
                ui.onNodeWithText("閉じる").assertIsFocused()
                instrumentation.setInTouchMode(originalTouchMode)
                ui.onNodeWithText("使い方・注意点").performScrollTo().performClick()
                ui.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").performScrollTo().assertIsDisplayed()
                ui.onNodeWithText("使い方・注意点").performScrollTo().performClick()
                ui.onNodeWithText("登録だけでは送信・配信・読み上げは始まりません。").assertDoesNotExist()
                ui.runOnIdle { OutdoorRuntime.update(originalSender) }
                ui.onNodeWithText("PCのQRを読み取る").performScrollTo()
                instrumentation.uiAutomation.waitForIdle(500, 5_000)
                val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                java.io.File(context.getExternalFilesDir(null), "connection-compact-${mode.storedValue}-$scale.png")
                    .outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                ui.onNodeWithText("登録を解除").performClick()
                ui.onNodeWithText("すべての登録を解除しますか？").assertIsDisplayed()
                ui.onNodeWithText("キャンセル").performClick()
                ui.onNodeWithText("閉じる").assertIsDisplayed().performClick()
                ui.onNodeWithTag("スマホ連携の登録内容").assertDoesNotExist()
                assertFalse(OutdoorRuntime.state.value.active)
                assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            }
        } finally {
            try {
                ui.runOnIdle { OutdoorRuntime.update(originalSender) }
            } finally {
                try {
                    runBlocking { preferences.setAppearance(originalAppearance) }
                } finally {
                    instrumentation.setInTouchMode(originalTouchMode)
                }
            }
        }
    }
}
