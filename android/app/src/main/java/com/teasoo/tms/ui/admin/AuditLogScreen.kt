package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.ui.components.Picker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import javax.inject.Inject

private const val PAGE = 50

@HiltViewModel
class AuditLogViewModel @Inject constructor(
    @ApplicationContext context: Context,
    private val api: AdminApi,
    handle: SavedStateHandle,
) : AdminBaseViewModel(context) {
    val actorId = MutableStateFlow(handle.get<String>("actor")?.takeIf { it.isNotBlank() })
    val actionPrefix = MutableStateFlow<String?>(null)
    val projectId = MutableStateFlow(handle.get<String>("project")?.takeIf { it.isNotBlank() })
    val entries = MutableStateFlow<List<AuditEntryDto>?>(null)
    val hasMore = MutableStateFlow(false)
    val loadingMore = MutableStateFlow(false)
    val moreError = MutableStateFlow<String?>(null)
    val users = MutableStateFlow<List<AdminUserDto>>(emptyList())
    val projects = MutableStateFlow<List<AdminProjectDto>>(emptyList())

    init {
        viewModelScope.launch { runCatching { api.users() }.onSuccess { users.value = it } }
        viewModelScope.launch { runCatching { api.projects() }.onSuccess { projects.value = it } }
        refresh()
    }

    fun setActor(id: String?) { actorId.value = id; refresh() }
    fun setAction(prefix: String?) { actionPrefix.value = prefix; refresh() }
    fun setProject(id: String?) { projectId.value = id; refresh() }

    private suspend fun page(before: Long?) =
        api.auditLogs(actorId = actorId.value, actionPrefix = actionPrefix.value, projectId = projectId.value, beforeId = before, limit = PAGE)

    fun refresh() = load {
        entries.value = null
        val list = page(null)
        entries.value = list
        hasMore.value = list.size >= PAGE
    }

    fun loadOlder() {
        val current = entries.value ?: return
        if (loadingMore.value) return
        viewModelScope.launch {
            loadingMore.value = true
            moreError.value = null
            try {
                val list = page(current.lastOrNull()?.id)
                entries.value = current + list.filter { n -> current.none { it.id == n.id } }
                hasMore.value = list.size >= PAGE
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                moreError.value = adminErrorMessage(e)
            } finally {
                loadingMore.value = false
            }
        }
    }
}

/** Friendly activity filters; each maps to an action prefix the server matches with LIKE 'prefix%'. */
val ACTIVITY_TYPES: List<Pair<String?, String>> = listOf(
    null to "All activity",
    "tree.create" to "Tree registrations",
    "tree.update" to "Tree edits",
    "tree.id_correction" to "Tree ID corrections",
    "tree.replacement" to "Replacements",
    "observation.create" to "Observations",
    "observation.amend" to "Observation amendments",
    "conflict." to "Conflict resolutions",
    "project." to "Project changes",
    "planting_year." to "Planting years",
    "tree_id_scheme." to "ID formats",
    "sector." to "Sectors",
    "sub_sector." to "Sub-sectors",
    "custom_field." to "Custom fields",
    "user." to "User accounts",
    "assignment." to "Assignments",
    "serial_allocation." to "Serial allocations",
    "device." to "Devices",
    "species." to "Species",
    "status." to "Statuses",
    "vendor." to "Vendors",
)

@Composable
fun AuditLogScreen(onBack: () -> Unit, onOpenTree: (String) -> Unit, vm: AuditLogViewModel = hiltViewModel()) {
    val entries = collect(vm.entries)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val hasMore = collect(vm.hasMore)
    val loadingMore = collect(vm.loadingMore)
    val moreError = collect(vm.moreError)
    val users = collect(vm.users)
    val projects = collect(vm.projects)
    val actorId = collect(vm.actorId)
    val action = collect(vm.actionPrefix)
    val projectId = collect(vm.projectId)
    val actorName = users.find { it.id == actorId }?.fullName

    AdminScaffold(
        title = "Activity log",
        subtitle = actorName?.let { "By $it" } ?: "Everyone",
        onBack = onBack,
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Filters(users, projects, actorId, action, projectId, vm)
            AdminLoadState(loading, error, entries != null, onRetry = { vm.refresh() }) {
                val list = entries.orEmpty()
                if (list.isEmpty()) {
                    EmptyState(
                        Icons.Default.History, "No activity found",
                        if (actorId != null || action != null || projectId != null) "Nothing matches these filters. Try widening them." else "Changes and field records appear here as they reach the server.",
                        if (actorId != null || action != null || projectId != null) "Clear filters" else null,
                        { vm.actorId.value = null; vm.actionPrefix.value = null; vm.setProject(null) },
                    )
                } else LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(list, key = { it.id }) { e -> AuditCard(e, onOpenTree) }
                    item {
                        when {
                            loadingMore -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                            hasMore -> OutlinedButton(onClick = { vm.loadOlder() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Load older") }
                            else -> Hint("Start of the log for these filters.")
                        }
                        moreError?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Filters(users: List<AdminUserDto>, projects: List<AdminProjectDto>, actorId: String?, action: String?, projectId: String?, vm: AuditLogViewModel) {
    var expanded by rememberSaveable { mutableStateOf(actorId == null) }
    Surface(tonalElevation = 1.dp) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val people = listOf<Pair<String?, String>>(null to "Everyone") + users.sortedBy { it.fullName }.map { it.id to it.fullName }
            Picker("Person", people, people.find { it.first == actorId } ?: (actorId to "Selected person"), { it.second }, { vm.setActor(it.first) })
            if (expanded) {
                Picker("Activity", ACTIVITY_TYPES, ACTIVITY_TYPES.find { it.first == action }, { it.second }, { vm.setAction(it.first) })
                val projectOptions = listOf<Pair<String?, String>>(null to "All projects") + projects.map { it.id to it.name }
                Picker("Project", projectOptions, projectOptions.find { it.first == projectId }, { it.second }, { vm.setProject(it.first) })
            } else {
                TextButton(onClick = { expanded = true }) { Text("More filters") }
            }
        }
    }
}

// ---------------------------------------------------------------- sentences

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonObject?.str(key: String): String? = (this?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

/** "registered tree T4L-2024-000123", without the actor or time. */
fun auditPhrase(e: AuditEntryDto): String {
    val after = e.after.obj()
    val before = e.before.obj()
    val label = e.entityLabel ?: after.str("name") ?: before.str("name")
    val l = label?.let { " $it" }.orEmpty()
    return when (e.action) {
        "tree.create" -> "registered tree$l"
        "tree.update" -> "edited tree$l"
        "tree.id_correction" -> "corrected the ID of tree$l"
        "tree.replacement" -> "registered replacement tree$l"
        "observation.create" -> "recorded an observation on tree$l"
        "observation.amend" -> "amended an observation on tree$l"
        "project.create" -> "created project$l"
        "project.update" -> "updated project$l"
        "planting_year.create" -> "added planting year$l"
        "planting_year.update" -> when {
            before?.get("active") != after?.get("active") && after.str("active") == "false" -> "closed planting year$l"
            before?.get("active") != after?.get("active") && after.str("active") == "true" -> "reopened planting year$l"
            else -> "updated planting year$l"
        }
        "tree_id_scheme.create" -> "set a new tree ID format" + (after.str("version")?.let { " (version $it)" } ?: "")
        "sector.create" -> "added sector$l"
        "sector.update" -> "updated sector$l"
        "sub_sector.create" -> "added sub-sector$l"
        "sub_sector.update" -> "updated sub-sector$l"
        "areas.import" -> "imported areas" + (e.metadata.obj().str("created")?.let { " ($it created)" } ?: "")
        "custom_field.create" -> "added custom field$l"
        "custom_field.update" -> "updated custom field$l"
        "user.create" -> "created the account for$l"
        "user.update" -> when {
            e.metadata.obj().str("password_changed") == "true" -> "reset the password of$l"
            before.str("active") == "true" && after.str("active") == "false" -> "deactivated$l"
            before.str("active") == "false" && after.str("active") == "true" -> "reactivated$l"
            else -> "updated the account of$l"
        }
        "assignment.create" -> "assigned someone to a project"
        "assignment.revoke" -> "removed an assignment"
        "serial_allocation.create" -> "allocated serials ${after.str("range_start") ?: ""}–${after.str("range_end") ?: ""}".trimEnd('–', ' ')
        "serial_allocation.revoke" -> "revoked a serial allocation"
        "device.revoke" -> "revoked a device" + (after.str("device_name")?.let { " ($it)" } ?: "")
        "species.create" -> "added species$l"
        "species.update" -> "updated species$l"
        "status.create" -> "added status$l"
        "status.update" -> "updated status$l"
        "vendor.create" -> "added vendor$l"
        "vendor.update" -> "updated vendor$l"
        else -> when {
            e.action.startsWith("conflict.") -> "resolved a sync conflict" + (label?.let { " on $it" } ?: "")
            else -> {
                val verb = e.action.substringAfter('.').replace('_', ' ')
                val noun = (e.entityType ?: e.action.substringBefore('.')).replace('_', ' ')
                "$verb $noun$l"
            }
        }
    }
}

private val SKIPPED_KEYS = setOf("id", "created_at", "updated_at", "synced_at", "revision", "password_hash", "seq", "created_by")

private fun JsonElement?.display(): String = when (this) {
    null, JsonNull -> "—"
    is JsonPrimitive -> contentOrNull?.let { if (it.length > 80) it.take(77) + "…" else it } ?: "—"
    is JsonArray -> if (isEmpty()) "none" else joinToString(", ") { it.display() }.let { if (it.length > 80) it.take(77) + "…" else it }
    is JsonObject -> if (this["type"] != null && this["coordinates"] != null) "map shape" else toString().let { if (it.length > 80) it.take(77) + "…" else it }
}

/** Changed fields (label, before, after), skipping identifiers, timestamps and unchanged values. */
fun auditChanges(e: AuditEntryDto): List<Triple<String, String?, String>> {
    val before = e.before.obj()
    val after = e.after.obj()
    val keys = ((before?.keys ?: emptySet()) + (after?.keys ?: emptySet()))
        .filter { it !in SKIPPED_KEYS && !it.endsWith("_id") && !it.endsWith("_at") }
    return keys.mapNotNull { k ->
        val b = before?.get(k)
        val a = after?.get(k)
        when {
            before == null -> if (a == null || a is JsonNull) null else Triple(k, null, a.display())
            b == a -> null
            else -> Triple(k, b.display(), a.display())
        }
    }
}

private fun keyLabel(k: String) = k.replace('_', ' ').replaceFirstChar { it.uppercase() }

@Composable
private fun AuditCard(e: AuditEntryDto, onOpenTree: (String) -> Unit) {
    var expanded by rememberSaveable(e.id) { mutableStateOf(false) }
    val changes = remember(e.id) { auditChanges(e) }
    val metadata = e.metadata.obj()
    val deviceId = metadata.str("device_id")
    val extraMeta = metadata?.filterKeys { it != "device_id" && it != "password_changed" }?.filterValues { it !is JsonNull }.orEmpty()
    val expandable = changes.isNotEmpty() || deviceId != null || extraMeta.isNotEmpty()
    OutlinedCard(
        onClick = { if (e.treeId != null) onOpenTree(e.treeId) else if (expandable) expanded = !expanded },
        modifier = Modifier.fillMaxWidth().animateContentSize(),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(e.actorName ?: "System") }
                        append(" ")
                        append(auditPhrase(e))
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    listOfNotNull(shortDateTime(e.createdAt), e.projectName?.takeIf { e.entityType != "project" }, roleLabel(e.actorRole).takeIf { e.actorRole != null })
                        .joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (e.treeId != null) Text("Tap to open the tree", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                if (expanded) {
                    HorizontalDivider(Modifier.padding(vertical = 6.dp))
                    changes.forEach { (k, b, a) ->
                        Text(
                            buildAnnotatedString {
                                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(keyLabel(k)) }
                                append(": ")
                                if (b != null) { append(b); append(" → ") }
                                append(a)
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    extraMeta.forEach { (k, v) -> Text("${keyLabel(k)}: ${v.display()}", style = MaterialTheme.typography.bodySmall) }
                    deviceId?.let { Text("Device $it", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace) }
                }
            }
            if (expandable) IconButton(onClick = { expanded = !expanded }) {
                Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, if (expanded) "Hide details" else "Show changes")
            }
        }
    }
}
