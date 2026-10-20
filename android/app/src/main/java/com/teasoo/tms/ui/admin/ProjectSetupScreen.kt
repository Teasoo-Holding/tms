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
import androidx.compose.material.icons.outlined.Info
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
}

enum class SetupTab(val title: String, val perYear: Boolean = false) {
    DETAILS("Checklist", perYear = true),
    YEARS("Planting years"),
    AREAS("Areas", perYear = true),
    VENDORS("Vendors", perYear = true),
    ID_FORMAT("ID format", perYear = true),
    OFFICERS("Officers"),
    FIELDS("Custom fields"),
}

@Composable
fun ProjectSetupScreen(onBack: () -> Unit, vm: ProjectSetupViewModel = hiltViewModel()) {
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
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
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
    EmptyState(
        Icons.Default.CalendarMonth, "Add a planting year first",
        "Each planting year has its own surveyed area, vendors and ID format. Add the year (for example 2025) to start.",
        "Add planting year", onAddYear,
    )
}

// ---------------------------------------------------------------- checklist + details

private data class CheckItem(val label: String, val detail: String, val done: Boolean, val optional: Boolean, val tab: SetupTab)

@Composable
private fun SetupChecklist(p: ProjectDetailDto, year: AdminPlantingYearDto?, vm: ProjectSetupViewModel, onJump: (SetupTab) -> Unit) {
    val areas = collect(vm.areas)
    val fields = collect(vm.fields)
    val assignments = collect(vm.assignments)
    val saving = collect(vm.saving)

    val yearSectors = areas.filter { it.active && year != null && it.plantingYearId == year.id }
    val olderSectors = areas.filter { it.active && it.plantingYearId == null }
    val subSectors = yearSectors.sumOf { s -> s.subSectors.count { it.active } }
    val olderSubSectors = olderSectors.sumOf { s -> s.subSectors.count { it.active } }
    val vendors = p.linkedVendors(year?.id)
    val yearFormat = year?.let { p.schemes.activeIn(null, it.id) }
    val defaultFormat = p.schemes.activeIn(null, null)
    val vendorFormats = vendors.count { v -> p.schemes.any { it.active && it.vendorId == v.vendorId && (it.plantingYearId == null || it.plantingYearId == year?.id) } }
    val officers = assignments.filter { it.active && it.userRole != "EXECUTIVE" }.map { it.userId }.distinct().size
    val y = year?.yearLabel ?: "this year"

    val items = listOf(
        CheckItem(
            "Planting year",
            when {
                year == null -> "Add the year trees are planted in, e.g. 2025"
                year.active -> "${year.yearLabel} is open for registration"
                else -> "${year.yearLabel} is closed – reopen it to register trees"
            },
            year?.active == true, false, SetupTab.YEARS,
        ),
        CheckItem(
            "Areas surveyed",
            when {
                subSectors > 0 -> "${yearSectors.size} sectors · $subSectors sub-sectors mapped for $y"
                olderSubSectors > 0 -> "Using ${olderSectors.size} older sectors not tied to a year. Map $y's survey under Areas."
                else -> "Map $y's planting area: sectors, then sub-sectors"
            },
            subSectors > 0 || olderSubSectors > 0, false, SetupTab.AREAS,
        ),
        CheckItem(
            "Vendors linked",
            if (vendors.isEmpty()) "Add the vendors planting in $y" else vendors.joinToString(", ") { it.vendorName ?: "Vendor" },
            vendors.isNotEmpty(), false, SetupTab.VENDORS,
        ),
        CheckItem(
            "ID format",
            when {
                yearFormat != null -> "$y has its own format" + if (vendorFormats > 0) " · $vendorFormats vendor formats" else ""
                defaultFormat != null -> "Uses the project default" + if (vendorFormats > 0) " · $vendorFormats vendor formats" else ""
                else -> "Define how tree IDs are built"
            },
            yearFormat != null || defaultFormat != null, false, SetupTab.ID_FORMAT,
        ),
        CheckItem("Officers assigned", if (officers == 0) "Assign field officers to the project or its areas" else "$officers assigned", officers > 0, false, SetupTab.OFFICERS),
        CheckItem("Custom fields", if (fields.isEmpty()) "Extra questions such as nursery batch" else "${fields.count { it.active }} active", fields.isNotEmpty(), true, SetupTab.FIELDS),
        CheckItem("Project ACTIVE", if (p.status == "ACTIVE") "Officers can record data" else "Currently ${projectStatusLabel(p.status)}", p.status == "ACTIVE", false, SetupTab.DETAILS),
    )
    val requiredDone = items.filter { !it.optional && it.tab != SetupTab.DETAILS }.all { it.done }
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 12.dp)) {
            Text("Setup checklist for ${year?.yearLabel ?: "the first year"}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp))
            Text(
                "${items.count { it.done && !it.optional }} of ${items.count { !it.optional }} steps done. Tap a step to open it.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            )
            items.forEachIndexed { i, item ->
                ListItem(
                    headlineContent = { Text("${i + 1}. ${item.label}" + if (item.optional) " (optional)" else "") },
                    supportingContent = { Text(item.detail) },
                    leadingContent = {
                        if (item.done) Icon(Icons.Default.CheckCircle, "Done", tint = StatusColors.good)
                        else Icon(Icons.Default.RadioButtonUnchecked, if (item.optional) "Optional" else "To do", tint = MaterialTheme.colorScheme.outline)
                    },
                    colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                    modifier = Modifier.clickable { onJump(item.tab) }.heightIn(min = 56.dp),
                )
            }
            if (p.status != "ACTIVE") {
                Button(
                    onClick = { vm.setStatus("ACTIVE") }, enabled = requiredDone && !saving,
                    modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().heightIn(min = 48.dp),
                ) { Text("Activate project") }
                if (!requiredDone) Text(
                    "Finish steps 1 to 5 to activate.", style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
        }
    }
}

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
        SetupChecklist(p, year, vm) { t -> if (t == SetupTab.YEARS && year == null) onAddYear() else onJump(t) }
        SectionHeader("Project details")
        ProjectFields(state, creating = false, originalCode = p.shortCode)
        BoldValue("Tree ID uniqueness", if (p.physicalIdUniqueness == "GLOBAL") "Across all projects" else "Within this project")
        Text("Fixed when the project was created.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(
            "Planting years",
            supporting = "Each year has its own surveyed area, vendors and ID format. Close a year when planting ends; reopen it to allow back-entry of late records.",
            action = { if (p.plantingYears.isNotEmpty()) TextButton(onClick = onAddYear, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Default.Add, null); Text("Add") } },
        )
        if (p.plantingYears.isEmpty()) {
            EmptyState(Icons.Default.CalendarMonth, "No planting years", "Add the year (or season) trees are planted in, for example 2025. Its label can be part of tree IDs.",
                "Add planting year", onAddYear)
        }
        p.yearsNewestFirst().forEach { y ->
            val vendors = p.linkedVendors(y.id).size
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(y.yearLabel, style = MaterialTheme.typography.titleMedium)
                            Text(
                                (if (y.startDate == null && y.endDate == null) "No dates set" else "${formatIsoDate(y.startDate)} – ${formatIsoDate(y.endDate)}") +
                                    " · $vendors vendor${if (vendors == 1) "" else "s"}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        TextButton(onClick = { vm.clearFormError(); editing = y }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Edit dates") }
                    }
                    SwitchRow(
                        if (y.active) "Open for registration" else "Closed",
                        y.active,
                        { open -> vm.updateYear(y, PlantingYearPatch(y.startDate, y.endDate, open)) },
                        supporting = if (y.active) "Officers can register and back-enter trees" else "Reopen to allow back-entry",
                        enabled = !saving,
                    )
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    editing?.let { y ->
        var start by remember(y) { mutableStateOf(y.startDate) }
        var end by remember(y) { mutableStateOf(y.endDate) }
        FormDialog(
            "Planting year ${y.yearLabel}", "Save", start == null || end == null || end!! >= start!!, saving, formError,
            onConfirm = { vm.updateYear(y, PlantingYearPatch(start, end, y.active)) { editing = null } },
            onDismiss = { editing = null },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Info, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("The label is part of registered tree IDs and cannot change.", style = MaterialTheme.typography.bodySmall)
            }
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
        CodeInput(label, { label = it }, label = "Year label", supporting = "e.g. 2025 or 2025A. Can be part of tree IDs; cannot be changed later.")
        IsoDateField("Start date (optional)", start, { start = it })
        IsoDateField("End date (optional)", end, { end = it })
        SwitchRow("Open for registration", open, { open = it })
        Hint("Next: map this year's survey under Areas, then add its vendors.")
    }
}

@Composable
internal fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Normal)
}
