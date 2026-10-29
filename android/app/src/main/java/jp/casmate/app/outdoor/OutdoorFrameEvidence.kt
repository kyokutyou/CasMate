package jp.casmate.app.outdoor

/** Correlates an actual new camera image submitted to MediaCodec with its encoded output.
 * The map contains timestamps and generation numbers only. A missing match is never proof. */
class OutdoorFrameEvidence {
    private val submitted = LinkedHashMap<Long, Long>()
    private var lastSourceTimestamp: Long? = null

    @Synchronized fun submitted(presentationUs: Long, sourceTimestampNs: Long, liveGeneration: Long) {
        val fresh = sourceTimestampNs > 0 && sourceTimestampNs != lastSourceTimestamp
        lastSourceTimestamp = sourceTimestampNs
        submitted[presentationUs] = if (fresh) liveGeneration else 0
        while (submitted.size > 600) submitted.remove(submitted.keys.first())
    }

    @Synchronized fun encoded(presentationUs: Long): Long = submitted.remove(presentationUs) ?: 0
    @Synchronized fun clear() { submitted.clear(); lastSourceTimestamp = null }
}
