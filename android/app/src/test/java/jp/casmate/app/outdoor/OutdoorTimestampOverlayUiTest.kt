package jp.casmate.app.outdoor

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import jp.casmate.app.ui.CasMateTabs
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class OutdoorTimestampOverlayUiTest {
    @get:Rule val compose = createComposeRule()

    @After fun resetOutdoorState() { OutdoorRuntime.update(OutdoorState()) }

    @Test fun timestampSwitchIsSessionOnlyAndLocksToTheActiveServiceValue() {
        OutdoorRuntime.update(OutdoorState())
        compose.setContent { MaterialTheme { TimestampOverlayTestHost() } }
        openSettings()

        val toggle = compose.onNodeWithTag("診断用時刻スイッチ")
        toggle.assertIsOff()
        compose.onNodeWithText("プレビュー・SRT映像とOBS録画・配信に表示されます。", substring = true)
            .performScrollTo().assertExists()

        toggle.performClick()
        toggle.assertIsOn()
        compose.onNodeWithText("閉じる").performClick()
        openSettings()
        compose.onNodeWithTag("診断用時刻スイッチ").assertIsOn()

        compose.runOnIdle {
            OutdoorRuntime.update(OutdoorState(active = true, status = "sending", timestampOverlay = true))
        }
        val activeToggle = compose.onNodeWithTag("診断用時刻スイッチ")
        activeToggle.assertIsOn()
        activeToggle.assertIsNotEnabled()
        compose.onNodeWithText("送信中は変更できません").performScrollTo().assertExists()

        compose.runOnIdle { OutdoorRuntime.update(OutdoorState()) }
        compose.onNodeWithTag("診断用時刻スイッチ").assertIsOff()
    }

    @Test fun timestampSwitchDoesNotSurviveSavedDraftRestoration() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MaterialTheme { TimestampDraftRestorationHost() } }
        val switch = compose.onNodeWithTag("診断用時刻スイッチ")
        switch.assertIsOff()
        switch.performClick()
        compose.waitForIdle()
        switch.assertIsOn()

        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("診断用時刻スイッチ").assertIsOff()
    }

    @Test fun startRequestCarriesTheChoiceAndConsumesItOnlyWhenAccepted() {
        val context = RuntimeEnvironment.getApplication()
        val draft = OutdoorDraft()
        draft.timestampOverlay.value = true
        var requested: android.content.Intent? = null

        val accepted = requestOutdoorServiceStart(context, draft, portrait = true, front = false, device = 12) { _, intent ->
            requested = intent
        }
        assertTrue(accepted)
        val enabled = checkNotNull(requested)
        assertEquals("START", enabled.action)
        assertTrue(enabled.getBooleanExtra("timestampOverlay", false))
        assertTrue(enabled.getBooleanExtra("portrait", false))
        assertFalse(enabled.getBooleanExtra("front", true))
        assertEquals(12, enabled.getIntExtra("device", -1))
        assertFalse(draft.timestampOverlay.value)

        draft.timestampOverlay.value = true
        val rejected = requestOutdoorServiceStart(context, draft, portrait = false, front = true, device = 4) { _, intent ->
            assertTrue(intent.getBooleanExtra("timestampOverlay", false))
            throw IllegalStateException("service start rejected")
        }
        assertFalse(rejected)
        assertTrue(draft.timestampOverlay.value)

        draft.timestampOverlay.value = false
        requested = null
        assertTrue(requestOutdoorServiceStart(context, draft, portrait = false, front = true, device = 4) { _, intent ->
            requested = intent
        })
        assertFalse(checkNotNull(requested).getBooleanExtra("timestampOverlay", true))
    }

    private fun openSettings() {
        compose.onNodeWithTag("画面切替・カメラ").performClick()
        compose.onNodeWithTag("カメラ設定の入口").performClick()
        compose.onNodeWithTag("映像・マイク分類・カメラ").performScrollTo().performClick()
    }
}

@Composable
private fun TimestampOverlayTestHost() {
    val draft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() }
    CasMateTabs(
        commentsContent = { androidx.compose.material3.Text("コメント本文") },
        outdoorContent = { OutdoorPanel(draft, onOpenConnection = {}) },
    )
}

@Composable
private fun TimestampDraftRestorationHost() {
    val draft = rememberSaveable(saver = OutdoorDraft.Saver) { OutdoorDraft() }
    Switch(
        checked = draft.timestampOverlay.value,
        onCheckedChange = { draft.timestampOverlay.value = it },
        modifier = Modifier.testTag("診断用時刻スイッチ"),
    )
}
