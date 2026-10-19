package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.Routes
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.Picker
import com.teasoo.tms.ui.components.formatInstant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: AppViewModel, nav: NavController) {
    val session = vm.sessionState.collectAsStateWithLifecycle().value as? SessionState.Active ?: return
    val projects by vm.projects.collectAsStateWithLifecycle()
    val selected by vm.selectedProjectId.collectAsStateWithLifecycle()
    val sync by vm.sync.collectAsStateWithLifecycle()
    val treeCount by vm.treeCount.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("TMS Field") },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.AccountCircle, contentDescription = "Account") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text(session.user.fullName) }, onClick = {}, enabled = false)
                        DropdownMenuItem(text = { Text("Sign out") }, onClick = { menu = false; vm.signOut() })
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (projects.isEmpty()) {
                Notice(if (sync.lastSuccess == null) "Downloading your projects… Stay connected for the first sync." else "You are not assigned to any project yet. Ask an administrator.")
            } else {
                Picker("Project", projects, projects.find { it.id == selected }, { "${it.name} (${it.shortCode})" }, { vm.selectProject(it.id) })
                Text("$treeCount trees on this device", style = MaterialTheme.typography.bodyMedium)
            }
            if (sync.lowStorage) Notice("Storage is running low. Sync to offload verified photos, or free up space on the device.", MaterialTheme.colorScheme.errorContainer)

            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Sync", style = MaterialTheme.typography.titleMedium)
                    Text(
                        when {
                            sync.pendingOperations == 0 && sync.unsentPhotos == 0 -> "Everything on this device has been sent."
                            else -> "${sync.pendingOperations} records and ${sync.unsentPhotos} photos waiting to send."
                        },
                    )
                    sync.oldestPending?.let { Text("Oldest unsent: ${formatInstant(it)}", style = MaterialTheme.typography.bodySmall) }
                    Text("Last successful sync: ${formatInstant(sync.lastSuccess)}", style = MaterialTheme.typography.bodySmall)
                    if (sync.needsAttention > 0) Text("${sync.needsAttention} items need attention (conflicts or rejections).", color = MaterialTheme.colorScheme.error)
                    if (sync.failedPhotos > 0) Text("${sync.failedPhotos} photos failed verification and will be re-sent.", style = MaterialTheme.typography.bodySmall)
                    sync.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Text("Offline access until ${formatInstant(session.offlineValidUntil.toString())}", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        Button(onClick = vm::syncNow, enabled = !sync.running) { Text(if (sync.running) "Syncing…" else "Sync now") }
                        OutlinedButton(onClick = { nav.navigate(Routes.SYNC) }) { Text("Details") }
                    }
                }
            }

            if (selected != null) {
                HomeAction(Icons.Default.Add, "Register a tree", "Enter the serial from its label") { nav.navigate(Routes.register()) }
                HomeAction(Icons.Default.Search, "Find a tree", "Record an observation, edit, or plant a replacement") { nav.navigate(Routes.TREES) }
                HomeAction(Icons.Default.Map, "Area map", "Sector and sub-sector boundaries") { nav.navigate(Routes.MAP) }
            }
        }
    }
}

@Composable
private fun HomeAction(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = { Text(title) },
            supportingContent = { Text(subtitle) },
            leadingContent = { Icon(icon, contentDescription = null) },
        )
    }
}
