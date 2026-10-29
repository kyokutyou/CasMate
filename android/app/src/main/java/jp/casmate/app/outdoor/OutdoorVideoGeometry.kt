package jp.casmate.app.outdoor

/** RootEncoder's clockwise source angle. Output dimensions are independent. */
fun outdoorCameraRotation(displayOrientation: Int): Int = (displayOrientation + 270) % 360

/** Keep the last quadrant for unknown/flat readings and add 15 degrees of hysteresis. */
internal class OutdoorOrientationTracker(initial: Int) {
    var current = initial
        private set

    fun sample(angle: Int): Int? {
        if (angle !in 0..359) return null
        val difference = kotlin.math.abs(angle - current).let { minOf(it, 360 - it) }
        val quadrant = ((angle + 45) / 90 * 90) % 360
        if (difference < 60 || quadrant == current) return null
        current = quadrant
        return current
    }
}
