package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.core.graphics.ColorUtils
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.audio.AudioServiceState
import jp.casmate.app.audio.AudioStatus
import jp.casmate.app.data.AppPreferences
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.OutdoorRuntime
import jp.casmate.app.outdoor.OutdoorPreferences
import jp.casmate.app.outdoor.OutdoorBitrateMode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in UI check. A synthetic sending state locks choices; no camera/audio services are started. */
class ControlContrastDeviceTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun weakSignalSwitchShowsEnabledOffAndFixedModeIsReadOnlyGray() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyWeakSwitch") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val preferences = AppPreferences(context)
        val qualityPreferences = OutdoorPreferences(context)
        val originalAppearance = runBlocking { preferences.appearance.first() }
        val originalQuality = qualityPreferences.quality()
        val originalState = OutdoorRuntime.state.value
        fun weak() = ui.onNodeWithTag("弱回線対策スイッチ")
        fun photograph(name: String) {
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            automation.waitForIdle(500, 5_000)
            val image = checkNotNull(automation.takeScreenshot())
            java.io.File(context.getExternalFilesDir(null), "weak-switch-$name.png").outputStream().use {
                image.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            image.recycle()
        }
        try {
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            for (mode in AppearanceMode.entries) {
                if (mode != AppearanceMode.entries.first()) ui.onNodeWithText("戻る").performClick()
                ui.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
                ui.onNodeWithText(if (mode == AppearanceMode.LIGHT) "ライトモード" else "ダークモード")
                    .performScrollTo().performClick()
                ui.waitUntil(5_000) { runBlocking { preferences.appearance.first() == mode } }
                ui.onNodeWithText("戻る").performClick()
                ui.onNodeWithTag("映像・マイク分類・カメラ").performScrollTo().performClick()
                ui.onNodeWithTag("診断用時刻スイッチ").performScrollTo().assertIsEnabled()
                ui.onNodeWithText("戻る").performClick()
                ui.onNodeWithTag("映像・マイク分類・送信品質").performScrollTo().performClick()
                ui.onNodeWithText("自動").performScrollTo().performClick()
                val control = weak().performScrollTo().assertIsEnabled()
                if (qualityPreferences.quality().audioFirst) control.performClick()
                control.assertIsOff()
                val off = control.captureToImage().asAndroidBitmap()
                val thumbX = (off.width * .3f).toInt()
                val trackX = (off.width * .7f).toInt()
                val centerY = off.height / 2
                val enabledThumb = off.getPixel(thumbX, centerY)
                assertTrue(ColorUtils.calculateContrast(enabledThumb, off.getPixel(trackX, centerY)) >= 3.0)
                photograph("${mode.storedValue}-auto-off")
                control.performClick().assertIsOn()
                assertTrue(qualityPreferences.quality().audioFirst)
                photograph("${mode.storedValue}-auto-on")
                ui.onNodeWithText("固定").performScrollTo().performClick()
                weak().performScrollTo().assertIsNotEnabled().assertIsOff()
                val fixed = weak().captureToImage().asAndroidBitmap()
                assertNotEquals(enabledThumb, fixed.getPixel(thumbX, centerY))
                val disabledThumb = fixed.getPixel(thumbX, centerY)
                val disabledTrack = fixed.getPixel(trackX, centerY)
                for (color in listOf(disabledThumb, disabledTrack)) {
                    val channels = listOf(android.graphics.Color.red(color), android.graphics.Color.green(color), android.graphics.Color.blue(color))
                    assertTrue("Fixed mode must show neutral gray", channels.max() - channels.min() <= 2)
                }
                assertTrue(ColorUtils.calculateContrast(disabledThumb, disabledTrack) >= 3.0)
                val fixedQuality = qualityPreferences.quality()
                assertEquals(OutdoorBitrateMode.FIXED, fixedQuality.bitrateMode)
                weak().performClick()
                assertEquals(fixedQuality, qualityPreferences.quality())
                photograph("${mode.storedValue}-fixed-off")
                ui.onNodeWithText("自動").performScrollTo().performClick()
                weak().performScrollTo().assertIsEnabled().assertIsOff()
                weak().performClick().assertIsOn()
                val lockedQuality = qualityPreferences.quality()
                ui.runOnIdle { OutdoorRuntime.update(originalState.copy(active = true, status = "sending", quality = lockedQuality)) }
                weak().assertIsNotEnabled().assertIsOn().performClick().assertIsOn()
                assertEquals(lockedQuality, qualityPreferences.quality())
                ui.runOnIdle { OutdoorRuntime.update(originalState) }
            }
            assertFalse(OutdoorRuntime.state.value.active)
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        } finally {
            // Restoration must not depend on a Compose idle wait after a failed assertion.
            OutdoorRuntime.update(originalState)
            try {
                qualityPreferences.saveQuality(originalQuality)
                assertEquals(originalQuality, qualityPreferences.quality())
            } finally {
                runBlocking { preferences.setAppearance(originalAppearance) }
                assertEquals(originalAppearance, runBlocking { preferences.appearance.first() })
            }
        }
    }

    @Test fun actualCameraSettingsKeepSelectedValuesReadableWhenLocked() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyControlContrast") == "true")
        assertFalse(OutdoorRuntime.state.value.active)
        assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val preferences = AppPreferences(context)
        val original = runBlocking { preferences.appearance.first() }
        val originalState = OutdoorRuntime.state.value
        try {
            ui.onNodeWithTag("カメラ設定の入口").performClick()
            for (mode in AppearanceMode.entries) {
                ui.onNodeWithTag("映像・マイク分類・その他").performScrollTo().performClick()
                ui.onNodeWithText(if (mode == AppearanceMode.LIGHT) "ライトモード" else "ダークモード")
                    .performScrollTo().performClick()
                ui.waitUntil(5_000) { runBlocking { preferences.appearance.first() == mode } }
                ui.onNodeWithText("戻る").performClick()
                for (locked in listOf(false, true)) {
                    ui.runOnIdle { OutdoorRuntime.update(originalState.copy(active = locked, status = if (locked) "sending" else "stopped")) }
                    for (label in listOf("横向き", "縦向き", "背面", "前面")) {
                        if (label == "横向き") ui.onNodeWithTag("映像・マイク分類・送信品質").performScrollTo().performClick()
                        if (label == "背面") {
                            ui.onNodeWithText("戻る").performClick()
                            ui.onNodeWithTag("映像・マイク分類・カメラ").performScrollTo().performClick()
                        }
                        val node = ui.onNodeWithText(label)
                        val bitmap = ui.onNodeWithText(label, useUnmergedTree = true).captureToImage().asAndroidBitmap()
                        val background = bitmap.getPixel(0, 0)
                        var ratio = 1.0
                        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
                            ratio = maxOf(ratio, ColorUtils.calculateContrast(bitmap.getPixel(x, y), background))
                        }
                        assertTrue("${mode.storedValue} locked=$locked $label contrast=$ratio", ratio >= 4.5)
                        if (locked && label in listOf("横向き", "縦向き")) {
                            node.assertIsNotEnabled()
                            val selected = node.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Selected]
                            node.performClick()
                            assertEquals(selected, node.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Selected])
                        }
                    }
                    // Capture all Android windows: a Compose root image excludes the dialog window.
                    InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(500, 5_000)
                    val capture = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
                    java.io.File(context.getExternalFilesDir(null), "settings-contrast-${mode.storedValue}-$locked.png")
                        .outputStream().use { capture.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    ui.onNodeWithText("戻る").performClick()
                }
                ui.runOnIdle { OutdoorRuntime.update(originalState) }
            }
            ui.onNodeWithText("閉じる").performClick()
            ui.onNodeWithTag("カメラ設定の入口").assertIsFocused()
            assertFalse(OutdoorRuntime.state.value.active)
            assertEquals(AudioStatus.STOPPED, AudioServiceState.status.value)
        } finally {
            ui.runOnIdle { OutdoorRuntime.update(originalState) }
            runBlocking { preferences.setAppearance(original) }
        }
    }
}
