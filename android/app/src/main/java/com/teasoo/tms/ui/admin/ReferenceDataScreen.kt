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

    fun deleteSpecies(s: AdminSpeciesDto, onDone: () -> Unit) = save("${s.displayName()} deleted", onDone, ::refresh) { api.deleteSpecies(s.id) }
    fun deleteStatus(s: AdminStatusDto, onDone: () -> Unit) = save("${s.name} deleted", onDone, ::refresh) { api.deleteStatus(s.id) }
    fun deleteVendor(v: AdminVendorDto, onDone: () -> Unit) = save("${v.name} deleted", onDone, ::refresh) { api.deleteVendor(v.id) }
}

private fun AdminSpeciesDto.displayName() = commonName?.takeIf { it.isNotBlank() } ?: scientificName

private enum class RefTab(val title: String) { SPECIES("Species"), STATUSES("Statuses"), VENDORS("Vendors") }

/** Species, tree statuses and vendors, shared by every project. Long-press or swipe an entry for more actions. */
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
    val actions = rememberItemActions()
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = "Reference data",
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
                        empty = { EmptyState(Icons.Default.Eco, "No species yet", actionLabel = "Add species", onAction = { vm.clearFormError(); adding = true }) },
                    ) { s ->
                        val edit = { vm.clearFormError(); editing = s }
                        RefRow(
                            title = s.displayName(),
                            subtitle = listOfNotNull(s.scientificName.takeIf { !s.commonName.isNullOrBlank() }, s.code).joinToString(" · "),
                            italicSubtitle = true, active = s.active,
                            onClick = edit,
                            onActions = {
                                actions.open(
                                    s.displayName(), onEdit = edit, active = s.active,
                                    onSetActive = { on -> vm.saveSpecies(s.id, SpeciesRequest(s.scientificName, s.commonName, s.code, on)) },
                                    delete = PendingDelete(s.displayName(), run = { done -> vm.deleteSpecies(s, done) },
                                        deactivate = { done: () -> Unit -> vm.saveSpecies(s.id, SpeciesRequest(s.scientificName, s.commonName, s.code, false), done); Unit }.takeIf { s.active }),
                                )
                            },
                        )
                    }
                    RefTab.STATUSES -> RefList(
                        statuses.orEmpty().sortedWith(compareBy({ !it.active }, { it.sortOrder }, { it.name })), { it.id },
                        empty = { EmptyState(Icons.Default.Category, "No statuses yet", actionLabel = "Add status", onAction = { vm.clearFormError(); adding = true }) },
                    ) { s ->
                        val edit = { vm.clearFormError(); editing = s }
                        RefRow(
                            title = s.name,
                            subtitle = listOfNotNull("Final".takeIf { s.isTerminal }, "Photo required".takeIf { s.requiresPhoto }).joinToString(" · "),
                            active = s.active, dot = { Box(Modifier.size(12.dp).background(StatusPalette.color(s.code), CircleShape)) },
                            onClick = edit,
                            onActions = {
                                actions.open(
                                    s.name, onEdit = edit, active = s.active,
                                    onSetActive = { on -> vm.updateStatus(s.id, s.toPatch().copy(active = on)) },
                                    delete = PendingDelete(s.name, run = { done -> vm.deleteStatus(s, done) },
                                        deactivate = { done: () -> Unit -> vm.updateStatus(s.id, s.toPatch().copy(active = false), done); Unit }.takeIf { s.active }),
                                )
                            },
                        )
                    }
                    RefTab.VENDORS -> RefList(
                        vendors.orEmpty().sortedWith(compareBy({ !it.active }, { it.name })), { it.id },
                        empty = { EmptyState(Icons.Default.Storefront, "No vendors yet", actionLabel = "Add vendor", onAction = { vm.clearFormError(); adding = true }) },
                    ) { v ->
                        val edit = { vm.clearFormError(); editing = v }
                        RefRow(
                            title = v.name,
                            subtitle = listOfNotNull(v.shortCode, v.contactName).filter { it.isNotBlank() }.joinToString(" · "),
                            active = v.active,
                            onClick = edit,
                            onActions = {
                                actions.open(
                                    v.name, onEdit = edit, active = v.active,
                                    onSetActive = { on -> vm.saveVendor(v.id, v.toRequest().copy(active = on)) },
                                    delete = PendingDelete(v.name, run = { done -> vm.deleteVendor(v, done) },
                                        deactivate = { done: () -> Unit -> vm.saveVendor(v.id, v.toRequest().copy(active = false), done); Unit }.takeIf { v.active }),
                                )
                            },
                        )
                    }
                }
            }
        }
    }

    ItemActionsHost(actions, vm)
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
internal fun AdminVendorDto.toRequest() = VendorRequest(name, shortCode, contactName, contactPhone, contactEmail, location, active)

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
    onClick: () -> Unit,
    onActions: () -> Unit,
    italicSubtitle: Boolean = false,
    dot: (@Composable () -> Unit)? = null,
) {
    ActionItem(onClick = onClick, onActions = onActions) {
        Row(Modifier.padding(horizontal = 16.dp).heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
            dot?.let { it(); Spacer(Modifier.width(12.dp)) }
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                ItemTitle(title, active)
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontStyle = if (italicSubtitle) FontStyle.Italic else FontStyle.Normal, maxLines = 1)
            }
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
        TextInput(scientific, { scientific = it }, "Scientific name")
        TextInput(common, { common = it }, "Common name (optional)")
        TextInput(code, { code = it.take(32) }, "Code (optional)")
        SwitchRow("Active", active, { active = it })
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
                supporting = "e.g. NEEDS_WATER. Can’t change later.",
                keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Characters, autoCorrectEnabled = false))
        } else BoldValue("Code", existing.code)
        TextInput(name, { name = it }, "Name")
        TextInput(description, { description = it }, "Description (optional)", singleLine = false)
        SwitchRow("Final (dead or missing)", terminal, { terminal = it })
        SwitchRow("Allows a replacement", replacement, { replacement = it })
        SwitchRow("Photo required", photo, { photo = it })
        TextInput(order, { order = it.filter { c -> c.isDigit() || c == '-' }.take(6) }, "Sort order", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        SwitchRow("Active", active, { active = it })
    }
}

@Composable
internal fun VendorDialog(existing: AdminVendorDto?, saving: Boolean, error: String?, onSave: (VendorRequest) -> Unit, onDismiss: () -> Unit) {
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
            supporting = if (existing?.shortCode != null && code != existing.shortCode) "Existing tree IDs keep the old code." else null)
        TextInput(contact, { contact = it }, "Contact name (optional)")
        TextInput(phone, { phone = it }, "Phone (optional)", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        TextInput(email, { email = it }, "Email (optional)", isError = !emailOk, supporting = if (!emailOk) "Enter a valid email" else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        TextInput(location, { location = it }, "Location (optional)")
        SwitchRow("Active", active, { active = it })
    }
}
