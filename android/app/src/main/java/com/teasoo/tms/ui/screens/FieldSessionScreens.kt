package com.teasoo.tms.ui.screens

import androidx.compose.foundation.horizontalScroll
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
import com.teasoo.tms.ui.components.DateField
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.Picker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate
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
    val title get() = listOfNotNull(project?.shortCode, year?.yearLabel, sector?.let { "${it.shortCode} ${it.name}" }).joinToString(" · ")
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
            SubSectorChips(ctx, onSwitchSubSector)
            Text("$trees trees registered · $observations observations recorded this session", style = MaterialTheme.typography.bodySmall)
            content()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onChange) { Text("Change") }
                TextButton(onClick = onEnd) { Text("End session") }
            }
        }
    }
}

/** Horizontal chips for moving between sub-sectors without leaving the current screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubSectorChips(ctx: SessionContext, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("Sub-sector", style = MaterialTheme.typography.labelMedium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ctx.subSectors.forEach { ss ->
                FilterChip(
                    selected = ss.id == ctx.session.subSectorId,
                    onClick = { onSelect(ss.id) },
                    label = { Text("${ss.shortCode} · ${ss.name}") },
                )
            }
        }
    }
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
    val vendors = ref.vendors().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val projectId = MutableStateFlow<String?>(null)
    val yearId = MutableStateFlow<String?>(null)
    val sectorId = MutableStateFlow<String?>(null)
    val subSectorId = MutableStateFlow<String?>(null)
    val vendorId = MutableStateFlow<String?>(null)
    val plantedOn = MutableStateFlow<LocalDate?>(LocalDate.now())

    val years = projectId.filterNotNull().flatMapLatest { ref.years(it) }
        // Officers work in open planting years; administrators may back-enter closed ones.
        .combine(isAdmin) { l, admin -> l.filter { it.active || admin } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val sectors = projectId.filterNotNull().flatMapLatest { ref.sectors(it) }.map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { ref.subSectors(it) }.map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val vendorNeeded = projectId.filterNotNull().mapLatest { id ->
        ref.activeScheme(id)?.let { it.componentsJson.contains("VENDOR_CODE") || it.serialScopeJson.contains("VENDOR") } ?: false
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        // Pre-fill from the current session, so "Change" only asks for what is different.
        viewModelScope.launch {
            sessions.current()?.let { s ->
                projectId.value = s.projectId; yearId.value = s.plantingYearId; sectorId.value = s.sectorId
                subSectorId.value = s.subSectorId; vendorId.value = s.vendorId; plantedOn.value = s.plantedOn?.let(LocalDate::parse)
            }
        }
    }

    fun selectProject(id: String) {
        if (projectId.value == id) return
        projectId.value = id; yearId.value = null; sectorId.value = null; subSectorId.value = null
    }

    fun selectSector(id: String) {
        if (sectorId.value == id) return
        sectorId.value = id; subSectorId.value = null
    }

    fun start(onStarted: () -> Unit) = viewModelScope.launch {
        val previous = sessions.current()
        val sameDay = previous?.projectId == projectId.value && previous?.plantingYearId == yearId.value && previous?.sectorId == sectorId.value
        sessions.start(
            FieldSession(
                projectId = projectId.value!!, plantingYearId = yearId.value!!, sectorId = sectorId.value!!, subSectorId = subSectorId.value!!,
                vendorId = vendorId.value, plantedOn = plantedOn.value?.toString(),
                // Keep the running count and remembered choices when only the sub-sector or vendor changed.
                startedAt = if (sameDay) previous!!.startedAt else java.time.Instant.now().toString(),
                speciesId = previous?.speciesId.takeIf { sameDay }, statusId = previous?.statusId.takeIf { sameDay },
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
    val plantedOn by vm.plantedOn.collectAsStateWithLifecycle()

    // Only areas this user is assigned to; administrators have no assignment rows and see everything.
    val mySectors = sectors.filter { s -> isAdmin || allowed(grants, s.projectId, s.id, null) }
    val mySubs = subSectors.filter { ss -> ss.sectorId == sectorId && (isAdmin || allowed(grants, ss.projectId, ss.sectorId, ss.id)) }
    // Single choices are made automatically.
    LaunchedEffect(projects) { if (projectId == null && projects.size == 1) vm.selectProject(projects[0].id) }
    LaunchedEffect(years) { if (yearId == null && years.size == 1) vm.yearId.value = years[0].id }
    LaunchedEffect(mySectors) { if (sectorId == null && mySectors.size == 1) vm.selectSector(mySectors[0].id) }
    LaunchedEffect(mySubs) { if (subSectorId == null && mySubs.size == 1) vm.subSectorId.value = mySubs[0].id }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Set up today’s session") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Choose these once. Every tree you register or visit will use them until you change them. You can switch sub-sector at any time as you move.",
                style = MaterialTheme.typography.bodyMedium)
            Picker("Project", projects, projects.find { it.id == projectId }, { "${it.name} (${it.shortCode})" }, { vm.selectProject(it.id) })
            Picker("Planting year", years, years.find { it.id == yearId }, { it.yearLabel + if (it.active) "" else " (closed – back-entry)" }, { vm.yearId.value = it.id },
                enabled = projectId != null, supportingText = "The cohort on the labels, not necessarily this year")
            Picker("Sector", mySectors, mySectors.find { it.id == sectorId }, { "${it.shortCode} · ${it.name}" }, { vm.selectSector(it.id) }, enabled = projectId != null)
            Picker("Starting sub-sector", mySubs, mySubs.find { it.id == subSectorId }, { "${it.shortCode} · ${it.name}" }, { vm.subSectorId.value = it.id }, enabled = sectorId != null)
            if (vendorNeeded) {
                Picker("Vendor", vendors, vendors.find { it.id == vendorId }, { listOfNotNull(it.shortCode, it.name).joinToString(" · ") }, { vm.vendorId.value = it.id },
                    supportingText = "Part of this project’s tree ID")
            }
            DateField("Planted on (default for new trees)", plantedOn, { vm.plantedOn.value = it })
            if (projects.isEmpty()) Notice("No projects on this device yet. Sync while connected, or ask an administrator to assign you.")
            Button(
                onClick = { vm.start(onStarted) },
                enabled = projectId != null && yearId != null && sectorId != null && subSectorId != null && (!vendorNeeded || vendorId != null),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Start session") }
        }
    }
}
