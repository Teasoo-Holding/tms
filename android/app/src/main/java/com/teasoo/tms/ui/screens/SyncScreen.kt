package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
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
    private val engine: com.teasoo.tms.sync.SyncEngine,
    private val backups: com.teasoo.tms.data.repo.LocalBackups,
) : ViewModel() {
    val backupMessage = MutableStateFlow<String?>(null)

    /** Removes this phone's copies of photos the server has verified (never unsent ones). */
    fun freeUpSpace() = viewModelScope.launch {
        backupMessage.value = runCatching {
            val freed = engine.cleanupMedia(now = true)
            if (freed == 0L) "Nothing to free: photos are removed only after the server has them." else "Freed ${"%.1f".format(freed / 1_048_576.0)} MB."
        }.getOrElse { "Could not free space: ${it.message}" }
    }

    /** Puts records from a backup file back in the queue; the server skips what it already has. */
    fun restore(uri: android.net.Uri) = viewModelScope.launch {
        backupMessage.value = runCatching {
            val r = backups.restore(uri)
            com.teasoo.tms.sync.SyncScheduler.syncNow(context)
            "Restored ${r.operations} records and ${r.photos} photos. They will be sent at the next sync."
        }.getOrElse { it.message ?: "This file could not be restored." }
    }
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
    val openBackup = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let(vm::restore) }
    var more by remember { mutableStateOf(false) }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Ready to send") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = {
                IconButton(onClick = { more = true }) { Icon(Icons.Default.MoreVert, "More") }
                DropdownMenu(more, { more = false }) {
                    DropdownMenuItem(text = { Text("Free up space") }, onClick = { more = false; vm.freeUpSpace() })
                    DropdownMenuItem(text = { Text("Export backup") }, onClick = { more = false; saveBackup.launch(vm.backupName()) })
                    DropdownMenuItem(text = { Text("Restore from backup") }, onClick = { more = false; openBackup.launch(arrayOf("application/zip", "application/octet-stream")) })
                }
            },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                    Text(
                        if (sync.pendingOperations + sync.unsentPhotos == 0) "Everything is sent."
                        else "${sync.pendingOperations} records · ${sync.unsentPhotos} photos",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text("Last sync ${formatInstant(sync.lastSuccess)}", style = MaterialTheme.typography.bodyMedium)
                    sync.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    Button(onClick = app::syncNow, enabled = !sync.running, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                        Text(if (sync.running) "Sending…" else "Send now")
                    }
                    backupMessage?.let { Notice(it) }
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
