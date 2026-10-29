package jp.casmate.app.ui

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import jp.casmate.app.data.AppearanceMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h470dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RegistrationNoticeDetailsTest {
    @get:Rule val ui = createComposeRule()

    @Test fun confirmingTheOpenedSnapshotDoesNotConfirmANewerMessage() {
        val message = mutableStateOf("以前の登録更新案内")
        val confirmed = mutableListOf<String>()
        ui.setContent { CasMateTheme(AppearanceMode.LIGHT) { RegistrationNoticeDetails(message.value, onConfirmed = confirmed::add) } }
        ui.onNodeWithText("全文を見る").performClick()
        ui.runOnIdle { message.value = "新しい登録更新案内" }
        ui.onNodeWithTag("登録案内の全文").assertTextContains("以前の登録更新案内")
        ui.onNodeWithTag("登録案内の全文を閉じる").performClick()
        ui.runOnIdle { check(confirmed == listOf("以前の登録更新案内")) }
        ui.onNodeWithText("全文を見る").performClick()
        ui.onNodeWithTag("登録案内の全文").assertTextContains("新しい登録更新案内")
    }

    @Test fun clearingTheNoticeKeepsTheFocusedReaderActionAtBothTextSizes() {
        val message = mutableStateOf("PCへの接続に失敗しました。")
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        val scale = mutableStateOf(1f)
        var inputMode: InputModeManager? = null
        ui.setContent {
            val density = LocalDensity.current
            val manager = LocalInputModeManager.current
            SideEffect { inputMode = manager }
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
                CasMateTheme(appearance.value) { RegistrationNoticeDetails(message.value) }
            }
        }
        for (mode in AppearanceMode.entries) for (fontScale in listOf(1f, 2f)) {
            ui.runOnIdle { appearance.value = mode; scale.value = fontScale; message.value = "PCへの接続に失敗しました。" }
            ui.runOnIdle { checkNotNull(inputMode).requestInputMode(InputMode.Keyboard) }
            ui.onNodeWithText("全文を見る").assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            ui.onNodeWithText("全文を見る").assertIsFocused()
            ui.runOnIdle { message.value = "" }
            ui.onNodeWithText("全文を見る").assertIsFocused().performClick()
            ui.onNodeWithTag("登録案内の全文").assertTextContains("現在、案内はありません。")
            ui.onNodeWithTag("登録案内の全文を閉じる").assertIsDisplayed().performClick()
        }
    }
}
