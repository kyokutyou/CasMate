package jp.casmate.app.outdoor

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import com.pedro.common.TimeUtils
import com.pedro.encoder.Frame
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.input.sources.audio.AudioSource

// Check the actual route before forwarding every PCM buffer. A route loss is latched until explicit reselection.
class SelectedMicrophone(private val context: Context, var deviceId: Int, private val onLost: () -> Unit,
    private val onVerified: () -> Unit = {}, private val gain: OutdoorMicrophoneGain = OutdoorMicrophoneGain()) : AudioSource() {
    @Volatile var verified = false
        private set
    @Volatile var muted = false
        private set
    @Volatile private var running = false
    private var recorder: AudioRecord? = null
    private var thread: Thread? = null
    override fun create(sampleRate: Int, isStereo: Boolean, echoCanceler: Boolean, noiseSuppressor: Boolean) = sampleRate == 48000 && !isStereo
    fun mute() { verified = false; if (!muted) { muted = true; onLost() } }
    @SuppressLint("MissingPermission")
    override fun start(getMicrophoneData: GetMicrophoneData) {
        if (running) return
        val device = inputs(context).firstOrNull { it.id == deviceId }
        val sampleRate = if (android.os.Build.VERSION.SDK_INT < 31 && device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) 8000 else 48000
        val resampler = if (sampleRate == 8000) OutdoorScoPcm() else null
        val size = maxOf(4096, AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT))
        if (device == null) mute()
        val audio = if (muted) null else runCatching {
            val candidate = AudioRecord.Builder().setAudioSource(if (device != null && isBluetoothInput(device.type))
                MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.MIC)
                .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setBufferSizeInBytes(size).build()
            try {
                check(candidate.state == AudioRecord.STATE_INITIALIZED && candidate.setPreferredDevice(device))
                candidate.startRecording(); candidate
            } catch (e: Exception) { candidate.release(); throw e }
        }.getOrElse { mute(); null }
        recorder = audio; running = true
        thread = Thread({
            var routeSeen = false
            val started = System.nanoTime()
            while (running) {
                val captured = ByteArray(sampleRate / 50 * 2)
                val count = runCatching { audio?.read(captured, 0, captured.size) ?: -1 }.getOrDefault(-1)
                if (!running) break
                val route = runCatching { audio?.routedDevice?.id }.getOrNull()
                val silenced = runCatching { audio?.activeRecordingConfiguration?.isClientSilenced ?: false }.getOrDefault(true)
                val routeValid = route == deviceId && !silenced && count > 0
                if (routeValid) {
                    routeSeen = true
                    if (!muted && !verified) { verified = true; onVerified() }
                }
                else if (routeSeen || System.nanoTime() - started > 2_000_000_000L) mute()
                if (!routeValid || muted) { captured.fill(0); resampler?.reset() }
                val bytes = if (count <= 0) ByteArray(1920) else resampler?.to48k(captured, count) ?: captured.copyOf(count)
                if (!routeValid || muted) bytes.fill(0)
                gain.process(bytes, bytes.size, !routeValid || muted, android.os.SystemClock.elapsedRealtime())
                if (count <= 0) Thread.sleep(20)
                // Match the video/encoder origin, including deep sleep. nanoTime uses a
                // different origin on Android and can clamp PCM PTS to zero after rebasing.
                getMicrophoneData.inputPCMData(Frame(bytes, 0, bytes.size, TimeUtils.getCurrentTimeMicro()))
            }
        }, "casmate-outdoor-microphone").also { it.start() }
    }
    override fun stop() {
        verified = false
        running = false; runCatching { recorder?.stop() }; thread?.join(1000); thread = null
        recorder?.release(); recorder = null
    }
    override fun isRunning() = running
    override fun release() { stop() }
    companion object {
        fun inputs(context: Context): List<AudioDeviceInfo> = context.getSystemService(AudioManager::class.java)
            .getDevices(AudioManager.GET_DEVICES_INPUTS).filter { it.type in setOf(AudioDeviceInfo.TYPE_BUILTIN_MIC,
                AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_WIRED_HEADSET) || (android.os.Build.VERSION.SDK_INT >= 31 && it.type == AudioDeviceInfo.TYPE_BLE_HEADSET) }
    }
}
