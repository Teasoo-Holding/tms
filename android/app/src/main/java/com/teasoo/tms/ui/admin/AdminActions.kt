package com.teasoo.tms.ui.admin

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/*
 * Long-press / swipe-left actions for admin list items: a bottom sheet with Edit, Activate or Deactivate and Delete,
 * then a confirmation that names the item and shows the server's refusal (e.g. "has trees – deactivate it instead").
 */

/** One action in an item's sheet. */
class SheetAction(val label: String, val icon: ImageVector, val destructive: Boolean = false, val onClick: () -> Unit)

/** A delete waiting for confirmation. [run] and [deactivate] call their argument when they succeed. */
class PendingDelete(
    val name: String,
    val detail: String? = null,
    val run: (onDone: () -> Unit) -> Unit,
    /** Offered when the server refuses the delete (the item is in use). */
    val deactivate: ((onDone: () -> Unit) -> Unit)? = null,
)

/** The sheet and confirmation shown for one screen's list items. */
class ItemActionsState {
    var sheetTitle by mutableStateOf<String?>(null)
        private set
    var sheetActions by mutableStateOf<List<SheetAction>>(emptyList())
        private set
    var deleting by mutableStateOf<PendingDelete?>(null)

    fun open(title: String, actions: List<SheetAction>) {
        sheetTitle = title
        sheetActions = actions
    }

    /**
     * Opens the standard sheet: Edit, Activate/Deactivate (when [active] is not null) and Delete (when [delete] is set).
     * [activeLabels] renames the toggle, e.g. "Reopen" / "Close".
     */
    fun open(
        title: String,
        onEdit: (() -> Unit)? = null,
        editLabel: String = "Edit",
        active: Boolean? = null,
        onSetActive: ((Boolean) -> Unit)? = null,
        activeLabels: Pair<String, String> = "Activate" to "Deactivate",
        delete: PendingDelete? = null,
        extra: List<SheetAction> = emptyList(),
    ) = open(
        title,
        buildList {
            onEdit?.let { add(SheetAction(editLabel, Icons.Default.Edit, onClick = it)) }
            addAll(extra)
            if (active != null && onSetActive != null) {
                add(
                    if (active) SheetAction(activeLabels.second, Icons.Default.Block) { onSetActive(false) }
                    else SheetAction(activeLabels.first, Icons.Default.CheckCircle) { onSetActive(true) },
                )
            }
            delete?.let { d -> add(SheetAction("Delete", Icons.Default.Delete, destructive = true) { deleting = d }) }
        },
    )

    fun closeSheet() {
        sheetTitle = null
    }
}

@Composable
fun rememberItemActions() = remember { ItemActionsState() }

/** Renders [state]'s sheet and delete confirmation; errors come from [vm]'s form error. */
@Composable
fun ItemActionsHost(state: ItemActionsState, vm: AdminBaseViewModel) {
    val saving = collect(vm.saving)
    val error = collect(vm.formError)
    state.sheetTitle?.let { title ->
        ActionsSheet(title, state.sheetActions, onPicked = { vm.clearFormError() }, onDismiss = { state.closeSheet() })
    }
    state.deleting?.let { d ->
        DeleteDialog(d, saving, error, onDismiss = { state.deleting = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionsSheet(title: String, actions: List<SheetAction>, onPicked: () -> Unit, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
            actions.forEach { a ->
                val color = if (a.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                Surface(
                    onClick = {
                        onPicked()
                        scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss(); a.onClick() }
                    },
                    shape = MaterialTheme.shapes.large,
                    color = if (a.destructive) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.45f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                ) {
                    Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(a.icon, null, tint = color)
                        Spacer(Modifier.width(16.dp))
                        Text(a.label, style = MaterialTheme.typography.titleSmall, color = color)
                    }
                }
            }
        }
    }
}

@Composable
private fun DeleteDialog(d: PendingDelete, saving: Boolean, error: String?, onDismiss: () -> Unit) {
    val refused = error != null
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text("Delete ${d.name}?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(d.detail ?: "This cannot be undone.")
                error?.let {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small) {
                        Text(it, Modifier.padding(10.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            if (refused && d.deactivate != null) {
                Button(onClick = { d.deactivate.invoke(onDismiss) }, enabled = !saving) { Text("Deactivate") }
            } else {
                Button(
                    onClick = { d.run(onDismiss) }, enabled = !saving,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) {
                    if (saving) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onError)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(if (refused) "Try again" else "Delete")
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text(if (refused) "Close" else "Cancel") } },
    )
}

/**
 * A rounded list item: tap runs [onClick]; long-press or swipe left runs [onActions] (and the item snaps back).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ActionItem(
    onClick: (() -> Unit)?,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
    tonal: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val currentActions by rememberUpdatedState(onActions)
    val swipe = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) currentActions()
            false // never dismiss: the item snaps back
        },
    )
    val shape = MaterialTheme.shapes.large
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        modifier = modifier.fillMaxWidth(),
        backgroundContent = {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = shape, modifier = Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().padding(end = 24.dp), contentAlignment = Alignment.CenterEnd) {
                    Icon(Icons.Default.MoreHoriz, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                }
            }
        },
    ) {
        Surface(
            shape = shape,
            color = if (tonal) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainerLow,
            border = if (tonal) null else CardDefaults.outlinedCardBorder(),
            modifier = Modifier.fillMaxWidth()
                .clip(shape)
                .combinedClickable(onClick = { (onClick ?: onActions)() }, onLongClick = onActions, onLongClickLabel = "More actions")
                .semantics { customActions = listOf(CustomAccessibilityAction("More actions") { currentActions(); true }) },
        ) {
            Column(Modifier.heightIn(min = 56.dp), content = content)
        }
    }
}

/** Title line with an optional "Inactive" tag, for [ActionItem] rows. */
@Composable
fun ItemTitle(title: String, active: Boolean = true, tag: (@Composable () -> Unit)? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f, fill = false), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (!active) InactiveTag()
        tag?.invoke()
    }
}

@Composable
fun ItemSubtitle(text: String) {
    if (text.isNotBlank()) Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
}
