package com.teasoo.tms.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.domain.TreeIdAssembler
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.Picker
import com.teasoo.tms.ui.components.StatusChip
import com.teasoo.tms.ui.components.SyncBadge
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class TreesViewModel @Inject constructor(private val db: TmsDatabase, private val photos: com.teasoo.tms.data.repo.PhotoLoader) : ViewModel() {
    val projectId = MutableStateFlow<String?>(null)
    val query = MutableStateFlow("")
    val subSectorId = MutableStateFlow<String?>(null)
    val subSectors = projectId.filterNotNull().flatMapLatest { db.reference().subSectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val rows = combine(projectId.filterNotNull(), query.debounce(200), subSectorId) { p, q, s -> Triple(p, q, s) }
        .flatMapLatest { (p, q, s) -> db.trees().search(p, TreeIdAssembler.normalize(q), s) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    suspend fun latestPhoto(treeId: String) = db.media().latestFor(treeId)
    suspend fun photo(m: com.teasoo.tms.data.local.MediaEntity, maxPx: Int) = photos.load(m, maxPx)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreesScreen(app: AppViewModel, onOpen: (String) -> Unit, onBack: () -> Unit, vm: TreesViewModel = hiltViewModel()) {
    val projectId by app.selectedProjectId.collectAsStateWithLifecycle()
    LaunchedEffect(projectId) { vm.projectId.value = projectId }
    val query by vm.query.collectAsStateWithLifecycle()
    val rows by vm.rows.collectAsStateWithLifecycle()
    val subs by vm.subSectors.collectAsStateWithLifecycle()
    val sub by vm.subSectorId.collectAsStateWithLifecycle()
    Scaffold(topBar = {
        TopAppBar(title = { Text("Find a tree") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 16.dp)) {
            OutlinedTextField(
                query, { vm.query.value = it }, label = { Text("Type the tree number") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
            )
            Text("Tap a tree to see it and record a visit.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(8.dp))
            Picker("Sub-sector", listOf<com.teasoo.tms.data.local.SubSectorEntity?>(null) + subs, subs.find { it.id == sub },
                { it?.let { s -> "${s.shortCode} · ${s.name}" } ?: "All sub-sectors" }, { vm.subSectorId.value = it?.id })
            Text("${rows.size}${if (rows.size == 500) "+" else ""} trees on this device", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 8.dp))
            LazyColumn {
                items(rows, key = { it.id }) { t ->
                    ListItem(
                        modifier = Modifier.clickable { onOpen(t.id) },
                        leadingContent = { com.teasoo.tms.ui.components.TreeThumb(t.id, vm::latestPhoto, vm::photo) },
                        headlineContent = { Text(t.physicalTreeId, fontFamily = FontFamily.Monospace) },
                        supportingContent = {
                            Column {
                                Text("${t.yearLabel} · ${t.sectorCode}/${t.subSectorCode} · ${t.speciesName}" + if (t.replacesTreeId != null) " · replacement" else "")
                                SyncBadge(t.syncState)
                            }
                        },
                        trailingContent = { StatusChip(t.statusCode, t.statusName) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
