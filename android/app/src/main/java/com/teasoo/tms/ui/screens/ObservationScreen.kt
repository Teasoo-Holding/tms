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

@HiltViewModel
class ObservationViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    db: TmsDatabase,
    private val trees: TreeRepository,
    private val session: SessionStore,
    val photoStore: PhotoStore,
    saved: SavedStateHandle,
) : ViewModel() {
    val treeId: String = checkNotNull(saved["treeId"])
    val amends: String? = saved["amends"]
    val tree = flow { emit(db.trees().get(treeId)) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val amended = flow { emit(amends?.let { db.observations().get(it) }) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val statuses = db.reference().statuses().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val statusId = MutableStateFlow<String?>(null)
    val date = MutableStateFlow(LocalDate.now())
    val remarks = MutableStateFlow("")
    val reason = MutableStateFlow("")
    val photos = MutableStateFlow<List<CapturedPhoto>>(emptyList())
    val error = MutableStateFlow<String?>(null)
    private var saved = false

    init {
        viewModelScope.launch {
            amended.filterNotNull().first().let { o ->
                statusId.value = o.statusId
                date.value = java.time.Instant.parse(o.observedAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                remarks.value = o.remarks.orEmpty()
            }
        }
    }

    fun save(onDone: () -> Unit) = viewModelScope.launch {
        error.value = null
        try {
            trees.addObservation(
                treeId = treeId,
                statusId = statusId.value ?: throw RegistrationException("Choose a status."),
                observedAt = observedInstant(date.value),
                remarks = remarks.value.ifBlank { null },
                photos = photos.value,
                userId = session.userId() ?: throw RegistrationException("Sign in again to save."),
                amendsObservationId = amends,
                amendmentReason = reason.value.ifBlank { null },
            )
            saved = true
            SyncScheduler.syncNow(context)
            onDone()
        } catch (e: RegistrationException) {
            error.value = e.message
        }
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
    val date by vm.date.collectAsStateWithLifecycle()
    val remarks by vm.remarks.collectAsStateWithLifecycle()
    val reason by vm.reason.collectAsStateWithLifecycle()
    val photos by vm.photos.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var camera by remember { mutableStateOf(false) }
    val status = statuses.find { it.id == statusId }
    val photoMissing = status?.requiresPhoto == true && photos.isEmpty()
    val amending = vm.amends != null

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (amending) "Correct observation" else "New observation") },
            navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            tree?.let { TreeIdText(it.physicalTreeId, "") }
            if (amending) Notice("The original observation is kept and marked as superseded. Your correction is recorded with its reason.")
            Text("What do you see?", style = MaterialTheme.typography.titleSmall)
            // One tap per tree: statuses as chips rather than a dropdown.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                statuses.forEach { st -> FilterChip(selected = st.id == statusId, onClick = { vm.statusId.value = st.id }, label = { Text(st.name) }) }
            }
            status?.takeIf { it.requiresPhoto }?.let { Text("“${it.name}” needs a photo.", style = MaterialTheme.typography.bodySmall) }
            DateField("Observed on", date, { vm.date.value = it ?: LocalDate.now() }, allowClear = false)
            OutlinedTextField(remarks, { vm.remarks.value = it }, label = { Text("Remarks") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            if (amending) OutlinedTextField(reason, { vm.reason.value = it }, label = { Text("Reason for correction") }, modifier = Modifier.fillMaxWidth())
            PhotoRow(photos, onAdd = { camera = true }, onRemove = { p -> vm.photoStore.discard(p); vm.photos.value = vm.photos.value - p }, required = photoMissing)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { vm.save(onDone) },
                enabled = statusId != null && !photoMissing && (!amending || reason.isNotBlank()),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save on this device") }
        }
    }
    if (camera) CameraCaptureDialog(vm.photoStore, onCaptured = { vm.photos.value = vm.photos.value + it; camera = false }, onDismiss = { camera = false })
}
