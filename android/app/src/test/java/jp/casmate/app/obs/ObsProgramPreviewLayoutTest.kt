package jp.casmate.app.obs

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
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
class ObsProgramPreviewLayoutTest {
    @get:Rule val ui = createComposeRule()
    @Test fun bothThemesAndDoubleTextKeepActionsAndImageGeometryAcrossResults() {
        val state = mutableStateOf(ObsProgramPreviewState(open = true, working = true, message = "OBS映像を取得中…"))
        val theme = mutableStateOf(AppearanceMode.LIGHT); val scale = mutableFloatStateOf(1f)
        var updates = 0; var closes = 0
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.floatValue)) {
                CasMateTheme(theme.value) { Surface(Modifier.width(320.dp).height(760.dp)) {
                    ObsProgramPreviewContent(state.value, true, null, { updates++ }, { closes++ })
                } }
            }
        }
        val image = ObsProgramImage(Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888), "配信シーン".repeat(20), "2026-10-14T00:00:00Z")
        for (appearance in listOf(AppearanceMode.LIGHT, AppearanceMode.DARK)) for (fontScale in listOf(1f, 2f)) {
            ui.runOnIdle { theme.value = appearance; scale.floatValue = fontScale; state.value = ObsProgramPreviewState(open = true, working = true, message = "OBS映像を取得中…") }
            ui.onNodeWithTag("OBS画像・更新").assertIsDisplayed().assertIsNotEnabled()
            val update = ui.onNodeWithTag("OBS画像・更新").fetchSemanticsNode().boundsInRoot
            val close = ui.onNodeWithTag("OBS画像・閉じる").fetchSemanticsNode().boundsInRoot
            val area = ui.onNodeWithTag("OBS画像領域").fetchSemanticsNode().boundsInRoot
            for (result in listOf(ObsProgramPreviewState(open = true, image = image),
                ObsProgramPreviewState(open = true, message = "取得できません。接続と操作許可を確認してください。".repeat(12)),
                ObsProgramPreviewState(open = true))) {
                ui.runOnIdle { state.value = result }
                ui.onNodeWithTag("OBS画像・更新").assertIsDisplayed().assertIsEnabled()
                ui.onNodeWithTag("OBS画像・閉じる").assertIsDisplayed()
                assertEquals(update, ui.onNodeWithTag("OBS画像・更新").fetchSemanticsNode().boundsInRoot)
                assertEquals(close, ui.onNodeWithTag("OBS画像・閉じる").fetchSemanticsNode().boundsInRoot)
                assertEquals(area, ui.onNodeWithTag("OBS画像領域").fetchSemanticsNode().boundsInRoot)
                ui.onNodeWithTag("OBS画像領域").captureToImage()
            }
            ui.onNodeWithTag("OBS画像・更新").performClick(); ui.onNodeWithTag("OBS画像・閉じる").performClick()
        }
        assertEquals(4, updates); assertEquals(4, closes)
    }
}
