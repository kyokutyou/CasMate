package jp.casmate.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/** Measure the complete status vocabulary so live changes never reflow either section. */
@Composable
internal fun SendBroadcastSectionHeading(
    title: String,
    description: String,
    status: String,
    statuses: List<String>,
    onDetails: () -> Unit,
    detailsTag: String,
    statusTag: String,
    modifier: Modifier = Modifier,
    statusColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val descriptionStyle = MaterialTheme.typography.bodySmall
    val statusStyle = MaterialTheme.typography.labelLarge
    val detailStyle = MaterialTheme.typography.labelLarge
    val detailWidth = with(density) {
        measurer.measure("詳細", detailStyle).size.width.toDp() + 16.dp
    }.coerceAtLeast(48.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            CasMateTextButton(onClick = onDetails, modifier = Modifier.width(detailWidth).heightIn(min = 48.dp)
                .focusProperties { canFocus = true }.testTag(detailsTag),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) { Text("詳細", style = detailStyle) }
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val candidates = (statuses + status).distinct()
            val fullWidth = with(density) { maxWidth.roundToPx() }.coerceAtLeast(1)
            val statusInset = with(density) { 14.dp.roundToPx() }
            val gap = with(density) { 8.dp.roundToPx() }
            val longestStatusWidth = candidates.maxOf { measurer.measure(it, statusStyle).size.width } + statusInset
            val descriptionWidth = measurer.measure(description, descriptionStyle).size.width
            val stacked = density.fontScale >= 1.5f || descriptionWidth + longestStatusWidth + gap > fullWidth
            val descriptionLimit = if (stacked) fullWidth else (fullWidth - longestStatusWidth - gap).coerceAtLeast(1)
            val statusLimit = (if (stacked) fullWidth - statusInset else longestStatusWidth - statusInset).coerceAtLeast(1)
            val descriptionHeight = measurer.measure(description, descriptionStyle, constraints = Constraints(maxWidth = descriptionLimit)).size.height
            val statusHeight = candidates.maxOf { measurer.measure(it, statusStyle, constraints = Constraints(maxWidth = statusLimit)).size.height }
            val fixedHeight = with(density) {
                if (stacked) (descriptionHeight + statusHeight).toDp() + 4.dp else maxOf(descriptionHeight, statusHeight).toDp()
            }
            @Composable fun Status(modifier: Modifier = Modifier) {
                Row(modifier.height(with(density) { statusHeight.toDp() }).testTag(statusTag).semantics(mergeDescendants = true) {},
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).background(statusColor, CircleShape))
                    Text(status, style = statusStyle, color = statusColor)
                }
            }
            if (stacked) Column(Modifier.fillMaxWidth().height(fixedHeight), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(description, style = descriptionStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Status(Modifier.fillMaxWidth())
            } else Row(Modifier.fillMaxWidth().height(fixedHeight), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(description, Modifier.weight(1f), style = descriptionStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Status(Modifier.width(with(density) { longestStatusWidth.toDp() }))
            }
        }
    }
}
