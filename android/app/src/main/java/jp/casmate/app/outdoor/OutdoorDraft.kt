package jp.casmate.app.outdoor

import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver

/** Shared by the tab and the common settings dialog; never starts capture. */
class OutdoorDraft(portrait: Boolean = false, front: Boolean = false, device: Int = -1) {
    val portrait = mutableStateOf(portrait)
    val front = mutableStateOf(front)
    val device = mutableIntStateOf(device)
    /** Per-send opt-in; intentionally omitted from Saver so the next app session starts off. */
    val timestampOverlay = mutableStateOf(false)
    val revision = mutableIntStateOf(0)
    companion object {
        val Saver = listSaver<OutdoorDraft, Any>(
            save = { listOf(it.portrait.value, it.front.value, it.device.intValue) },
            restore = { OutdoorDraft(it[0] as Boolean, it[1] as Boolean, it[2] as Int) })
    }
}
