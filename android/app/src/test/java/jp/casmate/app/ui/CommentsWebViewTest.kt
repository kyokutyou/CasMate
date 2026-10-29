package jp.casmate.app.ui

import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.data.AppearanceMode
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class CommentsWebViewTest {
    @get:Rule val compose = createComposeRule()
    private val connection = ConnectionUrl.parse("http://192.168.1.2:3000/comments").getOrThrow()

    @Test
    @Config(shadows = [CommentsMessageFeatureShadow::class, CommentsMessageListenerShadow::class])
    fun readyDocumentLeasesOnlyWhileSelectedAndStartedAndRejectsDisposedCallbacks() {
        val owner = CommentsTestLifecycleOwner()
        val reload = mutableStateOf(0)
        val present = mutableStateOf(true)
        val messages = mutableListOf<String>()
        var flicks = 0
        val proxy = RecordingCommentsReplyProxy(messages)
        val manager = jp.casmate.app.connection.MobileReadConnection
        val socket = readPrivateField(manager, "socket")
        val factoryField = socket.javaClass.getDeclaredField("factory").apply { isAccessible = true }
        val originalFactory = factoryField.get(socket)
        val sockets = mutableListOf<CommentsDormantSocket>()
        factoryField.set(socket, okhttp3.WebSocket.Factory { request, _ ->
            CommentsDormantSocket(request).also(sockets::add)
        })
        fun leases(): Map<*, *> = readPrivateField(manager, "comments") as Map<*, *>
        fun currentLeaseCallback(): (String) -> Unit {
            @Suppress("UNCHECKED_CAST")
            return readPrivateField(leases().values.single()!!, "event") as (String) -> Unit
        }
        try {
            compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.lifecycle.compose.LocalLifecycleOwner provides owner,
                ) {
                    if (present.value) CasMateTabs(
                        commentsContent = { CommentsWebView(connection, reload.value, Modifier.height(400.dp),
                            onHorizontalFlick = { flicks++ }) },
                        outdoorContent = { Text("カメラ本文") },
                    )
                }
            } }
            lateinit var firstView: WebView
            lateinit var firstListener: androidx.webkit.WebViewCompat.WebMessageListener
            compose.runOnIdle {
                owner.registry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
                firstView = currentWebView()
                firstListener = CommentsMessageListenerShadow.listeners.getValue(firstView)
                firstListener.onPostMessage(firstView, androidx.webkit.WebMessageCompat("ready"),
                    Uri.parse(connection.origin), true, proxy)
                assertEquals("Preloaded camera-hidden document must not subscribe", 0, leases().size)
                assertTrue(sockets.isEmpty())
            }
            compose.onNodeWithTag("画面切替・コメント").performClick()
            lateinit var firstCallback: (String) -> Unit
            compose.runOnIdle {
                assertEquals(1, leases().size)
                firstCallback = currentLeaseCallback()
                val before = messages.size
                firstCallback("fixture-visible-event")
                assertEquals(before + 1, messages.size)
            }
            compose.onNodeWithTag("画面切替・カメラ").performClick()
            compose.runOnIdle {
                assertEquals(0, leases().size)
                assertSame(firstView, currentWebView())
                assertTrue(sockets.last().cancelled)
                val before = messages.size
                firstCallback("fixture-hidden-event")
                firstListener.onPostMessage(firstView, androidx.webkit.WebMessageCompat("flick:right"),
                    Uri.parse(connection.origin), true, proxy)
                assertEquals(before, messages.size)
                assertEquals(0, flicks)
            }
            compose.onNodeWithTag("画面切替・コメント").performClick()
            lateinit var resumedCallback: (String) -> Unit
            compose.runOnIdle {
                // No second ready is sent: reselect must reuse the verified document reply.
                assertEquals(1, leases().size)
                resumedCallback = currentLeaseCallback()
                resumedCallback("fixture-reselected-event")
                assertEquals("fixture-reselected-event", messages.last())
                owner.registry.currentState = androidx.lifecycle.Lifecycle.State.CREATED
                assertEquals(0, leases().size)
                val before = messages.size
                resumedCallback("fixture-background-event")
                assertEquals(before, messages.size)
                owner.registry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
                assertEquals(1, leases().size)
                assertSame(firstView, currentWebView())
                resumedCallback = currentLeaseCallback()
                reload.value++
            }
            compose.runOnIdle {
                assertNotSame(firstView, currentWebView())
                assertEquals("New document waits for its own ready", 0, leases().size)
                val before = messages.size
                resumedCallback("fixture-disposed-event")
                firstListener.onPostMessage(firstView, androidx.webkit.WebMessageCompat("ready"),
                    Uri.parse(connection.origin), true, proxy)
                firstListener.onPostMessage(firstView, androidx.webkit.WebMessageCompat("flick:right"),
                    Uri.parse(connection.origin), true, proxy)
                assertEquals(before, messages.size)
                assertEquals(0, leases().size)
                assertEquals(0, flicks)
                val replacement = currentWebView()
                CommentsMessageListenerShadow.listeners.getValue(replacement).onPostMessage(
                    replacement, androidx.webkit.WebMessageCompat("ready"), Uri.parse(connection.origin), true, proxy)
                assertEquals(1, leases().size)
                present.value = false
            }
            compose.runOnIdle { assertEquals("True disposal releases its lease", 0, leases().size) }
        } finally {
            try {
                compose.runOnIdle { present.value = false }
                compose.waitForIdle()
            } finally {
                factoryField.set(socket, originalFactory)
            }
        }
    }

    private fun readPrivateField(value: Any, name: String): Any =
        requireNotNull(value.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(value))

    @Test
    @Config(shadows = [CountingCommentsWebViewShadow::class])
    fun commentsDocumentPreloadsAtFullSizeAndSurvivesTabRoundTrips() {
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            Surface(Modifier.width(320.dp).height(760.dp)) {
                CasMateTabs(
                    commentsContent = { CommentsWebView(connection, 0, Modifier.fillMaxSize()) },
                    outdoorContent = { Text("カメラ本文") },
                )
            }
        } }
        lateinit var initial: WebView
        var initialLoads = 0
        compose.runOnIdle {
            initial = currentWebView()
            assertTrue("Preloading must receive the real page measure constraints", initial.measuredWidth > 0 && initial.measuredHeight > 0)
            assertFalse(initial.isFocusable)
            assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS, initial.importantForAccessibility)
            // Robolectric measures the AndroidView holder but does not dispatch its native
            // layout here. Deliver the measured layout; the device test checks real layout.
            initial.left = 0; initial.top = 0
            initial.right = initial.measuredWidth; initial.bottom = initial.measuredHeight
            assertTrue("Native layout did not assign dimensions", initial.height > 0)
            shadowOf(initial).onLayoutChangeListeners.forEach {
                it.onLayoutChange(initial, 0, 0, initial.measuredWidth, initial.measuredHeight, 0, 0, 0, 0)
            }
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(connection.embeddedCommentsUrl, shadowOf(initial).lastLoadedUrl)
            initialLoads = (shadowOf(initial) as CountingCommentsWebViewShadow).loadRequests
            assertEquals(1, initialLoads)
        }
        repeat(3) {
            compose.onNodeWithTag("画面切替・コメント").performClick()
            compose.runOnIdle {
                assertSame(initial, currentWebView())
                assertEquals(initialLoads, (shadowOf(initial) as CountingCommentsWebViewShadow).loadRequests)
                assertTrue(initial.isFocusable)
                assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO, initial.importantForAccessibility)
            }
            compose.onNodeWithTag("画面切替・カメラ").performClick()
            compose.runOnIdle {
                assertSame(initial, currentWebView())
                assertFalse(shadowOf(initial).wasDestroyCalled())
                assertFalse(initial.isFocusable)
            }
        }
    }

    @Test fun retainedDocumentStillRecreatesForRegistrationReloadAndRendererLoss() {
        val current = mutableStateOf(connection)
        val reload = mutableStateOf(0)
        compose.setContent { CasMateTheme(AppearanceMode.LIGHT) {
            CasMateTabs(
                commentsContent = { CommentsWebView(current.value, reload.value, Modifier.height(400.dp)) },
                outdoorContent = { Text("カメラ本文") },
            )
        } }
        lateinit var previous: WebView
        compose.runOnIdle { previous = currentWebView(); reload.value++ }
        compose.runOnIdle {
            assertNotSame(previous, currentWebView())
            assertTrue(shadowOf(previous).wasDestroyCalled())
            previous = currentWebView()
            current.value = ConnectionUrl.parse("http://192.168.1.3:3000/comments").getOrThrow()
        }
        compose.runOnIdle {
            assertNotSame(previous, currentWebView())
            assertTrue(shadowOf(previous).wasDestroyCalled())
            previous = currentWebView()
            previous.webViewClient.onRenderProcessGone(previous, object : android.webkit.RenderProcessGoneDetail() {
                override fun didCrash() = true
                override fun rendererPriorityAtExit() = WebView.RENDERER_PRIORITY_BOUND
            })
        }
        compose.runOnIdle {
            assertNotSame(previous, currentWebView())
            assertTrue(shadowOf(previous).wasDestroyCalled())
        }
    }

    @Test fun appearanceChangesBackdropWithoutReloadingOrReplacingTheDocument() {
        val appearance = mutableStateOf(AppearanceMode.LIGHT)
        compose.setContent {
            CasMateTheme(appearance.value) { CommentsWebView(connection, 0, Modifier.height(400.dp), appearance.value) }
        }
        lateinit var previous: WebView
        var previousUrl: String? = null
        compose.runOnIdle {
            previous = currentWebView(); previousUrl = previous.url
            assertEquals(0xFFF5F7F4.toInt(), shadowOf(previous).backgroundColor)
            appearance.value = AppearanceMode.DARK
        }
        compose.runOnIdle {
            assertSame(previous, currentWebView()); assertEquals(previousUrl, currentWebView().url)
            assertEquals(0xFF151B19.toInt(), shadowOf(currentWebView()).backgroundColor)
            appearance.value = AppearanceMode.LIGHT
        }
        compose.runOnIdle {
            assertSame(previous, currentWebView()); assertEquals(previousUrl, currentWebView().url)
            assertEquals(0xFFF5F7F4.toInt(), shadowOf(currentWebView()).backgroundColor)
        }
    }

    @Test fun documentFailureShowsNativeRecoveryWithoutMovingSurroundingControls() {
        compose.setContent {
            MaterialTheme { Column {
                Button(onClick = {}) { Text("共通操作") }
                CommentsWebView(connection, 0, Modifier.height(400.dp))
                Button(onClick = {}) { Text("タブ操作") }
            } }
        }
        val top = compose.onNodeWithText("共通操作").fetchSemanticsNode().boundsInRoot
        val bottom = compose.onNodeWithText("タブ操作").fetchSemanticsNode().boundsInRoot
        lateinit var previous: WebView
        compose.runOnIdle {
            previous = currentWebView()
            previous.webViewClient.onReceivedHttpError(previous, request(true),
                WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), "Unavailable".byteInputStream()))
        }
        compose.onNodeWithText("コメントを再読み込み").assertIsDisplayed().performClick()
        compose.runOnIdle { assertNotSame(previous, currentWebView()) }
        // A response posted by the disposed renderer must not replace the new view.
        compose.runOnIdle {
            previous.webViewClient.onReceivedHttpError(previous, request(true),
                WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), "Unavailable".byteInputStream()))
        }
        compose.onNodeWithText("コメントを再読み込み").assertDoesNotExist()
        assertEquals(top, compose.onNodeWithText("共通操作").fetchSemanticsNode().boundsInRoot)
        assertEquals(bottom, compose.onNodeWithText("タブ操作").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun failedImageDoesNotReplaceTheWholeCommentList() {
        compose.setContent { MaterialTheme { CommentsWebView(connection, 0) } }
        compose.runOnIdle {
            val view = currentWebView()
            view.webViewClient.onReceivedHttpError(view, request(false, "/mobile/assets/image"),
                WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), "Unavailable".byteInputStream()))
        }
        compose.onNodeWithText("コメントを再読み込み").assertDoesNotExist()
    }

    private fun request(main: Boolean, path: String = "/comments?embedded=android") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(connection.origin + path)
        override fun isForMainFrame() = main
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = "GET"
        override fun getRequestHeaders() = emptyMap<String, String>()
    }

    private fun currentWebView(): WebView {
        val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single()
        return requireNotNull(find(activity.window.decorView))
    }
    private fun find(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
        return null
    }

    @Test fun requiredScriptFailureAndDeniedCredentialsExplainRecovery() {
        compose.setContent { MaterialTheme { CommentsWebView(connection, 0, Modifier.height(400.dp)) } }
        compose.runOnIdle {
            val view = currentWebView()
            view.webViewClient.onReceivedHttpError(view, request(false, "/assets/comments.js"),
                WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), "SECRET must not be shown".byteInputStream()))
        }
        compose.onNodeWithText("PCの確認または登録を確認できません。PCの共通QRと日時を確認してください。").assertIsDisplayed()
        compose.onNodeWithText("SECRET must not be shown").assertDoesNotExist()
        compose.onNodeWithText("コメントを再読み込み").assertIsDisplayed()
    }
}

/** Count actual public loadUrl calls rather than WebView's unrelated back/forward history. */
@org.robolectric.annotation.Implements(WebView::class)
class CountingCommentsWebViewShadow : org.robolectric.shadows.ShadowWebView() {
    var loadRequests = 0
        private set

    @org.robolectric.annotation.Implementation
    override fun loadUrl(url: String) {
        loadRequests++
        super.loadUrl(url)
    }
}

private class CommentsTestLifecycleOwner : androidx.lifecycle.LifecycleOwner {
    val registry = androidx.lifecycle.LifecycleRegistry(this)
    override val lifecycle: androidx.lifecycle.Lifecycle = registry
}

private class RecordingCommentsReplyProxy(private val messages: MutableList<String>) : androidx.webkit.JavaScriptReplyProxy() {
    override fun postMessage(message: String) { messages.add(message) }
    override fun postMessage(message: ByteArray) { error("Unexpected binary bridge event") }
    override fun executeJavaScript(script: String,
        receiver: androidx.webkit.WebViewOutcomeReceiver<String, androidx.webkit.JavaScriptExecutionException>?) {
        error("Unexpected JavaScript execution")
    }
}

private class CommentsDormantSocket(private val original: okhttp3.Request) : okhttp3.WebSocket {
    var cancelled = false
    override fun request() = original
    override fun queueSize() = 0L
    override fun send(text: String) = true
    override fun send(bytes: okio.ByteString) = true
    override fun close(code: Int, reason: String?) = true
    override fun cancel() { cancelled = true }
}

@org.robolectric.annotation.Implements(androidx.webkit.WebViewFeature::class)
class CommentsMessageFeatureShadow {
    companion object {
        @JvmStatic @org.robolectric.annotation.Implementation
        fun isFeatureSupported(feature: String) = feature == androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER
    }
}

@org.robolectric.annotation.Implements(androidx.webkit.WebViewCompat::class)
class CommentsMessageListenerShadow {
    companion object {
        val listeners = mutableMapOf<WebView, androidx.webkit.WebViewCompat.WebMessageListener>()
        @JvmStatic @org.robolectric.annotation.Implementation
        fun addWebMessageListener(view: WebView, name: String, origins: Set<String>,
            listener: androidx.webkit.WebViewCompat.WebMessageListener) {
            check(name == "CasMateComments" && origins.size == 1)
            listeners[view] = listener
        }
        @JvmStatic @org.robolectric.annotation.Resetter
        fun reset() { listeners.clear() }
    }
}
