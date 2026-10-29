package jp.casmate.app.outdoor

import com.pedro.common.TransportObservation
import com.pedro.common.frame.MediaFrame

/** Encoded frames only. Audio gets the next turn; a partial video is never replayed. */
internal class OutdoorSendQueue(private val latencyMs: Int, private val observation: TransportObservation,
    private val clock: () -> Long, private val limitBytes: Int = 4 * 1024 * 1024) {
    class Entry(val frame: MediaFrame, val at: Long, val videoId: Long, val liveGeneration: Long)
    private val audio = ArrayDeque<Entry>()
    private val video = ArrayDeque<Entry>()
    private var processing: Entry? = null
    private var bytes = 0
    @Volatile var needsKeyframe = true; private set

    @Synchronized fun offer(frame: MediaFrame, videoId: Long, liveGeneration: Long): Boolean {
        val isAudio = frame.type == MediaFrame.Type.AUDIO
        observation.generated(frame.info.size, isAudio, frame.info.isKeyFrame, videoId, liveGeneration)
        expire()
        if (frame.info.size > limitBytes || (!isAudio && needsKeyframe && !frame.info.isKeyFrame)) {
            observation.discarded(frame)
            if (!isAudio) { needsKeyframe = true; while (video.isNotEmpty()) discard(video.removeFirst()) }
            return false
        }
        while (bytes + frame.info.size > limitBytes || audio.size + video.size >= 512) {
            val removed = video.removeFirstOrNull() ?: if (isAudio) audio.removeFirstOrNull() else null
            if (removed == null) { observation.discarded(frame); if (!isAudio) needsKeyframe = true; return false }
            discard(removed)
        }
        // Eviction may have broken this video's prediction chain.
        if (!isAudio && needsKeyframe && !frame.info.isKeyFrame) { observation.discarded(frame); return false }
        val entry = Entry(frame, clock(), videoId, liveGeneration)
        if (isAudio) audio.addLast(entry) else { video.addLast(entry); if (frame.info.isKeyFrame) needsKeyframe = false }
        bytes += frame.info.size; observation.queued(frame, videoId, liveGeneration)
        return true
    }
    @Synchronized fun take(): Entry? {
        check(processing == null)
        expire()
        val next = audio.removeFirstOrNull() ?: video.removeFirstOrNull() ?: return null
        processing = next; observation.processing(next.frame); return next
    }
    @Synchronized fun finish(sent: Boolean) {
        val entry = processing ?: return
        bytes -= entry.frame.info.size
        if (sent) observation.sentFrame() else {
            observation.discarded(entry.frame)
            if (entry.frame.type == MediaFrame.Type.VIDEO) { needsKeyframe = true; while (video.isNotEmpty()) discard(video.removeFirst()) }
        }
        observation.finished(); processing = null
    }
    @Synchronized fun clear() {
        audio.clear(); video.clear(); processing = null; bytes = 0; needsKeyframe = true; observation.clearLocal()
    }
    @Synchronized fun sizeBytes() = bytes
    private fun expire() {
        val now = clock()
        while (audio.firstOrNull()?.let { now - it.at >= latencyMs } == true) discard(audio.removeFirst())
        while (video.firstOrNull()?.let { now - it.at >= latencyMs } == true) discard(video.removeFirst())
        if (needsKeyframe) while (video.firstOrNull()?.frame?.info?.isKeyFrame == false) discard(video.removeFirst())
    }
    private fun discard(entry: Entry) {
        bytes -= entry.frame.info.size; observation.discarded(entry.frame)
        if (entry.frame.type == MediaFrame.Type.VIDEO) {
            needsKeyframe = true
            // Once a reference frame is missing, queued dependent frames cannot recover it.
            while (video.isNotEmpty()) {
                val dependent = video.removeFirst()
                bytes -= dependent.frame.info.size; observation.discarded(dependent.frame)
            }
        }
    }
}
