package jp.casmate.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import jp.casmate.app.data.AppearanceMode

internal val CasMateLightColorScheme = lightColorScheme(
    primary = Color(0xFF236245), onPrimary = Color.White,
    primaryContainer = Color(0xFFEAF1E9), onPrimaryContainer = Color(0xFF1D3029),
    secondary = Color(0xFF52685C), onSecondary = Color.White,
    secondaryContainer = Color(0xFFEAF1E9), onSecondaryContainer = Color(0xFF1D3029),
    tertiary = Color(0xFF236245), onTertiary = Color.White,
    background = Color(0xFFF5F7F4), onBackground = Color(0xFF1D3029),
    surface = Color.White, onSurface = Color(0xFF1D3029),
    surfaceVariant = Color(0xFFEAF1E9), onSurfaceVariant = Color(0xFF52685C),
    surfaceTint = Color(0xFF236245), outline = Color(0xFFD9E3DB), outlineVariant = Color(0xFFD9E3DB),
    surfaceContainer = Color.White, surfaceContainerLow = Color(0xFFF5F7F4),
    surfaceContainerHigh = Color(0xFFEAF1E9), surfaceContainerHighest = Color(0xFFEAF1E9),
    surfaceContainerLowest = Color.White, surfaceBright = Color.White, surfaceDim = Color(0xFFEAF1E9),
    error = Color(0xFFA13535), onError = Color.White,
    errorContainer = Color(0xFFFFF0EE), onErrorContainer = Color(0xFFA13535),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFB6E9CB), onPrimary = Color(0xFF163022),
    primaryContainer = Color(0xFF293D30), onPrimaryContainer = Color(0xFFE9F2EC),
    secondary = Color(0xFFB5C6BB), onSecondary = Color(0xFF163022),
    secondaryContainer = Color(0xFF293D30), onSecondaryContainer = Color(0xFFE9F2EC),
    tertiary = Color(0xFFB6E9CB), onTertiary = Color(0xFF163022),
    background = Color(0xFF151B19), onBackground = Color(0xFFE9F2EC),
    surface = Color(0xFF212A26), onSurface = Color(0xFFE9F2EC),
    surfaceVariant = Color(0xFF293D30), onSurfaceVariant = Color(0xFFB5C6BB),
    surfaceTint = Color(0xFFB6E9CB), outline = Color(0xFF3A4B40), outlineVariant = Color(0xFF3A4B40),
    surfaceContainer = Color(0xFF212A26), surfaceContainerLow = Color(0xFF151B19),
    surfaceContainerHigh = Color(0xFF293D30), surfaceContainerHighest = Color(0xFF293D30),
    surfaceContainerLowest = Color(0xFF151B19), surfaceBright = Color(0xFF293D30), surfaceDim = Color(0xFF151B19),
    error = Color(0xFFFFB4AB), onError = Color(0xFF472B29),
    errorContainer = Color(0xFF472B29), onErrorContainer = Color(0xFFFFB4AB),
)

/** Manual appearance is independent of the system, registration and running services. */
@Composable
fun CasMateTheme(appearance: AppearanceMode, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (appearance == AppearanceMode.DARK) DarkColors else CasMateLightColorScheme, content = content)
}

@Composable
fun AppearanceSettings(
    appearance: AppearanceMode,
    onAppearanceChange: (AppearanceMode) -> Unit,
    error: String? = null,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("配色", style = MaterialTheme.typography.titleSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppearanceMode.entries.forEach { mode ->
                val chosen = appearance == mode
                FilledTonalButton(onClick = { onAppearanceChange(mode) },
                    modifier = Modifier.weight(1f).heightIn(min = 64.dp).semantics { selected = chosen },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                        contentColor = if (chosen) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    )) {
                    Box(Modifier.size(18.dp)) { if (chosen) Text("✓") }
                    Spacer(Modifier.width(4.dp))
                    Text(if (mode == AppearanceMode.LIGHT) "ライトモード" else "ダークモード")
                }
            }
        }
        // Saving failures use a reserved, font-scaled slot and never insert a notice below controls.
        val statusHeight = with(LocalDensity.current) { (MaterialTheme.typography.bodySmall.lineHeight * 2).toDp() }.coerceAtLeast(40.dp)
        Box(Modifier.fillMaxWidth().height(statusHeight).verticalScroll(rememberScrollState())) {
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}
