package jp.casmate.app.ui

class WebViewLoadCoordinator {
    private var loadedUrl: String? = null
    private var appliedReloadToken: Int? = null

    fun nextUrl(viewHeightPx: Int, targetUrl: String, reloadToken: Int): String? {
        if (viewHeightPx <= 0) return null
        if (loadedUrl == targetUrl && appliedReloadToken == reloadToken) return null
        loadedUrl = targetUrl
        appliedReloadToken = reloadToken
        return targetUrl
    }
}
