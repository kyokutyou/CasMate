package jp.casmate.app.outdoor

/** Main-thread fault revisions prevent a late repair result from erasing a new failure. */
class OutdoorVideoFailureTracker {
    private val revisions = mutableMapOf<OutdoorVideoFault, Long>()
    fun record(fault: OutdoorVideoFault) { revisions[fault] = (revisions[fault] ?: 0) + 1 }
    fun snapshot(faults: Set<OutdoorVideoFault>) = faults.associateWith { revisions[it] ?: 0 }
    fun unchanged(snapshot: Map<OutdoorVideoFault, Long>) = snapshot.filter { (fault, revision) ->
        (revisions[fault] ?: 0) == revision
    }.keys
}

/** Service completion seam: codec-only repair retains the GL input and network recovery gate. */
internal fun completeOutdoorVideoRecovery(control: OutdoorAdaptiveControl, renderRebuilt: Boolean,
    explicit: Boolean, faultsRemain: Boolean, now: Long, restoreLiveInput: () -> Unit) {
    if (renderRebuilt) {
        restoreLiveInput()
        control.videoRecovered(now)
    }
    if (explicit && control.view.controlStopped && !faultsRemain) control.retry(now)
}
