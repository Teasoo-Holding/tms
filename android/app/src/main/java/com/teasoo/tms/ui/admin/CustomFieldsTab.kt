package com.teasoo.tms.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.remote.AdminCustomFieldDto
import com.teasoo.tms.data.remote.CustomFieldPatch
import com.teasoo.tms.data.remote.CustomFieldRequest

private val FIELD_TYPES = listOf("TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN")

fun fieldTypeLabel(t: String) = when (t) {
    "TEXT" -> "Text"
    "NUMBER" -> "Number"
    "DATE" -> "Date"
    "SELECT" -> "Choice list"
    "BOOLEAN" -> "Yes / no"
    else -> t
}

private fun appliesToLabel(a: String) = if (a == "OBSERVATION") "At each visit" else "When registering a tree"

private const val STICKY_HELP = "Pre-fills the last answer for the next tree"

@Composable
internal fun CustomFieldsTab(vm: ProjectSetupViewModel) {
    val fields = collect(vm.fields)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var editing by remember { mutableStateOf<AdminCustomFieldDto?>(null) }
    var adding by remember { mutableStateOf<String?>(null) } // applies_to of the new field
    val actions = rememberItemActions()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (fields.isEmpty()) {
            EmptyState(Icons.AutoMirrored.Filled.PlaylistAdd, "No custom fields", actionLabel = "Add field", onAction = { vm.clearFormError(); adding = "TREE" })
        } else {
            listOf("TREE", "OBSERVATION").forEach { applies ->
                val list = fields.filter { it.appliesTo == applies }.sortedWith(compareBy({ !it.active }, { it.sortOrder }, { it.label }))
                SectionHeader(
                    appliesToLabel(applies),
                    action = { TextButton(onClick = { vm.clearFormError(); adding = applies }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Default.Add, null); Text("Add") } },
                )
                list.forEach { f ->
                    val edit = { vm.clearFormError(); editing = f }
                    FieldCard(f, onEdit = edit, onActions = {
                        actions.open(
                            f.label, onEdit = edit, active = f.active,
                            onSetActive = { on -> vm.updateField(f.id, f.toPatch().copy(active = on)) },
                            delete = PendingDelete(
                                "“${f.label}”", run = { done -> vm.deleteField(f, done) },
                                deactivate = { done: () -> Unit -> vm.updateField(f.id, f.toPatch().copy(active = false), done); Unit }.takeIf { f.active },
                            ),
                        )
                    })
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    ItemActionsHost(actions, vm)

    adding?.let { applies ->
        FieldDialog(null, applies, saving, formError,
            onCreate = { vm.createField(it) { adding = null } }, onUpdate = { _ -> }, onDismiss = { adding = null })
    }
    editing?.let { f ->
        FieldDialog(f, f.appliesTo, saving, formError,
            onCreate = {}, onUpdate = { vm.updateField(f.id, it) { editing = null } }, onDismiss = { editing = null })
    }
}

private fun AdminCustomFieldDto.toPatch() = CustomFieldPatch(label, options, required, sticky, helpText, sortOrder, active)

@Composable
private fun FieldCard(f: AdminCustomFieldDto, onEdit: () -> Unit, onActions: () -> Unit) {
    ActionItem(onClick = onEdit, onActions = onActions, onEdit = onEdit, editLabel = "Edit ${f.label}") {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            ItemTitle(f.label, f.active)
            ItemSubtitle(listOfNotNull(fieldTypeLabel(f.fieldType), "Required".takeIf { f.required }, "Remembered".takeIf { f.sticky }).joinToString(" · "))
        }
    }
}

@Composable
private fun FieldDialog(
    existing: AdminCustomFieldDto?,
    appliesToInitial: String,
    saving: Boolean,
    error: String?,
    onCreate: (CustomFieldRequest) -> Unit,
    onUpdate: (CustomFieldPatch) -> Unit,
    onDismiss: () -> Unit,
) {
    var appliesTo by remember { mutableStateOf(existing?.appliesTo ?: appliesToInitial) }
    var label by remember { mutableStateOf(existing?.label.orEmpty()) }
    var type by remember { mutableStateOf(existing?.fieldType ?: "TEXT") }
    var options by remember { mutableStateOf(existing?.options?.joinToString("\n").orEmpty()) }
    var required by remember { mutableStateOf(existing?.required ?: false) }
    var sticky by remember { mutableStateOf(existing?.sticky ?: false) }
    var help by remember { mutableStateOf(existing?.helpText.orEmpty()) }
    var order by remember { mutableStateOf((existing?.sortOrder ?: 0).toString()) }
    var active by remember { mutableStateOf(existing?.active ?: true) }
    val optionList = options.lines().map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val valid = label.isNotBlank() && (type != "SELECT" || optionList.isNotEmpty()) && order.toIntOrNull() != null

    FormDialog(
        if (existing == null) "Add custom field" else "Edit field", if (existing == null) "Add" else "Save", valid, saving, error,
        onConfirm = {
            val o = if (type == "SELECT") optionList else emptyList()
            val h = help.trim().ifBlank { null }
            val n = order.toIntOrNull() ?: 0
            if (existing == null) onCreate(CustomFieldRequest(appliesTo, label.trim(), type, o, required, sticky, h, n, active))
            else onUpdate(CustomFieldPatch(label.trim(), o, required, sticky, h, n, active))
        },
        onDismiss = onDismiss,
    ) {
        if (existing == null) {
            ChoiceChips("Asked", listOf("TREE", "OBSERVATION"), appliesTo, ::appliesToLabel, { appliesTo = it })
        } else BoldValue("Asked", appliesToLabel(existing.appliesTo))
        TextInput(label, { label = it }, "Label")
        if (existing == null) {
            ChoiceChips("Type (can’t change later)", FIELD_TYPES, type, ::fieldTypeLabel, { type = it })
        } else {
            BoldValue("Type", fieldTypeLabel(existing.fieldType))
        }
        if (type == "SELECT") {
            TextInput(options, { options = it }, "Choices, one per line", singleLine = false, minLines = 3,
                supporting = if (optionList.isEmpty()) "Add at least one choice" else "${optionList.size} choices", isError = optionList.isEmpty())
        }
        SwitchRow("Required", required, { required = it })
        SwitchRow("Remember last answer", sticky, { sticky = it }, supporting = STICKY_HELP)
        TextInput(help, { help = it }, "Help text (optional)", singleLine = false)
        TextInput(order, { order = it.filter { c -> c.isDigit() || c == '-' }.take(6) }, "Sort order",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        SwitchRow("Active", active, { active = it })
    }
}
