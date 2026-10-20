package com.teasoo.tms.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.sync.SyncScheduler
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.formatInstant
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Online oversight for administrators (dashboard, conflicts, ID corrections) and the read-only
 * dashboard for executives. Configuration (projects, ID formats, areas, users) stays in the web
 * portal, as the PRD assigns it; these screens link there.
 */
@HiltViewModel
class OversightViewModel @Inject constructor(@ApplicationContext private val context: Context, private val api: TmsApi) : ViewModel() {
    val summary = MutableStateFlow<ReportSummary?>(null)
    val conflicts = MutableStateFlow<List<ConflictDto>?>(null)
    val error = MutableStateFlow<String?>(null)
    val loading = MutableStateFlow(false)

    fun loadSummary(projectId: String?) = load { summary.value = api.summary(projectId) }
    fun loadConflicts() = load { conflicts.value = api.conflicts() }

    fun resolve(conflict: ConflictDto, resolution: String, serial: String?, notes: String, onDone: () -> Unit) = load {
        api.resolveConflict(conflict.id, ResolveConflictRequest(resolution, notes, serial?.ifBlank { null }))
        conflicts.value = api.conflicts()
        SyncScheduler.syncNow(context) // bring the resolved records down to this device
        onDone()
    }

    private fun load(block: suspend () -> Unit) = viewModelScope.launch {
        loading.value = true
        error.value = null
        try {
            block()
        } catch (e: Throwable) {
            error.value = when (val f = e.toApiFailure()) {
                is ApiFailure.Offline -> "This needs a connection to the server. Field records keep working offline."
                else -> f.message
            }
        } finally {
            loading.value = false
        }
    }
}

fun openPortal(context: Context, path: String = "") {
    if (BuildConfig.PORTAL_URL.isBlank()) return
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.PORTAL_URL.trimEnd('/') + path)))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(app: AppViewModel, onBack: (() -> Unit)?, actions: @Composable RowScope.() -> Unit = {}, vm: OversightViewModel = hiltViewModel()) {
    val projectId by app.selectedProjectId.collectAsStateWithLifecycle()
    val projects by app.projects.collectAsStateWithLifecycle()
    val summary by vm.summary.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(projectId) { vm.loadSummary(projectId) }

    Scaffold(topBar = {
        TopAppBar(
            title = { Column { Text("Dashboard"); Text(projects.find { it.id == projectId }?.name ?: "All my projects", style = MaterialTheme.typography.bodySmall) } },
            navigationIcon = { onBack?.let { IconButton(onClick = it) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } } },
            actions = {
                TextButton(onClick = { vm.loadSummary(projectId) }, enabled = !loading) { Text("Refresh") }
                actions()
            },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loading && summary == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Notice(it, MaterialTheme.colorScheme.errorContainer) }
            summary?.let { s ->
                Text("Server data as of ${formatInstant(s.lastServerSyncAt)}. Records still on field devices appear after they sync.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Planting events", s.totals.plantingEvents, Modifier.weight(1f))
                    Stat("Original trees", s.totals.originalTrees, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Replacements", s.totals.replacementTrees, Modifier.weight(1f))
                    Stat("Dead or missing", s.totals.terminalStatusTrees, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Unknown / overdue", s.totals.overdueUnknownTrees, Modifier.weight(1f), "No observation in ${s.overdueDays} days")
                    Stat("Open conflicts", s.completeness.openConflicts, Modifier.weight(1f))
                }
                Section("Registered trees by current status") {
                    val max = (s.byStatus.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1)
                    s.byStatus.forEach { row -> BarRow(row.name, row.count, max) }
                }
                Section("By planting year") {
                    s.byPlantingYear.forEach { y -> LabelValue(y.name, "${y.originalTrees} original · ${y.replacementTrees} replacement") }
                }
                Section("Data completeness") {
                    LabelValue("Never observed", s.completeness.neverObserved.toString())
                    LabelValue("Missing planted date", s.completeness.missingPlantedOn.toString())
                    LabelValue("Photos not yet verified", s.completeness.unverifiedPhotos.toString())
                    LabelValue("Devices not synced in 7 days", s.completeness.devicesNotSynced.toString())
                }
                if (s.officers.isNotEmpty()) Section("Field officer activity (30 days)") {
                    s.officers.forEach { o -> LabelValue(o.fullName, "${o.trees} trees · ${o.observations} obs · sync ${formatInstant(o.lastSyncAt)}") }
                }
                s.notes.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
            }
            if (BuildConfig.PORTAL_URL.isNotBlank()) {
                OutlinedButton(onClick = { openPortal(context) }, modifier = Modifier.fillMaxWidth()) { Text("Open the web portal for full reports and exports") }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: Int, modifier: Modifier, foot: String? = null) {
    OutlinedCard(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            foot?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            content()
        }
    }
}

/** Single-series bar with the value printed beside it, so nothing depends on colour alone. */
@Composable
private fun BarRow(label: String, value: Int, max: Int) {
    Column {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Text(value.toString(), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        }
        LinearProgressIndicator(progress = { value.toFloat() / max }, modifier = Modifier.fillMaxWidth(), drawStopIndicator = {})
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

// ---------------------------------------------------------------- conflicts

private val CONFLICT_LABEL = mapOf(
    "DUPLICATE_PHYSICAL_ID" to "Duplicate tree ID",
    "DUPLICATE_SERIAL" to "Duplicate serial in scope",
    "DUPLICATE_REPLACEMENT" to "Tree replaced twice",
    "REVISION_MISMATCH" to "Concurrent edit",
)

/** resolution code, label, needs a corrected serial */
private fun resolutionsFor(type: String): List<Triple<String, String, Boolean>> = when (type) {
    "DUPLICATE_REPLACEMENT" -> listOf(
        Triple("KEEP_UNLINKED", "Keep the incoming tree as an ordinary tree, not a replacement", false),
        Triple("REJECT_INCOMING", "Set the incoming submission aside (kept, not deleted)", false),
    )
    "REVISION_MISMATCH" -> listOf(
        Triple("APPLY_INCOMING_CHANGES", "Apply the incoming edit on top of the current record", false),
        Triple("KEEP_EXISTING", "Keep the current record and discard the incoming edit", false),
    )
    else -> listOf(
        Triple("CORRECT_INCOMING_SERIAL", "The incoming label was mis-keyed: give it the correct serial", true),
        Triple("CORRECT_EXISTING_SERIAL", "The existing record is wrong: correct its serial, then add the incoming tree", true),
        Triple("REJECT_INCOMING", "Set the incoming submission aside (kept, not deleted)", false),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConflictsScreen(onOpenTree: (String) -> Unit, onBack: () -> Unit, vm: OversightViewModel = hiltViewModel()) {
    val conflicts by vm.conflicts.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    var resolving by remember { mutableStateOf<ConflictDto?>(null) }
    LaunchedEffect(Unit) { vm.loadConflicts() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Sync conflicts") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = { TextButton(onClick = { vm.loadConflicts() }, enabled = !loading) { Text("Refresh") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 16.dp)) {
            Text("Submissions that collided at sync are never overwritten. Both records stay until you decide; every decision is audited.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 8.dp))
            if (loading && conflicts == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Notice(it, MaterialTheme.colorScheme.errorContainer) }
            if (conflicts?.isEmpty() == true) Text("No open conflicts.", Modifier.padding(16.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(conflicts.orEmpty(), key = { it.id }) { c ->
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(CONFLICT_LABEL[c.type] ?: c.type, style = MaterialTheme.typography.titleSmall)
                            Text("${c.projectName.orEmpty()} · ${formatInstant(c.createdAt)} · ${c.submittedBy.orEmpty()}", style = MaterialTheme.typography.bodySmall)
                            Row { Text("Incoming: "); Text(c.incomingPhysicalId.orEmpty(), fontFamily = FontFamily.Monospace) }
                            c.existingPhysicalId?.let { Row { Text("Existing: "); Text(it, fontFamily = FontFamily.Monospace) } }
                            Row {
                                TextButton(onClick = { onOpenTree(c.incomingTreeId) }) { Text("Incoming tree") }
                                c.existingTreeId?.let { id -> TextButton(onClick = { onOpenTree(id) }) { Text("Existing tree") } }
                                Spacer(Modifier.weight(1f))
                                Button(onClick = { resolving = c }) { Text("Resolve") }
                            }
                        }
                    }
                }
            }
        }
    }
    resolving?.let { c -> ResolveDialog(c, vm, onClose = { resolving = null }) }
}

@Composable
private fun ResolveDialog(c: ConflictDto, vm: OversightViewModel, onClose: () -> Unit) {
    val options = resolutionsFor(c.type)
    var choice by remember { mutableStateOf<String?>(null) }
    var serial by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    val error by vm.error.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val needsSerial = options.find { it.first == choice }?.third == true
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(CONFLICT_LABEL[c.type] ?: "Resolve") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                options.forEach { (code, label, _) ->
                    Row(Modifier.fillMaxWidth().selectable(selected = choice == code, onClick = { choice = code }), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = choice == code, onClick = { choice = code })
                        Text(label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (needsSerial) {
                    OutlinedTextField(serial, { serial = it.filter(Char::isDigit) }, label = { Text("Corrected serial") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                }
                OutlinedTextField(notes, { notes = it }, label = { Text("Reason (kept in the audit log)") })
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(
                onClick = { vm.resolve(c, choice!!, serial.takeIf { needsSerial }, notes, onClose) },
                enabled = !loading && choice != null && notes.trim().length >= 3 && (!needsSerial || serial.isNotBlank()),
            ) { Text("Resolve") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- serial correction (administrators)

@HiltViewModel
class CorrectionViewModel @Inject constructor(@ApplicationContext private val context: Context, private val api: TmsApi) : ViewModel() {
    val error = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)

    fun correct(treeId: String, serial: String, reason: String, onDone: () -> Unit) = viewModelScope.launch {
        busy.value = true
        error.value = null
        try {
            api.correctSerial(treeId, SerialCorrectionRequest(serial, reason))
            SyncScheduler.syncNow(context)
            onDone()
        } catch (e: Throwable) {
            error.value = when (val f = e.toApiFailure()) {
                is ApiFailure.Offline -> "ID corrections need a connection to the server."
                else -> f.message
            }
        } finally {
            busy.value = false
        }
    }
}

@Composable
fun CorrectSerialDialog(treeId: String, physicalId: String, currentSerial: String, onClose: () -> Unit, vm: CorrectionViewModel = hiltViewModel()) {
    var serial by remember { mutableStateOf(currentSerial.trimStart('0')) }
    var reason by remember { mutableStateOf("") }
    val error by vm.error.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Correct the serial") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Currently $physicalId. The old ID is kept in the tree’s history and the change is audited.", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(serial, { serial = it.filter(Char::isDigit) }, label = { Text("Correct serial") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                OutlinedTextField(reason, { reason = it }, label = { Text("Reason") })
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { vm.correct(treeId, serial, reason, onClose) }, enabled = !busy && serial.isNotBlank() && reason.trim().length >= 5) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}
