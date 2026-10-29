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

/** Opt-in UI check: preserves registration and appearance and starts no services. */
class UnifiedCameraMenuDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun directSenderAndAllCategoriesRemainUsableInBothThemes() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyUnifiedCameraMenu") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val preferences = AppPreferences(context)
        val original = runBlocking { preferences.appearance.first() }
        try {
            val send = ui.onNodeWithTag("機能操作の入口").fetchSemanticsNode().boundsInRoot
            val connection = ui.onNodeWithContentDescription("スマホ連携").fetchSemanticsNode().boundsInRoot
            val menu = ui.onNodeWithTag("カメラ設定の入口").fetchSemanticsNode().boundsInRoot
            assertTrue(send.right <= connection.left && connection.right <= menu.left)
            for (mode in AppearanceMode.entries) {
                ui.onNodeWithTag("カメラ設定の入口").performClick()
                category("その他")
                ui.onNodeWithText(if (mode == AppearanceMode.LIGHT) "ライトモード" else "ダークモード")
                    .performScrollTo().performClick()
                ui.waitUntil(5_000) { runBlocking { preferences.appearance.first() == mode } }
                ui.onNodeWithText("戻る").performClick()
                capture("list-${mode.storedValue}")
                for (name in listOf("カメラ", "マイク", "送信品質", "画面表示")) {
                    category(name)
                    ui.onNodeWithText("閉じる").assertIsDisplayed()
                    when (name) {
                        "カメラ" -> ui.onNodeWithText("前面").assertIsEnabled()
                        "マイク" -> ui.onNodeWithTag("カメラ・ミュート").performScrollTo().assertIsNotEnabled()
                        "送信品質" -> ui.onNodeWithText("横向き").assertIsEnabled()
                        "画面表示" -> ui.onNodeWithText("プレビューを閉じる").assertIsEnabled()
                    }
                    ui.onNodeWithText("戻る").performClick()
                }
                ui.onNodeWithTag("映像・マイク分類・送信・配信").assertDoesNotExist()
                ui.onNodeWithTag("カメラ・送信操作").assertDoesNotExist()
                ui.onNodeWithText("閉じる").performClick()
                ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
                ui.onNodeWithTag("機能操作の入口").performClick()
                ui.onNodeWithText("送信・配信").assertIsDisplayed()
                capture("send-${mode.storedValue}")
                ui.onNodeWithText("閉じる").performClick()
                ui.onNodeWithTag("機能操作の入口").assertIsFocused()
                capture("header-${mode.storedValue}")
                ui.onNodeWithTag("カメラ設定の入口").performClick()
                category("通信・診断")
                ui.onNodeWithTag("機能操作メニュー").assertDoesNotExist()
                listOf("概要", "自動調整", "通信", "履歴").forEach { ui.onNodeWithText(it).assertIsDisplayed() }
                ui.onNodeWithText("診断を閉じる").performClick()
                assertFalse(OutdoorRuntime.state.value.active)
                assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            }
        } finally {
            runBlocking { preferences.setAppearance(original) }
            assertEquals(original, runBlocking { preferences.appearance.first() })
        }
    }

    private fun category(name: String) {
        ui.onNodeWithTag("映像・マイク分類・$name").performScrollTo().performClick()
    }
    private fun capture(name: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.waitForIdle(500, 5_000)
        val bitmap = checkNotNull(automation.takeScreenshot())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.getExternalFilesDir(null), "unified-camera-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}
