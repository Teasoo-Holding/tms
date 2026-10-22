package com.teasoo.tms.ui.admin

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddLink
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.CreatedShareLinkDto
import com.teasoo.tms.data.remote.ShareLinkDto
import com.teasoo.tms.data.remote.ShareLinkRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val DEFAULT_PORTAL_URL = "https://tms.teasooconsulting.com"

/** The client's URL for a share token: `<portal>/share/<token>`. */
fun shareUrl(token: String, path: String? = null): String {
    val base = BuildConfig.PORTAL_URL.ifBlank { DEFAULT_PORTAL_URL }.trimEnd('/')
    val p = path?.takeIf { it.startsWith("/") && it.contains(token) } ?: "/share/$token"
    return base + p
}

@HiltViewModel
class ShareLinksViewModel @Inject constructor(
    @ApplicationContext context: Context,
    private val api: AdminApi,
    handle: SavedStateHandle,
) : AdminBaseViewModel(context) {
    val projectId: String = checkNotNull(handle["id"])
    val projectName = MutableStateFlow<String?>(null)
    val links = MutableStateFlow<List<ShareLinkDto>?>(null)
    /** The link just created: its token is shown once only. */
    val created = MutableStateFlow<CreatedShareLinkDto?>(null)

    init { refresh() }

    fun refresh() = load {
        coroutineScope {
            val name = async { runCatching { api.project(projectId).name }.getOrNull() }
            links.value = api.shareLinks(projectId)
            name.await()?.let { projectName.value = it }
        }
    }

    // Share links don't change this phone's data, so no device sync is needed.
    fun create(request: ShareLinkRequest, onDone: () -> Unit) = runChange("Link created", onDone) {
        created.value = api.createShareLink(projectId, request)
    }

    fun revoke(link: ShareLinkDto, onDone: () -> Unit) = runChange("Link revoked", onDone) {
        api.revokeShareLink(link.id)
        if (created.value?.id == link.id) created.value = null
    }

    fun dismissCreated() { created.value = null }

    private fun runChange(success: String, onDone: () -> Unit, block: suspend () -> Unit) = viewModelScope.launch {
        saving.value = true
        formError.value = null
        try {
            block()
            messages.tryEmit(success)
            onDone()
            refresh()
        } catch (e: Throwable) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            formError.value = adminErrorMessage(e)
        } finally {
            saving.value = false
        }
    }
}

private val EXPIRY_OPTIONS: List<Int?> = listOf(null, 30, 90, 365)
private fun expiryLabel(days: Int?) = if (days == null) "Never" else "$days days"

@Composable
fun ShareLinksScreen(onBack: () -> Unit, vm: ShareLinksViewModel = hiltViewModel()) {
    val links = collect(vm.links)
    val name = collect(vm.projectName)
    val created = collect(vm.created)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    val snackbar = remember { SnackbarHostState() }
    var creating by remember { mutableStateOf(false) }
    var revoking by remember { mutableStateOf<ShareLinkDto?>(null) }
    CollectMessages(vm, snackbar)

    AdminScaffold(
        title = "Share with client",
        subtitle = name,
        onBack = onBack,
        snackbar = snackbar,
        actions = { IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") } },
    ) { padding ->
        AdminLoadState(loading, error, links != null, onRetry = { vm.refresh() }, modifier = Modifier.padding(padding)) {
            val active = links.orEmpty().filter { it.isActive() }
            val old = links.orEmpty().filterNot { it.isActive() }
            LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    if (created != null) CreatedLinkCard(created, name, snackbar, onClose = vm::dismissCreated)
                    else Button(
                        onClick = { vm.clearFormError(); creating = true },
                        shape = MaterialTheme.shapes.extraLarge,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                    ) {
                        Icon(Icons.Default.AddLink, null)
                        Spacer(Modifier.width(12.dp))
                        Text("New link", style = MaterialTheme.typography.titleMedium)
                    }
                }
                if (links.orEmpty().isEmpty()) item { EmptyState(Icons.Default.Link, "No links yet") }
                if (active.isNotEmpty()) item { SectionHeader("Active") }
                items(active, key = { it.id }) { l -> LinkRow(l, onRevoke = { vm.clearFormError(); revoking = l }) }
                if (old.isNotEmpty()) item { SectionHeader("Revoked or expired") }
                items(old, key = { it.id }) { l -> LinkRow(l, onRevoke = null) }
            }
        }
    }

    if (creating) CreateLinkDialog(saving, formError, onCreate = { vm.create(it) { creating = false } }, onDismiss = { creating = false })
    revoking?.let { l ->
        ConfirmDialog(
            "Revoke ${l.label?.takeIf { it.isNotBlank() } ?: "this link"}?", "The link stops working right away.", "Revoke", saving, formError,
            destructive = true, onConfirm = { vm.revoke(l) { revoking = null } }, onDismiss = { revoking = null },
        )
    }
}

private fun ShareLinkDto.isActive(): Boolean {
    if (revokedAt != null) return false
    val expires = parseInstant(expiresAt) ?: return true
    return expires.isAfter(java.time.Instant.now())
}

@Composable
private fun CreatedLinkCard(link: CreatedShareLinkDto, projectName: String?, snackbar: SnackbarHostState, onClose: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val url = shareUrl(link.token, link.path)
    ElevatedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(link.label?.takeIf { it.isNotBlank() } ?: "New link", style = MaterialTheme.typography.titleMedium)
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                SelectionContainer { Text(url, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium) }
            }
            Text("Shown once — copy it now", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(url))
                        scope.launch { snackbar.showSnackbar("Link copied") }
                    },
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Icon(Icons.Default.ContentCopy, null); Spacer(Modifier.width(8.dp)); Text("Copy") }
                Button(
                    onClick = {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                            projectName?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
                        }
                        context.startActivity(Intent.createChooser(send, "Share link").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    },
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Icon(Icons.Default.Share, null); Spacer(Modifier.width(8.dp)); Text("Share") }
            }
            TextButton(onClick = onClose, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp)) { Text("Done") }
        }
    }
}

@Composable
private fun LinkRow(l: ShareLinkDto, onRevoke: (() -> Unit)?) {
    OutlinedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                ItemTitle(l.label?.takeIf { it.isNotBlank() } ?: "Unnamed link")
                ItemSubtitle(
                    listOfNotNull(
                        when {
                            l.revokedAt != null -> "Revoked"
                            l.expiresAt == null -> "Never expires"
                            onRevoke == null -> "Expired ${formatIsoDate(l.expiresAt)}"
                            else -> "Expires ${formatIsoDate(l.expiresAt)}"
                        },
                        "Opened ${relativeTime(l.lastUsedAt)}".takeIf { l.lastUsedAt != null },
                    ).joinToString(" · "),
                )
            }
            if (onRevoke != null) {
                TextButton(onClick = onRevoke, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.LinkOff, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Revoke")
                }
            }
        }
    }
}

@Composable
private fun CreateLinkDialog(saving: Boolean, error: String?, onCreate: (ShareLinkRequest) -> Unit, onDismiss: () -> Unit) {
    var label by remember { mutableStateOf("") }
    var days by remember { mutableStateOf<Int?>(90) }
    FormDialog(
        "New link", "Create", true, saving, error,
        onConfirm = { onCreate(ShareLinkRequest(label.trim().ifBlank { null }, days)) },
        onDismiss = onDismiss,
    ) {
        TextInput(label, { label = it.take(80) }, "Client name")
        ChoiceChips("Expires", EXPIRY_OPTIONS, days, ::expiryLabel, { days = it })
    }
}
