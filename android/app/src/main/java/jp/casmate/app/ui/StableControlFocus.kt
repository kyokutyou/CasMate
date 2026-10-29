package jp.casmate.app.ui

import androidx.compose.foundation.focusable
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged

/** Native disabled clickable nodes remove their target; retain only the same previously focused control. */
@Composable
internal fun Modifier.rememberControlFocusModifier(enabled: Boolean): Modifier {
    val requester = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    val keepFocus = remember(enabled) { focused }
    val restorePending = remember(enabled) { mutableStateOf(focused) }
    // Run once after modifier attachment, before another user event can move focus.
    SideEffect {
        if (restorePending.value) {
            restorePending.value = false
            requester.requestFocus()
        }
    }
    return onFocusChanged { focused = it.hasFocus }.focusRequester(requester)
        .focusProperties { canFocus = true }
        // One target: Native when enabled, a carrier only for retained disabled focus.
        .focusable(enabled = !enabled && keepFocus)
}
