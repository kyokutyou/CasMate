package jp.casmate.app.ui

import jp.casmate.app.audio.AudioStatus
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints

/** Waiting and recoverable failures retain the user's start request and can be stopped. */
internal val AudioStatus.readingActive: Boolean
    get() = this !in setOf(AudioStatus.STOPPED, AudioStatus.NOTIFICATION_PERMISSION_REQUIRED,
        AudioStatus.NETWORK_PERMISSION_REQUIRED, AudioStatus.FOREGROUND_UNAVAILABLE)

/** Reserve all failure text before asynchronous updates so the settings controls stay put. */
@Composable
internal fun CommentsReadingStatusDetails(status: AudioStatus) {
    BoxWithConstraints(Modifier.fillMaxWidth().testTag("読み上げ状態の詳細")) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val style = MaterialTheme.typography.bodyMedium
        val width = with(density) { maxWidth.roundToPx() }.coerceAtLeast(1)
        val height = with(density) { AudioStatus.entries.maxOf {
            measurer.measure("読み上げの状態：${it.label}", style,
                constraints = Constraints(maxWidth = width)).size.height
        }.toDp() }
        Text("読み上げの状態：${status.label}", Modifier.fillMaxWidth().height(height), style = style)
    }
}
