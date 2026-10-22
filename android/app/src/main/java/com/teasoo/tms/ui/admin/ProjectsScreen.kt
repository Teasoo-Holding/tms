package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Forest
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.AdminProjectDto
import com.teasoo.tms.data.remote.ProjectRequest
import com.teasoo.tms.data.remote.toPatchBody
import com.teasoo.tms.ui.theme.StatusColors
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@HiltViewModel
class ProjectsViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi) : AdminBaseViewModel(context) {
    val projects = MutableStateFlow<List<AdminProjectDto>?>(null)

    init { refresh() }

    fun refresh() = load { projects.value = api.projects() }

    fun create(request: ProjectRequest, onCreated: (String) -> Unit) {
        var created: AdminProjectDto? = null
        save("Project created", onDone = { created?.let { onCreated(it.id) } }, reload = ::refresh) { created = api.createProject(request) }
    }

    fun setStatus(p: AdminProjectDto, status: String, onDone: () -> Unit = {}) =
        save("${p.name}: ${projectStatusLabel(status).lowercase()}", onDone, ::refresh) {
            api.updateProject(p.id, ProjectRequest(p.name, p.shortCode, p.description, p.location, p.startDate, p.endDate, status).toPatchBody())
        }

    fun delete(p: AdminProjectDto, onDone: () -> Unit) = save("${p.name} deleted", onDone, ::refresh) { api.deleteProject(p.id) }
}

@Composable
fun ProjectsScreen(onBack: () -> Unit, onOpenProject: (String) -> Unit, vm: ProjectsViewModel = hiltViewModel()) {
    val projects = collect(vm.projects)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val snackbar = remember { SnackbarHostState() }
    var creating by rememberSaveable { mutableStateOf(false) }
    val actions = rememberItemActions()
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = "Projects",
        onBack = onBack,
        snackbar = snackbar,
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
        floatingActionButton = {
            if (projects?.isNotEmpty() == true) ExtendedFloatingActionButton(
                onClick = { vm.clearFormError(); creating = true },
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("New project") },
            )
        },
    ) { padding ->
        AdminLoadState(loading, error, projects != null, onRetry = { vm.refresh() }, modifier = Modifier.padding(padding)) {
            val list = projects.orEmpty()
            if (list.isEmpty()) {
                EmptyState(Icons.Default.Forest, "No projects yet", actionLabel = "New project", onAction = { vm.clearFormError(); creating = true })
            } else {
                LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(list, key = { it.id }) { p ->
                        ProjectCard(p, onClick = { onOpenProject(p.id) }, onActions = {
                            val archived = p.status == "ARCHIVED"
                            actions.open(
                                p.name, onEdit = { onOpenProject(p.id) }, editLabel = "Open",
                                active = !archived, onSetActive = { on -> vm.setStatus(p, if (on) "ACTIVE" else "ARCHIVED") },
                                activeLabels = "Restore" to "Archive",
                                delete = PendingDelete(
                                    p.name,
                                    detail = if (p.treeCount > 0) "It has ${"%,d".format(p.treeCount)} trees, so it can’t be deleted. Archive it instead."
                                    else "Its years, areas, formats and fields are deleted too.",
                                    run = { done -> vm.delete(p, done) },
                                    deactivate = { done: () -> Unit -> vm.setStatus(p, "ARCHIVED", done); Unit }.takeIf { !archived },
                                ),
                            )
                        })
                    }
                }
            }
        }
    }

    if (creating) ProjectDialog(
        title = "New project",
        initial = null,
        saving = collect(vm.saving),
        error = collect(vm.formError),
        onSave = { req -> vm.create(req) { id -> creating = false; onOpenProject(id) } },
        onDismiss = { creating = false },
    )
    ItemActionsHost(actions, vm)
}

@Composable
private fun ProjectCard(p: AdminProjectDto, onClick: () -> Unit, onActions: () -> Unit) {
    ActionItem(onClick = onClick, onActions = onActions, tonal = true) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                ProjectStatusTag(p.status)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(p.shortCode, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
                Text("${"%,d".format(p.treeCount)} trees", style = MaterialTheme.typography.bodyMedium)
                p.location?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
            }
        }
    }
}

@Composable
fun ProjectStatusTag(status: String) {
    when (status) {
        "ACTIVE" -> Tag("Active", StatusColors.good.copy(alpha = 0.18f), MaterialTheme.colorScheme.onSurface)
        "PAUSED" -> Tag("Paused", StatusColors.warning.copy(alpha = 0.25f), MaterialTheme.colorScheme.onSurface)
        "DRAFT" -> Tag("Draft")
        else -> Tag(projectStatusLabel(status), MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Editable project fields shared by the create dialog and the Details tab. */
class ProjectFormState(initial: ProjectRequest?) {
    var name by mutableStateOf(initial?.name.orEmpty())
    var shortCode by mutableStateOf(initial?.shortCode.orEmpty())
    var description by mutableStateOf(initial?.description.orEmpty())
    var location by mutableStateOf(initial?.location.orEmpty())
    var startDate by mutableStateOf(initial?.startDate)
    var endDate by mutableStateOf(initial?.endDate)
    var status by mutableStateOf(initial?.status ?: "DRAFT")
    var uniqueness by mutableStateOf(initial?.physicalIdUniqueness ?: "PROJECT")

    val datesValid get() = startDate == null || endDate == null || endDate!! >= startDate!!
    val valid get() = name.isNotBlank() && shortCode.isNotBlank() && datesValid

    fun toRequest(includeUniqueness: Boolean) = ProjectRequest(
        name = name.trim(), shortCode = shortCode.trim(), description = description.trim().ifBlank { null },
        location = location.trim().ifBlank { null }, startDate = startDate, endDate = endDate, status = status,
        physicalIdUniqueness = if (includeUniqueness) uniqueness else null,
    )
}

@Composable
fun ProjectFields(state: ProjectFormState, creating: Boolean, originalCode: String? = null) {
    TextInput(state.name, { state.name = it }, "Project name")
    CodeInput(
        state.shortCode, { state.shortCode = it },
        supporting = if (!creating && originalCode != null && state.shortCode != originalCode) "Existing tree IDs keep the old code." else null,
    )
    TextInput(state.description, { state.description = it }, "Description (optional)", singleLine = false, minLines = 2)
    TextInput(state.location, { state.location = it }, "Location (optional)")
    IsoDateField("Start date (optional)", state.startDate, { state.startDate = it })
    IsoDateField("End date (optional)", state.endDate, { state.endDate = it })
    if (!state.datesValid) Text("End date is before start date.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    ChoiceChips("Status", PROJECT_STATUSES, state.status, ::projectStatusLabel, { state.status = it })
    if (creating) {
        ChoiceChips(
            "Tree IDs unique (can’t change later)", listOf("PROJECT", "GLOBAL"), state.uniqueness,
            { if (it == "GLOBAL") "Across all projects" else "Within this project" }, { state.uniqueness = it },
        )
    }
}

@Composable
fun ProjectDialog(title: String, initial: ProjectRequest?, saving: Boolean, error: String?, onSave: (ProjectRequest) -> Unit, onDismiss: () -> Unit) {
    val state = remember { ProjectFormState(initial) }
    FormDialog(title, "Create", state.valid, saving, error, onConfirm = { onSave(state.toRequest(includeUniqueness = true)) }, onDismiss = onDismiss) {
        ProjectFields(state, creating = true)
    }
}
