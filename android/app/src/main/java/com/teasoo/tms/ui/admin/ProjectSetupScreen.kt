package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.ui.theme.StatusColors
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@HiltViewModel
class ProjectSetupViewModel @Inject constructor(
    @ApplicationContext context: Context,
    private val api: AdminApi,
    private val handle: SavedStateHandle,
) : AdminBaseViewModel(context) {
    val projectId: String = checkNotNull(handle["id"])
    val project = MutableStateFlow<ProjectDetailDto?>(null)
    /** Every area of the project; the screens filter them by planting year. */
    val areas = MutableStateFlow<List<AdminSectorDto>>(emptyList())
    val fields = MutableStateFlow<List<AdminCustomFieldDto>>(emptyList())
    val assignments = MutableStateFlow<List<AdminAssignmentDto>>(emptyList())
    val users = MutableStateFlow<List<AdminUserDto>>(emptyList())
    val vendors = MutableStateFlow<List<AdminVendorDto>>(emptyList())
    /** The planting year that the Areas, Vendors and ID format sections show. */
    val selectedYearId = MutableStateFlow<String?>(handle["year"])

    init { refresh() }

    fun refresh() = load {
        coroutineScope {
            val a = async { api.areas(projectId) }
            val f = async { api.customFields(projectId) }
            val s = async { api.assignments(projectId = projectId) }
            val u = async { runCatching { api.users() }.getOrDefault(users.value) }
            val v = async { runCatching { api.vendors() }.getOrDefault(vendors.value) }
            val p = api.project(projectId)
            project.value = p
            if (p.plantingYears.none { it.id == selectedYearId.value }) selectYear(p.defaultYear()?.id)
            areas.value = a.await()
            fields.value = f.await()
            assignments.value = s.await()
            users.value = u.await()
            vendors.value = v.await()
        }
    }

    fun selectYear(id: String?) {
        selectedYearId.value = id
        handle["year"] = id
    }

    fun saveDetails(request: ProjectRequest, onDone: () -> Unit = {}) =
        save("Project details saved", onDone, ::refresh) { api.updateProject(projectId, request.copy(physicalIdUniqueness = null).toPatchBody()) }

    fun setStatus(status: String) {
        val p = project.value ?: return
        val request = ProjectRequest(p.name, p.shortCode, p.description, p.location, p.startDate, p.endDate, status)
        save(if (status == "ACTIVE") "Project is now active" else "Status changed", reload = ::refresh) { api.updateProject(projectId, request.toPatchBody()) }
    }

    /** Adds a year and selects it, so the admin can go straight on to its areas. */
    fun addYear(request: PlantingYearRequest, onDone: () -> Unit) =
        save("Planting year ${request.yearLabel} added", onDone, ::refresh) { selectYear(api.createPlantingYear(projectId, request).id) }

    fun updateYear(year: AdminPlantingYearDto, patch: PlantingYearPatch, onDone: () -> Unit = {}) =
        save(if (patch.active != year.active) (if (patch.active) "${year.yearLabel} reopened" else "${year.yearLabel} closed") else "${year.yearLabel} saved", onDone, ::refresh) {
            api.updatePlantingYear(year.id, patch.toPatchBody())
        }

    fun createScheme(request: SchemeRequest, onDone: () -> Unit) =
        save("New ID format saved", onDone, ::refresh) { api.createScheme(projectId, request) }

    fun retireScheme(scheme: AdminSchemeDto, onDone: () -> Unit) =
        save("Format for ${scheme.scopeTitle()} retired", onDone, ::refresh) { api.retireScheme(scheme.id) }

    /** A new sector belongs to [plantingYearId]; an existing one keeps its year. */
    fun saveSector(id: String?, plantingYearId: String?, request: AreaRequest, onDone: () -> Unit) =
        save(if (id == null) "Sector added" else "Sector saved", onDone, ::refresh) {
            if (id == null) api.createSector(projectId, request.copy(plantingYearId = checkNotNull(plantingYearId) { "Choose a planting year first." }))
            else api.updateSector(id, request.toAreaPatch())
        }

    fun saveSubSector(sectorId: String, id: String?, request: AreaRequest, onDone: () -> Unit) =
        save(if (id == null) "Sub-sector added" else "Sub-sector saved", onDone, ::refresh) {
            if (id == null) api.createSubSector(sectorId, request.copy(plantingYearId = null)) else api.updateSubSector(id, request.toAreaPatch())
        }

    fun linkVendor(year: AdminPlantingYearDto, vendorId: String, vendorName: String, onDone: () -> Unit) =
        save("$vendorName added to ${year.yearLabel}", onDone, ::refresh) { api.linkVendor(year.id, LinkVendorRequest(vendorId)) }

    /** Quick create: a new vendor, linked to the year straight away. */
    fun createAndLinkVendor(year: AdminPlantingYearDto, request: VendorRequest, onDone: () -> Unit) =
        save("${request.name} created and added to ${year.yearLabel}", onDone, ::refresh) {
            val vendor = api.createVendor(request)
            api.linkVendor(year.id, LinkVendorRequest(vendor.id))
        }

    fun unlinkVendor(link: AdminYearVendorDto, onDone: () -> Unit) =
        save("${link.vendorName ?: "Vendor"} removed from this year", onDone, ::refresh) { api.unlinkVendor(link.id) }

    fun createField(request: CustomFieldRequest, onDone: () -> Unit) =
        save("Field “${request.label}” added", onDone, ::refresh) { api.createCustomField(projectId, request) }

    fun updateField(id: String, patch: CustomFieldPatch, onDone: () -> Unit = {}) =
        save("Field saved", onDone, ::refresh) { api.updateCustomField(id, patch.toPatchBody()) }

    fun assign(request: AssignmentRequest, onDone: () -> Unit) =
        save("Assigned to the project", onDone, ::refresh) { api.createAssignment(request) }

    fun revoke(assignment: AdminAssignmentDto, onDone: () -> Unit) =
        save("Assignment removed", onDone, ::refresh) { api.revokeAssignment(assignment.id) }

    fun updateVendor(v: AdminVendorDto, request: VendorRequest, onDone: () -> Unit = {}) =
        save("${request.name} saved", onDone, ::refresh) { api.updateVendor(v.id, request.toPatchBody()) }

    fun setSectorActive(s: AdminSectorDto, active: Boolean, onDone: () -> Unit = {}) =
        save(if (active) "${s.name} activated" else "${s.name} deactivated", onDone, ::refresh) { api.updateSector(s.id, s.toRequest().copy(active = active).toAreaPatch()) }

    fun setSubSectorActive(s: AdminSubSectorDto, active: Boolean, onDone: () -> Unit = {}) =
        save(if (active) "${s.name} activated" else "${s.name} deactivated", onDone, ::refresh) { api.updateSubSector(s.id, s.toRequest().copy(active = active).toAreaPatch()) }

    // ---------------------------------------------------------------- deletes (409 explains why, e.g. trees exist)

    fun deleteYear(y: AdminPlantingYearDto, onDone: () -> Unit) =
        save("${y.yearLabel} deleted", onDone, ::refresh) { api.deletePlantingYear(y.id) }

    fun deleteSector(s: AdminSectorDto, onDone: () -> Unit) = save("${s.name} deleted", onDone, ::refresh) { api.deleteSector(s.id) }

    fun deleteSubSector(s: AdminSubSectorDto, onDone: () -> Unit) = save("${s.name} deleted", onDone, ::refresh) { api.deleteSubSector(s.id) }

    fun deleteScheme(s: AdminSchemeDto, onDone: () -> Unit) = save("Format version ${s.version} deleted", onDone, ::refresh) { api.deleteScheme(s.id) }

    fun deleteField(f: AdminCustomFieldDto, onDone: () -> Unit) = save("“${f.label}” deleted", onDone, ::refresh) { api.deleteCustomField(f.id) }

    fun deleteYearVendor(link: AdminYearVendorDto, onDone: () -> Unit) =
        save("${link.vendorName ?: "Vendor"} deleted from this year", onDone, ::refresh) { api.deleteYearVendor(link.id) }
}

internal fun AdminSectorDto.toRequest() = AreaRequest(name, shortCode, description, referenceLatitude, referenceLongitude, active)
internal fun AdminSubSectorDto.toRequest() = AreaRequest(name, shortCode, description, referenceLatitude, referenceLongitude, active)

enum class SetupTab(val title: String, val perYear: Boolean = false) {
    DETAILS("Details"),
    YEARS("Planting years"),
    AREAS("Areas", perYear = true),
    VENDORS("Vendors", perYear = true),
    ID_FORMAT("ID format", perYear = true),
    OFFICERS("Officers"),
    FIELDS("Custom fields"),
}

@Composable
fun ProjectSetupScreen(onBack: () -> Unit, onShare: () -> Unit = {}, vm: ProjectSetupViewModel = hiltViewModel()) {
    val project = collect(vm.project)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val selectedYearId = collect(vm.selectedYearId)
    val snackbar = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableStateOf(SetupTab.DETAILS) }
    var addingYear by rememberSaveable { mutableStateOf(false) }
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = project?.name ?: "Project",
        subtitle = project?.let { "${it.shortCode} · ${projectStatusLabel(it.status)}" },
        onBack = onBack,
        snackbar = snackbar,
        actions = {
            IconButton(onClick = onShare) { Icon(Icons.Default.Share, "Share with client") }
            IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ScrollableTabRow(selectedTabIndex = tab.ordinal, edgePadding = 8.dp) {
                SetupTab.entries.forEach { t ->
                    Tab(selected = tab == t, onClick = { tab = t }, text = { Text(t.title) }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
            AdminLoadState(loading, error, project != null, onRetry = { vm.refresh() }) {
                val p = project ?: return@AdminLoadState
                val year = p.plantingYears.firstOrNull { it.id == selectedYearId }
                Column(Modifier.fillMaxSize()) {
                    if (tab.perYear) {
                        YearChips(p.yearsNewestFirst(), year?.id, onSelect = vm::selectYear, onAdd = { vm.clearFormError(); addingYear = true })
                        HorizontalDivider()
                    }
                    Box(Modifier.weight(1f)) {
                        val addYear = { vm.clearFormError(); addingYear = true }
                        when (tab) {
                            SetupTab.DETAILS -> DetailsTab(p, year, vm, onJump = { tab = it }, onAddYear = addYear)
                            SetupTab.YEARS -> PlantingYearsTab(p, vm, onAddYear = addYear)
                            SetupTab.AREAS -> AreasTab(year, vm, onAddYear = addYear)
                            SetupTab.VENDORS -> VendorsTab(p, year, vm, onAddYear = addYear)
                            SetupTab.ID_FORMAT -> IdFormatTab(p, year, vm)
                            SetupTab.FIELDS -> CustomFieldsTab(vm)
                            SetupTab.OFFICERS -> OfficersTab(vm)
                        }
                    }
                }
            }
        }
    }
    if (addingYear) AddYearDialog(vm, onDismiss = { addingYear = false })
}

/** Shown by the per-year sections while the project has no planting year. */
@Composable
internal fun NoYearState(onAddYear: () -> Unit) {
    EmptyState(Icons.Default.CalendarMonth, "No planting year yet", actionLabel = "Add planting year", onAction = onAddYear)
}

// ---------------------------------------------------------------- details

private data class CheckItem(val label: String, val detail: String, val done: Boolean, val optional: Boolean, val tab: SetupTab)

@Composable
private fun DetailsTab(p: ProjectDetailDto, year: AdminPlantingYearDto?, vm: ProjectSetupViewModel, onJump: (SetupTab) -> Unit, onAddYear: () -> Unit) {
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val initial = ProjectRequest(p.name, p.shortCode, p.description, p.location, p.startDate, p.endDate, p.status, p.physicalIdUniqueness)
    val state = remember(p) { ProjectFormState(initial) }
    val changed = state.toRequest(true) != initial.copy(
        description = initial.description?.ifBlank { null }, location = initial.location?.ifBlank { null },
    )
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ProjectFields(state, creating = false, originalCode = p.shortCode)
        BoldValue("Tree IDs unique", if (p.physicalIdUniqueness == "GLOBAL") "Across all projects" else "Within this project")
        formError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = { vm.saveDetails(state.toRequest(false)) }, enabled = changed && state.valid && !saving,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(if (saving) "Saving…" else "Save details") }
        Spacer(Modifier.height(24.dp))
    }
}

// ---------------------------------------------------------------- planting years

@Composable
private fun PlantingYearsTab(p: ProjectDetailDto, vm: ProjectSetupViewModel, onAddYear: () -> Unit) {
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var editing by remember { mutableStateOf<AdminPlantingYearDto?>(null) }
    val actions = rememberItemActions()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (p.plantingYears.isEmpty()) {
            EmptyState(Icons.Default.CalendarMonth, "No planting years", actionLabel = "Add planting year", onAction = onAddYear)
        } else {
            FilledTonalButton(onClick = onAddYear, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add planting year")
            }
        }
        p.yearsNewestFirst().forEach { y ->
            val vendors = p.linkedVendors(y.id).size
            val edit = { vm.clearFormError(); editing = y }
            ActionItem(
                onClick = edit, onEdit = edit, editLabel = "Edit ${y.yearLabel}",
                onActions = {
                    actions.open(
                        y.yearLabel, onEdit = edit, editLabel = "Edit dates", active = y.active,
                        onSetActive = { open -> vm.updateYear(y, PlantingYearPatch(y.startDate, y.endDate, open)) },
                        activeLabels = "Reopen" to "Close",
                        delete = PendingDelete(
                            y.yearLabel, detail = "Its areas, vendor links and formats are deleted too.",
                            run = { done -> vm.deleteYear(y, done) },
                            deactivate = { done: () -> Unit -> vm.updateYear(y, PlantingYearPatch(y.startDate, y.endDate, false), done); Unit }.takeIf { y.active },
                        ),
                    )
                },
            ) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    ItemTitle(y.yearLabel, tag = { if (!y.active) Tag("Closed", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant) })
                    ItemSubtitle(
                        listOfNotNull(
                            "${formatIsoDate(y.startDate)} – ${formatIsoDate(y.endDate)}".takeIf { y.startDate != null || y.endDate != null },
                            "$vendors vendor${if (vendors == 1) "" else "s"}",
                        ).joinToString(" · "),
                    )
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    ItemActionsHost(actions, vm)

    editing?.let { y ->
        var start by remember(y) { mutableStateOf(y.startDate) }
        var end by remember(y) { mutableStateOf(y.endDate) }
        FormDialog(
            "Planting year ${y.yearLabel}", "Save", start == null || end == null || end!! >= start!!, saving, formError,
            onConfirm = { vm.updateYear(y, PlantingYearPatch(start, end, y.active)) { editing = null } },
            onDismiss = { editing = null },
        ) {
            IsoDateField("Start date", start, { start = it })
            IsoDateField("End date", end, { end = it })
        }
    }
}

/** Adds a planting year; the new year becomes the selected one. */
@Composable
internal fun AddYearDialog(vm: ProjectSetupViewModel, onDismiss: () -> Unit) {
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var label by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableStateOf<String?>(null) }
    var end by rememberSaveable { mutableStateOf<String?>(null) }
    var open by rememberSaveable { mutableStateOf(true) }
    FormDialog(
        "Add planting year", "Add", label.isNotBlank() && (start == null || end == null || end!! >= start!!), saving, formError,
        onConfirm = { vm.addYear(PlantingYearRequest(label.trim(), start, end, open), onDismiss) },
        onDismiss = onDismiss,
    ) {
        CodeInput(label, { label = it }, label = "Year", supporting = "e.g. 2025. Can’t change later.")
        IsoDateField("Start date (optional)", start, { start = it })
        IsoDateField("End date (optional)", end, { end = it })
        SwitchRow("Open for registration", open, { open = it })
    }
}

@Composable
internal fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Normal)
}
