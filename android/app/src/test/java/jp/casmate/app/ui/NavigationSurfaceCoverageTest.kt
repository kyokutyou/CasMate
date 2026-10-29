package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.outdoor.OutdoorDiagnosticSummary
import jp.casmate.app.outdoor.OutdoorPreviewBadges
import jp.casmate.app.outdoor.OutdoorState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h760dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NavigationSurfaceCoverageTest {
    @get:Rule val compose = createComposeRule()

    @Test fun previewBadgesAndMarginsAllowHorizontalFlicks() {
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("保持されたコメント") }, {
                    Box(Modifier.fillMaxSize()) {
                        OutdoorPreviewBadges(OutdoorState(active = true, status = "sending"), false, null, "準備済み")
                    }
                })
            }
        } }
        // Covers the scrollable top badges, status/meter, uncovered canvas and lower OBS badge.
        for (fraction in listOf(0.04f, 0.11f, 0.18f, 0.27f, 0.5f, 0.97f)) {
            compose.onNodeWithTag("機能画面").performTouchInput {
                swipe(Offset(width * 0.8f, height * fraction), Offset(width * 0.2f, height * fraction), 220)
            }
            compose.onNodeWithTag("画面切替・コメント").assertIsSelected()
            compose.onNodeWithTag("画面切替・カメラ").performClick()
        }
    }

    @Test fun diagnosticSummaryFlicksHorizontallyAndScrollsVertically() {
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs({ Text("保持されたコメント") }, {
                    OutdoorDiagnosticSummary(OutdoorState(active = true, status = "sending"), Modifier.fillMaxWidth())
                })
            }
        } }
        compose.onNodeWithTag("診断表示要約・本文").performTouchInput { swipeUp() }
        compose.onNodeWithTag("画面切替・カメラ").assertIsSelected()
        compose.onNodeWithTag("診断表示要約・本文").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("画面切替・コメント").assertIsSelected()
    }
}
