package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in presentation-only test. Keeps registration and original appearance; starts no services. */
class CameraOverlayDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun cameraSettingsMatchCommentsAndStoppedStatusHasNoCards() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyCameraOverlay") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val preferences = AppPreferences(context)
        val original = runBlocking { preferences.appearance.first() }
        val evidence = JSONObject()
        try {
            ui.onNodeWithTag("画面切替・カメラ").assertIsSelected()
            val cameraGear = ui.onNodeWithTag("カメラ設定の入口").fetchSemanticsNode().boundsInRoot
            val cameraAction = ui.onNodeWithTag("機能操作の入口").fetchSemanticsNode().boundsInRoot
            val header = ui.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot
            val body = ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot
            for (mode in AppearanceMode.entries) {
                ui.onNodeWithTag("カメラ設定の入口").performClick()
                ui.onNodeWithTag("機能操作メニュー").assertIsDisplayed()
                ui.onNodeWithTag("映像・マイク分類・送信品質").performScrollTo().performClick()
                ui.onNodeWithText("送信品質：", substring = true).performScrollTo().assertIsDisplayed()
                ui.onNodeWithText("戻る").performClick()
                ui.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
                ui.onNodeWithText(if (mode == AppearanceMode.LIGHT) "ライトモード" else "ダークモード")
                    .performScrollTo().performClick()
                ui.waitUntil(5_000) { runBlocking { preferences.appearance.first() == mode } }
                ui.onNodeWithText("閉じる").performClick()
                ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
                assertEquals(header, ui.onNodeWithTag("配信共通操作").fetchSemanticsNode().boundsInRoot)
                assertEquals(body, ui.onNodeWithTag("機能画面").fetchSemanticsNode().boundsInRoot)
                val bitmap = ui.onRoot().captureToImage().asAndroidBitmap()
                val expected = if (mode == AppearanceMode.LIGHT) 0xFFEAF1E9.toInt() else 0xFF293D30.toInt()
                for (tag in listOf("プレビューカメラ表示", "プレビュー送信状態", "プレビューマイク表示", "プレビューOBS表示")) {
                    val rect = ui.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
                    assertEquals("Transparent status padding: $tag", expected,
                        bitmap.getPixel((rect.right - 6).toInt(), rect.center.y.toInt()))
                }
                java.io.File(context.getExternalFilesDir(null), "camera-transparent-${mode.storedValue}.png")
                    .outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                ui.onNodeWithTag("画面切替・コメント").performClick()
                assertEquals(cameraGear, ui.onNodeWithTag("コメント・読み上げ操作").fetchSemanticsNode().boundsInRoot)
                assertTrue(cameraAction.right <= cameraGear.left)
                ui.onNodeWithTag("画面切替・カメラ").performClick()
            }
            ui.onNodeWithTag("機能操作の入口").performClick()
            ui.onNodeWithTag("カメラ・送信操作").assertExists()
            ui.onNodeWithText("送信・配信").assertIsDisplayed()
            ui.onNodeWithText("閉じる").performClick()
            ui.onNodeWithTag("機能操作の入口").assertIsFocused()
            assertFalse(OutdoorRuntime.state.value.active)
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
            evidence.put("lightAndDarkTransparent", true).put("sameHeaderAndBodyGeometry", true)
                .put("directSettingsAndOwnFocus", true).put("existingActionsRetained", true)
                .put("servicesRemainStopped", true)
        } finally {
            runBlocking { preferences.setAppearance(original) }
            java.io.File(context.getExternalFilesDir(null), "camera-transparent-result.json").writeText(evidence.toString(2))
        }
    }
}
