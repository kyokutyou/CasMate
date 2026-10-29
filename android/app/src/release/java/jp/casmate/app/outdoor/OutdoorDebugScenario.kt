package jp.casmate.app.outdoor

import com.pedro.common.TransportSnapshot

/** Release builds have no injection implementation or scenario creation. */
class OutdoorDebugScenario private constructor() {
    fun sample(now: Long, actual: TransportSnapshot?): TransportSnapshot? = actual
    companion object { fun start(now: Long): OutdoorDebugScenario? = null }
}
