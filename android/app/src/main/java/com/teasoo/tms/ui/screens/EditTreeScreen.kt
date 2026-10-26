package com.teasoo.tms.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
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
import com.teasoo.tms.data.repo.RegistrationException
import com.teasoo.tms.data.repo.TreeRepository
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
class EditTreeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: TmsDatabase,
    private val trees: TreeRepository,
    saved: SavedStateHandle,
) : ViewModel() {
    private val treeId: String = checkNotNull(saved["treeId"])
    val species = db.reference().species().map { l -> l.filter { it.active } }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val speciesId = MutableStateFlow<String?>(null)
    /** Not editable on the phone any more; sent back unchanged. */
    private var plantedOn: String? = null
    val notes = MutableStateFlow("")
    val physicalId = MutableStateFlow("")
    val fieldDefs = MutableStateFlow<List<com.teasoo.tms.data.local.CustomFieldEntity>>(emptyList())
    val fieldValues = MutableStateFlow<Map<String, String>>(emptyMap())
    private var originalFields = "{}"
    val error = MutableStateFlow<String?>(null)

    init {
        viewModelScope.launch {
            db.trees().get(treeId)?.let { t ->
                speciesId.value = t.speciesId
                plantedOn = t.plantedOn
                notes.value = t.notes.orEmpty()
                physicalId.value = t.physicalTreeId
                fieldDefs.value = db.reference().customFields(t.projectId, "TREE").first()
                fieldValues.value = storedFieldText(t.customFieldsJson)
                originalFields = t.customFieldsJson
            }
        }
    }

    fun save(onDone: () -> Unit) = viewModelScope.launch {
        try {
            // Values of deactivated fields are kept; only the editable ones are replaced.
            val edited = toFieldValues(fieldDefs.value, fieldValues.value)
            val keep = (com.teasoo.tms.data.remote.TmsJson.parseToJsonElement(originalFields) as kotlinx.serialization.json.JsonObject)
                .filterKeys { k -> fieldDefs.value.none { it.key == k } }
                .mapNotNull { (k, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.let { k to it } }.toMap()
            val fields = keep + edited
            trees.updateTree(treeId, speciesId.value, plantedOn, notes.value.ifBlank { null }, fields)
            SyncScheduler.syncNow(context)
            onDone()
        } catch (e: RegistrationException) {
            error.value = e.message
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditTreeScreen(app: AppViewModel, onDone: () -> Unit, vm: EditTreeViewModel = hiltViewModel()) {
    val species by vm.species.collectAsStateWithLifecycle()
    val speciesId by vm.speciesId.collectAsStateWithLifecycle()
    val notes by vm.notes.collectAsStateWithLifecycle()
    val physicalId by vm.physicalId.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    Scaffold(topBar = {
        TopAppBar(title = { Text("Edit tree") }, navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TreeIdText(physicalId, "")
            SpeciesChooser(species, speciesId, { vm.speciesId.value = it })
            OutlinedTextField(notes, { vm.notes.value = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            val fieldDefs by vm.fieldDefs.collectAsStateWithLifecycle()
            val fieldValues by vm.fieldValues.collectAsStateWithLifecycle()
            CustomFieldsForm(fieldDefs, fieldValues, { k, v -> vm.fieldValues.value = vm.fieldValues.value + (k to v) })
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = { vm.save(onDone) }, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) { Text("Save on this device", style = MaterialTheme.typography.titleMedium) }
        }
    }
}
