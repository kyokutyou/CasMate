package jp.casmate.app.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import jp.casmate.app.data.AppearanceMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class CasMateThemeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun lightThemeMatchesTheAdoptedMockPaletteAcrossNativeSurfacesAndActions() {
        lateinit var colors: androidx.compose.material3.ColorScheme
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) { colors = androidx.compose.material3.MaterialTheme.colorScheme } }
        compose.runOnIdle {
            fun color(value: Long) = androidx.compose.ui.graphics.Color(value)
            assertEquals(color(0xFFF5F7F4), colors.background)
            assertEquals(color(0xFFFFFFFF), colors.surface)
            assertEquals(color(0xFF1D3029), colors.onSurface)
            assertEquals(color(0xFF52685C), colors.onSurfaceVariant)
            assertEquals(color(0xFFD9E3DB), colors.outline)
            assertEquals(color(0xFFEAF1E9), colors.primaryContainer)
            assertEquals(color(0xFF236245), colors.primary)
            assertEquals(color(0xFFFFFFFF), colors.onPrimary)
            assertEquals(color(0xFFA13535), colors.error)
        }
    }

    @Test fun explicitChoicesExposeSelectionAndSavingFailureDoesNotMoveTheButtons() {
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val error = mutableStateOf<String?>(null)
        compose.setContent {
            CasMateTheme(appearance.value) { AppearanceSettings(appearance.value, { appearance.value = it }, error.value) }
        }
        compose.onNodeWithText("ライトモード").assertIsSelected()
        val light = compose.onNodeWithText("ライトモード").fetchSemanticsNode().boundsInRoot
        val dark = compose.onNodeWithText("ダークモード").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("ダークモード").performClick().assertIsSelected()
        compose.onNodeWithText("ライトモード").assertIsNotSelected()
        compose.runOnIdle { error.value = "配色を保存できませんでした。もう一度選択してください。" }
        compose.onNodeWithText("配色を保存できませんでした。もう一度選択してください。").assertIsDisplayed()
        assertEquals(light, compose.onNodeWithText("ライトモード").fetchSemanticsNode().boundsInRoot)
        assertEquals(dark, compose.onNodeWithText("ダークモード").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("ライトモード").performClick().assertIsSelected()
    }
}
