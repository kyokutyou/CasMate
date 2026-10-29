package jp.casmate.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/** Keep current values readable when their setting is locked, without enabling input. */
@Composable
internal fun CasMateFilterChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val scheme = MaterialTheme.colorScheme
    FilterChip(selected = selected, onClick = onClick, label = label, modifier = modifier, enabled = enabled,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = scheme.surface, labelColor = scheme.onSurface,
            selectedContainerColor = scheme.primary, selectedLabelColor = scheme.onPrimary,
            selectedLeadingIconColor = scheme.onPrimary,
            disabledContainerColor = scheme.surface,
            disabledLabelColor = if (selected) scheme.onPrimaryContainer else scheme.onSurfaceVariant,
            disabledSelectedContainerColor = scheme.primaryContainer,
            disabledLeadingIconColor = scheme.onPrimaryContainer,
        ),
        border = BorderStroke(1.dp, when {
            selected && enabled -> scheme.primary
            selected -> scheme.onSurfaceVariant
            else -> scheme.outline
        }),
        // Reserve the same space in each option so selection never moves its label.
        leadingIcon = { Box(Modifier.size(18.dp)) {
            if (selected) Text("✓", color = if (enabled) scheme.onPrimary else scheme.onPrimaryContainer)
        } })
}

@Composable
internal fun CasMateButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.buttonColors(), contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    content: @Composable RowScope.() -> Unit) {
    Button(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = contentPadding,
        colors = colors.readableDisabled(), content = content)
}

@Composable
internal fun CasMateOutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(), contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    content: @Composable RowScope.() -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = contentPadding,
        colors = colors.readableDisabled(), content = content,
        border = if (enabled) ButtonDefaults.outlinedButtonBorder(true)
            else BorderStroke(1.dp, MaterialTheme.colorScheme.onSurfaceVariant))
}

@Composable
internal fun CasMateTextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.textButtonColors(), contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    content: @Composable RowScope.() -> Unit) {
    TextButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = contentPadding,
        colors = colors.copy(disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant), content = content)
}

@Composable
private fun ButtonColors.readableDisabled() = copy(
    disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
    disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

@Composable
internal fun CasMateSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier,
    enabled: Boolean = true) {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.surface.luminance() < .5f
    val disabledInk = Color(if (dark) 0xFF909090 else 0xFF838383)
    val disabledBase = Color(if (dark) 0xFF333333 else 0xFFEEEEEE)
    Switch(checked = checked, onCheckedChange = onCheckedChange, modifier = modifier, enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedTrackColor = scheme.primary, checkedThumbColor = scheme.onPrimary,
            checkedBorderColor = scheme.primary,
            uncheckedTrackColor = scheme.surfaceVariant, uncheckedThumbColor = scheme.primary,
            uncheckedBorderColor = scheme.primary,
            disabledCheckedTrackColor = disabledInk,
            disabledCheckedThumbColor = disabledBase, disabledCheckedBorderColor = disabledInk,
            disabledUncheckedTrackColor = disabledBase, disabledUncheckedBorderColor = disabledInk,
            disabledUncheckedThumbColor = disabledInk))
}
