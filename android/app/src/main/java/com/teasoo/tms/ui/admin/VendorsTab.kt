package com.teasoo.tms.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.remote.AdminPlantingYearDto
import com.teasoo.tms.data.remote.AdminVendorDto
import com.teasoo.tms.data.remote.AdminYearVendorDto
import com.teasoo.tms.data.remote.ProjectDetailDto
import com.teasoo.tms.data.remote.VendorRequest
import com.teasoo.tms.ui.components.Picker

/** Vendors planting in [year]: each plants across the year's whole area and may tag trees its own way. */
@Composable
internal fun VendorsTab(p: ProjectDetailDto, year: AdminPlantingYearDto?, vm: ProjectSetupViewModel, onAddYear: () -> Unit) {
    val areas = collect(vm.areas)
    val allVendors = collect(vm.vendors)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var adding by remember { mutableStateOf(false) }
    var unlinking by remember { mutableStateOf<AdminYearVendorDto?>(null) }
    var editing by remember { mutableStateOf<AdminVendorDto?>(null) }
    val actions = rememberItemActions()

    if (year == null) { NoYearState(onAddYear); return }
    val linked = p.linkedVendors(year.id)
    val previous = p.plantingYearVendors.filter { !it.active && it.plantingYearId == year.id && linked.none { l -> l.vendorId == it.vendorId } }
    val add = { vm.clearFormError(); adding = true }
    fun vendorOf(link: AdminYearVendorDto) = allVendors.firstOrNull { it.id == link.vendorId }
    fun deleteLink(link: AdminYearVendorDto) = PendingDelete(
        "${link.vendorName ?: "vendor"} from ${year.yearLabel}", detail = "The vendor itself is kept.",
        run = { done -> vm.deleteYearVendor(link, done) },
        deactivate = { done: () -> Unit -> vm.unlinkVendor(link, done); Unit }.takeIf { link.active },
    )

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (linked.isEmpty()) {
            EmptyState(Icons.Default.Storefront, "No vendors for ${year.yearLabel} yet", actionLabel = "Add vendor", onAction = add)
        } else {
            FilledTonalButton(onClick = add, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add vendor")
            }
        }
        linked.forEach { link ->
            val vendor = vendorOf(link)
            val edit = vendor?.let { v -> { vm.clearFormError(); editing = v } }
            ActionItem(
                onClick = edit, onEdit = edit, editLabel = "Edit ${link.vendorName ?: "vendor"}",
                onActions = {
                    actions.open(
                        link.vendorName ?: "Vendor", onEdit = edit, active = true,
                        onSetActive = { vm.clearFormError(); unlinking = link },
                        activeLabels = "Add back" to "Remove from ${year.yearLabel}",
                        delete = deleteLink(link),
                    )
                },
            ) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    ItemTitle(link.vendorName ?: "Vendor")
                    ItemSubtitle(link.vendorShortCode.orEmpty())
                }
            }
        }
        if (previous.isNotEmpty()) {
            SectionHeader("Removed from ${year.yearLabel}")
            previous.forEach { link ->
                val addBack = { vm.linkVendor(year, link.vendorId, link.vendorName ?: "Vendor") {}; Unit }
                ActionItem(
                    onClick = addBack,
                    onActions = {
                        actions.open(
                            link.vendorName ?: "Vendor", active = false, onSetActive = { addBack() },
                            activeLabels = "Add back" to "Remove", delete = deleteLink(link),
                        )
                    },
                ) {
                    Row(Modifier.padding(horizontal = 16.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(link.vendorName ?: "Vendor", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Add back", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    ItemActionsHost(actions, vm)

    if (adding) {
        val available = allVendors.filter { v -> v.active && linked.none { it.vendorId == v.id } }.sortedBy { it.name.lowercase() }
        AddVendorDialog(
            year, available, saving, formError,
            onLink = { v -> vm.linkVendor(year, v.id, v.name) { adding = false } },
            onCreate = { r -> vm.createAndLinkVendor(year, r) { adding = false } },
            onDismiss = { adding = false },
        )
    }
    editing?.let { v -> VendorDialog(v, saving, formError, { vm.updateVendor(v, it) { editing = null } }, { editing = null }) }
    unlinking?.let { link ->
        ConfirmDialog(
            "Remove ${link.vendorName ?: "this vendor"} from ${year.yearLabel}?",
            "Its trees keep their IDs.",
            "Remove", saving, formError, destructive = true,
            onConfirm = { vm.unlinkVendor(link) { unlinking = null } },
            onDismiss = { unlinking = null },
        )
    }
}

@Composable
private fun AddVendorDialog(
    year: AdminPlantingYearDto,
    available: List<AdminVendorDto>,
    saving: Boolean,
    error: String?,
    onLink: (AdminVendorDto) -> Unit,
    onCreate: (VendorRequest) -> Unit,
    onDismiss: () -> Unit,
) {
    var creating by remember { mutableStateOf(available.isEmpty()) }
    var picked by remember { mutableStateOf<AdminVendorDto?>(null) }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    FormDialog(
        "Add vendor to ${year.yearLabel}", "Add",
        if (creating) name.isNotBlank() && code.isNotBlank() else picked != null,
        saving, error,
        onConfirm = { if (creating) onCreate(VendorRequest(name.trim(), code.trim())) else picked?.let(onLink) },
        onDismiss = onDismiss,
    ) {
        ChoiceChips(null, listOf(false, true), creating, { if (it) "New vendor" else "Existing vendor" }, { creating = it })
        if (!creating) {
            if (available.isEmpty()) Hint("All vendors are already added.")
            Picker("Vendor", available, picked, { v -> v.name + (v.shortCode?.let { " ($it)" } ?: "") }, { picked = it })

        } else {
            TextInput(name, { name = it }, "Vendor name")
            CodeInput(code, { code = it }, label = "Short code", supporting = "e.g. GEN")
        }
    }
}
