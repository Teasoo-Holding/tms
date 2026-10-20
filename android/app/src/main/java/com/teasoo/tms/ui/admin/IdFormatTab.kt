package com.teasoo.tms.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.teasoo.tms.data.remote.ProjectDetailDto
import com.teasoo.tms.data.remote.AdminSchemeDto
import com.teasoo.tms.data.remote.SchemeComponent
import com.teasoo.tms.data.remote.SchemeRequest

val COMPONENT_TYPES = listOf("PROJECT_CODE", "PLANTING_YEAR", "VENDOR_CODE", "SECTOR_CODE", "SUB_SECTOR_CODE", "SERIAL")
val SCOPE_DIMENSIONS = listOf("PROJECT", "PLANTING_YEAR", "VENDOR", "SECTOR", "SUB_SECTOR")
private val SEPARATORS = listOf("-", "_", "/", ".", "")

fun componentLabel(type: String) = when (type) {
    "PROJECT_CODE" -> "Project code"
    "PLANTING_YEAR" -> "Planting year"
    "VENDOR_CODE" -> "Vendor code"
    "SECTOR_CODE" -> "Sector code"
    "SUB_SECTOR_CODE" -> "Sub-sector code"
    "SERIAL" -> "Serial number"
    else -> type
}

fun scopeLabel(dim: String) = when (dim) {
    "PROJECT" -> "Project"
    "PLANTING_YEAR" -> "Planting year"
    "VENDOR" -> "Vendor"
    "SECTOR" -> "Sector"
    "SUB_SECTOR" -> "Sub-sector"
    else -> dim
}

private fun separatorLabel(s: String) = if (s.isEmpty()) "None" else "“$s”"

/** Example ID for a format, using this project’s real codes where they exist. */
fun previewId(components: List<SchemeComponent>, separator: String, serialWidth: Int, samples: Map<String, String>, serial: Int = 1): String {
    val parts = components.filter { it.type != "SERIAL" }.mapNotNull { samples[it.type]?.uppercase() }
    val serialText = serial.toString().padStart(serialWidth.coerceIn(1, 12), '0')
    return if (parts.isEmpty()) serialText else parts.joinToString(separator) + separator + serialText
}

private fun schemeProblems(components: List<SchemeComponent>, scope: List<String>): List<String> = buildList {
    val types = components.map { it.type }
    if (types.toSet().size != types.size) add("Each part can appear only once.")
    if ("SERIAL" !in types) add("The ID needs a serial number.") else if (types.last() != "SERIAL") add("The serial number must be the last part.")
    if (scope.toSet().size != scope.size) add("Each uniqueness dimension can be chosen once.")
    val needs = mapOf("PLANTING_YEAR" to "PLANTING_YEAR", "VENDOR" to "VENDOR_CODE", "SECTOR" to "SECTOR_CODE", "SUB_SECTOR" to "SUB_SECTOR_CODE")
    scope.forEach { d ->
        val c = needs[d]
        if (c != null && c !in types) add("Serials are unique per ${scopeLabel(d).lowercase()}, but the ID does not show it, so two trees could carry the same visible ID.")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun IdFormatTab(p: ProjectDetailDto, vm: ProjectSetupViewModel) {
    val areas = collect(vm.areas)
    val vendors = collect(vm.vendors)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val active = p.schemes.firstOrNull { it.active } ?: p.schemes.maxByOrNull { it.version }
    val samples = mapOf(
        "PROJECT_CODE" to p.shortCode,
        "PLANTING_YEAR" to (p.plantingYears.filter { it.active }.maxByOrNull { it.yearLabel }?.yearLabel ?: p.plantingYears.maxByOrNull { it.yearLabel }?.yearLabel ?: "2024"),
        "VENDOR_CODE" to (vendors.firstOrNull { it.active && !it.shortCode.isNullOrBlank() }?.shortCode ?: "V01"),
        "SECTOR_CODE" to (areas.firstOrNull { it.active }?.shortCode ?: "S1"),
        "SUB_SECTOR_CODE" to (areas.flatMap { it.subSectors }.firstOrNull { it.active }?.shortCode ?: "A1"),
    )

    var editing by rememberSaveable { mutableStateOf(false) }
    val components = remember(active?.id) {
        mutableStateListOf<SchemeComponent>().apply {
            addAll(active?.components?.takeIf { it.isNotEmpty() } ?: listOf(SchemeComponent("PROJECT_CODE"), SchemeComponent("PLANTING_YEAR"), SchemeComponent("SERIAL")))
        }
    }
    var separator by remember(active?.id) { mutableStateOf(active?.separator ?: "-") }
    var width by remember(active?.id) { mutableIntStateOf(active?.serialWidth ?: 6) }
    val scope = remember(active?.id) { mutableStateListOf<String>().apply { addAll(active?.serialUniquenessScope ?: listOf("PROJECT", "PLANTING_YEAR")) } }
    var confirming by remember { mutableStateOf(false) }
    val problems = schemeProblems(components, scope)
    val blocking = problems.filter { !it.startsWith("Serials are unique per") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("Tree ID format", supporting = "How officers’ tree labels are built. A new format applies to new registrations only; registered IDs never change.")

        if (active != null && !editing) {
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Current format · version ${active.version}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (active.active) Tag("In use")
                    }
                    PreviewBox(previewId(active.components, active.separator, active.serialWidth, samples, 1))
                    Text(active.components.joinToString(" + ") { componentLabel(it.type) + if (!it.required) " (optional)" else "" }, style = MaterialTheme.typography.bodyMedium)
                    Text("Separator ${separatorLabel(active.separator)} · serial ${active.serialWidth} digits", style = MaterialTheme.typography.bodySmall)
                    Text(scopeSentence(active.serialUniquenessScope), style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = { vm.clearFormError(); editing = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Create a new version") }
                }
            }
        }
        if (active == null && !editing) {
            EmptyState(Icons.Default.Add, "No ID format yet", "Choose the parts of a tree ID (for example project code, planting year and a serial number). Officers cannot register trees until a format exists.",
                "Design ID format", { vm.clearFormError(); editing = true })
        }

        if (editing) {
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Live preview", style = MaterialTheme.typography.labelLarge)
                    PreviewBox(previewId(components, separator, width, samples, 1))
                    Text("Another example: ${previewId(components, separator, width, samples, 123)}", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)

                    HorizontalDivider()
                    Text("Parts, in order", style = MaterialTheme.typography.titleSmall)
                    components.forEachIndexed { i, c ->
                        ComponentRow(
                            c, index = i, count = components.size,
                            onUp = { if (i > 0) components.add(i - 1, components.removeAt(i)) },
                            onDown = { if (i < components.lastIndex - 1) components.add(i + 1, components.removeAt(i)) },
                            onRemove = { components.removeAt(i) },
                            onRequired = { components[i] = c.copy(required = it) },
                        )
                    }
                    val unused = COMPONENT_TYPES.filter { t -> t != "SERIAL" && components.none { it.type == t } }
                    if (unused.isNotEmpty()) {
                        Text("Add a part", style = MaterialTheme.typography.labelLarge)

                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            unused.forEach { t ->
                                AssistChip(
                                    onClick = {
                                        val serialAt = components.indexOfFirst { it.type == "SERIAL" }
                                        if (serialAt >= 0) components.add(serialAt, SchemeComponent(t)) else components.add(SchemeComponent(t))
                                    },
                                    label = { Text(componentLabel(t)) },
                                    leadingIcon = { Icon(Icons.Default.Add, null, Modifier.size(18.dp)) },
                                    modifier = Modifier.heightIn(min = 40.dp),
                                )
                            }
                        }
                    }
                    if (components.none { it.type == "SERIAL" }) TextButton(onClick = { components.add(SchemeComponent("SERIAL")) }) { Text("Add serial number") }

                    HorizontalDivider()
                    ChoiceChips("Separator", SEPARATORS, separator, ::separatorLabel, { separator = it })
                    Text("Serial width", style = MaterialTheme.typography.labelLarge)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        FilledTonalIconButton(onClick = { width = (width - 1).coerceAtLeast(1) }, enabled = width > 1) { Icon(Icons.Default.Remove, "Fewer digits") }
                        Text("$width digits", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleMedium)
                        FilledTonalIconButton(onClick = { width = (width + 1).coerceAtMost(12) }, enabled = width < 12) { Icon(Icons.Default.Add, "More digits") }
                    }
                    Hint("Serials are padded with zeros to this width; up to ${"9".repeat(width).toLongOrNull()?.let { "%,d".format(it) } ?: "many"} trees per scope.")

                    HorizontalDivider()
                    Text("Serial numbers restart for each…", style = MaterialTheme.typography.titleSmall)

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SCOPE_DIMENSIONS.forEach { d ->
                            FilterChip(
                                selected = d in scope,
                                onClick = { if (d in scope) scope.remove(d) else scope.add(d) },
                                label = { Text(scopeLabel(d)) },
                                modifier = Modifier.heightIn(min = 40.dp),
                            )
                        }
                    }
                    Hint(scopeSentence(scope))

                    problems.forEach { Text("• $it", color = if (it in blocking) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodySmall) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { editing = false }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Cancel") }
                        Button(onClick = { vm.clearFormError(); confirming = true }, enabled = blocking.isEmpty() && !saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Save format") }
                    }
                }
            }
        }

        if (p.schemes.isNotEmpty()) {
            SectionHeader("Version history")
            p.schemes.sortedByDescending { it.version }.forEach { s -> VersionRow(s, samples) }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (confirming) {
        val next = (p.schemes.maxOfOrNull { it.version } ?: 0) + 1
        FormDialog(
            "Save ID format version $next?", "Save", true, saving, formError,
            onConfirm = {
                vm.createScheme(SchemeRequest(components.toList(), separator, width, scope.toList())) { confirming = false; editing = false }
            },
            onDismiss = { confirming = false },
        ) {
            PreviewBox(previewId(components, separator, width, samples, 1))
            Text("New registrations will use this format. Trees already registered keep their IDs, and officers’ phones receive the new format at their next sync.")
        }
    }
}

private fun scopeSentence(scope: List<String>) =
    if (scope.isEmpty()) "Serials are unique across the whole system (global)."
    else "Serials are unique within each " + scope.joinToString(" + ") { scopeLabel(it).lowercase() } + "."

@Composable
private fun PreviewBox(text: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
        Text(text, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun ComponentRow(c: SchemeComponent, index: Int, count: Int, onUp: () -> Unit, onDown: () -> Unit, onRemove: () -> Unit, onRequired: (Boolean) -> Unit) {
    val serial = c.type == "SERIAL"
    OutlinedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${index + 1}.", style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(24.dp))
            Column(Modifier.weight(1f)) {
                Text(componentLabel(c.type), style = MaterialTheme.typography.bodyLarge)
                if (serial) Text("Always last and required", style = MaterialTheme.typography.bodySmall)
                else Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = c.required, onCheckedChange = onRequired)
                    Text("Required", style = MaterialTheme.typography.bodySmall)
                }
            }
            if (serial) Icon(Icons.Default.Lock, "Fixed position", Modifier.padding(12.dp), tint = MaterialTheme.colorScheme.outline)
            else {
                IconButton(onClick = onUp, enabled = index > 0) { Icon(Icons.Default.KeyboardArrowUp, "Move up") }
                IconButton(onClick = onDown, enabled = index < count - 2) { Icon(Icons.Default.KeyboardArrowDown, "Move down") }
                IconButton(onClick = onRemove) { Icon(Icons.Default.Close, "Remove") }
            }
        }
    }
}

@Composable
private fun VersionRow(s: AdminSchemeDto, samples: Map<String, String>) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Version ${s.version}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                if (s.active) Tag("In use") else InactiveTag()
            }
            Text(previewId(s.components, s.separator, s.serialWidth, samples), fontFamily = FontFamily.Monospace)
            Text(
                listOfNotNull(
                    (s.activeFrom ?: s.createdAt)?.let { "From ${shortDateTime(it)}" },
                    scopeSentence(s.serialUniquenessScope),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
