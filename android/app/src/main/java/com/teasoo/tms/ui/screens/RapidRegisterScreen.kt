package com.teasoo.tms.ui.screens

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.repo.*
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.sync.SyncScheduler
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/** Per-tree input; everything else comes from the field session. */
data class TreeEntry(
    val serial: String = "",
    val confirmed: Boolean = false,
    val remarks: String = "",
    val notes: String = "",
    val observedOn: LocalDate = LocalDate.now(),
    val photos: List<CapturedPhoto> = emptyList(),
    /** Custom field text for the tree and its first observation, keyed by field key. */
    val treeFields: Map<String, String> = emptyMap(),
    val observationFields: Map<String, String> = emptyMap(),
    val height: HeightReading? = null,
)

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@HiltViewModel
class RapidRegisterViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: TmsDatabase,
    private val trees: TreeRepository,
    private val sessions: FieldSessionRepository,
    private val auth: SessionStore,
    val photoStore: PhotoStore,
) : ViewModel() {
    private val ref = db.reference()
    val session = sessions.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val species = ref.species().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    // A newly registered tree is alive; dead/missing are recorded later as observations.
    val statuses = ref.statuses().map { l -> l.filter { it.active && !it.isTerminal } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val entry = MutableStateFlow(TreeEntry())
    val prefix = MutableStateFlow<Result<PrefixInfo>?>(null)
    val check = MutableStateFlow<SerialCheck?>(null)
    val suggestion = MutableStateFlow<Long?>(null)
    val lastSaved = MutableStateFlow<String?>(null)
    val error = MutableStateFlow<String?>(null)
    val saving = MutableStateFlow(false)
    val showFieldErrors = MutableStateFlow(false)
    val referenceCm = MutableStateFlow(100.0)
    private val projectId = session.filterNotNull().map { it.projectId }.distinctUntilChanged()
    val treeFieldDefs = projectId.flatMapLatest { ref.customFields(it, "TREE") }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val observationFieldDefs = projectId.flatMapLatest { ref.customFields(it, "OBSERVATION") }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    init {
        viewModelScope.launch { referenceCm.value = sessions.referenceCm() }
        // Sticky field values (e.g. today's nursery batch) are carried into every new tree.
        viewModelScope.launch {
            combine(session.filterNotNull(), treeFieldDefs, observationFieldDefs) { s, t, o -> Triple(s.stickyValues, t, o) }.collect { (sticky, t, o) ->
                fun prefill(defs: List<com.teasoo.tms.data.local.CustomFieldEntity>, current: Map<String, String>) =
                    defs.filter { it.sticky && current[it.key].isNullOrBlank() }.mapNotNull { d -> sticky[d.key]?.let { d.key to it } }.toMap() + current.filterValues { it.isNotBlank() }
                entry.update { it.copy(treeFields = prefill(t, it.treeFields), observationFields = prefill(o, it.observationFields)) }
            }
        }
        // Re-derive the prefix and next-serial suggestion whenever the sub-sector (or session) changes.
        viewModelScope.launch {
            session.filterNotNull().distinctUntilChanged().collect { s ->
                prefix.value = runCatching { trees.prefix(s.area()) }
                refreshCheck()
                suggestion.value = trees.suggestNextSerial(s.area(), auth.userId().orEmpty())
                if (s.statusId == null) {
                    ref.statuses().first().let { l -> l.firstOrNull { it.code == "ALIVE" && it.active } ?: l.firstOrNull { it.code == "PLANTED" && it.active } ?: l.firstOrNull { it.active && !it.isTerminal } }?.let { p -> sessions.update { it.copy(statusId = p.id) } }
                }
            }
        }
    }

    fun setSerial(v: String) {
        entry.update { it.copy(serial = v, confirmed = false) }
        viewModelScope.launch { refreshCheck() }
    }

    fun update(change: (TreeEntry) -> TreeEntry) = entry.update(change)
    fun setTreeField(key: String, v: String) = entry.update { it.copy(treeFields = it.treeFields + (key to v)) }
    fun setObservationField(key: String, v: String) = entry.update { it.copy(observationFields = it.observationFields + (key to v)) }
    fun setHeight(h: HeightReading?) = entry.update { it.copy(height = h) }
    fun setReferenceCm(cm: Double) = viewModelScope.launch { referenceCm.value = cm; sessions.setReferenceCm(cm) }

    /** Last recorded species and status of a tree already on the device, to confirm it is the right one. */
    suspend fun describe(treeId: String): String? {
        val t = db.trees().get(treeId) ?: return null
        val species = ref.species().first().find { it.id == t.speciesId }?.let { it.commonName ?: it.scientificName }
        val status = t.currentStatusId?.let { ref.status(it)?.name }
        val about = listOfNotNull(species, status, t.lastObservedAt?.let { "last seen ${formatInstant(it)}" }).joinToString(" · ")
        return listOfNotNull(about, areaMismatch(db, t, session.value)?.let { "⚠ $it" }).joinToString("\n")
    }

    /** Remembered for the rest of the session. */
    fun setSpecies(id: String) = viewModelScope.launch { sessions.update { it.copy(speciesId = id) } }
    fun setStatus(id: String) = viewModelScope.launch { sessions.update { it.copy(statusId = id) } }
    fun setPlantedOn(d: LocalDate?) = viewModelScope.launch { sessions.update { it.copy(plantedOn = d?.toString()) } }
    fun switchSubSector(id: String) = viewModelScope.launch { sessions.update { it.copy(subSectorId = id) } }

    private suspend fun refreshCheck() {
        val s = session.value ?: return
        val info = prefix.value?.getOrNull()
        val serial = entry.value.serial
        check.value = if (info != null && serial.isNotBlank()) trees.checkSerial(s.area(), info, serial, auth.userId().orEmpty()) else null
    }

    fun addPhoto(p: CapturedPhoto) = entry.update { it.copy(photos = it.photos + p) }
    fun removePhoto(p: CapturedPhoto) {
        photoStore.discard(p)
        entry.update { it.copy(photos = it.photos - p) }
    }

    fun save(onSaved: () -> Unit) = viewModelScope.launch {
        val s = session.value ?: return@launch
        val ok = check.value as? SerialCheck.Ok ?: return@launch
        val e = entry.value
        saving.value = true
        error.value = null
        try {
            val missing = missingRequired(treeFieldDefs.value, e.treeFields) + missingRequired(observationFieldDefs.value, e.observationFields)
            if (missing.isNotEmpty()) {
                showFieldErrors.value = true
                throw RegistrationException("Fill in: ${missing.joinToString()}.")
            }
            trees.register(
                NewTree(
                    area = s.area(),
                    speciesId = s.speciesId ?: throw RegistrationException("Choose a species."),
                    serialInput = e.serial,
                    confirmedPhysicalId = ok.assembled.physicalId,
                    statusId = s.statusId ?: throw RegistrationException("Choose a status."),
                    observedAt = observedInstant(e.observedOn),
                    plantedOn = s.plantedOn,
                    notes = e.notes.ifBlank { null },
                    remarks = e.remarks.ifBlank { null },
                    photos = e.photos,
                    treeFields = toFieldValues(treeFieldDefs.value, e.treeFields),
                    observationFields = toFieldValues(observationFieldDefs.value, e.observationFields),
                    height = e.height,
                ),
                auth.userId() ?: throw RegistrationException("Sign in again to save."),
            )
            val sticky = (treeFieldDefs.value + observationFieldDefs.value).filter { it.sticky }
                .associate { d -> d.key to (e.treeFields[d.key] ?: e.observationFields[d.key]).orEmpty() }
            if (sticky.isNotEmpty()) sessions.update { it.copy(stickyValues = it.stickyValues + sticky) }
            showFieldErrors.value = false
            lastSaved.value = ok.assembled.physicalId
            // Ready for the next tree: keep the session choices, clear what belongs to this tree.
            entry.value = TreeEntry(
                observedOn = e.observedOn,
                treeFields = e.treeFields.filterKeys { k -> treeFieldDefs.value.any { it.key == k && it.sticky } },
                observationFields = e.observationFields.filterKeys { k -> observationFieldDefs.value.any { it.key == k && it.sticky } },
            )
            check.value = null
            suggestion.value = trees.suggestNextSerial(s.area(), auth.userId().orEmpty())
            SyncScheduler.syncNow(context)
            onSaved()
        } catch (ex: RegistrationException) {
            error.value = ex.message
        } finally {
            saving.value = false
        }
    }

    /** Photos taken for a tree that was never saved must not linger on the device. */
    override fun onCleared() {
        entry.value.photos.forEach(photoStore::discard)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RapidRegisterScreen(onBack: () -> Unit, onVisitTree: (String) -> Unit, vm: RapidRegisterViewModel = hiltViewModel(), sessionVm: FieldSessionViewModel = hiltViewModel()) {
    val ctx by sessionVm.context.collectAsStateWithLifecycle()
    val treesCount by sessionVm.treesThisSession.collectAsStateWithLifecycle()
    val s by vm.session.collectAsStateWithLifecycle()
    val e by vm.entry.collectAsStateWithLifecycle()
    val prefix by vm.prefix.collectAsStateWithLifecycle()
    val check by vm.check.collectAsStateWithLifecycle()
    val suggestion by vm.suggestion.collectAsStateWithLifecycle()
    val species by vm.species.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()
    val lastSaved by vm.lastSaved.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val saving by vm.saving.collectAsStateWithLifecycle()
    val treeFieldDefs by vm.treeFieldDefs.collectAsStateWithLifecycle()
    val observationFieldDefs by vm.observationFieldDefs.collectAsStateWithLifecycle()
    val showFieldErrors by vm.showFieldErrors.collectAsStateWithLifecycle()
    val referenceCm by vm.referenceCm.collectAsStateWithLifecycle()
    var camera by remember { mutableStateOf(false) }
    var moreDetails by remember { mutableStateOf(false) }
    val serialFocus = remember { FocusRequester() }
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()

    val status = statuses.find { it.id == s?.statusId }
    val photoMissing = e.photos.isEmpty()
    LaunchedEffect(Unit) { runCatching { serialFocus.requestFocus() } }

    Scaffold(topBar = {
        TopAppBar(
            title = {
                Column {
                    Text("Register trees")
                    ctx?.let { Text(it.title, style = MaterialTheme.typography.bodySmall) }
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 16.dp).verticalScroll(scroll), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AnimatedVisibility(lastSaved != null) {
                Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text("Saved ${lastSaved.orEmpty()} on this device · $treesCount this session. Next tree.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            ctx?.let { SubSectorChips(it) { id -> vm.switchSubSector(id) } }

            when (val p = prefix) {
                null -> Text("Preparing…")
                else -> p.fold(
                    onSuccess = { info ->
                        val ok = check as? SerialCheck.Ok
                        TreeIdText(info.prefix, ok?.assembled?.serial ?: "_".repeat(info.serialWidth))
                        OutlinedTextField(
                            value = e.serial,
                            onValueChange = { v -> vm.setSerial(v.filter(Char::isDigit).take(info.serialWidth)) },
                            label = { Text("Serial number on the label") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            singleLine = true,
                            isError = check != null && check !is SerialCheck.Ok,
                            modifier = Modifier.fillMaxWidth().focusRequester(serialFocus),
                        )
                        if (e.serial.isBlank() && suggestion != null) {
                            AssistChip(onClick = { vm.setSerial(suggestion.toString()) }, label = { Text("Next in sequence: ${suggestion.toString().padStart(info.serialWidth, '0')}") })
                        }
                        when (val c = check) {
                            is SerialCheck.Invalid -> Text(c.message, color = MaterialTheme.colorScheme.error)
                            is SerialCheck.NotAllocated -> Text(c.message, color = MaterialTheme.colorScheme.error)
                            // A known ID means a visit to an existing tree, not a mistake.
                            is SerialCheck.LocalDuplicate -> Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("${c.physicalId} is already registered.", style = MaterialTheme.typography.titleSmall)
                                    val about by produceState<String?>(null, c.existingTreeId) { value = vm.describe(c.existingTreeId) }
                                    about?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                                    Button(onClick = { onVisitTree(c.existingTreeId) }) { Text("Record a visit to this tree") }
                                }
                            }
                            is SerialCheck.Ok -> Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(e.confirmed, { v -> vm.update { it.copy(confirmed = v) } })
                                Text("Matches the label: ", style = MaterialTheme.typography.bodyMedium)
                                Text(c.assembled.physicalId, fontFamily = FontFamily.Monospace)
                            }
                            null -> {}
                        }
                    },
                    onFailure = { Text(it.message ?: "The ID format is unavailable. Sync and try again.", color = MaterialTheme.colorScheme.error) },
                )
            }

            Picker("Species", species, species.find { it.id == s?.speciesId }, { it.commonName?.let { c -> "$c (${it.scientificName})" } ?: it.scientificName },
                { vm.setSpecies(it.id) }, supportingText = "Remembered for the next tree")
            Text("Status", style = MaterialTheme.typography.labelMedium)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                statuses.forEach { st -> FilterChip(selected = st.id == s?.statusId, onClick = { vm.setStatus(st.id) }, label = { Text(st.name) }) }
            }
            OutlinedTextField(e.remarks, { v -> vm.update { it.copy(remarks = v) } }, label = { Text("Remarks (optional)") }, modifier = Modifier.fillMaxWidth())
            PhotoRow(e.photos, onAdd = { camera = true }, onRemove = vm::removePhoto, required = photoMissing)
            HeightSection(e.height, vm::setHeight, e.photos, referenceCm, vm::setReferenceCm)
            CustomFieldsForm(treeFieldDefs, e.treeFields, vm::setTreeField, showFieldErrors)
            CustomFieldsForm(observationFieldDefs, e.observationFields, vm::setObservationField, showFieldErrors)

            TextButton(onClick = { moreDetails = !moreDetails }) { Text(if (moreDetails) "Hide details" else "More details (dates, notes)") }
            AnimatedVisibility(moreDetails) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DateField("Planted on (remembered)", s?.plantedOn?.let(LocalDate::parse), vm::setPlantedOn)
                    DateField("Observed on", e.observedOn, { d -> vm.update { it.copy(observedOn = d ?: LocalDate.now()) } }, allowClear = false)
                    OutlinedTextField(e.notes, { v -> vm.update { it.copy(notes = v) } }, label = { Text("Tree notes") }, modifier = Modifier.fillMaxWidth())
                }
            }

            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { vm.save { scope.launch { scroll.animateScrollTo(0); runCatching { serialFocus.requestFocus() } } } },
                enabled = !saving && check is SerialCheck.Ok && e.confirmed && s?.speciesId != null && s?.statusId != null && !photoMissing,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            ) { Text(if (saving) "Saving…" else "Save and next tree") }
        }
    }
    if (camera) CameraCaptureDialog(vm.photoStore, onCaptured = { vm.addPhoto(it); camera = false }, onDismiss = { camera = false })
}
