package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.Send
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
import com.teasoo.tms.ui.admin.ADMIN_ENTRIES
import com.teasoo.tms.ui.admin.AnalyticsDashboardScreen
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
        AnalyticsDashboardScreen(onBack = null, actions = { AccountMenu(session, vm) })
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

    // Search and the area map follow the session's project.
    LaunchedEffect(ctx?.session?.projectId) { ctx?.session?.projectId?.let { vm.selectProject(it) } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(ctx?.project?.name ?: "TMS Field", maxLines = 1) },
                actions = { AccountMenu(session, vm) },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(horizontal = 20.dp, vertical = 8.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (sync.lowStorage) Notice("Phone storage is low. Open “Ready to send” → Free up space.", MaterialTheme.colorScheme.errorContainer)
            val c = ctx
            when {
                projects.isEmpty() -> Notice(
                    when {
                        sync.lastSuccess == null -> "Connect to the internet to download your projects."
                        isAdmin -> "No projects yet. Create one in Administration."
                        else -> "No project assigned to you yet."
                    },
                )
                c == null -> PrimaryPill(Icons.Default.PlayArrow, "Start field session") { nav.navigate(Routes.SESSION_SETUP) }
                else -> {
                    // One line saying where the officer is working; tap to change.
                    Surface(onClick = { nav.navigate(Routes.SESSION_SETUP) }, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceVariant) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(c.title, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                                if (trees + observations > 0) Text("$trees registered · $observations visits today", style = MaterialTheme.typography.bodySmall)
                            }
                            Icon(Icons.Default.Edit, contentDescription = "Change session", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (c.stale) Notice("This session's area was changed by an administrator. Tap above to choose again.", MaterialTheme.colorScheme.errorContainer)
                    SubSectorChips(c, fs::switchSubSector)
                    PrimaryPill(Icons.Default.Add, "Register trees", enabled = !c.stale) { nav.navigate(Routes.SESSION_REGISTER) }
                    Pill(Icons.Default.Checklist, "Visit trees", enabled = !c.stale) { nav.navigate(Routes.SESSION_VISIT) }
                }
            }
            if (projects.isNotEmpty()) {
                Pill(Icons.Default.History, "My visits") { nav.navigate(Routes.MY_VISITS) }
                Pill(
                    Icons.AutoMirrored.Filled.Send, "Ready to send",
                    count = (sync.pendingOperations + sync.unsentPhotos).takeIf { it > 0 },
                    alert = sync.needsAttention > 0,
                ) { nav.navigate(Routes.SYNC) }
                Pill(Icons.Default.Search, "Find a tree") { nav.navigate(Routes.TREES) }
                Pill(Icons.Default.Map, "Map") { nav.navigate(Routes.MAP) }
            }
            if (isAdmin) Pill(Icons.Default.AdminPanelSettings, "Administration") { nav.navigate(com.teasoo.tms.ui.admin.AdminRoutes.HUB) }
            if (c != null) TextButton(onClick = { fs.end() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("End session") }
            SyncFooter(vm)
        }
    }
}

/** Last sync and a sync button, nothing more. */
@Composable
private fun SyncFooter(vm: AppViewModel) {
    val sync by vm.sync.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Text(
            if (sync.running) "Syncing…" else "Synced ${formatInstant(sync.lastSuccess)}",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        IconButton(onClick = vm::syncNow, enabled = !sync.running) { Icon(Icons.Default.Sync, contentDescription = "Sync now") }
    }
}

/** The one main action on the screen: a large filled pill. */
@Composable
private fun PrimaryPill(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, shape = CircleShape, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) {
        Icon(icon, contentDescription = null)
        Spacer(Modifier.width(12.dp))
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
}

/** A large rounded option with an icon, a label and an optional count. */
@Composable
private fun Pill(icon: ImageVector, label: String, count: Int? = null, alert: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(
        onClick = onClick, enabled = enabled, shape = CircleShape, tonalElevation = 2.dp, shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
    ) {
        Row(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline)
            Spacer(Modifier.width(20.dp))
            Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (alert) Icon(Icons.Default.Error, contentDescription = "Needs attention", tint = MaterialTheme.colorScheme.error)
            count?.let { Text("$it", style = MaterialTheme.typography.titleMedium) }
        }
    }
}
