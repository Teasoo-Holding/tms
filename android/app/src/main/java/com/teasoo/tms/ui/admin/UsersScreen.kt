package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@HiltViewModel
class UsersViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi) : AdminBaseViewModel(context) {
    val users = MutableStateFlow<List<AdminUserDto>?>(null)

    init { refresh() }

    fun refresh() = load { users.value = api.users() }

    fun create(r: UserCreateRequest, onDone: () -> Unit) = save("Account created for ${r.fullName}", onDone, ::refresh) { api.createUser(r) }

    fun update(user: AdminUserDto, patch: UserPatch, message: String, onDone: () -> Unit = {}) =
        save(message, onDone, ::refresh) { api.updateUser(user.id, patch.toPatchBody(keepNulls = false)) }
}

private val ROLES = listOf("FIELD_OFFICER", "ADMIN", "EXECUTIVE")
private const val ALL_PROJECTS_LABEL = "Teasoo management – sees all projects"
private const val PASSWORD_HINT = "At least 10 characters"

private sealed interface UserAction {
    data object Create : UserAction
    data class Edit(val user: AdminUserDto) : UserAction
    data class Password(val user: AdminUserDto) : UserAction
    data class Toggle(val user: AdminUserDto) : UserAction
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UsersScreen(onBack: () -> Unit, onViewActivity: (String) -> Unit, vm: UsersViewModel = hiltViewModel()) {
    val users = collect(vm.users)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val snackbar = remember { SnackbarHostState() }
    var query by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf<String?>(null) }
    var action by remember { mutableStateOf<UserAction?>(null) }
    fun open(a: UserAction) { vm.clearFormError(); action = a }
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = "Users",
        subtitle = users?.let { list -> "${list.count { it.active }} active · ${list.count { !it.active }} inactive" },
        onBack = onBack,
        snackbar = snackbar,
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { open(UserAction.Create) }, icon = { Icon(Icons.Default.PersonAdd, null) }, text = { Text("New user") })
        },
    ) { padding ->
        AdminLoadState(loading, error, users != null, onRetry = { vm.refresh() }, modifier = Modifier.padding(padding)) {
            val filtered = users.orEmpty()
                .filter { role == null || it.role == role }
                .filter { u -> query.isBlank() || listOfNotNull(u.fullName, u.username, u.email, u.phone).any { it.contains(query, true) } }
                .sortedWith(compareBy({ !it.active }, { it.fullName.lowercase() }))
            LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    OutlinedTextField(
                        query, { query = it }, placeholder = { Text("Search") }, singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, null) }, modifier = Modifier.fillMaxWidth(),
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                        FilterChip(role == null, { role = null }, { Text("Everyone") })
                        ROLES.forEach { r -> FilterChip(role == r, { role = if (role == r) null else r }, { Text(roleLabel(r)) }) }
                    }
                }
                if (users.orEmpty().isEmpty()) item {
                    EmptyState(Icons.Default.PersonAdd, "No users yet", actionLabel = "New user", onAction = { open(UserAction.Create) })
                } else if (filtered.isEmpty()) item { Hint("No one matches the search.") }
                items(filtered, key = { it.id }) { u ->
                    UserCard(
                        u,
                        onEdit = { open(UserAction.Edit(u)) },
                        onPassword = { open(UserAction.Password(u)) },
                        onToggle = { open(UserAction.Toggle(u)) },
                        onActivity = { onViewActivity(u.id) },
                    )
                }
            }
        }
    }

    val close = { action = null }
    when (val a = action) {
        UserAction.Create -> UserDialog(null, saving, formError, onCreate = { vm.create(it, close) }, onUpdate = {}, onDismiss = close)
        is UserAction.Edit -> UserDialog(a.user, saving, formError, onCreate = {}, onUpdate = { vm.update(a.user, it, "${a.user.fullName} saved", close) }, onDismiss = close)
        is UserAction.Password -> PasswordDialog(a.user, saving, formError, onSave = { vm.update(a.user, UserPatch(password = it), "Password reset for ${a.user.fullName}", close) }, onDismiss = close)
        is UserAction.Toggle -> ConfirmDialog(
            if (a.user.active) "Deactivate ${a.user.fullName}?" else "Reactivate ${a.user.fullName}?",
            if (a.user.active) "They are signed out everywhere. Their records stay." else "They can sign in again.",
            if (a.user.active) "Deactivate" else "Reactivate", saving, formError, destructive = a.user.active,
            onConfirm = { vm.update(a.user, UserPatch(active = !a.user.active), if (a.user.active) "${a.user.fullName} deactivated" else "${a.user.fullName} reactivated", close) },
            onDismiss = close,
        )
        null -> Unit
    }
}

@Composable
private fun UserCard(u: AdminUserDto, onEdit: () -> Unit, onPassword: () -> Unit, onToggle: () -> Unit, onActivity: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val stale = u.active && u.role == "FIELD_OFFICER" && isStale(u.lastSyncAt)
    OutlinedCard(onClick = onEdit, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(u.fullName, style = MaterialTheme.typography.titleSmall)
                    if (!u.active) InactiveTag()
                }
                Text(listOfNotNull(u.username?.let { "@$it" }, u.phone, u.email).joinToString(" · ").ifBlank { "No sign-in name" }, style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Tag(roleLabel(u.role))
                    if (u.role != "EXECUTIVE") Text("${"%,d".format(u.treesRegistered)} trees · ${"%,d".format(u.observationsRecorded)} observations", style = MaterialTheme.typography.bodySmall)
                }
                if (u.role == "EXECUTIVE") {
                    Text(
                        if (u.allProjects) ALL_PROJECTS_LABEL else "Client or sponsor – sees assigned projects only",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (u.allProjects) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    "Last sync ${relativeTime(u.lastSyncAt)}" + if (stale) " – over 7 days" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (stale) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Actions for ${u.fullName}") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; onEdit() })
                    DropdownMenuItem(text = { Text("Reset password") }, onClick = { menu = false; onPassword() })
                    DropdownMenuItem(text = { Text(if (u.active) "Deactivate" else "Reactivate") }, onClick = { menu = false; onToggle() })
                    DropdownMenuItem(text = { Text("View activity") }, onClick = { menu = false; onActivity() })
                }
            }
        }
    }
}

@Composable
private fun PasswordInput(value: String, onChange: (String) -> Unit, label: String) = PasswordField(value, onChange, label, supporting = PASSWORD_HINT)

@Composable
private fun UserDialog(existing: AdminUserDto?, saving: Boolean, error: String?, onCreate: (UserCreateRequest) -> Unit, onUpdate: (UserPatch) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(existing?.fullName.orEmpty()) }
    var email by remember { mutableStateOf(existing?.email.orEmpty()) }
    var username by remember { mutableStateOf(existing?.username.orEmpty()) }
    var phone by remember { mutableStateOf(existing?.phone.orEmpty()) }
    var role by remember { mutableStateOf(existing?.role ?: "FIELD_OFFICER") }
    var password by remember { mutableStateOf("") }
    var active by remember { mutableStateOf(existing?.active ?: true) }
    var allProjects by remember { mutableStateOf(existing?.allProjects ?: false) }
    val allProjectsNow = role == "EXECUTIVE" && allProjects
    val emailOk = email.isBlank() || android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()
    val usernameOk = username.isBlank() || Regex("^(?=.*[A-Za-z])[A-Za-z0-9._-]{3,40}$").matches(username.trim())
    val phoneOk = phone.isBlank() || Regex("^\\+?[0-9]{7,16}$").matches(phone.replace(Regex("[\\s().-]"), ""))
    val hasLogin = listOf(username, phone, email).any { it.isNotBlank() }
    fun differs(now: String, before: String?) = now.trim() != before.orEmpty()
    val changed = existing == null || name.trim() != existing.fullName || differs(email, existing.email) || differs(username, existing.username) ||
        differs(phone, existing.phone) || role != existing.role || allProjectsNow != existing.allProjects
    val valid = name.isNotBlank() && emailOk && usernameOk && phoneOk && hasLogin && changed && (existing != null || password.isNotEmpty())
    FormDialog(
        if (existing == null) "New user" else "Edit ${existing.fullName}", if (existing == null) "Create" else "Save", valid, saving, error,
        onConfirm = {
            if (existing == null) {
                onCreate(UserCreateRequest(username.trim().ifBlank { null }, phone.trim().ifBlank { null }, email.trim().ifBlank { null }, name.trim(), role, password, active, allProjectsNow))
            }
            else onUpdate(
                UserPatch(
                    email = email.trim().takeIf { differs(email, existing.email) },
                    username = username.trim().takeIf { differs(username, existing.username) },
                    phone = phone.trim().takeIf { differs(phone, existing.phone) },
                    fullName = name.trim().takeIf { it != existing.fullName },
                    role = role.takeIf { it != existing.role },
                    allProjects = allProjectsNow.takeIf { it != existing.allProjects },
                ),
            )
        },
        onDismiss = onDismiss,
    ) {
        TextInput(name, { name = it }, "Full name")
        TextInput(username, { username = it }, "Username", isError = !usernameOk,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, autoCorrectEnabled = false))
        TextInput(phone, { phone = it }, "Phone number", isError = !phoneOk, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        TextInput(email, { email = it }, "Email (optional)", isError = !emailOk,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false))
        if (!hasLogin) Hint("Add a username, phone or email to sign in with.")
        ChoiceChips("Role", ROLES, role, ::roleLabel, { role = it })
        if (role == "EXECUTIVE") {
            SwitchRow(
                ALL_PROJECTS_LABEL, allProjects, { allProjects = it },
                supporting = if (allProjects) null else "Client or sponsor: assign projects under Officers",
            )
        }
        if (existing != null && role != existing.role) Hint("They’ll be signed out everywhere.")
        if (existing == null) {
            PasswordInput(password, { password = it }, "Initial password")
            SwitchRow("Active", active, { active = it })
        }
    }
}

@Composable
private fun PasswordDialog(user: AdminUserDto, saving: Boolean, error: String?, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var password by remember { mutableStateOf("") }
    FormDialog("Reset password", "Reset", password.isNotEmpty(), saving, error, onConfirm = { onSave(password) }, onDismiss = onDismiss) {
        Text("${user.fullName} will be signed out everywhere.")
        PasswordInput(password, { password = it }, "New password")
    }
}
