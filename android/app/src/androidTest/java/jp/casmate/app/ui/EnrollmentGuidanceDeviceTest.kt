package jp.casmate.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.data.AppearanceMode
import jp.casmate.app.obs.directEnrollmentConnectionFailure
import jp.casmate.app.obs.registrationFailureMessage
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule

/** Opt-in presentation check in a test activity; never reads or changes the user's registration. */
class EnrollmentGuidanceDeviceTest {
    private val ui = createComposeRule()
    private val optIn = TestRule { base, _ -> object : org.junit.runners.model.Statement() {
        override fun evaluate() {
            assumeTrue(InstrumentationRegistry.getArguments().getString("verifyEnrollmentGuidance") == "true")
            base.evaluate()
        }
    } }
    @get:Rule val rules: TestRule = RuleChain.outerRule(optIn).around(ui)

    @Test fun longWifiFailureKeepsTheQrActionInBothThemes() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        val message = mutableStateOf<String?>(null)
        val guidance = registrationFailureMessage(directEnrollmentConnectionFailure(SocketTimeoutException(), true))
        ui.setContent { CasMateTheme(mode.value) {
            Surface(Modifier.width(320.dp).height(470.dp).testTag("登録案内の実機描画"), color = MaterialTheme.colorScheme.background) {
                RegistrationWelcome(mode.value, {}, {}, {}, {}, false, false, message.value, message.value != null)
            }
        } }
        val qr = ui.onNodeWithTag("初回QR読取").assertIsDisplayed().getUnclippedBoundsInRoot()
        for (appearance in AppearanceMode.entries) {
            ui.runOnIdle { mode.value = appearance; message.value = guidance }
            ui.onNodeWithText(guidance).assertExists()
            assertEquals(qr, ui.onNodeWithTag("初回QR読取").assertIsDisplayed().getUnclippedBoundsInRoot())
            ui.onNodeWithText("アプリ設定").assertIsDisplayed()
            ui.onNodeWithText("全文を見る").assertIsDisplayed().performClick()
            ui.onNodeWithTag("登録案内の全文").assertTextContains(guidance)
                .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 10_000f) }
            ui.waitForIdle()
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val context = instrumentation.targetContext
            val output = java.io.File(context.getExternalFilesDir(null), "enrollment-guidance-${appearance.storedValue}.png")
            output.outputStream().use { checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                .compress(Bitmap.CompressFormat.PNG, 100, it) }
            ui.onNodeWithTag("登録案内の全文を閉じる").assertIsDisplayed().performClick()
            assertEquals(qr, ui.onNodeWithTag("初回QR読取").assertIsDisplayed().getUnclippedBoundsInRoot())
        }
    }
}
