package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.sync.SyncScheduler
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// ---------------------------------------------------------------- errors

const val OFFLINE_MESSAGE = "You’re offline. Administration needs a connection to the server; field work keeps working offline."

/** Friendly text for a failed admin call, including the server’s own validation messages. */
fun adminErrorMessage(e: Throwable): String = when (e) {
    is IOException -> OFFLINE_MESSAGE
    is HttpException -> {
        val body = runCatching { e.response()?.errorBody()?.string()?.let { TmsJson.parseToJsonElement(it).jsonObject } }.getOrNull()
        val message = body?.get("message")?.let { (it as? JsonPrimitive)?.contentOrNull }
        val details = (body?.get("details") as? JsonArray)?.mapNotNull { d ->
            when (d) {
                is JsonPrimitive -> d.contentOrNull?.let { SCHEME_PROBLEMS[it] ?: it }
                is JsonObject -> {
                    val path = d["path"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val msg = d["message"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    if (path.isBlank()) msg else "${path.replace('_', ' ')}: $msg"
                }
                else -> null
            }
        }.orEmpty()
        when {
            e.code() == 401 -> "Your session has expired. Sign in again."
            e.code() == 403 -> message ?: "Only administrators can do this."
            e.code() >= 500 -> "The server had a problem (${e.code()}). Try again in a moment."
            else -> listOfNotNull(message ?: "The server returned an error (${e.code()}).", details.takeIf { it.isNotEmpty() }?.joinToString("\n• ", "• "))
                .joinToString("\n")
        }
    }
    else -> e.message ?: "Something went wrong."
}

private val SCHEME_PROBLEMS = mapOf(
    "SEPARATOR_UNSUPPORTED" to "Use one of - _ / . or no separator.",
    "SERIAL_WIDTH_OUT_OF_RANGE" to "The serial width must be between 1 and 12 digits.",
    "COMPONENT_DUPLICATED" to "Each part can appear only once (fixed text can repeat).",
    "TEXT_VALUE_INVALID" to "Fixed text needs 1 to 16 letters or digits.",
    "SERIAL_MISSING" to "The ID needs a tree number.",
    "SERIAL_NOT_LAST" to "The tree number must be the last part.",
    "SERIAL_MUST_BE_REQUIRED" to "The tree number is always required.",
    "SCOPE_DIMENSION_DUPLICATED" to "Each uniqueness dimension can be chosen once.",
)

// ---------------------------------------------------------------- view model base

/**
 * Shared loading/saving state for the online admin screens. Every successful change triggers a device
 * sync so new configuration reaches this phone’s offline cache.
 */
abstract class AdminBaseViewModel(protected val appContext: Context) : ViewModel() {
    val loading = MutableStateFlow(false)
    /** Failure of the last load (shown in place of the content, with Retry). */
    val error = MutableStateFlow<String?>(null)
    val saving = MutableStateFlow(false)
    /** Failure of the last save (shown inside the open form). */
    val formError = MutableStateFlow<String?>(null)
    /** One-off confirmations for a snackbar. */
    val messages = MutableSharedFlow<String>(extraBufferCapacity = 8)

    protected fun load(block: suspend () -> Unit) = viewModelScope.launch {
        loading.value = true
        error.value = null
        try {
            block()
        } catch (e: Throwable) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error.value = adminErrorMessage(e)
        } finally {
            loading.value = false
        }
    }

    /** Runs a change; on success syncs the device, reports [success] and calls [onDone]. */
    protected fun save(success: String?, onDone: () -> Unit = {}, reload: (() -> Unit)? = null, block: suspend () -> Unit) = viewModelScope.launch {
        saving.value = true
        formError.value = null
        try {
            block()
            SyncScheduler.syncNow(appContext)
            success?.let { messages.tryEmit(it) }
            onDone()
            reload?.invoke()
        } catch (e: Throwable) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            formError.value = adminErrorMessage(e)
        } finally {
            saving.value = false
        }
    }

    fun clearFormError() {
        formError.value = null
    }
}

// ---------------------------------------------------------------- scaffold and states

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScaffold(
    title: String,
    onBack: (() -> Unit)?,
    subtitle: String? = null,
    snackbar: SnackbarHostState? = null,
    actions: @Composable RowScope.() -> Unit = {},
    floatingActionButton: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title)
                        subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1) }
                    }
                },
                navigationIcon = { onBack?.let { IconButton(onClick = it) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } } },
                actions = actions,
            )
        },
        snackbarHost = { snackbar?.let { SnackbarHost(it) } },
        floatingActionButton = floatingActionButton,
        content = content,
    )
}

/** Shows one-off messages from the view model in [host]. */
@Composable
fun CollectMessages(vm: AdminBaseViewModel, host: SnackbarHostState) {
    LaunchedEffect(vm) { vm.messages.collect { host.showSnackbar(it) } }
}

/**
 * Standard load handling: a spinner on first load, a full-screen error with Retry when nothing has loaded,
 * or an error banner above stale content.
 */
@Composable
fun AdminLoadState(
    loading: Boolean,
    error: String?,
    hasData: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(modifier.fillMaxSize()) {
        when {
            hasData -> Column(Modifier.fillMaxSize()) {
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(it, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            TextButton(onClick = onRetry) { Text("Retry") }
                        }
                    }
                }
                Box(Modifier.weight(1f)) { content() }
            }
            error != null -> ErrorState(error, onRetry)
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val offline = message == OFFLINE_MESSAGE
    Column(
        modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(if (offline) Icons.Default.CloudOff else Icons.Default.ErrorOutline, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(if (offline) "Can’t reach the server" else "Something went wrong", style = MaterialTheme.typography.titleMedium)
        Text(if (offline) "Administration needs a connection. Field work keeps working offline; try again when you’re connected." else message,
            style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Retry") }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, body: String, actionLabel: String? = null, onAction: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(44.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (actionLabel != null && onAction != null) {
            Button(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(actionLabel) }
        }
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, supporting: String? = null, action: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        action?.invoke()
    }
}

/** Small tonal label, e.g. "Inactive" or a role. */
@Composable
fun Tag(text: String, color: Color = MaterialTheme.colorScheme.secondaryContainer, contentColor: Color = MaterialTheme.colorScheme.onSecondaryContainer) {
    Surface(color = color, contentColor = contentColor, shape = MaterialTheme.shapes.small) {
        Text(text, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
fun InactiveTag() = Tag("Inactive", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)

// ---------------------------------------------------------------- forms

/** Dialog form with a scrollable body, an inline error and a busy state. */
@Composable
fun FormDialog(
    title: String,
    confirmLabel: String,
    canConfirm: Boolean,
    saving: Boolean,
    error: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                content()
                error?.let {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small) {
                        Text(it, Modifier.padding(10.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onConfirm, enabled = canConfirm && !saving) {
                if (saving) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text(confirmLabel)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") } },
    )
}

@Composable
fun ConfirmDialog(title: String, body: String, confirmLabel: String, saving: Boolean = false, error: String? = null, destructive: Boolean = false, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(body)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm, enabled = !saving,
                colors = if (destructive) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError)
                else ButtonDefaults.buttonColors(),
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") } },
    )
}

@Composable
fun TextInput(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    isError: Boolean = false,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
    minLines: Int = 1,
) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = singleLine, enabled = enabled,
        supportingText = supporting?.let { { Text(it) } }, isError = isError, keyboardOptions = keyboardOptions, minLines = minLines,
        modifier = modifier.fillMaxWidth(),
    )
}

/** Short code input: letters and digits only, upper-cased, at most [max] characters. */
@Composable
fun CodeInput(value: String, onChange: (String) -> Unit, label: String = "Short code", supporting: String? = "Letters and digits, up to 16", max: Int = 16, enabled: Boolean = true, allowUnderscore: Boolean = false) {
    TextInput(
        value, { raw -> onChange(raw.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' || (allowUnderscore && it == '_') }.take(max)) },
        label, supporting = supporting, enabled = enabled,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
    )
}

/** Whole row toggles, so the target is large. */
@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, supporting: String? = null, enabled: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/** Single choice among a few options, as chips that wrap. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> ChoiceChips(label: String?, options: List<T>, selected: T?, optionLabel: (T) -> String, onSelect: (T) -> Unit, enabled: Boolean = true) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        label?.let { Text(it, style = MaterialTheme.typography.labelLarge) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { o ->
                FilterChip(selected = o == selected, onClick = { onSelect(o) }, label = { Text(optionLabel(o)) }, enabled = enabled,
                    modifier = Modifier.heightIn(min = 40.dp))
            }
        }
    }
}

/** Date picker field that allows any date (the shared DateField only allows past dates). Value is YYYY-MM-DD. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IsoDateField(label: String, value: String?, onChange: (String?) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val date = value?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
    OutlinedTextField(
        value = date?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)) ?: "",
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        placeholder = { Text("Not set") },
        trailingIcon = { TextButton(onClick = { open = true }) { Text(if (date == null) "Choose" else "Change") } },
        modifier = modifier.fillMaxWidth(),
    )
    if (open) {
        val state = rememberDatePickerState(initialSelectedDateMillis = (date ?: LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    onChange(state.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() })
                    open = false
                }) { Text("OK") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { onChange(null); open = false }) { Text("Clear") }
                    TextButton(onClick = { open = false }) { Text("Cancel") }
                }
            },
        ) { DatePicker(state) }
    }
}

@Composable
fun <T> collect(flow: MutableStateFlow<T>): T = flow.collectAsStateWithLifecycle().value

// ---------------------------------------------------------------- labels and formatting

fun roleLabel(role: String?) = when (role) {
    "ADMIN" -> "Administrator"
    "EXECUTIVE" -> "Executive"
    "FIELD_OFFICER" -> "Field officer"
    null -> "—"
    else -> role
}

fun projectStatusLabel(status: String) = when (status) {
    "DRAFT" -> "Draft"
    "ACTIVE" -> "Active"
    "PAUSED" -> "Paused"
    "COMPLETED" -> "Completed"
    "ARCHIVED" -> "Archived"
    else -> status
}

val PROJECT_STATUSES = listOf("DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED")

fun formatIsoDate(value: String?): String = value?.let {
    runCatching { LocalDate.parse(it.take(10)).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)) }.getOrDefault(it)
} ?: "—"

fun parseInstant(value: String?): Instant? = value?.let { runCatching { Instant.parse(it) }.getOrNull() }

/** "just now", "3 h ago", "5 days ago", or a date for older times. */
fun relativeTime(value: String?, now: Instant = Instant.now()): String {
    val t = parseInstant(value) ?: return "never"
    val d = Duration.between(t, now)
    return when {
        d.isNegative || d.toMinutes() < 1 -> "just now"
        d.toMinutes() < 60 -> "${d.toMinutes()} min ago"
        d.toHours() < 24 -> "${d.toHours()} h ago"
        d.toDays() < 14 -> "${d.toDays()} day${if (d.toDays() == 1L) "" else "s"} ago"
        else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(t)
    }
}

/** True when the time is missing or older than [days]. */
fun isStale(value: String?, days: Long = 7): Boolean = parseInstant(value)?.let { Duration.between(it, Instant.now()).toDays() >= days } ?: true

/** "12 Oct 10:21" this year, "12 Oct 2023 10:21" otherwise. */
fun shortDateTime(value: String?): String {
    val t = parseInstant(value) ?: return value ?: "—"
    val z = t.atZone(ZoneId.systemDefault())
    val pattern = if (z.year == LocalDate.now().year) "d MMM HH:mm" else "d MMM yyyy HH:mm"
    return DateTimeFormatter.ofPattern(pattern).format(z)
}

@Composable
fun BoldValue(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Color.Unspecified) {
    Row(modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = valueColor)
    }
}
