package jp.casmate.app.connection

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import jp.casmate.app.MainActivity
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runners.model.Statement
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Opt-in navigation check using the existing direct registration; never changes it or starts sending. */
class DirectNavigationDeviceTest {
    private val ui = createAndroidComposeRule<MainActivity>()
    private val optIn = TestRule { base, _ ->
        object : Statement() {
            override fun evaluate() {
                assumeTrue(InstrumentationRegistry.getArguments().getString("directNavigation") == "true")
                base.evaluate()
            }
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(optIn).around(ui)

    @Test fun directCommentsRenderAndReceiveSnapshot() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val before = runBlocking { AppPreferences(context).connection.first() }
        assertNotNull("A saved direct registration is required", before?.direct)
        ui.onNodeWithTag("画面切替・コメント").performClick()
        assertCommentSnapshot()
        assertEquals(before?.identity, runBlocking { AppPreferences(context).connection.first() }?.identity)
    }

    @Test fun savedDirectPcServesCommentDocument() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val registration = requireNotNull(runBlocking { AppPreferences(context).connection.first() }?.direct)
        val client = PinnedPcClient.create(registration.fingerprint, registration.endpoints)
        val outcomes = mutableListOf<String>()
        var served = false
        try {
            registration.endpoints.forEachIndexed { index, endpoint ->
                try {
                    client.newCall(okhttp3.Request.Builder().url("https://${endpoint.authority}/comments?embedded=android")
                        .header("X-CasMate-Read", "Bearer ${registration.comments.token}").build()).execute().use {
                        val html = it.body.string()
                        val valid = it.code == 200 && html.contains("id=\"root\"") && html.contains("type=\"module\"")
                        served = served || valid
                        outcomes.add("candidate $index ${endpoint.family}: HTTP ${it.code}, validDocument=$valid")
                    }
                } catch (failure: java.io.IOException) {
                    outcomes.add("candidate $index ${endpoint.family}: ${failure.javaClass.simpleName}, cause=${failure.cause?.javaClass?.simpleName}")
                }
            }
        } finally { PinnedPcClient.release(client) }
        assertTrue("Saved PC document: $outcomes", served)
    }

    @Test fun unreachableDocumentShowsRecoveryThenHealthyConnectionRenders() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val before = requireNotNull(runBlocking { AppPreferences(context).connection.first() })
        val registration = requireNotNull(before.direct)
        // Keep stored credentials/profile untouched. Only this renderer uses an unforwarded port.
        val unavailable = org.json.JSONObject(registration.json).apply {
            val candidate = getJSONArray("endpoints").getJSONObject(0).put("tcpPort", 19301)
            put("endpoints", org.json.JSONArray().put(candidate))
        }
        val target = mutableStateOf(ConnectionUrl.fromDirect(DirectRegistration.parse(unavailable)))
        ui.activity.setContent { MaterialTheme(colorScheme = jp.casmate.app.CasMateColorScheme) {
            jp.casmate.app.ui.CommentsWebView(target.value, 0, Modifier.fillMaxSize())
        } }
        ui.waitUntil(15000) { ui.onAllNodesWithText("コメントを再読み込み").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("コメントを表示できません").assertIsDisplayed()
        ui.onNodeWithText("コメントを再読み込み").assertIsDisplayed().performClick()
        ui.runOnIdle { target.value = before }
        assertCommentSnapshot()
        assertEquals(before.identity, runBlocking { AppPreferences(context).connection.first() }?.identity)
    }

    private fun assertCommentSnapshot() {
        val rendered = AtomicBoolean(false)
        val diagnostic = AtomicReference("No WebView")
        try {
            ui.waitUntil(15000) {
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    webView(ui.activity.window.decorView)?.evaluateJavascript("""
                        JSON.stringify({connected: Boolean(document.querySelector('.comment-list-page .connection-ok')),
                        rootChildren: document.getElementById('root')?.childElementCount ?? -1,
                        scripts: document.scripts.length, styles: document.styleSheets.length,
                        bridge: Boolean(window.CasMateComments), bodyLength: document.body?.innerText.length ?? 0})
                    """.trimIndent()) {
                        diagnostic.set(it)
                        val value = org.json.JSONTokener(it).nextValue() as? String
                        rendered.set(value != null && org.json.JSONObject(value).optBoolean("connected"))
                    }
                }
                rendered.get()
            }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            throw AssertionError("Comment page did not render its connected snapshot: ${diagnostic.get()}", failure)
        }
    }

    @Test fun opensOutdoorAndReturnsToDirectCommentsRepeatedly() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val before = runBlocking { AppPreferences(context).connection.first() }
        assertNotNull("A saved direct registration is required", before?.direct)
        repeat(5) {
            ui.onNodeWithTag("画面切替・コメント").performClick()
            assertCommentSnapshot()
            ui.onNodeWithTag("画面切替・カメラ").performClick()
            ui.onNodeWithText("送信を開始").assertIsDisplayed()
            ui.runOnIdle { assertFalse(ui.activity.isFinishing); assertFalse(ui.activity.isDestroyed) }
        }
        ui.onNodeWithTag("画面切替・コメント").performClick()
        assertCommentSnapshot()
        val after = runBlocking { AppPreferences(context).connection.first() }
        assertEquals(before?.identity, after?.identity)
    }

    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) webView(view.getChildAt(index))?.let { return it }
        return null
    }
}
