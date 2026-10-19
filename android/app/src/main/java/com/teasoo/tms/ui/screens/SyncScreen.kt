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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SyncViewModel @Inject constructor(private val db: TmsDatabase) : ViewModel() {
    val outbox = db.outbox().all().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /** Removes a conflict/rejection notice; the record and its history stay on the device and the server. */
    fun dismiss(op: OutboxEntity) = viewModelScope.launch { db.outbox().dismiss(op.operationId) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncScreen(app: AppViewModel, onOpenTree: (String) -> Unit, onBack: () -> Unit, vm: SyncViewModel = hiltViewModel()) {
    val sync by app.sync.collectAsStateWithLifecycle()
    val outbox by vm.outbox.collectAsStateWithLifecycle()
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
                    Notice("Photos are deleted from this device only after the server confirms they are stored, intact, and attached to the right tree.")
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
