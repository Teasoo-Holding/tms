package com.teasoo.tms.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.teasoo.tms.data.local.SyncState
import com.teasoo.tms.ui.theme.StatusColors
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Exposed dropdown for choosing one item; [enabled] false shows the current value read-only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> Picker(
    label: String,
    items: List<T>,
    selected: T?,
    itemLabel: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    supportingText: String? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded && enabled, onExpandedChange = { if (enabled) expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = selected?.let(itemLabel) ?: "",
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            supportingText = supportingText?.let { { Text(it) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
            items.forEach { item ->
                DropdownMenuItem(text = { Text(itemLabel(item)) }, onClick = { onSelect(item); expanded = false })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: LocalDate?, onChange: (LocalDate?) -> Unit, modifier: Modifier = Modifier, allowClear: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)) ?: "",
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        trailingIcon = { TextButton(onClick = { open = true }) { Text("Choose") } },
        modifier = modifier.fillMaxWidth(),
    )
    if (open) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = (value ?: LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= System.currentTimeMillis() + 86_400_000
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    onChange(state.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() })
                    open = false
                }) { Text("OK") }
            },
            dismissButton = {
                Row {
                    if (allowClear) TextButton(onClick = { onChange(null); open = false }) { Text("Clear") }
                    TextButton(onClick = { open = false }) { Text("Cancel") }
                }
            },
        ) { DatePicker(state) }
    }
}

/** Status label with a coloured dot; the text always carries the meaning. */
@Composable
fun StatusChip(code: String?, name: String?) {
    // Alive green, struggling (e.g. Transplant Shock) yellow, dead red, as on the web (#114).
    val stressed = Regex("shock|stress|wilt|damag|sick|inspect|weak|poor", RegexOption.IGNORE_CASE)
    val color = when {
        code == "DEAD" || code == "MISSING" -> StatusColors.critical
        code != null && (stressed.containsMatchIn(code) || stressed.containsMatchIn(name ?: "")) -> StatusColors.warning
        code == "ALIVE" || code == "HEALTHY" || code == "PLANTED" -> StatusColors.good
        else -> MaterialTheme.colorScheme.outline
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(name ?: "Not observed", style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SyncBadge(syncState: String) {
    val (text, color) = when (syncState) {
        SyncState.PENDING -> "Not yet synced" to MaterialTheme.colorScheme.tertiary
        SyncState.CONFLICT -> "Conflict – under review" to StatusColors.warning
        SyncState.REJECTED -> "Rejected by server" to MaterialTheme.colorScheme.error
        else -> return
    }
    Surface(color = color.copy(alpha = 0.14f), shape = MaterialTheme.shapes.small) {
        Text(text, color = if (syncState == SyncState.CONFLICT) MaterialTheme.colorScheme.onSurface else color, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
fun TreeIdText(prefix: String, serial: String, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp)) {
            Text(prefix, fontFamily = FontFamily.Monospace, fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(serial, fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
fun Notice(text: String, color: Color = MaterialTheme.colorScheme.secondaryContainer, modifier: Modifier = Modifier) {
    Surface(color = color, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Text(text, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

/** Every date and time is shown in West Africa Time, labelled "WAT", and days run midnight to midnight WAT. */
val WAT: ZoneId = ZoneId.of("Africa/Lagos")
const val WAT_LABEL = "WAT"
/** Today's date in WAT. */
fun todayWat(): LocalDate = LocalDate.now(WAT)

private val DISPLAY = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(WAT)
fun formatInstant(iso: String?): String = iso?.let { runCatching { "${DISPLAY.format(Instant.parse(it))} $WAT_LABEL" }.getOrDefault(it) } ?: "—"

/**
 * Keeps controls clear of the system navigation buttons/gesture bar at the bottom of the screen. Full-screen dialogs
 * do not get the bar's size on every device, so at least [min] is always kept free.
 */
fun Modifier.bottomSafe(min: androidx.compose.ui.unit.Dp = 40.dp) = composed {
    windowInsetsPadding(
        WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal).union(WindowInsets(bottom = min)),
    )
}

/** The same for the status bar and camera cut-out at the top. */
fun Modifier.topSafe(min: androidx.compose.ui.unit.Dp = 28.dp) = composed {
    windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal).union(WindowInsets(top = min)))
}

/**
 * The top bar on every screen: a soft green band, so it is clearly separate from the page below it. Text and icons use
 * the matching dark (or, in dark mode, light) colour for contrast.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun tmsTopBarColors() = TopAppBarDefaults.topAppBarColors(
    containerColor = MaterialTheme.colorScheme.primaryContainer,
    scrolledContainerColor = MaterialTheme.colorScheme.primaryContainer,
    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    navigationIconContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    actionIconContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
)
