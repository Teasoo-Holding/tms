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
)

@HiltViewModel
class RapidRegisterViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    db: TmsDatabase,
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

    init {
        // Re-derive the prefix and next-serial suggestion whenever the sub-sector (or session) changes.
        viewModelScope.launch {
            session.filterNotNull().distinctUntilChanged().collect { s ->
                prefix.value = runCatching { trees.prefix(s.area()) }
                refreshCheck()
                suggestion.value = trees.suggestNextSerial(s.area(), auth.userId().orEmpty())
                if (s.statusId == null) {
                    ref.statuses().first().firstOrNull { it.code == "PLANTED" }?.let { p -> sessions.update { it.copy(statusId = p.id) } }
                }
            }
        }
    }

    fun setSerial(v: String) {
        entry.update { it.copy(serial = v, confirmed = false) }
        viewModelScope.launch { refreshCheck() }
    }

    fun update(change: (TreeEntry) -> TreeEntry) = entry.update(change)

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
                ),
                auth.userId() ?: throw RegistrationException("Sign in again to save."),
            )
            lastSaved.value = ok.assembled.physicalId
            // Ready for the next tree: keep the session choices, clear what belongs to this tree.
            entry.value = TreeEntry(observedOn = e.observedOn)
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
fun RapidRegisterScreen(onBack: () -> Unit, vm: RapidRegisterViewModel = hiltViewModel(), sessionVm: FieldSessionViewModel = hiltViewModel()) {
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
    var camera by remember { mutableStateOf(false) }
    var moreDetails by remember { mutableStateOf(false) }
    val serialFocus = remember { FocusRequester() }
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()

    val status = statuses.find { it.id == s?.statusId }
    val photoMissing = status?.requiresPhoto == true && e.photos.isEmpty()
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
                            is SerialCheck.LocalDuplicate -> Text("${c.physicalId} is already registered on this device. Check the label.", color = MaterialTheme.colorScheme.error)
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
