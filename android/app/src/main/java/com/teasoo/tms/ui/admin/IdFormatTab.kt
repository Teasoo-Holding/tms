package com.teasoo.tms.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.teasoo.tms.data.remote.AdminPlantingYearDto
import com.teasoo.tms.data.remote.AdminSchemeDto
import com.teasoo.tms.data.remote.ProjectDetailDto
import com.teasoo.tms.data.remote.SchemeComponent
import com.teasoo.tms.data.remote.SchemeRequest

/**
 * One format per project. Vendors tag trees with the same model and each starts from 1, so the vendor's short code is
 * normally part of the ID and numbers run per project + year + vendor.
 */
val COMPONENT_TYPES = listOf("PROJECT_CODE", "PLANTING_YEAR", "VENDOR_CODE", "TEXT", "SECTOR_CODE", "SUB_SECTOR_CODE", "SERIAL")
val SCOPE_DIMENSIONS = listOf("PROJECT", "PLANTING_YEAR", "VENDOR", "SECTOR", "SUB_SECTOR")
val RECOMMENDED_SCOPE = listOf("PROJECT", "PLANTING_YEAR", "VENDOR")
/** Parts that are the same on every tree in the format's scope; the others change with where the tree is. */
val FIXED_TYPES = setOf("PROJECT_CODE", "PLANTING_YEAR", "VENDOR_CODE", "TEXT")
private const val MAX_PARTS = 8
private val SEPARATORS = listOf("-", "_", "/", ".", "")
private val TEXT_PATTERN = Regex("^[A-Z0-9]{1,16}$")

fun componentLabel(type: String) = when (type) {
    "PROJECT_CODE" -> "Project code"
    "PLANTING_YEAR" -> "Planting year"
    "VENDOR_CODE" -> "Vendor code"
    "TEXT" -> "Fixed text"
    "SECTOR_CODE" -> "Sector code"
    "SUB_SECTOR_CODE" -> "Sub-sector code"
    "SERIAL" -> "Tree number"
    else -> type
}

private fun componentText(c: SchemeComponent) = if (c.type == "TEXT") "“${c.value.orEmpty()}”" else componentLabel(c.type)

fun scopeLabel(dim: String) = when (dim) {
    "PROJECT" -> "Project"
    "PLANTING_YEAR" -> "Planting year"
    "VENDOR" -> "Vendor"
    "SECTOR" -> "Sector"
    "SUB_SECTOR" -> "Sub-sector"
    else -> dim
}

private fun separatorLabel(s: String) = if (s.isEmpty()) "None" else "“$s”"

/** Example ID for a format, using this project’s real codes where they exist. Fixed text parts show their own value. */
fun previewId(components: List<SchemeComponent>, separator: String, serialWidth: Int, samples: Map<String, String>, serial: Int = 1): String {
    val parts = components.filter { it.type != "SERIAL" }.mapNotNull { c ->
        (if (c.type == "TEXT") c.value?.takeIf { it.isNotBlank() } ?: "TEXT" else samples[c.type])?.uppercase()
    }
    val serialText = serial.toString().padStart(serialWidth.coerceIn(1, 12), '0')
    return if (parts.isEmpty()) serialText else parts.joinToString(separator) + separator + serialText
}

private fun schemeProblems(components: List<SchemeComponent>, scope: List<String>): List<String> = buildList {
    val types = components.map { it.type }
    val named = types.filter { it != "TEXT" }
    if (named.toSet().size != named.size) add("Each part can appear only once (fixed text can repeat).")
    if (components.size > MAX_PARTS) add("An ID can have at most $MAX_PARTS parts.")
    if (components.any { it.type == "TEXT" && !TEXT_PATTERN.matches(it.value.orEmpty()) }) add("Fixed text needs 1 to 16 letters or digits.")
    if ("SERIAL" !in types) add("The ID needs a tree number.") else if (types.last() != "SERIAL") add("The tree number must be the last part.")
    if (scope.toSet().size != scope.size) add("Each uniqueness dimension can be chosen once.")
    val needs = mapOf("PLANTING_YEAR" to "PLANTING_YEAR", "VENDOR" to "VENDOR_CODE", "SECTOR" to "SECTOR_CODE", "SUB_SECTOR" to "SUB_SECTOR_CODE")
    scope.forEach { d ->
        val c = needs[d]
        if (c != null && c !in types) add("Tree numbers restart for each ${scopeLabel(d).lowercase()}, but the ID does not show it, so two trees could carry the same visible ID.")
    }
}

private fun isWarning(problem: String) = problem.startsWith("Tree numbers restart for each")

private fun scopeSentence(scope: List<String>) =
    if (scope.isEmpty()) "Tree numbers are unique across the whole system (they never restart)."
    else "Tree numbers restart for each " + scope.joinToString(" + ") { scopeLabel(it).lowercase() } + "."

/** The builder's working copy of a format. */
private class FormatDraft(base: AdminSchemeDto?) {
    val components = mutableStateListOf<SchemeComponent>().apply {
        addAll(
            base?.components?.takeIf { it.isNotEmpty() }
                ?: listOf(SchemeComponent("PROJECT_CODE"), SchemeComponent("PLANTING_YEAR"), SchemeComponent("VENDOR_CODE"), SchemeComponent("SERIAL")),
        )
    }
    var separator by mutableStateOf(base?.separator ?: "-")
    var width by mutableIntStateOf(base?.serialWidth ?: 5)
    val scope = mutableStateListOf<String>().apply {
        addAll(base?.serialUniquenessScope ?: RECOMMENDED_SCOPE)
    }
}

/**
 * The project's one ID format. Tree numbers run on per project and planting year; vendors share the sequence.
 * Changing the format makes a new version; existing tree IDs never change.
 */
@Composable
internal fun IdFormatTab(p: ProjectDetailDto, year: AdminPlantingYearDto?, vm: ProjectSetupViewModel) {
    val areas = collect(vm.areas)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val current = p.schemes.activeIn(null, null)
    val samples = idSamples(p, year, p.linkedVendors(year?.id).firstOrNull()?.vendorShortCode ?: "KNM", areas)

    var draft by remember { mutableStateOf<FormatDraft?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    val actions = rememberItemActions()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val d = draft
        if (d != null) {
            FormatBuilder(p, d, saving, samples, onCancel = { draft = null }, onSave = { vm.clearFormError(); confirming = true })
            Spacer(Modifier.height(24.dp))
            return@Column
        }

        FormatLevelCard(
            title = "Tree ID format",
            subtitle = "One format for the project. With the vendor code in it, each vendor numbers its own trees from 1.",
            scheme = current,
            samples = samples,
            emptyText = "Not set. Needed before trees can be registered.",
            actionLabel = if (current == null) "Set the format" else "Change",
            onAction = { vm.clearFormError(); draft = FormatDraft(current) },
        )

        if (p.schemes.isNotEmpty()) {
            TextButton(onClick = { showHistory = !showHistory }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (showHistory) "Hide all versions" else "All versions (${p.schemes.size})")
            }
            if (showHistory) p.schemes.sortedByDescending { it.version }.forEach { s ->
                VersionRow(s, idSamples(p, year, s.vendorShortCode, areas), onActions = {
                    actions.open(
                        "${s.scopeTitle()} · v${s.version}",
                        delete = PendingDelete(
                            "format version ${s.version}",
                            detail = if (s.active) "Only a format no tree uses can be deleted." else null,
                            run = { done -> vm.deleteScheme(s, done) },
                        ),
                    )
                })
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    ItemActionsHost(actions, vm)

    val d = draft
    if (confirming && d != null) {
        FormDialog(
            "Save the new tree ID format?", "Save", true, saving, formError,
            onConfirm = { vm.createScheme(SchemeRequest(d.components.toList(), d.separator, d.width, d.scope.toList())) { confirming = false; draft = null } },
            onDismiss = { confirming = false },
        ) {
            PreviewBox(previewId(d.components, d.separator, d.width, samples, 1))
            Text((if (current != null) "Replaces the current one. " else "") + "Existing tree IDs don’t change.")
        }
    }
}

@Composable
private fun FormatLevelCard(
    title: String,
    subtitle: String?,
    scheme: AdminSchemeDto?,
    samples: Map<String, String>,
    emptyText: String,
    actionLabel: String,
    onAction: () -> Unit,
) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    subtitle?.let { Hint(it) }
                }
                if (scheme != null) Tag("In use")
            }
            if (scheme == null) Text(emptyText, style = MaterialTheme.typography.bodyMedium)
            else SchemeSummary(scheme, samples)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAction, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(actionLabel) }
            }
        }
    }
}

@Composable
private fun SchemeSummary(s: AdminSchemeDto, samples: Map<String, String>) {
    PreviewBox(previewId(s.components, s.separator, s.serialWidth, samples, 1))
    Text(s.components.joinToString(" + ") { componentText(it) + if (!it.required) " (optional)" else "" }, style = MaterialTheme.typography.bodyMedium)
    Hint(scopeSentence(s.serialUniquenessScope))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FormatBuilder(
    p: ProjectDetailDto,
    d: FormatDraft,
    saving: Boolean,
    samples: Map<String, String>,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    val problems = schemeProblems(d.components, d.scope)
    val blocking = problems.filterNot(::isWarning)
    val replaced = p.schemes.activeIn(null, null)

    SectionHeader("New ID format")

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (replaced != null) Hint("Replaces version ${replaced.version}.")

            HorizontalDivider()
            PreviewBox(previewId(d.components, d.separator, d.width, samples, 1))
            Text("Next trees: ${previewId(d.components, d.separator, d.width, samples, 2)}, ${previewId(d.components, d.separator, d.width, samples, 3)}",
                style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)

            HorizontalDivider()
            Text("Parts", style = MaterialTheme.typography.titleSmall)
            d.components.forEachIndexed { i, c ->
                ComponentRow(
                    c, index = i, count = d.components.size, samples = samples,
                    onUp = { if (i > 0) d.components.add(i - 1, d.components.removeAt(i)) },
                    onDown = { if (i < d.components.lastIndex - 1) d.components.add(i + 1, d.components.removeAt(i)) },
                    onRemove = { d.components.removeAt(i) },
                    onRequired = { d.components[i] = c.copy(required = it) },
                    onValue = { d.components[i] = c.copy(value = it) },
                )
            }
            val unused = COMPONENT_TYPES.filter { t -> t != "SERIAL" && (t == "TEXT" || d.components.none { it.type == t }) }
            if (d.components.size < MAX_PARTS && unused.isNotEmpty()) {
                Text("Add a part", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    unused.forEach { t ->
                        AssistChip(
                            onClick = {
                                val part = if (t == "TEXT") SchemeComponent("TEXT", required = true, value = "") else SchemeComponent(t)
                                val serialAt = d.components.indexOfFirst { it.type == "SERIAL" }
                                if (serialAt >= 0) d.components.add(serialAt, part) else d.components.add(part)
                            },
                            label = { Text(componentLabel(t)) },
                            leadingIcon = { Icon(Icons.Default.Add, null, Modifier.size(18.dp)) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
            } else if (d.components.size >= MAX_PARTS) Hint("An ID can have at most $MAX_PARTS parts.")
            if (d.components.none { it.type == "SERIAL" }) {
                TextButton(onClick = { d.components.add(SchemeComponent("SERIAL")) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Add tree number") }
            }

            HorizontalDivider()
            ChoiceChips("Separator", SEPARATORS, d.separator, ::separatorLabel, { d.separator = it })
            Text("Tree number width", style = MaterialTheme.typography.labelLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilledTonalIconButton(onClick = { d.width = (d.width - 1).coerceAtLeast(1) }, enabled = d.width > 1, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Remove, "Fewer digits") }
                Text("${d.width} digits", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleMedium)
                FilledTonalIconButton(onClick = { d.width = (d.width + 1).coerceAtMost(12) }, enabled = d.width < 12, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Add, "More digits") }
            }
            Hint("Up to ${"9".repeat(d.width).toLongOrNull()?.let { "%,d".format(it) } ?: "many"} trees")

            HorizontalDivider()
            Text("Tree numbers restart for each…", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SCOPE_DIMENSIONS.forEach { dim ->
                    FilterChip(
                        selected = dim in d.scope,
                        onClick = { if (dim in d.scope) d.scope.remove(dim) else d.scope.add(dim) },
                        label = { Text(scopeLabel(dim)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            Hint(scopeSentence(d.scope))
            problems.forEach { Text("• $it", color = if (isWarning(it)) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Cancel") }
                Button(onClick = onSave, enabled = blocking.isEmpty() && !saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Save format") }
            }
        }
    }
}

@Composable
private fun PreviewBox(text: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
        Text(text, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
    }
}

private fun partHelp(type: String, samples: Map<String, String>) = when (type) {
    "PROJECT_CODE" -> samples["PROJECT_CODE"].orEmpty()
    "PLANTING_YEAR" -> "e.g. ${samples["PLANTING_YEAR"]}"
    "TEXT" -> ""
    "SECTOR_CODE" -> "e.g. ${samples["SECTOR_CODE"]}"
    "SUB_SECTOR_CODE" -> "e.g. ${samples["SUB_SECTOR_CODE"]}"
    "VENDOR_CODE" -> "e.g. ${samples["VENDOR_CODE"]} (the session's vendor)"
    "SERIAL" -> "Always last"
    else -> ""
}

@Composable
private fun ComponentRow(
    c: SchemeComponent,
    index: Int,
    count: Int,
    samples: Map<String, String>,
    onUp: () -> Unit,
    onDown: () -> Unit,
    onRemove: () -> Unit,
    onRequired: (Boolean) -> Unit,
    onValue: (String) -> Unit,
) {
    val serial = c.type == "SERIAL"
    val fixed = c.type in FIXED_TYPES
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)) {
            Row(Modifier.heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${index + 1}.", style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(24.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(componentLabel(c.type), style = MaterialTheme.typography.bodyLarge)
                    }
                    partHelp(c.type, samples).takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (serial) Icon(Icons.Default.Lock, "Always last", Modifier.padding(12.dp), tint = MaterialTheme.colorScheme.outline)
                else {
                    IconButton(onClick = onUp, enabled = index > 0) { Icon(Icons.Default.KeyboardArrowUp, "Move up") }
                    IconButton(onClick = onDown, enabled = index < count - 2) { Icon(Icons.Default.KeyboardArrowDown, "Move down") }
                    IconButton(onClick = onRemove) { Icon(Icons.Default.Close, "Remove") }
                }
            }
            if (c.type == "TEXT") {
                val value = c.value.orEmpty()
                OutlinedTextField(
                    value, { raw -> onValue(raw.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }.take(16)) },
                    label = { Text("Text") }, singleLine = true,
                    isError = value.isEmpty(),
                    supportingText = if (value.isEmpty()) { { Text("e.g. NG") } } else null,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().padding(end = 8.dp, bottom = 4.dp),
                )
            } else if (!serial) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = c.required, onCheckedChange = onRequired)
                    Text("Required", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun VersionRow(s: AdminSchemeDto, samples: Map<String, String>, onActions: () -> Unit) {
    ActionItem(onClick = null, onActions = onActions) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            ItemTitle("${s.scopeTitle()} · v${s.version}", s.active, tag = { if (s.active) Tag("In use") })
            Text(previewId(s.components, s.separator, s.serialWidth, samples), fontFamily = FontFamily.Monospace)
            (s.activeFrom ?: s.createdAt)?.let { ItemSubtitle("From ${shortDateTime(it)}") }
        }
    }
}
