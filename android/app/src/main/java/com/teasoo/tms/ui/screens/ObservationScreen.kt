package com.teasoo.tms.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.repo.*
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.sync.SyncScheduler
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@HiltViewModel
class ObservationViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: TmsDatabase,
    private val trees: TreeRepository,
    private val session: SessionStore,
    val photoStore: PhotoStore,
    private val fieldSessions: FieldSessionRepository,
    private val photoLoader: PhotoLoader,
    saved: SavedStateHandle,
) : ViewModel() {
    val treeId: String = checkNotNull(saved["treeId"])
    val amends: String? = saved["amends"]
    val tree = flow { emit(db.trees().get(treeId)) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val amended = flow { emit(amends?.let { db.observations().get(it) }) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val statuses = db.reference().statuses().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val statusId = MutableStateFlow<String?>(null)
    /** Kept from the visit being corrected; new visits are plain visits (the type is no longer asked). */
    private var visitType = "VISIT"
    /** Earlier photos of this tree, so the officer can check it is the right one. */
    val treeMedia = db.media().forTree(treeId).stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val remarks = MutableStateFlow("")
    val reason = MutableStateFlow("")
    val photos = MutableStateFlow<List<CapturedPhoto>>(emptyList())
    val height = MutableStateFlow<HeightReading?>(null)
    val referenceCm = MutableStateFlow(100.0)
    val fieldDefs = tree.filterNotNull().flatMapLatest { db.reference().customFields(it.projectId, "OBSERVATION") }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val fieldValues = MutableStateFlow<Map<String, String>>(emptyMap())
    val showFieldErrors = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)
    /** Set when today's field session is in a different area than where this tree was registered. */
    val areaWarning: StateFlow<String?> = combine(tree.filterNotNull(), fieldSessions.session) { t, s -> t to s }
        .mapLatest { (t, s) -> areaMismatch(db, t, s) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    private var saved = false

    init {
        viewModelScope.launch {
            referenceCm.value = fieldSessions.referenceCm()
        }
        viewModelScope.launch {
            // Sticky values from today's field session pre-fill the form.
            fieldSessions.current()?.stickyValues?.let { sticky ->
                val defs = db.reference().customFields(tree.filterNotNull().first().projectId, "OBSERVATION").first()
                fieldValues.value = defs.filter { it.sticky }.mapNotNull { d -> sticky[d.key]?.let { d.key to it } }.toMap() + fieldValues.value
            }
        }
        viewModelScope.launch {
            amended.filterNotNull().first().let { o ->
                statusId.value = o.statusId
                visitType = o.visitType
                remarks.value = o.remarks.orEmpty()
                height.value = o.heightCm?.let { HeightReading(it, o.heightMethod ?: "MANUAL", o.heightMeasurementJson) }
                fieldValues.value = storedFieldText(o.customFieldsJson)
            }
        }
    }

    suspend fun photo(m: com.teasoo.tms.data.local.MediaEntity, maxPx: Int) = photoLoader.load(m, maxPx)
    fun addPhoto(p: CapturedPhoto) = photos.update { it + p }
    fun removePhoto(p: CapturedPhoto) { photoStore.discard(p); photos.update { it - p } }

    fun setField(key: String, value: String) = fieldValues.update { it + (key to value) }
    fun setReferenceCm(cm: Double) = viewModelScope.launch { referenceCm.value = cm; fieldSessions.setReferenceCm(cm) }

    fun save(onDone: () -> Unit) = viewModelScope.launch {
        error.value = null
        try {
            val missing = missingRequired(fieldDefs.value, fieldValues.value)
            if (missing.isNotEmpty()) {
                showFieldErrors.value = true
                throw RegistrationException("Fill in: ${missing.joinToString()}.")
            }
            trees.addObservation(
                treeId = treeId,
                statusId = statusId.value ?: throw RegistrationException("Choose a status."),
                // Stamped when saved and not editable; a correction keeps the time of the visit it corrects.
                observedAt = amended.value?.observedAt?.let(java.time.Instant::parse) ?: java.time.Instant.now(),
                visitType = visitType,
                remarks = remarks.value.ifBlank { null },
                photos = photos.value,
                userId = session.userId() ?: throw RegistrationException("Sign in again to save."),
                amendsObservationId = amends,
                amendmentReason = reason.value.ifBlank { null },
                height = height.value,
                fields = toFieldValues(fieldDefs.value, fieldValues.value),
            )
            rememberSticky(fieldDefs.value, fieldValues.value)
            saved = true
            SyncScheduler.syncNow(context)
            onDone()
        } catch (e: RegistrationException) {
            error.value = e.message
        }
    }

    private suspend fun rememberSticky(defs: List<com.teasoo.tms.data.local.CustomFieldEntity>, values: Map<String, String>) {
        val sticky = defs.filter { it.sticky }.associate { it.key to values[it.key].orEmpty() }
        if (sticky.isNotEmpty()) fieldSessions.update { it.copy(stickyValues = it.stickyValues + sticky) }
    }

    override fun onCleared() {
        if (!saved) photos.value.forEach(photoStore::discard)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ObservationScreen(app: AppViewModel, onDone: () -> Unit, vm: ObservationViewModel = hiltViewModel()) {
    val tree by vm.tree.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()
    val statusId by vm.statusId.collectAsStateWithLifecycle()
    val treeMedia by vm.treeMedia.collectAsStateWithLifecycle()
    val remarks by vm.remarks.collectAsStateWithLifecycle()
    val reason by vm.reason.collectAsStateWithLifecycle()
    val photos by vm.photos.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val height by vm.height.collectAsStateWithLifecycle()
    val referenceCm by vm.referenceCm.collectAsStateWithLifecycle()
    val fieldDefs by vm.fieldDefs.collectAsStateWithLifecycle()
    val fieldValues by vm.fieldValues.collectAsStateWithLifecycle()
    val showFieldErrors by vm.showFieldErrors.collectAsStateWithLifecycle()
    val areaWarning by vm.areaWarning.collectAsStateWithLifecycle()
    val status = statuses.find { it.id == statusId }
    val photoMissing = vm.amends == null && photos.isEmpty()
    val amending = vm.amends != null

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (amending) "Correct visit" else "Record a visit") },
            navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            tree?.let { TreeIdText(it.physicalTreeId, "") }
            TreePhoto(treeMedia, vm::photo)
            areaWarning?.let { Notice(it, MaterialTheme.colorScheme.errorContainer) }
            if (amending) Notice("The original observation is kept and marked as superseded. Your correction is recorded with its reason.")
            StatusSelector(statuses, statusId, { vm.statusId.value = it }, label = "What do you see?")
            Text(
                if (amending) "The correction keeps the date and time of the original visit." else "Date and time are recorded automatically when you save.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(remarks, { vm.remarks.value = it }, label = { Text("Remarks") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            if (amending) OutlinedTextField(reason, { vm.reason.value = it }, label = { Text("Reason for correction") }, modifier = Modifier.fillMaxWidth())
            PhotoCapture(photos, vm.photoStore, onAdd = vm::addPhoto, onRemove = vm::removePhoto, required = photoMissing)
            if (SHOW_HEIGHT) HeightSection(height, { vm.height.value = it }, photos, referenceCm, vm::setReferenceCm)
            CustomFieldsForm(fieldDefs, fieldValues, vm::setField, showFieldErrors)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { vm.save(onDone) },
                enabled = statusId != null && !photoMissing && (!amending || reason.isNotBlank()),
                modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
            ) { Text("Save visit", style = MaterialTheme.typography.titleMedium) }
        }
    }
}

/**
 * A tree is expected where it was registered. If the officer's session is in another sector (or
 * sub-sector), the label may be misread or the tree record may be in the wrong area: say so before saving.
 */
internal suspend fun areaMismatch(db: TmsDatabase, t: com.teasoo.tms.data.local.TreeEntity, s: FieldSession?): String? {
    if (s == null || s.projectId != t.projectId) return null
    val ref = db.reference()
    fun name(code: String?, n: String?) = listOfNotNull(code, n).joinToString(" · ")
    return when {
        s.sectorId != t.sectorId -> {
            val registered = ref.sector(t.sectorId)
            val working = ref.sector(s.sectorId)
            "This tree was registered in sector ${name(registered?.shortCode, registered?.name)}, but you are working in sector " +
                "${name(working?.shortCode, working?.name)}. Check the label before saving."
        }
        s.subSectorId != t.subSectorId -> {
            val registered = ref.subSector(t.subSectorId)
            "This tree was registered in sub-sector ${name(registered?.shortCode, registered?.name)}, not the one you selected. Check the label."
        }
        else -> null
    }
}
