package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.Routes
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.formatInstant

private fun roleLabel(role: String) = when (role) {
    "ADMIN" -> "Administrator"
    "EXECUTIVE" -> "Executive"
    else -> "Field officer"
}

/**
 * Home screen by role (PRD §4): executives get the read-only dashboard; field officers and administrators
 * work inside a field session, and administrators also get the oversight tools that need a connection.
 */
@Composable
fun HomeScreen(vm: AppViewModel, nav: NavController) {
    val session = vm.sessionState.collectAsStateWithLifecycle().value as? SessionState.Active ?: return
    if (session.user.role == "EXECUTIVE") {
        DashboardScreen(vm, onBack = null, actions = { AccountMenu(session, vm) })
    } else {
        FieldHome(vm, nav, session)
    }
}

@Composable
private fun AccountMenu(session: SessionState.Active, vm: AppViewModel) {
    var menu by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }
    val sync by vm.sync.collectAsStateWithLifecycle()
    val unsent = sync.pendingOperations + sync.unsentPhotos
    IconButton(onClick = { menu = true }) { Icon(Icons.Default.AccountCircle, contentDescription = "Account") }
    DropdownMenu(menu, { menu = false }) {
        DropdownMenuItem(text = { Text("${session.user.fullName}\n${roleLabel(session.user.role)}") }, onClick = {}, enabled = false)
        DropdownMenuItem(text = { Text("Sign out") }, onClick = { menu = false; if (unsent > 0) blocked = true else vm.signOut() })
    }
    // Every record must reach the server under the account that entered it before anyone signs out.
    if (blocked) {
        AlertDialog(
            onDismissRequest = { blocked = false },
            title = { Text("Sync before signing out") },
            text = {
                Text("${sync.pendingOperations} records and ${sync.unsentPhotos} photos on this phone have not reached the server yet. " +
                    "Connect to the internet and sync; you can sign out once everything is sent.")
            },
            confirmButton = { Button(onClick = { vm.syncNow(); blocked = false }, enabled = !sync.running) { Text("Sync now") } },
            dismissButton = { TextButton(onClick = { blocked = false }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FieldHome(vm: AppViewModel, nav: NavController, session: SessionState.Active, fs: FieldSessionViewModel = hiltViewModel()) {
    val isAdmin = session.user.role == "ADMIN"
    val projects by vm.projects.collectAsStateWithLifecycle()
    val sync by vm.sync.collectAsStateWithLifecycle()
    val ctx by fs.context.collectAsStateWithLifecycle()
    val trees by fs.treesThisSession.collectAsStateWithLifecycle()
    val observations by fs.observationsThisSession.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Search and the area map follow the session's project.
    LaunchedEffect(ctx?.session?.projectId) { ctx?.session?.projectId?.let { vm.selectProject(it) } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("TMS Field")
                        Text("${session.user.fullName} · ${roleLabel(session.user.role)}", style = MaterialTheme.typography.labelMedium)
                    }
                },
                actions = { AccountMenu(session, vm) },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (sync.lowStorage) Notice("Storage is running low. Sync to offload verified photos, or free up space on the device.", MaterialTheme.colorScheme.errorContainer)

            val c = ctx
            when {
                projects.isEmpty() -> Notice(
                    if (sync.lastSuccess == null) "Downloading your projects… Stay connected for the first sync."
                    else if (isAdmin) "No projects yet. Create one in the web portal, then sync."
                    else "You are not assigned to any project yet. Ask an administrator.",
                )
                c == null -> ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Going to the field?", style = MaterialTheme.typography.titleMedium)
                        Text("Pick the project, planting year and sector once. Everything you record today is filed under them until you change.",
                            style = MaterialTheme.typography.bodyMedium)
                        Button(onClick = { nav.navigate(Routes.SESSION_SETUP) }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Start field session")
                        }
                    }
                }
                else -> SessionContextCard(
                    ctx = c, trees = trees, observations = observations,
                    onSwitchSubSector = fs::switchSubSector,
                    onChange = { nav.navigate(Routes.SESSION_SETUP) },
                    onEnd = { fs.end() },
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        BigAction(Icons.Default.AddCircle, "Register trees", Modifier.weight(1f), enabled = !c.stale) { nav.navigate(Routes.SESSION_REGISTER) }
                        BigAction(Icons.Default.Checklist, "Visit trees", Modifier.weight(1f), enabled = !c.stale) { nav.navigate(Routes.SESSION_VISIT) }
                    }
                }
            }

            SyncCard(vm, session, onDetails = { nav.navigate(Routes.SYNC) })

            if (projects.isNotEmpty()) {
                HomeAction(Icons.Default.Search, "Find any tree", "Search across the project: observe, edit, or plant a replacement") { nav.navigate(Routes.TREES) }
                HomeAction(Icons.Default.Map, "Area map", "Sector and sub-sector boundaries") { nav.navigate(Routes.MAP) }
            }

            if (isAdmin) {
                Text("Administration", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                Text("These need a connection. Projects, ID formats, areas, users and assignments are set up in the web portal.",
                    style = MaterialTheme.typography.bodySmall)
                HomeAction(Icons.Default.Dashboard, "Dashboard", "Progress, survival by status, data completeness") { nav.navigate(Routes.ADMIN_DASHBOARD) }
                HomeAction(Icons.Default.Warning, "Conflicts", "Resolve duplicate tree IDs reported by sync") { nav.navigate(Routes.ADMIN_CONFLICTS) }
                if (BuildConfig.PORTAL_URL.isNotBlank()) {
                    HomeAction(Icons.Default.OpenInBrowser, "Open web portal", "Configuration, users, reports and exports") { openPortal(context) }
                }
            }
        }
    }
}

@Composable
private fun SyncCard(vm: AppViewModel, session: SessionState.Active, onDetails: () -> Unit) {
    val sync by vm.sync.collectAsStateWithLifecycle()
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        if (sync.pendingOperations == 0 && sync.unsentPhotos == 0) "All sent"
                        else "${sync.pendingOperations} records · ${sync.unsentPhotos} photos to send",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text("Last sync ${formatInstant(sync.lastSuccess)}", style = MaterialTheme.typography.bodySmall)
                }
                FilledTonalButton(onClick = vm::syncNow, enabled = !sync.running) { Text(if (sync.running) "Syncing…" else "Sync") }
            }
            if (sync.needsAttention > 0) Text("${sync.needsAttention} items need attention (conflicts or rejections).", color = MaterialTheme.colorScheme.error)
            if (sync.failedPhotos > 0) Text("${sync.failedPhotos} photos failed verification and will be re-sent.", style = MaterialTheme.typography.bodySmall)
            sync.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Offline access until ${formatInstant(session.offlineValidUntil.toString())}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = onDetails) { Text("Details") }
            }
        }
    }
}

@Composable
private fun BigAction(icon: ImageVector, label: String, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 72.dp), contentPadding = PaddingValues(12.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null)
            Text(label)
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
