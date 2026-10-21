package com.teasoo.tms.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.repo.*
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.sync.SyncScheduler
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

data class RegisterForm(
    val yearId: String? = null,
    val sectorId: String? = null,
    val subSectorId: String? = null,
    val vendorId: String? = null,
    val speciesId: String? = null,
    val statusId: String? = null,
    val serial: String = "",
    val plantedOn: LocalDate? = LocalDate.now(),
    val notes: String = "",
    val remarks: String = "",
    /** Administrators only, for replacements: a tree ID typed by hand. */
    val customId: String = "",
    val useCustomId: Boolean = false,
    val visitType: String = "VISIT",
    val photos: List<CapturedPhoto> = emptyList(),
    val treeFields: Map<String, String> = emptyMap(),
    val observationFields: Map<String, String> = emptyMap(),
    val height: HeightReading? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class RegisterViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: TmsDatabase,
    private val trees: TreeRepository,
    private val session: SessionStore,
    val photoStore: PhotoStore,
    saved: SavedStateHandle,
) : ViewModel() {
    val replacesTreeId: String? = saved["replaces"]
    private val ref = db.reference()
    val form = MutableStateFlow(RegisterForm())
    private val projectId = MutableStateFlow<String?>(null)

    val replacing = flow { emit(replacesTreeId?.let { db.trees().get(it) }) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val isAdmin = session.state.map { (it as? SessionState.Active)?.user?.role == "ADMIN" }.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    // Officers work in open planting years; administrators may back-enter closed ones.
    val years = projectId.filterNotNull().flatMapLatest { ref.years(it) }.combine(isAdmin) { l, admin -> l.filter { it.active || admin } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    private val yearId = form.map { it.yearId }.distinctUntilChanged()
    // Each year's land survey has its own sectors.
    val sectors = combine(projectId.filterNotNull(), yearId) { p, y -> p to y }
        .flatMapLatest { (p, y) -> if (y == null) flowOf(emptyList()) else ref.sectorsForYear(p, y) }
        .map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { ref.subSectors(it) }.map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val species = ref.species().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val statuses = ref.statuses().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    private val linkedVendors = yearId.flatMapLatest { y -> if (y == null) flowOf(emptyList()) else ref.vendorsForYear(y) }
    /** Vendors planting in the chosen year, or every active vendor when none are linked. */
    val vendors = combine(linkedVendors, ref.vendors()) { linked, all -> linked.ifEmpty { all.filter { it.active } } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val assignments = ref.assignments().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val treeFieldDefs = projectId.filterNotNull().flatMapLatest { ref.customFields(it, "TREE") }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val observationFieldDefs = projectId.filterNotNull().flatMapLatest { ref.customFields(it, "OBSERVATION") }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val showFieldErrors = MutableStateFlow(false)

    val prefix = MutableStateFlow<Result<PrefixInfo>?>(null)
    val serialCheck = MutableStateFlow<SerialCheck?>(null)
    val saveError = MutableStateFlow<String?>(null)
    val saving = MutableStateFlow(false)

    fun setProject(id: String) {
        if (projectId.value == id) return
        projectId.value = id
        viewModelScope.launch {
            // A replacement is planted in the original's area by default.
            replacing.first { replacesTreeId == null || it != null }?.let { t ->
                form.update { it.copy(sectorId = t.sectorId, subSectorId = t.subSectorId) }
            }
            val default = ref.statuses().first().let { l -> l.firstOrNull { it.code == "ALIVE" && it.active } ?: l.firstOrNull { it.active && !it.isTerminal } }
            form.update { it.copy(statusId = it.statusId ?: default?.id) }
            refresh()
        }
    }

    fun update(change: (RegisterForm) -> RegisterForm) {
        val before = form.value
        form.update { change(it) }
        viewModelScope.launch { refresh() }
    }

    private fun area(): AreaSelection? {
        val f = form.value
        return AreaSelection(projectId.value ?: return null, f.yearId ?: return null, f.sectorId ?: return null, f.subSectorId ?: return null, f.vendorId)
    }

    val vendorNeeded = MutableStateFlow(false)

    private suspend fun refresh() {
        val pid = projectId.value ?: return
        val all = ref.activeSchemes(pid)
        val f = form.value
        vendorNeeded.value = (f.yearId != null && ref.vendorsForYear(f.yearId).first().isNotEmpty()) || all.any { it.vendorId != null } ||
            resolveScheme(all, f.yearId, null)?.let { s -> s.componentsJson.contains("VENDOR_CODE") || s.serialScopeJson.contains("VENDOR") } == true
        val a = area()
        if (a == null) {
            prefix.value = null; serialCheck.value = null; return
        }
        prefix.value = runCatching { trees.prefix(a) }
        val info = prefix.value?.getOrNull()
        serialCheck.value = if (info != null && form.value.serial.isNotBlank()) trees.checkSerial(a, info, form.value.serial, session.userId().orEmpty()) else null
    }

    fun addPhoto(p: CapturedPhoto) = form.update { it.copy(photos = it.photos + p) }
    fun removePhoto(p: CapturedPhoto) {
        photoStore.discard(p)
        form.update { it.copy(photos = it.photos - p) }
    }

    fun save(onSaved: (String) -> Unit) = viewModelScope.launch {
        val a = area() ?: return@launch
        val f = form.value
        val custom = f.useCustomId && replacesTreeId != null && isAdmin.value
        val ok = serialCheck.value as? SerialCheck.Ok
        if (!custom && ok == null) return@launch
        saving.value = true
        saveError.value = null
        try {
            val missing = missingRequired(treeFieldDefs.value, f.treeFields) + missingRequired(observationFieldDefs.value, f.observationFields)
            if (missing.isNotEmpty()) {
                showFieldErrors.value = true
                throw RegistrationException("Fill in: ${missing.joinToString()}.")
            }
            val id = trees.register(
                NewTree(
                    area = a, speciesId = f.speciesId ?: throw RegistrationException("Choose a species."),
                    serialInput = f.serial, confirmedPhysicalId = if (custom) f.customId.trim() else ok!!.assembled.physicalId,
                    statusId = f.statusId ?: throw RegistrationException("Choose a status."),
                    observedAt = Instant.now(), plantedOn = f.plantedOn?.toString(),
                    notes = f.notes.ifBlank { null }, remarks = f.remarks.ifBlank { null }, photos = f.photos,
                    replacesTreeId = replacesTreeId,
                    customPhysicalId = f.customId.trim().takeIf { custom && it.isNotEmpty() },
                    visitType = f.visitType,
                    treeFields = toFieldValues(treeFieldDefs.value, f.treeFields),
                    observationFields = toFieldValues(observationFieldDefs.value, f.observationFields),
                    height = f.height,
                ),
                session.userId() ?: throw RegistrationException("Sign in again to save."),
            )
            saved = true
            SyncScheduler.syncNow(context)
            onSaved(id)
        } catch (e: RegistrationException) {
            saveError.value = e.message
        } finally {
            saving.value = false
        }
    }

    private var saved = false

    /** Leaving without saving must not orphan photo files; saved photos belong to the record. */
    override fun onCleared() {
        if (!saved) form.value.photos.forEach(photoStore::discard)
    }
}

/** Today means "now"; a past date records midday local time on that date. */
fun observedInstant(date: LocalDate): Instant =
    if (date == LocalDate.now()) Instant.now() else date.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(app: AppViewModel, onDone: (String) -> Unit, onBack: () -> Unit, vm: RegisterViewModel = hiltViewModel()) {
    val projectId by app.selectedProjectId.collectAsStateWithLifecycle()
    LaunchedEffect(projectId) { projectId?.let(vm::setProject) }
    val f by vm.form.collectAsStateWithLifecycle()
    val years by vm.years.collectAsStateWithLifecycle()
    val sectors by vm.sectors.collectAsStateWithLifecycle()
    val subSectors by vm.subSectors.collectAsStateWithLifecycle()
    val species by vm.species.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()
    val vendors by vm.vendors.collectAsStateWithLifecycle()
    val assignments by vm.assignments.collectAsStateWithLifecycle()
    val prefix by vm.prefix.collectAsStateWithLifecycle()
    val check by vm.serialCheck.collectAsStateWithLifecycle()
    val error by vm.saveError.collectAsStateWithLifecycle()
    val saving by vm.saving.collectAsStateWithLifecycle()
    val vendorNeeded by vm.vendorNeeded.collectAsStateWithLifecycle()
    val replacing by vm.replacing.collectAsStateWithLifecycle()
    var camera by remember { mutableStateOf(false) }

    // Only areas the officer is assigned to (the server enforces this too).
    val isAdmin by vm.isAdmin.collectAsStateWithLifecycle()
    // Administrators have no assignment rows and may work in any area.
    val mySectors = sectors.filter { s -> isAdmin || allowed(assignments, s.projectId, s.id, null) }
    val mySubs = subSectors.filter { ss -> ss.sectorId == f.sectorId && (isAdmin || allowed(assignments, ss.projectId, ss.sectorId, ss.id)) }
    val status = statuses.find { it.id == f.statusId }
    val photoMissing = f.photos.isEmpty()

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (vm.replacesTreeId != null) "Plant a replacement" else "Register a tree") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            replacing?.let { Notice("Replacing ${it.physicalTreeId}. The replacement gets its own new ID and planting year; the original keeps its history.") }

            Picker("Planting year", years, years.find { it.id == f.yearId }, { it.yearLabel + if (it.active) "" else " (closed – back-entry)" }, { y -> vm.update { if (it.yearId == y.id) it else it.copy(yearId = y.id, sectorId = null, subSectorId = null, vendorId = null) } },
                supportingText = "Choose the cohort on the label, not today’s year")
            Picker("Sector", mySectors, mySectors.find { it.id == f.sectorId }, { "${it.shortCode} · ${it.name}" }, { s -> vm.update { it.copy(sectorId = s.id, subSectorId = null) } })
            Picker("Sub-sector", mySubs, mySubs.find { it.id == f.subSectorId }, { "${it.shortCode} · ${it.name}" }, { s -> vm.update { it.copy(subSectorId = s.id) } }, enabled = f.sectorId != null)
            if (vendorNeeded) {
                Picker("Vendor", vendors, vendors.find { it.id == f.vendorId }, { listOfNotNull(it.shortCode, it.name).joinToString(" · ") }, { v -> vm.update { it.copy(vendorId = v.id) } })
            }

            HorizontalDivider()
            Text("Tree ID", style = MaterialTheme.typography.titleMedium)
            // Administrators can give a replanted tree any ID (e.g. the tag the vendor attached).
            if (isAdmin && vm.replacesTreeId != null) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Switch(f.useCustomId, { v -> vm.update { it.copy(useCustomId = v) } })
                    Spacer(Modifier.width(8.dp))
                    Text("Set the new tree's ID by hand", style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (f.useCustomId && isAdmin && vm.replacesTreeId != null) OutlinedTextField(
                value = f.customId,
                onValueChange = { v -> vm.update { it.copy(customId = v.take(64)) } },
                label = { Text("New tree ID") },
                supportingText = { Text("Letters, digits and - _ / . — must not be used by another tree.") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            ) else when (val p = prefix) {
                null -> Text("Choose the planting year and area to see the ID prefix.", style = MaterialTheme.typography.bodyMedium)
                else -> p.fold(
                    onSuccess = { info ->
                        val ok = check as? SerialCheck.Ok
                        TreeIdText(info.prefix, ok?.assembled?.serial ?: "_".repeat(info.serialWidth))
                        OutlinedTextField(
                            value = f.serial,
                            onValueChange = { v -> vm.update { it.copy(serial = v.filter(Char::isDigit).take(info.serialWidth)) } },
                            label = { Text("Serial number on the label") },
                            supportingText = { Text("Digits only, up to ${info.serialWidth}. Leading zeros are added for you.") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            singleLine = true,
                            isError = check != null && check !is SerialCheck.Ok,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        when (val c = check) {
                            is SerialCheck.Invalid -> Text(c.message, color = MaterialTheme.colorScheme.error)
                            is SerialCheck.NotAllocated -> Text(c.message, color = MaterialTheme.colorScheme.error)
                            is SerialCheck.LocalDuplicate -> Text("${c.physicalId} is already registered on this device. Check the label.", color = MaterialTheme.colorScheme.error)
                            is SerialCheck.Ok -> Text("Tree ID: ${c.assembled.physicalId}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                            null -> {}
                        }
                        if (check is SerialCheck.Ok) {
                            Text("Other devices that are offline cannot be checked; the server confirms uniqueness when you sync.", style = MaterialTheme.typography.bodySmall)
                        }
                    },
                    onFailure = { Text(it.message ?: "The ID format is unavailable.", color = MaterialTheme.colorScheme.error) },
                )
            }

            HorizontalDivider()
            Picker("Species", species, species.find { it.id == f.speciesId }, { it.commonName?.let { c -> "$c (${it.scientificName})" } ?: it.scientificName }, { s -> vm.update { it.copy(speciesId = s.id) } })
            StatusSelector(statuses, f.statusId, { id -> vm.update { it.copy(statusId = id) } })
            VisitTypeSelector(f.visitType) { t -> vm.update { it.copy(visitType = t) } }
            DateField("Planted on", f.plantedOn, { d -> vm.update { it.copy(plantedOn = d) } })
            OutlinedTextField(f.remarks, { v -> vm.update { it.copy(remarks = v) } }, label = { Text("Observation remarks") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(f.notes, { v -> vm.update { it.copy(notes = v) } }, label = { Text("Tree notes") }, modifier = Modifier.fillMaxWidth())
            Text("No GPS is recorded for the tree; its location is the sub-sector.", style = MaterialTheme.typography.bodySmall)

            PhotoRow(f.photos, onAdd = { camera = true }, onRemove = vm::removePhoto, required = photoMissing)
            val treeFieldDefs by vm.treeFieldDefs.collectAsStateWithLifecycle()
            val observationFieldDefs by vm.observationFieldDefs.collectAsStateWithLifecycle()
            val showFieldErrors by vm.showFieldErrors.collectAsStateWithLifecycle()
            // Stick length is not remembered here; the default 1 m pole is offered.
            if (SHOW_HEIGHT) HeightSection(f.height, { h -> vm.form.update { it.copy(height = h) } }, f.photos, 100.0, {})
            CustomFieldsForm(treeFieldDefs, f.treeFields, { k, v -> vm.form.update { it.copy(treeFields = it.treeFields + (k to v)) } }, showFieldErrors)
            CustomFieldsForm(observationFieldDefs, f.observationFields, { k, v -> vm.form.update { it.copy(observationFields = it.observationFields + (k to v)) } }, showFieldErrors)

            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { vm.save(onDone) },
                enabled = !saving && (check is SerialCheck.Ok || (f.useCustomId && isAdmin && f.customId.isNotBlank())) && f.speciesId != null && f.statusId != null && !photoMissing,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (saving) "Saving…" else "Save on this device") }
        }
    }
    if (camera) CameraCaptureDialog(vm.photoStore, onCaptured = { vm.addPhoto(it); camera = false }, onDismiss = { camera = false })
}

@Composable
fun PhotoRow(photos: List<CapturedPhoto>, onAdd: () -> Unit, onRemove: (CapturedPhoto) -> Unit, required: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Photos (${photos.size})", style = MaterialTheme.typography.titleSmall)
        photos.forEachIndexed { i, p ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Photo ${i + 1} · ${p.byteSize / 1024} KB", Modifier.padding(top = 12.dp))
                TextButton(onClick = { onRemove(p) }) { Text("Remove") }
            }
        }
        if (required) Text("A photo of the tree is required.", color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onAdd) { Text("Take photo") }
    }
}
