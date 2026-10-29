package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateFilterChip as FilterChip
import jp.casmate.app.ui.CasMateButton as Button
import jp.casmate.app.ui.CasMateOutlinedButton as OutlinedButton
import jp.casmate.app.ui.CasMateTextButton as TextButton
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.core.graphics.ColorUtils
import jp.casmate.app.data.AppearanceMode
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h900dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ControlContrastTest {
    @get:Rule val ui = createComposeRule()

    @Test fun enabledSwitchesHaveVisibleOffControlsAndDifferFromDisabledSwitches() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val checked = mutableStateOf(false)
        var changes = 0
        ui.setContent { CasMateTheme(mode.value) { Surface {
            Column(Modifier.padding(16.dp)) {
                CasMateSwitch(checked.value, { checked.value = it; changes++ }, Modifier.testTag("enabled"))
                CasMateSwitch(checked.value, { changes++ }, Modifier.testTag("disabled"), enabled = false)
            }
        } } }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; checked.value = false }
            for (on in listOf(false, true)) {
                val enabled = ui.onNodeWithTag("enabled").assertIsEnabled()
                val disabled = ui.onNodeWithTag("disabled").assertIsNotEnabled()
                if (on) { enabled.assertIsOn(); disabled.assertIsOn() }
                else { enabled.assertIsOff(); disabled.assertIsOff() }
                val image = enabled.captureToImage().asAndroidBitmap()
                val inactive = disabled.captureToImage().asAndroidBitmap()
                val thumbX = (image.width * if (on) .7f else .3f).toInt()
                val trackX = (image.width * if (on) .3f else .7f).toInt()
                val centerY = image.height / 2
                val thumb = image.getPixel(thumbX, centerY)
                val track = image.getPixel(trackX, centerY)
                assertTrue("$appearance on=$on thumb/track must contrast", ColorUtils.calculateContrast(thumb, track) >= 3.0)
                assertNotEquals("Enabled and disabled controls must differ", if (on) track else thumb,
                    inactive.getPixel(if (on) trackX else thumbX, centerY))
                if (!on) {
                    val background = image.getPixel(0, 0)
                    assertTrue("$appearance OFF thumb must contrast with its background",
                        ColorUtils.calculateContrast(thumb, background) >= 3.0)
                    var borderContrast = 1.0
                    for (y in 0 until image.height / 3) borderContrast = maxOf(borderContrast,
                        ColorUtils.calculateContrast(image.getPixel(image.width / 2, y), background))
                    assertTrue("$appearance OFF border must contrast with its background", borderContrast >= 3.0)
                }
                val before = changes
                disabled.performClick()
                assertEquals(before, changes)
                enabled.performClick()
                assertEquals(before + 1, changes)
            }
        }
    }

    @Test fun currentSelectionAndDisabledActionLabelsRemainReadableInBothThemes() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        var clicks = 0
        ui.setContent { CasMateTheme(mode.value) { Surface {
            Column(Modifier.width(360.dp).padding(16.dp)) {
                for (enabled in listOf(true, false)) {
                    Row {
                        FilterChip(selected = true, enabled = enabled, onClick = { clicks++ },
                            label = { Text("縦向き", Modifier.testTag("selected-$enabled")) })
                        FilterChip(selected = false, enabled = enabled, onClick = { clicks++ },
                            label = { Text("横向き", Modifier.testTag("other-$enabled")) })
                    }
                    Button(enabled = enabled, onClick = { clicks++ }) { Text("QRを読み取る", Modifier.testTag("filled-$enabled")) }
                    OutlinedButton(enabled = enabled, onClick = { clicks++ }) { Text("映像を隠す", Modifier.testTag("outline-$enabled")) }
                    TextButton(enabled = enabled, onClick = { clicks++ }) { Text("再試行", Modifier.testTag("text-$enabled")) }
                }
            }
        } } }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance }
            val bitmap = ui.onRoot().captureToImage().asAndroidBitmap()
            for (enabled in listOf(true, false)) for (type in listOf("selected", "other", "filled", "outline", "text")) {
                val bounds = ui.onNodeWithTag("$type-$enabled", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
                // The edge of the label's ink box is the actual composited control background.
                val background = bitmap.getPixel(bounds.left.toInt(), bounds.top.toInt())
                var contrast = 1.0
                for (y in bounds.top.toInt() until bounds.bottom.toInt()) for (x in bounds.left.toInt() until bounds.right.toInt()) {
                    contrast = maxOf(contrast, ColorUtils.calculateContrast(bitmap.getPixel(x, y), background))
                }
                assertTrue("${appearance.storedValue} $type enabled=$enabled text contrast=$contrast", contrast >= 4.5)
            }
            ui.onAllNodesWithText("縦向き").filterToOne(isNotEnabled()).assertIsSelected().assertIsNotEnabled().performClick()
            assertEquals("A read-only choice must never invoke its callback", 0, clicks)
            val capture = java.io.File("build/reports/layout/controls-${appearance.storedValue}.png")
            checkNotNull(capture.parentFile).mkdirs()
            capture.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    @Test fun selectingSettingsKeepsLabelPositionsAndReadOnlySwitchesKeepTheirValue() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val selected = mutableStateOf(false)
        var switchClicks = 0
        ui.setContent { CasMateTheme(mode.value) { Surface {
            Column(Modifier.width(320.dp).padding(16.dp)) {
                FilterChip(selected.value, { selected.value = !selected.value },
                    { Text("縦向き", Modifier.testTag("label")) }, Modifier.testTag("choice"))
                for (checked in listOf(true, false)) CasMateSwitch(checked, { switchClicks++ },
                    Modifier.testTag("switch-$checked"), enabled = false)
            }
        } } }
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; selected.value = false }
            val bounds = ui.onNodeWithTag("label", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            ui.onNodeWithTag("choice").assertIsNotSelected().performClick().assertIsSelected()
            assertEquals(bounds, ui.onNodeWithTag("label", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
            for (checked in listOf(true, false)) {
                val node = ui.onNodeWithTag("switch-$checked").assertIsNotEnabled()
                if (checked) node.assertIsOn() else node.assertIsOff()
                val bitmap = node.captureToImage().asAndroidBitmap()
                val ink = bitmap.getPixel((bitmap.width * if (checked) .3f else .7f).toInt(), bitmap.height / 2)
                val base = bitmap.getPixel((bitmap.width * if (checked) .7f else .3f).toInt(), bitmap.height / 2)
                for (color in listOf(ink, base)) {
                    val channels = listOf(android.graphics.Color.red(color), android.graphics.Color.green(color), android.graphics.Color.blue(color))
                    assertTrue("Disabled switches must be neutral gray, without green tint", channels.max() - channels.min() <= 2)
                }
                var inkPixels = 0
                var basePixels = 0
                for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
                    if (bitmap.getPixel(x, y) == ink) inkPixels++
                    if (bitmap.getPixel(x, y) == base) basePixels++
                }
                assertTrue("Both thumb and track must remain visible", inkPixels > 20 && basePixels > 20)
                assertTrue(ColorUtils.calculateContrast(ink, base) >= 3.0)
                node.performClick()
                assertEquals(0, switchClicks)
            }
        }
    }
}
