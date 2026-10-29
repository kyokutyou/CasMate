package jp.casmate.app.ui

import jp.casmate.app.ui.CasMateButton as Button
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebResourceError
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.connection.MobileReadConnection
import jp.casmate.app.connection.DirectAssets
import jp.casmate.app.data.AppearanceMode
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp

internal val LocalCommentsPageVisible = compositionLocalOf { true }

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CommentsWebView(
    connection: ConnectionUrl,
    reloadToken: Int,
    modifier: Modifier = Modifier,
    appearance: AppearanceMode = AppearanceMode.LIGHT,
    onHorizontalFlick: (Int) -> Unit = LocalHorizontalFlick.current,
) {
    val background = MaterialTheme.colorScheme.background.toArgb()
    val pageVisible = LocalCommentsPageVisible.current
    val flick by rememberUpdatedState(onHorizontalFlick)
    var renderGeneration by remember(connection.identity) { mutableIntStateOf(0) }
    key(connection.identity, renderGeneration, reloadToken) {
        var loadFailure by remember { mutableStateOf<String?>(null) }
        val bridge = remember(connection.identity, renderGeneration) { CommentsBridge(connection) { flick(it) } }
        val assets = remember(connection.identity, renderGeneration) { connection.direct?.let(::DirectAssets) }
        SideEffect { connection.direct?.let { assets?.update(it) } }
        DisposableEffect(assets) { onDispose { assets?.close() } }
        val lifecycleOwner = LocalLifecycleOwner.current
        val documentAvailable by rememberUpdatedState(pageVisible && loadFailure == null)
        DisposableEffect(lifecycleOwner, bridge) {
            val observer = LifecycleEventObserver { _, _ -> bridge.visible(documentAvailable && lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose { lifecycleOwner.lifecycle.removeObserver(observer); bridge.close() }
        }
        SideEffect { bridge.visible(documentAvailable && lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
        val loadCoordinator = remember(connection.identity, renderGeneration) {
            WebViewLoadCoordinator()
        }
        val loadTarget = remember(connection.identity, renderGeneration) {
            WebViewLoadTarget(loadCoordinator)
        }
        val client = remember(connection.identity, renderGeneration) {
            RestrictedWebViewClient(connection.origin, assets, bridge::reset,
                onLoadFailure = { loadFailure = it; bridge.visible(false) }, onRenderProcessGone = { renderGeneration += 1 })
        }
        Box(modifier.background(MaterialTheme.colorScheme.background)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        setBackgroundColor(background)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = assets == null
                        settings.blockNetworkLoads = assets != null
                        if (assets != null) settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        settings.setSupportMultipleWindows(false)
                        webViewClient = client
                        bridge.install(this)
                        addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                            loadTarget.loadIfReady(view as WebView)
                        }
                    }
                },
                update = { webView ->
                    webView.webViewClient = client
                    webView.setBackgroundColor(background)
                    webView.importantForAccessibility = if (pageVisible) android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                        else android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                    webView.isFocusable = pageVisible
                    webView.isFocusableInTouchMode = pageVisible
                    if (!pageVisible) webView.clearFocus()
                    bridge.appearance(appearance)
                    loadTarget.update(
                        webView,
                        connection.embeddedCommentsUrl,
                        reloadToken,
                    )
                },
                onRelease = { bridge.close(); it.destroy() },
            )
            loadFailure?.let { message ->
                Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                    .verticalScroll(rememberScrollState()).padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.Start) {
                    Text("コメントを表示できません", style = MaterialTheme.typography.titleMedium)
                    Text(message)
                    Button(onClick = { renderGeneration += 1 }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("コメントを再読み込み")
                    }
                }
            }
        }
    }
}

private class CommentsBridge(private val connection: ConnectionUrl, private val onHorizontalFlick: (Int) -> Unit) {
    private var view: WebView? = null
    private var reply: JavaScriptReplyProxy? = null
    private var visible = false
    private var lease: AutoCloseable? = null
    private var appearance = AppearanceMode.LIGHT
    fun install(webView: WebView) {
        view = webView
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "CasMateComments", setOf(connection.origin)) { source, message, origin, mainFrame, proxy ->
            if (source !== view || !mainFrame || origin.toString() != connection.origin) return@addWebMessageListener
            if (message.type != androidx.webkit.WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            when (message.data) {
                "ready" -> { reset(); reply = proxy; sendAppearance(); update() }
                "hidden" -> reset()
                "flick:left" -> if (visible && reply != null) onHorizontalFlick(-1)
                "flick:right" -> if (visible && reply != null) onHorizontalFlick(1)
            }
        }
    }
    fun visible(value: Boolean) { visible = value; update() }
    fun appearance(value: AppearanceMode) {
        if (appearance == value) return
        appearance = value
        sendAppearance()
    }
    fun reset() { lease?.close(); lease = null; reply = null }
    fun close() { reset(); view = null }
    private fun sendAppearance() {
        // A presentation event travels only to the verified document's reply proxy.
        // It carries no PC data, credentials or operations and does not touch its subscription.
        reply?.let { proxy -> runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                proxy.postMessage("{\"type\":\"android.presentation\",\"payload\":{\"theme\":\"${appearance.storedValue}\"}}")
            }
        } }
    }
    private fun update() {
        if (!visible) { lease?.close(); lease = null; return }
        val webView = view ?: return
        val proxy = reply ?: return
        if (lease == null) lease = MobileReadConnection.comments(webView.context, connection) { text ->
            if (reply === proxy && view === webView && visible) runCatching {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(text)
            }
        }
    }
}

private class WebViewLoadTarget(private val coordinator: WebViewLoadCoordinator) {
    private var targetUrl = ""
    private var reloadToken = 0

    fun update(webView: WebView, targetUrl: String, reloadToken: Int) {
        this.targetUrl = targetUrl
        this.reloadToken = reloadToken
        loadIfReady(webView)
    }

    fun loadIfReady(webView: WebView) {
        if (targetUrl.isEmpty()) return
        coordinator.nextUrl(webView.height, targetUrl, reloadToken)?.let(webView::loadUrl)
    }
}

private class RestrictedWebViewClient(
    private val allowedOrigin: String,
    private val assets: DirectAssets?,
    private val resetBridge: () -> Unit,
    private val onLoadFailure: (String) -> Unit,
    private val onRenderProcessGone: () -> Unit,
) : WebViewClient() {
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        resetBridge()
        view.post(onRenderProcessGone)
        return true
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        !request.url.toString().startsWith("$allowedOrigin/")

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        resetBridge()
        if (url != null && !url.startsWith("$allowedOrigin/")) {
            view.stopLoading()
            return
        }
        super.onPageStarted(view, url, favicon)
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = if (assets != null) assets.load(request.url.toString(), request.method).also { response ->
        if (response.statusCode >= 400 && requiredForDisplay(request)) reportFailure(view, response.statusCode)
    } else if (request.url.toString().startsWith("$allowedOrigin/")) {
        super.shouldInterceptRequest(view, request)
    } else {
        WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
    }
    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
        if (requiredForDisplay(request)) reportFailure(view, response.statusCode)
    }
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (requiredForDisplay(request)) reportFailure(view)
    }
    override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) {
        handler.cancel()
        val failed = android.net.Uri.parse(error.url)
        if (error.url == view.url || (failed.toString().startsWith("$allowedOrigin/assets/") &&
                (failed.path?.endsWith(".js") == true || failed.path?.endsWith(".css") == true))) reportFailure(view, 403)
    }
    private fun requiredForDisplay(request: WebResourceRequest): Boolean = request.isForMainFrame ||
        (request.url.toString().startsWith("$allowedOrigin/assets/") &&
            (request.url.path?.endsWith(".js") == true || request.url.path?.endsWith(".css") == true))
    private fun reportFailure(view: WebView, status: Int? = null) {
        val message = if (status in listOf(401, 403))
            "PCの確認または登録を確認できません。PCの共通QRと日時を確認してください。"
        else "PCのきゃすメイトが起動しているか、選択した接続と公開・受信の状態を確認してください。接続先が変わった場合はPCの共通QRを読み直してください。"
        view.post { onLoadFailure(message) }
    }
}
