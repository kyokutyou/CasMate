package jp.casmate.app.outdoor

import com.pedro.common.TransportSnapshot

/** Debug-only observation injection. ACK/frame evidence always remains actual transport evidence. */
class OutdoorDebugScenario private constructor(private val startedAt: Long) {
    fun sample(now: Long, actual: TransportSnapshot?): TransportSnapshot? = actual?.let {
        if (now - startedAt < 8000) it.copy(localWaitMs = maxOf(300, it.localWaitMs), audioWaitMs = maxOf(300, it.audioWaitMs)) else it
    }
    companion object { fun start(now: Long): OutdoorDebugScenario? = OutdoorDebugScenario(now) }
}
