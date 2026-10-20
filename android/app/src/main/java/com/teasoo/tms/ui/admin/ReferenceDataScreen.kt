package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Eco
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.ui.components.StatusPalette
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@HiltViewModel
class ReferenceDataViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi) : AdminBaseViewModel(context) {
    val species = MutableStateFlow<List<AdminSpeciesDto>?>(null)
    val statuses = MutableStateFlow<List<AdminStatusDto>?>(null)
    val vendors = MutableStateFlow<List<AdminVendorDto>?>(null)

    init { refresh() }

    fun refresh() = load {
        coroutineScope {
            val a = async { api.species() }
            val b = async { api.statuses() }
            val c = async { api.vendors() }
            species.value = a.await()
            statuses.value = b.await()
            vendors.value = c.await()
        }
    }

    fun saveSpecies(id: String?, r: SpeciesRequest, onDone: () -> Unit = {}) =
        save(if (id == null) "Species added" else "Species saved", onDone, ::refresh) { if (id == null) api.createSpecies(r) else api.updateSpecies(id, r.toPatchBody()) }

    fun createStatus(r: StatusRequest, onDone: () -> Unit) = save("Status added", onDone, ::refresh) { api.createStatus(r) }
    fun updateStatus(id: String, p: StatusPatch, onDone: () -> Unit = {}) = save("Status saved", onDone, ::refresh) { api.updateStatus(id, p.toPatchBody()) }

    fun saveVendor(id: String?, r: VendorRequest, onDone: () -> Unit = {}) =
        save(if (id == null) "Vendor added" else "Vendor saved", onDone, ::refresh) { if (id == null) api.createVendor(r) else api.updateVendor(id, r.toPatchBody()) }
}

private enum class RefTab(val title: String) { SPECIES("Species"), STATUSES("Statuses"), VENDORS("Vendors") }

/** Species, tree statuses and vendors: shared by every project. Entries are deactivated, never deleted. */
@Composable
fun ReferenceDataScreen(onBack: () -> Unit, vm: ReferenceDataViewModel = hiltViewModel()) {
    val species = collect(vm.species)
    val statuses = collect(vm.statuses)
    val vendors = collect(vm.vendors)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val snackbar = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableStateOf(RefTab.SPECIES) }
    var editing by remember { mutableStateOf<Any?>(null) }
    var adding by remember { mutableStateOf(false) }
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = "Reference data",
        subtitle = "Shared by all projects",
        onBack = onBack,
        snackbar = snackbar,
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { vm.clearFormError(); adding = true },
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text(when (tab) { RefTab.SPECIES -> "Add species"; RefTab.STATUSES -> "Add status"; RefTab.VENDORS -> "Add vendor" }) },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab.ordinal) {
                RefTab.entries.forEach { t -> Tab(selected = tab == t, onClick = { tab = t }, text = { Text(t.title) }, modifier = Modifier.heightIn(min = 48.dp)) }
            }
            AdminLoadState(loading, error, species != null, onRetry = { vm.refresh() }) {
                when (tab) {
                    RefTab.SPECIES -> RefList(
                        species.orEmpty().sortedWith(compareBy({ !it.active }, { it.scientificName })), { it.id },
                        empty = { EmptyState(Icons.Default.Eco, "No species yet", "Add the tree species planted in your projects.", "Add species", { vm.clearFormError(); adding = true }) },
                    ) { s ->
                        RefRow(
                            title = s.commonName?.takeIf { it.isNotBlank() } ?: s.scientificName,
                            subtitle = listOfNotNull(s.scientificName.takeIf { !s.commonName.isNullOrBlank() }, s.code).joinToString(" · "),
                            italicSubtitle = true, active = s.active,
                            onToggle = { on -> vm.saveSpecies(s.id, SpeciesRequest(s.scientificName, s.commonName, s.code, on)) }, enabled = !saving,
                            onClick = { vm.clearFormError(); editing = s },
                        )
                    }
                    RefTab.STATUSES -> RefList(
                        statuses.orEmpty().sortedWith(compareBy({ !it.active }, { it.sortOrder }, { it.name })), { it.id },
                        empty = { EmptyState(Icons.Default.Category, "No statuses yet", "Statuses describe a tree’s condition at each visit, e.g. Healthy, Damaged, Dead.", "Add status", { vm.clearFormError(); adding = true }) },
                    ) { s ->
                        RefRow(
                            title = s.name,
                            subtitle = listOfNotNull(s.code, "ends the tree’s life".takeIf { s.isTerminal }, "replaceable".takeIf { s.allowsReplacement }, "photo required".takeIf { s.requiresPhoto }).joinToString(" · "),
                            active = s.active, dot = { Box(Modifier.size(12.dp).background(StatusPalette.color(s.code), CircleShape)) },
                            onToggle = { on -> vm.updateStatus(s.id, s.toPatch().copy(active = on)) }, enabled = !saving,
                            onClick = { vm.clearFormError(); editing = s },
                        )
                    }
                    RefTab.VENDORS -> RefList(
                        vendors.orEmpty().sortedWith(compareBy({ !it.active }, { it.name })), { it.id },
                        empty = { EmptyState(Icons.Default.Storefront, "No vendors yet", "Vendors supply seedlings. Their code can be part of tree IDs.", "Add vendor", { vm.clearFormError(); adding = true }) },
                    ) { v ->
                        RefRow(
                            title = v.name,
                            subtitle = listOfNotNull(v.shortCode, v.contactName, v.contactPhone, v.location).filter { it.isNotBlank() }.joinToString(" · "),
                            active = v.active,
                            onToggle = { on -> vm.saveVendor(v.id, v.toRequest().copy(active = on)) }, enabled = !saving,
                            onClick = { vm.clearFormError(); editing = v },
                        )
                    }
                }
            }
        }
    }

    val close = { adding = false; editing = null }
    when (val e = editing) {
        is AdminSpeciesDto -> SpeciesDialog(e, saving, formError, { vm.saveSpecies(e.id, it, close) }, close)
        is AdminStatusDto -> StatusDialog(e, saving, formError, onCreate = {}, onUpdate = { vm.updateStatus(e.id, it, close) }, onDismiss = close)
        is AdminVendorDto -> VendorDialog(e, saving, formError, { vm.saveVendor(e.id, it, close) }, close)
    }
    if (adding) when (tab) {
        RefTab.SPECIES -> SpeciesDialog(null, saving, formError, { vm.saveSpecies(null, it, close) }, close)
        RefTab.STATUSES -> StatusDialog(null, saving, formError, onCreate = { vm.createStatus(it, close) }, onUpdate = {}, onDismiss = close)
        RefTab.VENDORS -> VendorDialog(null, saving, formError, { vm.saveVendor(null, it, close) }, close)
    }
}

private fun AdminStatusDto.toPatch() = StatusPatch(name, description, isTerminal, allowsReplacement, requiresPhoto, sortOrder, active)
private fun AdminVendorDto.toRequest() = VendorRequest(name, shortCode, contactName, contactPhone, contactEmail, location, active)

@Composable
private fun <T> RefList(items: List<T>, key: (T) -> Any, empty: @Composable () -> Unit, row: @Composable (T) -> Unit) {
    if (items.isEmpty()) empty()
    else LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(items, key = key) { row(it) }
    }
}

@Composable
private fun RefRow(
    title: String,
    subtitle: String,
    active: Boolean,
    onToggle: (Boolean) -> Unit,
    enabled: Boolean,
    onClick: () -> Unit,
    italicSubtitle: Boolean = false,
    dot: (@Composable () -> Unit)? = null,
) {
    OutlinedCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp).heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
            dot?.let { it(); Spacer(Modifier.width(12.dp)) }
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    if (!active) InactiveTag()
                }
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, fontStyle = if (italicSubtitle) FontStyle.Italic else FontStyle.Normal)
            }
            Switch(checked = active, onCheckedChange = onToggle, enabled = enabled)
        }
    }
}

@Composable
private fun SpeciesDialog(existing: AdminSpeciesDto?, saving: Boolean, error: String?, onSave: (SpeciesRequest) -> Unit, onDismiss: () -> Unit) {
    var scientific by remember { mutableStateOf(existing?.scientificName.orEmpty()) }
    var common by remember { mutableStateOf(existing?.commonName.orEmpty()) }
    var code by remember { mutableStateOf(existing?.code.orEmpty()) }
    var active by remember { mutableStateOf(existing?.active ?: true) }
    FormDialog(
        if (existing == null) "Add species" else "Edit species", if (existing == null) "Add" else "Save", scientific.isNotBlank(), saving, error,
        onConfirm = { onSave(SpeciesRequest(scientific.trim(), common.trim().ifBlank { null }, code.trim().ifBlank { null }, active)) },
        onDismiss = onDismiss,
    ) {
        TextInput(scientific, { scientific = it }, "Scientific name", supporting = "e.g. Khaya senegalensis")
        TextInput(common, { common = it }, "Common name (optional)", supporting = "e.g. African mahogany")
        TextInput(code, { code = it.take(32) }, "Code (optional)")
        SwitchRow("Active", active, { active = it }, supporting = "Inactive species are hidden for new trees")
    }
}

@Composable
private fun StatusDialog(existing: AdminStatusDto?, saving: Boolean, error: String?, onCreate: (StatusRequest) -> Unit, onUpdate: (StatusPatch) -> Unit, onDismiss: () -> Unit) {
    var code by remember { mutableStateOf(existing?.code.orEmpty()) }
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var description by remember { mutableStateOf(existing?.description.orEmpty()) }
    var terminal by remember { mutableStateOf(existing?.isTerminal ?: false) }
    var replacement by remember { mutableStateOf(existing?.allowsReplacement ?: false) }
    var photo by remember { mutableStateOf(existing?.requiresPhoto ?: false) }
    var order by remember { mutableStateOf((existing?.sortOrder ?: 0).toString()) }
    var active by remember { mutableStateOf(existing?.active ?: true) }
    FormDialog(
        if (existing == null) "Add status" else "Edit status", if (existing == null) "Add" else "Save",
        name.isNotBlank() && code.isNotBlank() && order.toIntOrNull() != null, saving, error,
        onConfirm = {
            val d = description.trim().ifBlank { null }
            val n = order.toIntOrNull() ?: 0
            if (existing == null) onCreate(StatusRequest(code, name.trim(), d, terminal, replacement, photo, n, active))
            else onUpdate(StatusPatch(name.trim(), d, terminal, replacement, photo, n, active))
        },
        onDismiss = onDismiss,
    ) {
        if (existing == null) {
            TextInput(code, { raw -> code = raw.uppercase().filter { it in 'A'..'Z' || it == '_' }.take(32) }, "Code",
                supporting = "Capital letters and underscores, e.g. NEEDS_WATER. Cannot change later.",
                keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Characters, autoCorrectEnabled = false))
        } else BoldValue("Code", existing.code)
        TextInput(name, { name = it }, "Name", supporting = "What officers see, e.g. Needs water")
        TextInput(description, { description = it }, "Description (optional)", singleLine = false)
        SwitchRow("Ends the tree’s life", terminal, { terminal = it }, supporting = "Like Dead or Missing: counted as dead or missing on the dashboard")
        SwitchRow("Allows a replacement", replacement, { replacement = it }, supporting = "Officers may plant a replacement tree")
        SwitchRow("Photo required", photo, { photo = it }, supporting = "Officers must take a photo when recording it")
        TextInput(order, { order = it.filter { c -> c.isDigit() || c == '-' }.take(6) }, "Sort order", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        SwitchRow("Active", active, { active = it })
    }
}

@Composable
private fun VendorDialog(existing: AdminVendorDto?, saving: Boolean, error: String?, onSave: (VendorRequest) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var code by remember { mutableStateOf(existing?.shortCode.orEmpty()) }
    var contact by remember { mutableStateOf(existing?.contactName.orEmpty()) }
    var phone by remember { mutableStateOf(existing?.contactPhone.orEmpty()) }
    var email by remember { mutableStateOf(existing?.contactEmail.orEmpty()) }
    var location by remember { mutableStateOf(existing?.location.orEmpty()) }
    var active by remember { mutableStateOf(existing?.active ?: true) }
    val emailOk = email.isBlank() || android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()
    FormDialog(
        if (existing == null) "Add vendor" else "Edit vendor", if (existing == null) "Add" else "Save", name.isNotBlank() && emailOk, saving, error,
        onConfirm = {
            onSave(VendorRequest(name.trim(), code.ifBlank { null }, contact.trim().ifBlank { null }, phone.trim().ifBlank { null },
                email.trim().ifBlank { null }, location.trim().ifBlank { null }, active))
        },
        onDismiss = onDismiss,
    ) {
        TextInput(name, { name = it }, "Name")
        CodeInput(code, { code = it }, label = "Short code (optional)",
            supporting = if (existing?.shortCode != null && code != existing.shortCode) "Registered tree IDs keep the old code." else "Used when tree IDs include the vendor, e.g. V03")
        TextInput(contact, { contact = it }, "Contact name (optional)")
        TextInput(phone, { phone = it }, "Phone (optional)", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        TextInput(email, { email = it }, "Email (optional)", isError = !emailOk, supporting = if (!emailOk) "Enter a valid email" else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        TextInput(location, { location = it }, "Location (optional)")
        SwitchRow("Active", active, { active = it })
    }
}
