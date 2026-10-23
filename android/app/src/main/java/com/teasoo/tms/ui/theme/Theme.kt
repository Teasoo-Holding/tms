package com.teasoo.tms.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle

private val Light = lightColorScheme(
    primary = Color(0xFF1D6B45), onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEBD9), onPrimaryContainer = Color(0xFF0B2E1D),
    secondary = Color(0xFF52634F), tertiary = Color(0xFF2A78D6),
    error = Color(0xFFB42323), background = Color(0xFFF7F7F3), surface = Color(0xFFFCFCFB),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF7BD3A4), onPrimary = Color(0xFF00391F),
    primaryContainer = Color(0xFF15502F), onPrimaryContainer = Color(0xFFCDEBD9),
    secondary = Color(0xFFB9CCB4), tertiary = Color(0xFF6DA7EC),
    error = Color(0xFFF08A8A), background = Color(0xFF121211), surface = Color(0xFF1A1A19),
)

/** Status cues used beside text labels, never on their own. */
object StatusColors {
    val good = Color(0xFF0CA30C)
    val warning = Color(0xFFFAB219)
    val critical = Color(0xFFD03B3B)
}

/** Text a size up from the Material defaults, for reading outdoors and at arm's length. */
private const val TEXT_SCALE = 1.12f

private fun TextStyle.larger() = copy(fontSize = fontSize * TEXT_SCALE, lineHeight = lineHeight * TEXT_SCALE)

private val Larger = Typography().run {
    copy(
        displayLarge = displayLarge.larger(), displayMedium = displayMedium.larger(), displaySmall = displaySmall.larger(),
        headlineLarge = headlineLarge.larger(), headlineMedium = headlineMedium.larger(), headlineSmall = headlineSmall.larger(),
        titleLarge = titleLarge.larger(), titleMedium = titleMedium.larger(), titleSmall = titleSmall.larger(),
        bodyLarge = bodyLarge.larger(), bodyMedium = bodyMedium.larger(), bodySmall = bodySmall.larger(),
        labelLarge = labelLarge.larger(), labelMedium = labelMedium.larger(), labelSmall = labelSmall.larger(),
    )
}

@Composable
fun TmsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, typography = Larger, content = content)
}
