package com.teasoo.tms.ui.admin

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Forest
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument

/** Routes of the online administration area. */
object AdminRoutes {
    const val HUB = "admin"
    const val ANALYTICS = "admin/analytics"
    const val PROJECTS = "admin/projects"
    const val PROJECT = "admin/projects/{id}"
    const val SHARE = "admin/projects/{id}/share"
    const val REFERENCE = "admin/reference"
    const val USERS = "admin/users"
    const val CLEAR_DATA = "admin/clear-data"
    const val ACTIVITY = "admin/activity"
    const val CLIENT_LINKS = "admin/client-links"
    const val AUDIT = "admin/audit?actor={actor}&project={project}"

    fun project(id: String) = "admin/projects/$id"
    fun share(projectId: String) = "admin/projects/$projectId/share"

    /** Audit log, optionally filtered to one person and/or project. */
    fun audit(actorId: String? = null, projectId: String? = null): String {
        val params = listOfNotNull(actorId?.let { "actor=${Uri.encode(it)}" }, projectId?.let { "project=${Uri.encode(it)}" })
        return if (params.isEmpty()) "admin/audit" else "admin/audit?" + params.joinToString("&")
    }
}

/**
 * Registers every administration screen. [onOpenTree] receives a tree's server id (audit entries).
 * Each screen's back arrow pops the stack.
 */
fun NavGraphBuilder.adminGraph(nav: NavController, onOpenTree: (String) -> Unit) {
    val back: () -> Unit = { nav.popBackStack() }
    val idArg = listOf(navArgument("id") { type = NavType.StringType })
    composable(AdminRoutes.HUB) { AdminHubScreen(onBack = back, onNavigate = { nav.navigate(it) }) }
    composable(AdminRoutes.ANALYTICS) { AnalyticsDashboardScreen(onBack = back) }
    composable(AdminRoutes.PROJECTS) { ProjectsScreen(onBack = back, onOpenProject = { nav.navigate(AdminRoutes.project(it)) }) }
    composable(AdminRoutes.PROJECT, arguments = idArg) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        ProjectSetupScreen(onBack = back, onShare = { nav.navigate(AdminRoutes.share(id)) })
    }
    composable(AdminRoutes.SHARE, arguments = idArg) { ShareLinksScreen(onBack = back) }
    composable(AdminRoutes.ACTIVITY) { FieldActivityScreen(onBack = back) }
    composable(AdminRoutes.CLIENT_LINKS) { ClientLinksScreen(onBack = back, onProject = { nav.navigate(AdminRoutes.share(it)) }) }
    composable(AdminRoutes.REFERENCE) { ReferenceDataScreen(onBack = back) }
    composable(AdminRoutes.USERS) { UsersScreen(onBack = back, onViewActivity = { nav.navigate(AdminRoutes.audit(actorId = it)) }) }
    composable(AdminRoutes.CLEAR_DATA) { ClearDataScreen(onBack = back) }
    composable(
        AdminRoutes.AUDIT,
        arguments = listOf(
            navArgument("actor") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("project") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { AuditLogScreen(onBack = back, onOpenTree = onOpenTree) }
}

/** Entries for a home screen's administration section. [danger] entries are destructive and drawn in red. */
data class AdminEntry(val title: String, val subtitle: String, val icon: ImageVector, val route: String, val danger: Boolean = false)

/** The first entry is the hub's primary action. */
val ADMIN_ENTRIES = listOf(
    AdminEntry("Projects", "Years, areas, ID formats, officers", Icons.Default.Forest, AdminRoutes.PROJECTS),
    AdminEntry("Dashboard", "Progress and field activity", Icons.Default.Insights, AdminRoutes.ANALYTICS),
    AdminEntry("Field activity", "Trees and visits by officer, day and session", Icons.Default.Timeline, AdminRoutes.ACTIVITY),
    AdminEntry("Density map", "A dot for every tree, by area", Icons.Default.Map, com.teasoo.tms.ui.Routes.MAP),
    AdminEntry("Client links", "Share a project's live report with a client", Icons.Default.Share, AdminRoutes.CLIENT_LINKS),
    AdminEntry("Users", "Accounts and roles", Icons.Default.Group, AdminRoutes.USERS),
    AdminEntry("Reference data", "Species, statuses, vendors", Icons.Default.Category, AdminRoutes.REFERENCE),
    AdminEntry("Activity log", "Who changed what", Icons.Default.History, AdminRoutes.audit()),
    AdminEntry("Conflicts", "Duplicate tree IDs to resolve", Icons.Default.Warning, com.teasoo.tms.ui.Routes.ADMIN_CONFLICTS),
    AdminEntry("Clear data", "Delete all trees or everything", Icons.Default.DeleteForever, AdminRoutes.CLEAR_DATA, danger = true),
)

@Composable
fun AdminHubScreen(onBack: () -> Unit, onNavigate: (String) -> Unit) {
    AdminScaffold(title = "Administration", onBack = onBack) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val primary = ADMIN_ENTRIES.first()
            Button(
                onClick = { onNavigate(primary.route) },
                shape = MaterialTheme.shapes.extraLarge,
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp),
            ) {
                Icon(primary.icon, null, Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Text(primary.title, style = MaterialTheme.typography.titleLarge)
            }
            Spacer(Modifier.height(4.dp))
            ADMIN_ENTRIES.drop(1).forEach { e -> HubOption(e) { onNavigate(e.route) } }
        }
    }
}

@Composable
private fun HubOption(e: AdminEntry, onClick: () -> Unit) {
    val color = if (e.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.extraLarge,
        color = if (e.danger) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f) else MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(e.icon, null, tint = color, modifier = Modifier.size(26.dp))
            Spacer(Modifier.width(16.dp))
            Text(e.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f),
                color = if (e.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Client links start from a project: pick one, then create, copy or revoke its read-only links. */
@Composable
fun ClientLinksScreen(onBack: () -> Unit, onProject: (String) -> Unit, vm: ProjectsViewModel = androidx.hilt.navigation.compose.hiltViewModel()) {
    val projects = collect(vm.projects)
    AdminScaffold(title = "Client links", onBack = onBack) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "A client link opens a read-only report of one project – charts, the tree dot map and Excel/CSV/PDF downloads – " +
                    "without an account. Choose the project to share.",
                style = MaterialTheme.typography.bodyMedium,
            )
            projects.orEmpty().forEach { p ->
                HubOption(AdminEntry(p.name, p.shortCode, Icons.Default.Share, "")) { onProject(p.id) }
            }
            if (projects?.isEmpty() == true) Text("No projects yet.", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
