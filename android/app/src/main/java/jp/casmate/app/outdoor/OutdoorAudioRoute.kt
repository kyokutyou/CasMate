package jp.casmate.app.outdoor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

internal fun isBluetoothInput(type: Int) = type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
    (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET)

// Input and output ports have different IDs. Never choose a different headset by name.
internal fun sameAudioEndpoint(type: Int, address: String, otherType: Int, otherAddress: String) =
    type == otherType && address.isNotEmpty() && address == otherAddress

/** Owned by the sending session, not by the probe/recorder or SRT connection. */
@Suppress("DEPRECATION")
class OutdoorAudioRoute(private val context: Context) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private var previousMode: Int? = null
    private var requested = false
    private var receiver: BroadcastReceiver? = null
    @Volatile private var scoConnected = false

    suspend fun prepare(id: Int): Int {
        close()
        val input = SelectedMicrophone.inputs(context).firstOrNull { it.id == id }
            ?: error("INPUT_LOST")
        if (!isBluetoothInput(input.type)) return id
        try {
            check(manager.mode != AudioManager.MODE_IN_CALL) { "INPUT_LOST" }
            previousMode = manager.mode
            manager.mode = AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= 31) {
                val candidates = manager.availableCommunicationDevices.filter { it.type == input.type }
                val output = candidates.firstOrNull {
                    sameAudioEndpoint(input.type, input.address, it.type, it.address)
                } ?: candidates.singleOrNull()?.takeIf {
                    input.address.isEmpty() && SelectedMicrophone.inputs(context).count { it.type == input.type } == 1
                } ?: error("INPUT_LOST")
                requested = true
                check(manager.setCommunicationDevice(output)) { "INPUT_LOST" }
                check(withTimeoutOrNull(30_000) {
                    while (manager.communicationDevice?.id != output.id) delay(50)
                    true
                } == true) { "INPUT_LOST" }
            } else {
                check(SelectedMicrophone.inputs(context).count { it.type == input.type } == 1) { "INPUT_LOST" }
                val listener = object : BroadcastReceiver() {
                    override fun onReceive(context: Context?, intent: Intent?) {
                        scoConnected = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED
                    }
                }
                receiver = listener
                val sticky = context.registerReceiver(listener, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
                listener.onReceive(context, sticky)
                requested = true
                manager.startBluetoothSco()
                check(withTimeoutOrNull(30_000) { while (!scoConnected) delay(50); true } == true) { "INPUT_LOST" }
            }
            return SelectedMicrophone.inputs(context).firstOrNull { it.id == id ||
                sameAudioEndpoint(input.type, input.address, it.type, it.address) }?.id ?: error("INPUT_LOST")
        } catch (error: Exception) { close(); throw error }
    }

    fun close() {
        receiver?.let { runCatching { context.unregisterReceiver(it) } }; receiver = null
        if (requested) runCatching {
            if (Build.VERSION.SDK_INT >= 31) manager.clearCommunicationDevice() else manager.stopBluetoothSco()
        }
        requested = false; scoConnected = false
        previousMode?.let { mode ->
            if (manager.mode == AudioManager.MODE_IN_COMMUNICATION) runCatching { manager.mode = mode }
        }
        previousMode = null
    }
}
