package jp.casmate.app.audio

import android.app.Notification
import android.app.Service
import android.content.Context
import jp.casmate.app.connection.ConnectionUrl
import jp.casmate.app.connection.MobileAudioListener
import jp.casmate.app.connection.MobileReadConnection
import jp.casmate.app.data.AppPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], shadows = [DeniedForegroundService::class, AudioConnectionShadow::class],
    instrumentedPackages = ["jp.casmate.app.connection"])
class MobileAudioServiceTest {
    @Test fun aPendingStopCannotTerminateANewerStart() {
        DeniedForegroundService.allowedCalls = 20
        val controller = Robolectric.buildService(MobileAudioService::class.java).create()
        val service = controller.get()
        try {
            service.onStartCommand(MobileAudioService.startIntent(service, "http://192.168.1.2:3000/comments"), 0, 1)
            service.onStartCommand(MobileAudioService.stopIntent(service), 0, 2)
            service.onStartCommand(MobileAudioService.startIntent(service, "http://192.168.1.2:3000/comments"), 0, 3)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            // A subsequent edit is a public persistence barrier for both preceding intent writes.
            val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
            try {
                val barrier = executor.submit { runBlocking { AppPreferences(service).setAppearance(jp.casmate.app.data.AppearanceMode.LIGHT) } }
                val deadline = System.nanoTime() + 5_000_000_000L
                while (!barrier.isDone && System.nanoTime() < deadline) {
                    org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                    Thread.sleep(10)
                }
                barrier.get(1, java.util.concurrent.TimeUnit.SECONDS)
            } finally { executor.shutdownNow() }
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertFalse("An earlier stop must not end the new subscription", org.robolectric.Shadows.shadowOf(service).isStoppedBySelf)
            runBlocking { assertTrue(AppPreferences(service).startDesired.first()) }
        } finally { controller.destroy(); DeniedForegroundService.allowedCalls = 0 }
    }

    @Test fun foregroundDenialDuringSubscriptionImmediatelyReleasesTheAcquiredLease() {
        DeniedForegroundService.allowedCalls = 1
        AudioConnectionShadow.closed = 0
        val controller = Robolectric.buildService(MobileAudioService::class.java).create()
        try {
            val service = controller.get()
            service.onStartCommand(MobileAudioService.startIntent(service, "http://192.168.1.2:3000/comments"), 0, 1)
            assertEquals("FOREGROUND_UNAVAILABLE", AudioServiceState.status.value.name)
            assertEquals(1, AudioConnectionShadow.closed)
        } finally { controller.destroy(); DeniedForegroundService.allowedCalls = 0 }
    }
    @Test fun foregroundDenialClearsStartIntentAndReportsTheFailureWithoutCrashing() {
        val controller = Robolectric.buildService(MobileAudioService::class.java).create()
        val service = controller.get()
        try {
            runBlocking { AppPreferences(service).setStartDesired(true) }
            service.onStartCommand(MobileAudioService.startIntent(service, "http://192.168.1.2:3000/comments"), 0, 1)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertEquals("FOREGROUND_UNAVAILABLE", AudioServiceState.status.value.name)
            val deadline = System.nanoTime() + 5_000_000_000L
            while (!org.robolectric.Shadows.shadowOf(service).isStoppedBySelf && System.nanoTime() < deadline) {
                org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue(org.robolectric.Shadows.shadowOf(service).isStoppedBySelf)
            runBlocking { assertFalse(AppPreferences(service).startDesired.first()) }
            assertEquals(Service.START_NOT_STICKY,
                service.onStartCommand(MobileAudioService.startIntent(service, "http://192.168.1.2:3000/comments"), 0, 2))
        } finally { controller.destroy() }
    }
}

@Implements(Service::class)
class DeniedForegroundService : ShadowService() {
    companion object { var allowedCalls = 0 }
    @Implementation
    override fun startForeground(id: Int, notification: Notification, foregroundServiceType: Int) {
        if (allowedCalls > 0) { allowedCalls--; return }
        throw SecurityException("Foreground service is denied by the OS")
    }
}

@Implements(value = MobileReadConnection::class, isInAndroidSdk = false)
internal class AudioConnectionShadow {
    companion object { var closed = 0 }
    @Implementation
    fun audio(context: Context, connection: ConnectionUrl, listener: MobileAudioListener): AutoCloseable {
        listener.state("connected")
        return AutoCloseable { closed++ }
    }
}
