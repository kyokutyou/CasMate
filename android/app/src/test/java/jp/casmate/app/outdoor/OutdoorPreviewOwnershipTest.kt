package jp.casmate.app.outdoor

import android.view.TextureView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutdoorPreviewOwnershipTest {
    private fun selected(service: OutdoorService) = OutdoorService::class.java.getDeclaredField("preview")
        .apply { isAccessible = true }.get(service)

    @Test fun lateOldWindowNotificationsKeepTheCurrentPreview() {
        val service = OutdoorService(); val context = RuntimeEnvironment.getApplication()
        val old = TextureView(context); val current = TextureView(context)
        service.attachPreview(old); service.attachPreview(current)
        service.detachPreview(old); service.resizePreview(old, 10, 10)
        assertSame(current, selected(service))
        service.detachPreview(current); assertNull(selected(service))
    }

    @Test fun duplicateDestroyAndReleaseRemainHarmless() {
        val service = OutdoorService(); val view = TextureView(RuntimeEnvironment.getApplication())
        service.attachPreview(view); service.detachPreview(view); service.detachPreview(view)
        assertNull(selected(service))
        service.attachPreview(view); assertSame(view, selected(service))
        service.detachPreview(view)
    }
}
