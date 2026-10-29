package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h900dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RegistrationWelcomeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun compactWelcomeKeepsTheQrActionVisibleThroughLongFailures() {
        val message = mutableStateOf<String?>(null)
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        compose.setContent { CasMateTheme(mode.value) {
            Surface(modifier = Modifier.width(320.dp).height(470.dp), color = MaterialTheme.colorScheme.background) {
                RegistrationWelcome(mode.value, {}, {}, {}, {}, false, false,
                    message.value, message.value != null)
            }
        } }
        compose.onNodeWithTag("初回QR読取").assertIsDisplayed()
        val qr = compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot
        val help = compose.onNodeWithText("QRコードの表示場所").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { message.value = jp.casmate.app.obs.registrationFailureMessage(
            jp.casmate.app.obs.directEnrollmentConnectionFailure(java.net.SocketTimeoutException(), true)) }
        compose.onNodeWithText(message.value!!).assertExists()
        compose.onNodeWithText("全文を見る").assertIsDisplayed().performClick()
        compose.onNodeWithTag("登録案内の全文").assertTextContains(message.value!!)
        compose.onNodeWithTag("登録案内の全文を閉じる").performClick()
        assertEquals(qr, compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot)
        assertEquals(help, compose.onNodeWithText("QRコードの表示場所").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithText("アプリ設定").assertIsDisplayed()
        compose.runOnIdle { mode.value = AppearanceMode.DARK }
        compose.onNodeWithText(message.value!!).assertExists()
        assertEquals(qr, compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot)
        assertEquals(help, compose.onNodeWithText("QRコードの表示場所").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun largeTextKeepsBothQrAndCorruptRegistrationRecoveryAccessible() {
        RuntimeEnvironment.setFontScale(2f)
        var scans = 0
        var recovery = 0
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(modifier = Modifier.width(320.dp).height(760.dp), color = MaterialTheme.colorScheme.background) {
                RegistrationWelcome(AppearanceMode.LIGHT, {}, { scans++ }, {}, { recovery++ }, true, false,
                    "登録情報を復元できません。既存登録を保持しています。", true)
            }
        } }
        compose.onNodeWithTag("初回QR読取").assertIsDisplayed().performClick()
        compose.onNodeWithText("登録を確認・解除").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, scans); assertEquals(1, recovery) }
    }

    @Test fun bothAppearancesRenderWithoutMovingTheFirstLaunchActions() {
        val mode = mutableStateOf(AppearanceMode.LIGHT)
        compose.setContent { CasMateTheme(mode.value) {
            Surface(modifier = Modifier.width(400.dp).height(840.dp).testTag("初回登録の描画"), color = MaterialTheme.colorScheme.background) {
                RegistrationWelcome(mode.value, { mode.value = it }, {}, {}, {}, false, false, null, false)
            }
        } }
        settleDraw()
        val qr = compose.onNodeWithTag("初回QR読取").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertQrLabelPainted(android.graphics.Color.WHITE)
        assertEquals(android.graphics.Color.rgb(245, 247, 244),
            compose.onNodeWithTag("初回登録の描画").captureToImage().asAndroidBitmap().getPixel(0, 0))
        capture("android-welcome-light")
        compose.onNodeWithText("☾ ダークモード").performClick()
        settleDraw()
        assertEquals(qr, compose.onNodeWithTag("初回QR読取").fetchSemanticsNode().boundsInRoot)
        assertQrLabelPainted(android.graphics.Color.rgb(22, 48, 34))
        assertEquals(android.graphics.Color.rgb(21, 27, 25),
            compose.onNodeWithTag("初回登録の描画").captureToImage().asAndroidBitmap().getPixel(0, 0))
        capture("android-welcome-dark")
    }

    private fun capture(name: String) {
        val output = java.io.File("build/reports/layout/$name.png")
        checkNotNull(output.parentFile).mkdirs()
        output.outputStream().use { stream -> compose.onNodeWithTag("初回登録の描画").captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream) }
    }

    private fun settleDraw() {
        compose.mainClock.advanceTimeBy(400)
        compose.waitForIdle()
    }

    private fun assertQrLabelPainted(expectedColor: Int) {
        val button = compose.onNodeWithTag("初回QR読取")
            .assertTextContains("PCのQRコードを読み取る")
            .captureToImage().asAndroidBitmap()
        var ink = 0
        // Ignore rounded edges; the middle must contain the contrasting label, not a blank fill.
        for (y in button.height / 4 until button.height * 3 / 4) {
            for (x in button.width / 5 until button.width * 4 / 5) {
                val pixel = button.getPixel(x, y)
                if (kotlin.math.abs(android.graphics.Color.red(pixel) - android.graphics.Color.red(expectedColor)) < 24 &&
                    kotlin.math.abs(android.graphics.Color.green(pixel) - android.graphics.Color.green(expectedColor)) < 24 &&
                    kotlin.math.abs(android.graphics.Color.blue(pixel) - android.graphics.Color.blue(expectedColor)) < 24) ink++
            }
        }
        assertTrue("The QR button label must be painted in the selected appearance", ink > 10)
    }
}
