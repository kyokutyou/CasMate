package jp.casmate.app.outdoor

import android.Manifest
import android.content.pm.PackageManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutdoorRoutingRegressionTest {
    @Test @Config(shadows = [PendingCommunicationAudioManager::class])
    fun acceptedRequestWaitsForConnectionAndCancellationReleasesIt() = kotlinx.coroutines.runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(android.media.AudioManager::class.java)
        val shadow = org.robolectric.Shadows.shadowOf(manager)
        val input = org.robolectric.shadows.AudioDeviceInfoBuilder.newBuilder()
            .setType(android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadow.setInputDevices(listOf(input))
        shadow.setAvailableCommunicationDevices(listOf(input))
        val route = OutdoorAudioRoute(context)
        var ready = false
        val pending = launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            route.prepare(input.id); ready = true
        }
        assertFalse(ready)
        assertTrue(pending.isActive)
        assertEquals(android.media.AudioManager.MODE_IN_COMMUNICATION, manager.mode)
        pending.cancelAndJoin()
        assertEquals(android.media.AudioManager.MODE_NORMAL, manager.mode)
        assertTrue(shadow is PendingCommunicationAudioManager && shadow.cleared)
    }
    @Test fun legacyScoConversionKeepsDurationAndContinuity() {
        val converter = OutdoorScoPcm()
        val first = converter.to48k(byteArrayOf(0, 0), 2)
        assertEquals(12, first.size)
        assertTrue(first.all { it == 0.toByte() })
        val next = converter.to48k(byteArrayOf(0x58, 0x02), 2) // 600
        val samples = next.toList().chunked(2).map { (it[0].toInt() and 255) or (it[1].toInt() shl 8) }
        assertEquals(listOf(100, 200, 300, 400, 500, 600), samples)
        assertEquals(1920, converter.to48k(ByteArray(320), 320).size)
    }
    @Test fun bluetoothRouteIsKeptUntilExplicitRelease() = kotlinx.coroutines.runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(android.media.AudioManager::class.java)
        val shadow = org.robolectric.Shadows.shadowOf(manager)
        val input = org.robolectric.shadows.AudioDeviceInfoBuilder.newBuilder()
            .setType(android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadow.setInputDevices(listOf(input))
        shadow.setAvailableCommunicationDevices(listOf(input))
        val route = OutdoorAudioRoute(context)
        assertEquals(input.id, route.prepare(input.id))
        assertEquals(android.media.AudioManager.MODE_IN_COMMUNICATION, manager.mode)
        assertEquals(input, manager.communicationDevice)
        route.close()
        assertEquals(android.media.AudioManager.MODE_NORMAL, manager.mode)
        org.junit.Assert.assertNull(manager.communicationDevice)
        route.close()
    }

    @Test fun rejectedBluetoothRouteRestoresAudioMode() = kotlinx.coroutines.runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(android.media.AudioManager::class.java)
        val shadow = org.robolectric.Shadows.shadowOf(manager)
        val input = org.robolectric.shadows.AudioDeviceInfoBuilder.newBuilder()
            .setType(android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadow.setInputDevices(listOf(input))
        shadow.setAvailableCommunicationDevices(listOf(input))
        shadow.lockCommunicationDevice(true)
        val route = OutdoorAudioRoute(context)
        assertTrue(runCatching { route.prepare(input.id) }.isFailure)
        assertEquals(android.media.AudioManager.MODE_NORMAL, manager.mode)
        org.junit.Assert.assertNull(manager.communicationDevice)
    }

    @Test fun ambiguousBluetoothInputsDoNotSelectAnotherHeadset() = kotlinx.coroutines.runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(android.media.AudioManager::class.java)
        val shadow = org.robolectric.Shadows.shadowOf(manager)
        val first = org.robolectric.shadows.AudioDeviceInfoBuilder.newBuilder()
            .setType(android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        val second = org.robolectric.shadows.AudioDeviceInfoBuilder.newBuilder()
            .setType(android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadow.setInputDevices(listOf(first, second))
        shadow.setAvailableCommunicationDevices(listOf(first, second))
        assertTrue(runCatching { OutdoorAudioRoute(context).prepare(first.id) }.isFailure)
        assertEquals(android.media.AudioManager.MODE_NORMAL, manager.mode)
    }

    @Test fun matchingRequiresAnIdentifiedEndpointOfTheSameType() {
        assertTrue(sameAudioEndpoint(7, "headset-a", 7, "headset-a"))
        org.junit.Assert.assertFalse(sameAudioEndpoint(7, "headset-a", 7, "headset-b"))
        org.junit.Assert.assertFalse(sameAudioEndpoint(7, "", 7, ""))
        org.junit.Assert.assertFalse(sameAudioEndpoint(7, "headset-a", 26, "headset-a"))
    }
    @Test fun sourceRotationFollowsDisplayWithoutDependingOnOutputDimensions() {
        assertEquals(0, outdoorCameraRotation(90))
        assertEquals(270, outdoorCameraRotation(0))
        assertEquals(90, outdoorCameraRotation(180))
        assertEquals(180, outdoorCameraRotation(270))
    }
    @Test fun bluetoothRoutingHasTheRequiredNormalAudioPermission() {
        val app = RuntimeEnvironment.getApplication()
        val info = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS)
        assertTrue(info.requestedPermissions?.contains(Manifest.permission.MODIFY_AUDIO_SETTINGS) == true)
    }
}

@org.robolectric.annotation.Implements(android.media.AudioManager::class)
class PendingCommunicationAudioManager : org.robolectric.shadows.ShadowAudioManager() {
    var cleared = false
    @org.robolectric.annotation.Implementation
    override fun setCommunicationDevice(device: android.media.AudioDeviceInfo): Boolean = true
    @org.robolectric.annotation.Implementation
    override fun clearCommunicationDevice() { cleared = true; super.clearCommunicationDevice() }
}

