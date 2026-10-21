package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.repo.PhotoLoader
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.ui.Routes
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class TreeDetail(
    val tree: TreeEntity,
    val year: PlantingYearEntity?,
    val sector: SectorEntity?,
    val subSector: SubSectorEntity?,
    val species: SpeciesEntity?,
    val status: StatusEntity?,
    val original: TreeEntity?,
    val replacement: TreeEntity?,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class TreeDetailViewModel @Inject constructor(db: TmsDatabase, session: SessionStore, saved: SavedStateHandle, private val photos: PhotoLoader) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    private val ref = db.reference()
    val userId = flow { emit(session.userId()) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val isAdmin = session.state.map { (it as? SessionState.Active)?.user?.role == "ADMIN" }.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    val detail = db.trees().observe(id).filterNotNull().mapLatest { t ->
        TreeDetail(
            tree = t, year = ref.year(t.plantingYearId), sector = ref.sector(t.sectorId), subSector = ref.subSector(t.subSectorId),
            species = ref.species().first().find { it.id == t.speciesId }, status = t.currentStatusId?.let { ref.status(it) },
            original = t.replacesTreeId?.let { db.trees().get(it) }, replacement = db.trees().replacementOf(t.id),
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val observations = db.observations().forTree(id).stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val statuses = ref.statuses().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val media = db.media().forTree(id).stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /** All of the project's extra fields, including deactivated ones, to label stored values. */
    val fieldDefs = db.trees().observe(id).filterNotNull().map { it.projectId }.distinctUntilChanged()
        .flatMapLatest { ref.allCustomFields(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    suspend fun photo(m: MediaEntity, maxPx: Int) = photos.load(m, maxPx)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeDetailScreen(nav: NavController, onBack: () -> Unit, vm: TreeDetailViewModel = hiltViewModel()) {
    val d = vm.detail.collectAsStateWithLifecycle().value
    val observations by vm.observations.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()
    val media by vm.media.collectAsStateWithLifecycle()
    val userId by vm.userId.collectAsStateWithLifecycle()
    val isAdmin by vm.isAdmin.collectAsStateWithLifecycle()
    val fieldDefs by vm.fieldDefs.collectAsStateWithLifecycle()
    var correcting by remember { mutableStateOf(false) }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(d?.tree?.physicalTreeId ?: "", fontFamily = FontFamily.Monospace) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        if (d == null) return@Scaffold
        val t = d.tree
        val superseded = observations.mapNotNull { it.amendsObservationId }.toSet()
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { StatusChip(d.status?.code, d.status?.name); SyncBadge(t.syncState) }
            t.syncMessage?.let { Notice(it, MaterialTheme.colorScheme.errorContainer) }
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Field("Planting year", d.year?.yearLabel)
                    Field("Area", "${d.sector?.shortCode} · ${d.sector?.name} / ${d.subSector?.shortCode} · ${d.subSector?.name}")
                    Field("Species", d.species?.let { it.commonName ?: it.scientificName })
                    Field("Planted on", t.plantedOn)
                    Field("ID format", "version ${t.idSchemeVersion}")
                    t.notes?.let { Field("Notes", it) }
                    displayFields(fieldDefs.filter { it.appliesTo == "TREE" }, t.customFieldsJson).forEach { (label, value) -> Field(label, value) }
                    Field("Registered by", if (t.createdBy == userId) "you" else t.createdByName ?: "another user")
                    d.original?.let { o -> TextButton(onClick = { nav.navigate(Routes.tree(o.id)) }) { Text("Replaces ${o.physicalTreeId}") } }
                    d.replacement?.let { r -> TextButton(onClick = { nav.navigate(Routes.tree(r.id)) }) { Text("Replaced by ${r.physicalTreeId}") } }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { nav.navigate(Routes.observe(t.id)) }, enabled = t.recordState != "REJECTED") { Text("Add observation") }
                OutlinedButton(onClick = { nav.navigate(Routes.edit(t.id)) }, enabled = t.recordState == "ACTIVE") { Text("Edit") }
            }
            if (d.status?.allowsReplacement == true && d.replacement == null && t.recordState == "ACTIVE") {
                OutlinedButton(onClick = { nav.navigate(Routes.register(replaces = t.id)) }, modifier = Modifier.fillMaxWidth()) { Text("Plant a replacement tree") }
            }
            // Serial corrections are an administrator action on the server record (PRD: serials are immutable for officers).
            if (isAdmin && t.serverRevision != null && t.recordState != "REJECTED") {
                OutlinedButton(onClick = { correcting = true }, modifier = Modifier.fillMaxWidth()) { Text("Correct serial number") }
            }
            if (correcting) CorrectSerialDialog(t.id, t.physicalTreeId, t.serialNumber, onClose = { correcting = false })

            val heights = observations.filter { it.id !in superseded && it.heightCm != null }
                .mapNotNull { o -> runCatching { java.time.Instant.parse(o.observedAt) }.getOrNull()?.let { it to o.heightCm!! } }
            if (SHOW_HEIGHT && heights.isNotEmpty()) {
                Text("Growth", style = MaterialTheme.typography.titleMedium)
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        heights.maxByOrNull { it.first }?.let { (_, cm) -> Text("Latest height ${formatHeight(cm)}", style = MaterialTheme.typography.bodyMedium) }
                        GrowthChart(heights)
                    }
                }
            }

            Text("Observation history", style = MaterialTheme.typography.titleMedium)
            observations.forEach { o ->
                val s = statuses.find { it.id == o.statusId }
                val isSuperseded = o.id in superseded
                val photos = media.filter { it.observationId == o.id }
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip(s?.code, s?.name)
                            Text(formatInstant(o.observedAt), textDecoration = if (isSuperseded) TextDecoration.LineThrough else null)
                        }
                        if (o.isInitial) Text("Registration", style = MaterialTheme.typography.labelMedium)
                        if (o.amendsObservationId != null) Text("Correction: ${o.amendmentReason}", style = MaterialTheme.typography.labelMedium)
                        if (isSuperseded) Text("Superseded by a correction", style = MaterialTheme.typography.labelMedium)
                        Text(
                            "Recorded by ${if (o.recordedBy == userId) "you" else o.recordedByName ?: "another user"}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(VisitType.label(o.visitType), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        if (SHOW_HEIGHT) o.heightCm?.let { cm ->
                            Text("Height ${formatHeight(cm)}" + if (o.heightMethod == "PHOTO_REFERENCE") " · measured on photo" else "", style = MaterialTheme.typography.bodyMedium)
                        }
                        displayFields(fieldDefs.filter { it.appliesTo == "OBSERVATION" }, o.customFieldsJson).forEach { (label, value) ->
                            Text("$label: $value", style = MaterialTheme.typography.bodyMedium)
                        }
                        o.remarks?.let { Text(it) }
                        PhotoStrip(photos, vm::photo, if (SHOW_HEIGHT) HeightMeasurement.parse(o.heightMeasurementJson) else null)
                        if (photos.any { it.state != MediaState.VERIFIED }) Text(photos.joinToString { photoState(it) }, style = MaterialTheme.typography.bodySmall)
                        SyncBadge(o.syncState)
                        o.syncMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                        if (!isSuperseded && (o.recordedBy == userId) && t.recordState != "REJECTED") {
                            TextButton(onClick = { nav.navigate(Routes.observe(t.id, amends = o.id)) }) { Text("Correct this observation") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String?) {
    Row { Text("$label: ", style = MaterialTheme.typography.bodyMedium); Text(value ?: "—", style = MaterialTheme.typography.bodyMedium) }
}

private fun photoState(m: MediaEntity) = when {
    m.state == MediaState.VERIFIED && m.localPath == null -> "photo stored on server"
    m.state == MediaState.VERIFIED -> "photo verified"
    m.state == MediaState.FAILED -> "photo will be re-sent"
    else -> "photo waiting to upload"
}
