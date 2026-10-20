package com.teasoo.tms.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.remote.AdminAssignmentDto
import com.teasoo.tms.data.remote.AdminSectorDto
import com.teasoo.tms.data.remote.AdminSubSectorDto
import com.teasoo.tms.data.remote.AdminUserDto
import com.teasoo.tms.data.remote.AssignmentRequest
import com.teasoo.tms.ui.components.Picker

private fun scopeText(a: AdminAssignmentDto) = when {
    a.subSectorId != null -> "${a.sectorName ?: "Sector"} › ${a.subSectorName ?: "sub-sector"}"
    a.sectorId != null -> "Sector ${a.sectorName ?: ""}".trim()
    else -> "Whole project"
}

@Composable
internal fun OfficersTab(vm: ProjectSetupViewModel) {
    val assignments = collect(vm.assignments)
    val users = collect(vm.users)
    val areas = collect(vm.areas)
    val project = collect(vm.project)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var adding by remember { mutableStateOf(false) }
    var revoking by remember { mutableStateOf<AdminAssignmentDto?>(null) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            "Officers",
            supporting = "Who works on this project. Assign a field officer to the whole project, one sector or one sub-sector; their phone downloads only that area. " +
                "Clients and sponsors (executives) are assigned to the whole project to see its dashboard.",
            action = { if (assignments.isNotEmpty()) TextButton(onClick = { vm.clearFormError(); adding = true }) { Icon(Icons.Default.Add, null); Text("Assign") } },
        )
        if (assignments.isEmpty()) {
            EmptyState(Icons.Default.GroupAdd, "No one assigned", "Assign field officers so they can record trees in this project.", "Assign officer", { vm.clearFormError(); adding = true })
        }
        assignments.groupBy { it.userId }.forEach { (_, list) ->
            val first = list.first()
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 6.dp)) {
                    Text(first.userName ?: "Unknown user", style = MaterialTheme.typography.titleSmall)
                    Text(roleLabel(first.userRole), style = MaterialTheme.typography.bodySmall)
                    list.forEach { a ->
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Text(scopeText(a), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            TextButton(onClick = { vm.clearFormError(); revoking = a }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Remove") }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    val yearLabels = project?.plantingYears.orEmpty().associate { it.id to it.yearLabel }
    if (adding) AssignDialog(vm.projectId, users.filter { it.active && !(it.role == "EXECUTIVE" && it.allProjects) }, areas, yearLabels, saving, formError,
        onAssign = { vm.assign(it) { adding = false } }, onDismiss = { adding = false })
    revoking?.let { a ->
        ConfirmDialog(
            "Remove assignment?",
            "${a.userName ?: "This person"} will no longer see ${scopeText(a).lowercase()} on their phone after their next sync. Records they already made are kept.",
            "Remove", saving, formError, destructive = true,
            onConfirm = { vm.revoke(a) { revoking = null } }, onDismiss = { revoking = null },
        )
    }
}

@Composable
private fun AssignDialog(
    projectId: String,
    users: List<AdminUserDto>,
    areas: List<AdminSectorDto>,
    yearLabels: Map<String, String>,
    saving: Boolean,
    error: String?,
    onAssign: (AssignmentRequest) -> Unit,
    onDismiss: () -> Unit,
) {
    var user by remember { mutableStateOf<AdminUserDto?>(null) }
    var level by remember { mutableStateOf("PROJECT") }
    var sector by remember { mutableStateOf<AdminSectorDto?>(null) }
    var sub by remember { mutableStateOf<AdminSubSectorDto?>(null) }
    val activeSectors = areas.filter { it.active }.sortedWith(compareByDescending<AdminSectorDto> { it.plantingYearId?.let(yearLabels::get) ?: "" }.thenBy { it.shortCode })
    val executive = user?.role == "EXECUTIVE"
    fun sectorLabel(s: AdminSectorDto) = "${s.name} (${s.shortCode})" + (s.plantingYearId?.let(yearLabels::get)?.let { " · $it" } ?: " · no year")
    val valid = user != null && when (level) {
        "SECTOR" -> sector != null
        "SUB_SECTOR" -> sector != null && sub != null
        else -> true
    }
    FormDialog(
        "Assign to project", "Assign", valid, saving, error,
        onConfirm = {
            onAssign(
                AssignmentRequest(
                    user!!.id, projectId,
                    sectorId = sector?.id?.takeIf { level != "PROJECT" },
                    subSectorId = sub?.id?.takeIf { level == "SUB_SECTOR" },
                ),
            )
        },
        onDismiss = onDismiss,
    ) {
        if (users.isEmpty()) Hint("No active people to assign. Create one under Users first.")
        Picker(
            "Person", users.sortedWith(compareBy({ it.role == "EXECUTIVE" }, { it.fullName.lowercase() })), user,
            { "${it.fullName} (${if (it.role == "EXECUTIVE") "Client / sponsor" else roleLabel(it.role)})" },
            { user = it; if (it.role == "EXECUTIVE") { level = "PROJECT"; sector = null; sub = null } },
        )
        if (executive) Hint("Clients and sponsors see this project's dashboard (read only). Teasoo management already sees every project.")
        if (!executive) ChoiceChips(
            "Covers", listOf("PROJECT", "SECTOR", "SUB_SECTOR"), level,
            { when (it) { "SECTOR" -> "A sector"; "SUB_SECTOR" -> "A sub-sector"; else -> "Whole project" } },
            { level = it; if (it == "PROJECT") { sector = null; sub = null } },
        )
        if (level != "PROJECT") {
            if (activeSectors.isEmpty()) Hint("This project has no active sectors yet. Add them under Areas.")
            Picker("Sector", activeSectors, sector, ::sectorLabel, { sector = it; sub = null })
        }
        if (level == "SUB_SECTOR") {
            val subs = sector?.subSectors?.filter { it.active }.orEmpty()
            Picker("Sub-sector", subs, sub, { "${it.name} (${it.shortCode})" }, { sub = it }, enabled = sector != null,
                supportingText = if (sector == null) "Choose a sector first" else null)
        }
    }
}
