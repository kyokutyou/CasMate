package jp.casmate.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import jp.casmate.app.audio.AudioStatus
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CommentsReadingToggleTest {
    @get:Rule val ui = createComposeRule()

    @Test fun headphonesDirectlyToggleEveryStateAndSettingsNeverIssueServiceCommands() {
        val status = mutableStateOf(AudioStatus.STOPPED)
        val registered = mutableStateOf(false)
        var starts = 0
        var stops = 0
        ui.setContent {
            MaterialTheme {
                CasMateTabs(commentsContent = { Text("コメント本文") }, outdoorContent = { Text("カメラ本文") },
                    readingActive = status.value.readingActive, readingRegistered = registered.value,
                    commentsActionStatus = status.value.label,
                    onToggleReading = { if (status.value.readingActive) stops++ else starts++ },
                    commentsSettingsContent = { close -> AlertDialog(onDismissRequest = close,
                        text = { Text(status.value.label) },
                        confirmButton = { TextButton(onClick = close) { Text("閉じる") } }) })
            }
        }
        ui.onNodeWithTag("コメント・読み上げ操作").assertDoesNotExist()
        ui.onNodeWithTag("画面切替・コメント").performClick()
        ui.onNodeWithContentDescription("読み上げを聞く").assertIsOff().assertIsNotEnabled()
        ui.runOnIdle { registered.value = true }
        val off = setOf(AudioStatus.STOPPED, AudioStatus.NOTIFICATION_PERMISSION_REQUIRED, AudioStatus.NETWORK_PERMISSION_REQUIRED, AudioStatus.FOREGROUND_UNAVAILABLE)
        var expectedStarts = 0
        var expectedStops = 0
        for (value in AudioStatus.entries) {
            ui.runOnIdle { status.value = value }
            val node = ui.onNodeWithTag("コメント・読み上げ操作")
            node.assertIsEnabled()
            if (value in off) { node.assertIsOff(); expectedStarts++ }
            else { node.assertIsOn(); expectedStops++ }
            node.performClick()
            assertEquals(expectedStarts, starts)
            assertEquals(expectedStops, stops)
            ui.onNodeWithText("コメントの操作").assertDoesNotExist()
            ui.onNodeWithTag("コメント設定の入口").performClick()
            ui.onNodeWithText(value.label).assertIsDisplayed()
            ui.onNodeWithText("閉じる").performClick()
            assertEquals(expectedStarts, starts)
            assertEquals(expectedStops, stops)
        }
        ui.runOnIdle { registered.value = false; status.value = AudioStatus.ERROR }
        ui.onNodeWithContentDescription("読み上げを停止").assertIsEnabled().performClick()
        assertEquals(expectedStops + 1, stops)
        ui.onNodeWithTag("画面切替・カメラ").performClick()
        ui.onNodeWithTag("コメント設定の入口").assertDoesNotExist()
        ui.onNodeWithTag("コメント・読み上げ操作").assertDoesNotExist()
        ui.onNodeWithTag("画面切替・コメント").performClick()
        assertEquals(expectedStarts, starts)
        assertEquals(expectedStops + 1, stops)
    }
}
