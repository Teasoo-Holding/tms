package com.teasoo.tms.ui.admin

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Forest
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
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
    const val REFERENCE = "admin/reference"
    const val USERS = "admin/users"
    const val AUDIT = "admin/audit?actor={actor}&project={project}"

    fun project(id: String) = "admin/projects/$id"

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
    composable(AdminRoutes.HUB) { AdminHubScreen(onBack = back, onNavigate = { nav.navigate(it) }) }
    composable(AdminRoutes.ANALYTICS) { AnalyticsDashboardScreen(onBack = back) }
    composable(AdminRoutes.PROJECTS) { ProjectsScreen(onBack = back, onOpenProject = { nav.navigate(AdminRoutes.project(it)) }) }
    composable(AdminRoutes.PROJECT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { ProjectSetupScreen(onBack = back) }
    composable(AdminRoutes.REFERENCE) { ReferenceDataScreen(onBack = back) }
    composable(AdminRoutes.USERS) { UsersScreen(onBack = back, onViewActivity = { nav.navigate(AdminRoutes.audit(actorId = it)) }) }
    composable(
        AdminRoutes.AUDIT,
        arguments = listOf(
            navArgument("actor") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("project") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { AuditLogScreen(onBack = back, onOpenTree = onOpenTree) }
}

/** Entries for a home screen's administration section (title, subtitle, icon, route). */
data class AdminEntry(val title: String, val subtitle: String, val icon: ImageVector, val route: String)

val ADMIN_ENTRIES = listOf(
    AdminEntry("Dashboard", "Progress, status, growth and field activity", Icons.Default.Insights, AdminRoutes.ANALYTICS),
    AdminEntry("Projects", "Planting years, ID format, areas, custom fields, officers", Icons.Default.Forest, AdminRoutes.PROJECTS),
    AdminEntry("Reference data", "Species, statuses and vendors", Icons.Default.Category, AdminRoutes.REFERENCE),
    AdminEntry("Users", "Accounts, roles, passwords and activity", Icons.Default.Group, AdminRoutes.USERS),
    AdminEntry("Activity log", "Who changed what, and when", Icons.Default.History, AdminRoutes.audit()),
)

@Composable
fun AdminHubScreen(onBack: () -> Unit, onNavigate: (String) -> Unit) {
    AdminScaffold(title = "Administration", subtitle = "Needs a connection", onBack = onBack) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Changes apply on the server right away; this phone downloads them at its next sync, which starts automatically after each change.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ADMIN_ENTRIES.forEach { e ->
                Card(onClick = { onNavigate(e.route) }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(e.title) },
                        supportingContent = { Text(e.subtitle) },
                        leadingContent = { Icon(e.icon, contentDescription = null) },
                    )
                }
            }
        }
    }
}
