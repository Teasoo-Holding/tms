package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.repo.FieldSession
import com.teasoo.tms.data.repo.FieldSessionRepository
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.Picker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The session's ids resolved to the names and codes shown on screen. */
data class SessionContext(
    val session: FieldSession,
    val project: ProjectEntity?,
    val year: PlantingYearEntity?,
    val sector: SectorEntity?,
    val subSector: SubSectorEntity?,
    val vendor: VendorEntity?,
    /** Sub-sectors of the session's sector the officer may work in. */
    val subSectors: List<SubSectorEntity>,
) {
    /** True when an administrator has since removed or deactivated part of this context. */
    val stale get() = project == null || year == null || sector == null || subSector == null || sector.active.not() || subSector.active.not()
    val title get() = listOfNotNull(project?.shortCode, year?.yearLabel, vendor?.shortCode, sector?.let { "${it.shortCode} ${it.name}" }).joinToString(" · ")
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class FieldSessionViewModel @Inject constructor(
    private val db: TmsDatabase,
    private val sessions: FieldSessionRepository,
    private val auth: SessionStore,
) : ViewModel() {
    private val ref = db.reference()

    private val isAdmin = auth.state.map { (it as? SessionState.Active)?.user?.role == "ADMIN" }

    val context: StateFlow<SessionContext?> = combine(sessions.session, ref.assignments(), isAdmin, ref.projects()) { s, grants, admin, _ -> Triple(s, grants, admin) }
        .mapLatest { (s, grants, admin) ->
            s ?: return@mapLatest null
            val subs = ref.subSectors(s.projectId).first().filter { ss ->
                ss.sectorId == s.sectorId && ss.active && (admin || allowed(grants, s.projectId, ss.sectorId, ss.id))
            }
            SessionContext(
                session = s, project = ref.project(s.projectId), year = ref.year(s.plantingYearId), sector = ref.sector(s.sectorId),
                subSector = ref.subSector(s.subSectorId), vendor = s.vendorId?.let { ref.vendor(it) }, subSectors = subs,
            )
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val userId = auth.state.map { (it as? SessionState.Active)?.user?.id }

    /** Trees registered and observations recorded by this officer since the session started. */
    val treesThisSession: StateFlow<Int> = combine(sessions.session, userId) { s, u -> s to u }
        .flatMapLatest { (s, u) -> if (s == null || u == null) flowOf(0) else db.trees().countCreatedSince(u, s.startedAt) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)
    val observationsThisSession: StateFlow<Int> = combine(sessions.session, userId) { s, u -> s to u }
        .flatMapLatest { (s, u) -> if (s == null || u == null) flowOf(0) else db.observations().countRecordedSince(u, s.startedAt) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    fun switchSubSector(id: String) = viewModelScope.launch { sessions.update { it.copy(subSectorId = id) } }
    fun end() = viewModelScope.launch { sessions.end() }
}

internal fun allowed(grants: List<AssignmentEntity>, projectId: String, sectorId: String, subSectorId: String?) =
    grants.any { g -> g.projectId == projectId && (g.sectorId == null || g.sectorId == sectorId) && (subSectorId == null || g.subSectorId == null || g.subSectorId == subSectorId) }

/** Card on the home screen: the session context plus one-tap sub-sector switching. */
@Composable
fun SessionContextCard(
    ctx: SessionContext,
    trees: Int,
    observations: Int,
    onSwitchSubSector: (String) -> Unit,
    onChange: () -> Unit,
    onEnd: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Today’s field session", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(ctx.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (ctx.vendor != null) Text("Vendor: ${ctx.vendor.name}", style = MaterialTheme.typography.bodySmall)
            if (ctx.year?.active == false) Text("Back-entry into closed planting year ${ctx.year.yearLabel}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
            if (ctx.stale) {
                Notice("Part of this session was changed or deactivated by an administrator. Tap “Change” to pick again.", MaterialTheme.colorScheme.errorContainer)
            }
            SubSectorPicker(ctx, onSwitchSubSector)
            Text("$trees trees registered · $observations observations recorded this session", style = MaterialTheme.typography.bodySmall)
            content()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onChange) { Text("Change") }
                TextButton(onClick = onEnd) { Text("End session") }
            }
        }
    }
}

/** Drop-down for moving to another sub-sector of the session's sector without leaving the current screen. */
@Composable
fun SubSectorPicker(ctx: SessionContext, onSelect: (String) -> Unit) {
    Picker(
        "Sub-sector", ctx.subSectors, ctx.subSectors.find { it.id == ctx.session.subSectorId }, { "${it.shortCode} · ${it.name}" },
        { onSelect(it.id) }, supportingText = null,
    )
}

// ---------------------------------------------------------------- setup

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SessionSetupViewModel @Inject constructor(
    db: TmsDatabase,
    private val sessions: FieldSessionRepository,
    auth: SessionStore,
) : ViewModel() {
    private val ref = db.reference()
    val isAdmin = auth.state.map { (it as? SessionState.Active)?.user?.role == "ADMIN" }.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    // Officers register only in active projects (the server enforces the same rule).
    val projects = ref.projects().combine(isAdmin) { l, admin -> l.filter { it.status == "ACTIVE" || admin } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val grants = ref.assignments().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val projectId = MutableStateFlow<String?>(null)
    val yearId = MutableStateFlow<String?>(null)
    val sectorId = MutableStateFlow<String?>(null)
    val subSectorId = MutableStateFlow<String?>(null)
    val vendorId = MutableStateFlow<String?>(null)

    val years = projectId.filterNotNull().flatMapLatest { ref.years(it) }
        // Officers work in open planting years; administrators may back-enter closed ones.
        .combine(isAdmin) { l, admin -> l.filter { it.active || admin } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    // Each year's land survey has its own sectors.
    val sectors = combine(projectId.filterNotNull(), yearId) { p, y -> p to y }
        .flatMapLatest { (p, y) -> if (y == null) flowOf(emptyList()) else ref.sectorsForYear(p, y) }
        .map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /** Vendors planting in the chosen year; when none are linked, every active vendor is offered. */
    private val linkedVendors = yearId.flatMapLatest { y -> if (y == null) flowOf(emptyList()) else ref.vendorsForYear(y) }
    val vendors = combine(linkedVendors, ref.vendors()) { linked, all -> linked.ifEmpty { all.filter { it.active } } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { ref.subSectors(it) }.map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /**
     * The vendor is chosen once per session whenever the project has vendors: their short code is part of the tree ID
     * and each vendor numbers its own trees.
     */
    val vendorNeeded = vendors.map { it.isNotEmpty() }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        // Pre-fill from the current session, so "Change" only asks for what is different.
        viewModelScope.launch {
            sessions.current()?.let { s ->
                projectId.value = s.projectId; yearId.value = s.plantingYearId; sectorId.value = s.sectorId
                subSectorId.value = s.subSectorId; vendorId.value = s.vendorId
            }
        }
    }

    fun selectProject(id: String) {
        if (projectId.value == id) return
        projectId.value = id; yearId.value = null; sectorId.value = null; subSectorId.value = null; vendorId.value = null
    }

    /** A different year means a different survey (areas) and possibly different vendors. */
    fun selectYear(id: String) {
        if (yearId.value == id) return
        yearId.value = id; sectorId.value = null; subSectorId.value = null; vendorId.value = null
    }

    fun selectSector(id: String) {
        if (sectorId.value == id) return
        sectorId.value = id; subSectorId.value = null
    }

    fun start(onStarted: () -> Unit) = viewModelScope.launch {
        val previous = sessions.current()
        val sameDay = previous?.projectId == projectId.value && previous?.plantingYearId == yearId.value && previous?.sectorId == sectorId.value
        // Changing only the sub-sector continues the same session; anything else starts a new one.
        val sameSession = sameDay && previous?.vendorId == vendorId.value
        sessions.start(
            FieldSession(
                id = if (sameSession) previous!!.id else java.util.UUID.randomUUID().toString(),
                projectId = projectId.value!!, plantingYearId = yearId.value!!, sectorId = sectorId.value!!, subSectorId = subSectorId.value!!,
                vendorId = vendorId.value,
                // Keep the running count and remembered choices when only the sub-sector or vendor changed.
                startedAt = if (sameDay) previous!!.startedAt else java.time.Instant.now().toString(),
                speciesId = previous?.speciesId.takeIf { sameDay }, statusId = previous?.statusId.takeIf { sameDay },
                stickyValues = previous?.stickyValues.takeIf { sameDay }.orEmpty(),
            ),
        )
        onStarted()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionSetupScreen(onStarted: () -> Unit, onBack: () -> Unit, vm: SessionSetupViewModel = hiltViewModel()) {
    val projects by vm.projects.collectAsStateWithLifecycle()
    val grants by vm.grants.collectAsStateWithLifecycle()
    val years by vm.years.collectAsStateWithLifecycle()
    val sectors by vm.sectors.collectAsStateWithLifecycle()
    val subSectors by vm.subSectors.collectAsStateWithLifecycle()
    val vendors by vm.vendors.collectAsStateWithLifecycle()
    val vendorNeeded by vm.vendorNeeded.collectAsStateWithLifecycle()
    val isAdmin by vm.isAdmin.collectAsStateWithLifecycle()
    val projectId by vm.projectId.collectAsStateWithLifecycle()
    val yearId by vm.yearId.collectAsStateWithLifecycle()
    val sectorId by vm.sectorId.collectAsStateWithLifecycle()
    val subSectorId by vm.subSectorId.collectAsStateWithLifecycle()
    val vendorId by vm.vendorId.collectAsStateWithLifecycle()

    // Only areas this user is assigned to; administrators have no assignment rows and see everything.
    val mySectors = sectors.filter { s -> isAdmin || allowed(grants, s.projectId, s.id, null) }
    val mySubs = subSectors.filter { ss -> ss.sectorId == sectorId && (isAdmin || allowed(grants, ss.projectId, ss.sectorId, ss.id)) }
    // Single choices are made automatically.
    LaunchedEffect(projects) { if (projectId == null && projects.size == 1) vm.selectProject(projects[0].id) }
    LaunchedEffect(years) { if (yearId == null && years.size == 1) vm.selectYear(years[0].id) }
    LaunchedEffect(vendors, vendorNeeded) { if (vendorNeeded && vendorId == null && vendors.size == 1) vm.vendorId.value = vendors[0].id }
    LaunchedEffect(mySectors) { if (sectorId == null && mySectors.size == 1) vm.selectSector(mySectors[0].id) }
    LaunchedEffect(mySubs) { if (subSectorId == null && mySubs.size == 1) vm.subSectorId.value = mySubs[0].id }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Field session") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Picker("Project", projects, projects.find { it.id == projectId }, { "${it.name} (${it.shortCode})" }, { vm.selectProject(it.id) })
            Picker("Planting year", years, years.find { it.id == yearId }, { it.yearLabel + if (it.active) "" else " (closed – back-entry)" }, { vm.selectYear(it.id) },
                enabled = projectId != null, supportingText = null)
            if (vendorNeeded) {
                Picker("Vendor (who planted)", vendors, vendors.find { it.id == vendorId }, { listOfNotNull(it.shortCode, it.name).joinToString(" · ") }, { vm.vendorId.value = it.id },
                    enabled = yearId != null, supportingText = null)
                if (vendors.find { it.id == vendorId }?.shortCode.isNullOrBlank() && vendorId != null) {
                    Notice("This vendor has no short code, which tree IDs need. Ask an administrator to add one.", MaterialTheme.colorScheme.errorContainer)
                }
            }
            Picker("Sector", mySectors, mySectors.find { it.id == sectorId }, { "${it.shortCode} · ${it.name}" }, { vm.selectSector(it.id) }, enabled = yearId != null,
                supportingText = null)
            Picker("Sub-sector", mySubs, mySubs.find { it.id == subSectorId }, { "${it.shortCode} · ${it.name}" }, { vm.subSectorId.value = it.id }, enabled = sectorId != null)
            if (yearId != null && mySectors.isEmpty()) Notice("No surveyed areas for this planting year on this device yet. Sync, or ask an administrator to add this year's sectors.")
            if (projects.isEmpty()) Notice("No projects on this device yet. Sync while connected, or ask an administrator to assign you.")
            Button(
                onClick = { vm.start(onStarted) },
                enabled = projectId != null && yearId != null && sectorId != null && subSectorId != null &&
                    (!vendorNeeded || !vendors.find { it.id == vendorId }?.shortCode.isNullOrBlank()),
                modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
            ) { Text("Start session", style = MaterialTheme.typography.titleMedium) }
        }
    }
}
