package jp.casmate.app.outdoor

import com.pedro.common.socket.base.SocketType
import com.pedro.library.util.streamclient.StreamBaseClient

/** RootEncoder's compatibility surface. Session controls are owned by OutdoorTransmission. */
internal class OutdoorStreamClient(private val sender: OutdoorNativeSender) : StreamBaseClient() {
    private fun unsupported(): Nothing = error("This option is owned by the outdoor session")
    override fun setAuthorization(user: String?, password: String?) { if (user != null || password != null) unsupported() }
    override fun reTry(delay: Long, reason: String, backupUrl: String?): Boolean = unsupported()
    override fun setReTries(reTries: Int) { require(reTries == 0) }
    override fun hasCongestion(percentUsed: Float) = (sender.observation()?.unackedAgeMs ?: 0) > 100
    override fun setLogs(enabled: Boolean) { require(!enabled) }
    override fun setCheckServerAlive(enabled: Boolean) { require(enabled) }
    override fun resizeCache(newSize: Int): Unit = unsupported()
    override fun clearCache(): Unit = unsupported()
    override fun getCacheSize() = 512
    override fun getItemsInCache() = sender.observation()?.queuedFrames ?: 0
    override fun getQueueBytesOut() = sender.observation()?.queuedBytes ?: 0
    override fun getSentAudioFrames() = sender.observation()?.sentAudioFrames ?: 0
    override fun getSentVideoFrames() = sender.observation()?.sentVideoFrames ?: 0
    override fun getBytesSend() = sender.observation()?.sentBytes ?: 0
    override fun getDroppedAudioFrames() = sender.observation()?.droppedAudioFrames ?: 0
    override fun getDroppedVideoFrames() = sender.observation()?.droppedVideoFrames ?: 0
    override fun resetSentAudioFrames(): Unit = unsupported()
    override fun resetSentVideoFrames(): Unit = unsupported()
    override fun resetDroppedAudioFrames(): Unit = unsupported()
    override fun resetDroppedVideoFrames(): Unit = unsupported()
    override fun resetBytesSend(): Unit = unsupported()
    override fun setOnlyAudio(onlyAudio: Boolean) { require(!onlyAudio) }
    override fun setOnlyVideo(onlyVideo: Boolean) { require(!onlyVideo) }
    override fun setBitrateExponentialFactor(factor: Float) { require(factor == 1f) }
    override fun getBitrateExponentialFactor() = 1f
    override fun setSocketType(type: SocketType): Unit = unsupported()
    override fun setSocketTimeout(timeout: Long): Unit = unsupported()
    override fun setDelay(millis: Long) { require(millis == 0L) }
}
