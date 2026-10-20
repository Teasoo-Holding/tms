package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.OutboxEntity
import com.teasoo.tms.data.local.OutboxState
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.formatInstant
import dagger.hilt.android.lifecycle.HiltViewModel
import com.teasoo.tms.data.repo.BackupExporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SyncViewModel @Inject constructor(
    private val db: TmsDatabase,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val backup: BackupExporter,
) : ViewModel() {
    val backupMessage = MutableStateFlow<String?>(null)
    fun backupName() = backup.fileName()

    /** Writes the backup to the file the officer chose (Downloads, Drive, a USB stick…). */
    fun exportBackup(uri: android.net.Uri) = viewModelScope.launch {
        backupMessage.value = runCatching {
            val summary = context.contentResolver.openOutputStream(uri)!!.use { backup.export(it) }
            "Backup saved: ${summary.operations} records waiting to sync, ${summary.photos} photos. Nothing was removed from the phone."
        }.getOrElse { "The backup could not be written: ${it.message}" }
    }

    val outbox = db.outbox().all().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /** Removes a conflict/rejection notice; the record and its history stay on the device and the server. */
    fun dismiss(op: OutboxEntity) = viewModelScope.launch { db.outbox().dismiss(op.operationId) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncScreen(app: AppViewModel, onOpenTree: (String) -> Unit, onBack: () -> Unit, vm: SyncViewModel = hiltViewModel()) {
    val sync by app.sync.collectAsStateWithLifecycle()
    val outbox by vm.outbox.collectAsStateWithLifecycle()
    val backupMessage by vm.backupMessage.collectAsStateWithLifecycle()
    val saveBackup = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri -> uri?.let(vm::exportBackup) }
    Scaffold(topBar = {
        TopAppBar(title = { Text("Sync details") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        LazyColumn(Modifier.padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${sync.pendingOperations} records waiting · ${sync.unsentPhotos} photos waiting · ${sync.needsAttention} need attention")
                    Text("Last successful sync: ${formatInstant(sync.lastSuccess)}", style = MaterialTheme.typography.bodySmall)
                    sync.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Button(onClick = app::syncNow, enabled = !sync.running) { Text(if (sync.running) "Syncing…" else "Retry now") }
                    Notice("Photos stay on this device for 30 days after the server confirms they are stored, intact, and attached to the right tree.")
                    OutlinedButton(onClick = { saveBackup.launch(vm.backupName()) }) { Text("Export backup") }
                    Text(
                        "Saves every record and photo not yet sent into one file you can copy off the phone, in case the phone cannot sync.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    backupMessage?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
                }
            }
            items(outbox, key = { it.operationId }) { op ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${label(op)} · ${formatInstant(op.clientRecordedAt)}", style = MaterialTheme.typography.titleSmall)
                        Text(
                            when (op.state) {
                                OutboxState.CONFLICT -> "Conflict: ${op.lastError}"
                                OutboxState.REJECTED -> "Rejected: ${op.lastError}"
                                else -> if (op.attempts == 0) "Waiting to send" else "Will retry (attempt ${op.attempts}): ${op.lastError}"
                            },
                            color = if (op.state == OutboxState.PENDING) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
                        )
                        Row {
                            if (op.entityType == "tree") TextButton(onClick = { onOpenTree(op.entityId) }) { Text("Open tree") }
                            if (op.state != OutboxState.PENDING) TextButton(onClick = { vm.dismiss(op) }) { Text("Dismiss notice") }
                        }
                    }
                }
            }
        }
    }
}

private fun label(op: OutboxEntity) = when ("${op.entityType}:${op.operationType}") {
    "tree:create" -> "Tree registration"
    "tree:update" -> "Tree edit"
    "observation:amendment" -> "Observation correction"
    else -> "Observation"
}
