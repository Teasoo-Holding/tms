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

    if (year == null) { NoYearState(onAddYear); return }
    val linked = p.linkedVendors(year.id)
    val previous = p.plantingYearVendors.filter { !it.active && it.plantingYearId == year.id && linked.none { l -> l.vendorId == it.vendorId } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            "Vendors planting in ${year.yearLabel}",
            supporting = "Each vendor plants across the year's whole area. A vendor can have its own tree ID format (set it under ID format).",
            action = {
                if (linked.isNotEmpty()) TextButton(onClick = { vm.clearFormError(); adding = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.Add, null); Text("Add vendor")
                }
            },
        )
        if (linked.isEmpty()) {
            EmptyState(
                Icons.Default.Storefront, "No vendors for ${year.yearLabel} yet",
                "Add the companies planting trees this year. Pick an existing vendor or create a new one with a short code.",
                "Add vendor", { vm.clearFormError(); adding = true },
            )
        }
        linked.forEach { link ->
            val scheme = p.schemes.effectiveFor(link.vendorId, year.id)
            val samples = idSamples(p, year, link.vendorShortCode, areas)
            val usesVendorCode = scheme?.components?.any { it.type == "VENDOR_CODE" } == true
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(link.vendorName ?: "Vendor", style = MaterialTheme.typography.titleMedium)
                            Text(
                                link.vendorShortCode?.let { "Code $it" } ?: "No short code",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (link.vendorShortCode == null && usesVendorCode) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { vm.clearFormError(); unlinking = link }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Unlink") }
                    }
                    if (scheme == null) {
                        Hint("No ID format yet. Set one under ID format before officers register trees.")
                    } else {
                        Text("Example tree ID", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            previewId(scheme.components, scheme.separator, scheme.serialWidth, samples, 1),
                            fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Hint(
                            when (scheme.scopeKind()) {
                                FormatScope.VENDOR_YEAR -> "Uses its own format for ${year.yearLabel}"
                                FormatScope.VENDOR -> "Uses its own format (all years)"
                                FormatScope.YEAR -> "Uses the ${year.yearLabel} format"
                                FormatScope.DEFAULT -> "Uses the project default format"
                            },
                        )
                    }
                    if (link.vendorShortCode == null && usesVendorCode) {
                        Text("The ID format includes the vendor code. Give this vendor a short code under Reference data.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        if (previous.isNotEmpty()) {
            SectionHeader("Removed from ${year.yearLabel}", supporting = "Their trees are kept. Add one back if it plants again this year.")
            previous.forEach { link ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(start = 16.dp, end = 8.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(link.vendorName ?: "Vendor", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        TextButton(onClick = { vm.linkVendor(year, link.vendorId, link.vendorName ?: "Vendor") {} }, enabled = !saving,
                            modifier = Modifier.heightIn(min = 48.dp)) { Text("Add back") }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (adding) {
        val available = allVendors.filter { v -> v.active && linked.none { it.vendorId == v.id } }.sortedBy { it.name.lowercase() }
        AddVendorDialog(
            year, available, saving, formError,
            onLink = { v -> vm.linkVendor(year, v.id, v.name) { adding = false } },
            onCreate = { r -> vm.createAndLinkVendor(year, r) { adding = false } },
            onDismiss = { adding = false },
        )
    }
    unlinking?.let { link ->
        ConfirmDialog(
            "Unlink ${link.vendorName ?: "this vendor"}?",
            "${link.vendorName ?: "The vendor"} will no longer be offered for new trees in ${year.yearLabel}. Trees it already planted keep their records and IDs.",
            "Unlink", saving, formError, destructive = true,
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
            if (available.isEmpty()) Hint("Every vendor is already linked to ${year.yearLabel}. Create a new one instead.")
            Picker("Vendor", available, picked, { v -> v.name + (v.shortCode?.let { " ($it)" } ?: "") }, { picked = it })
            picked?.let { if (it.shortCode.isNullOrBlank()) Hint("This vendor has no short code. Add one under Reference data if tree IDs include the vendor code.") }
        } else {
            TextInput(name, { name = it }, "Vendor name", supporting = "e.g. Green Earth Nurseries")
            CodeInput(code, { code = it }, label = "Short code", supporting = "Used in tree IDs, e.g. GEN or V03. Letters and digits.")
            Hint("You can add contact details later under Reference data.")
        }
    }
}
