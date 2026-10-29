package jp.casmate.app.outdoor

/** Native SRT returns 1 on success, -2 on authentication failure, and -1 on other failure. */
internal fun aggregateOutdoorCandidateResult(previous: Int, current: Int): Int = when {
    previous == 1 || current == 1 -> 1
    previous == -2 || current == -2 -> -2
    else -> -1
}
