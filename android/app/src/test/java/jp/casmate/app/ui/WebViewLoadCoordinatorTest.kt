package jp.casmate.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WebViewLoadCoordinatorTest {
    @Test
    fun waitsForPositiveHeightBeforeInitialLoad() {
        val coordinator = WebViewLoadCoordinator()

        assertNull(coordinator.nextUrl(0, COMMENTS_URL, reloadToken = 0))
        assertEquals(COMMENTS_URL, coordinator.nextUrl(1, COMMENTS_URL, reloadToken = 0))
        assertNull(coordinator.nextUrl(1, COMMENTS_URL, reloadToken = 0))
    }

    @Test
    fun reloadsTheSameUrlWhenRegistrationRequestsIt() {
        val coordinator = WebViewLoadCoordinator()

        assertEquals(COMMENTS_URL, coordinator.nextUrl(100, COMMENTS_URL, reloadToken = 0))
        assertEquals(COMMENTS_URL, coordinator.nextUrl(100, COMMENTS_URL, reloadToken = 1))
        assertNull(coordinator.nextUrl(100, COMMENTS_URL, reloadToken = 1))
    }

    @Test
    fun loadsWhenTheConnectionTargetChanges() {
        val coordinator = WebViewLoadCoordinator()

        assertEquals(COMMENTS_URL, coordinator.nextUrl(100, COMMENTS_URL, reloadToken = 0))
        assertEquals(LAN_COMMENTS_URL, coordinator.nextUrl(100, LAN_COMMENTS_URL, reloadToken = 0))
    }

    private companion object {
        const val COMMENTS_URL = "http://100.122.130.28:3000/comments?embedded=android"
        const val LAN_COMMENTS_URL = "http://192.168.10.107:3000/comments?embedded=android"
    }
}
