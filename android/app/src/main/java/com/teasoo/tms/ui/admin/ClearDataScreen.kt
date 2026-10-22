package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.ClearDataRequest
import com.teasoo.tms.data.remote.ClearDataResult
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

const val CLEAR_DATA_PHRASE = "DELETE ALL DATA"

@HiltViewModel
class ClearDataViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi) : AdminBaseViewModel(context) {
    val result = MutableStateFlow<ClearDataResult?>(null)

    /** On success the base class syncs this phone, so its local copy resets too. */
    fun clear(scope: String, password: String) =
        save(success = null) { result.value = api.clearData(ClearDataRequest(scope, CLEAR_DATA_PHRASE, password)) }
}

private enum class ClearScope(val code: String, val title: String, val detail: String) {
    FIELD_DATA("FIELD_DATA", "Field data only", "Trees, visits, photos and sync history. Setup is kept."),
    EVERYTHING("EVERYTHING", "Everything", "Also projects, areas, formats, species, statuses and vendors."),
}

@Composable
fun ClearDataScreen(onBack: () -> Unit, vm: ClearDataViewModel = hiltViewModel()) {
    val saving = collect(vm.saving)
    val error = collect(vm.formError)
    val result = collect(vm.result)
    var scope by rememberSaveable { mutableStateOf<ClearScope?>(null) }
    var phrase by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val phraseOk = phrase.trim() == CLEAR_DATA_PHRASE
    val valid = scope != null && phraseOk && password.isNotEmpty()

    AdminScaffold(title = "Clear data", onBack = onBack) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (result != null) {
                ClearedSummary(result, onDone = onBack)
                return@Column
            }
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ClearScope.entries.forEach { s -> ScopeOption(s, selected = scope == s, enabled = !saving) { scope = s; vm.clearFormError() } }
            }
            Text("Accounts and the activity log are kept.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            OutlinedTextField(
                phrase, { phrase = it.uppercase().take(32); vm.clearFormError() },
                label = { Text("Type $CLEAR_DATA_PHRASE") }, singleLine = true, enabled = !saving,
                isError = phrase.isNotBlank() && !phraseOk && !CLEAR_DATA_PHRASE.startsWith(phrase.trim()),
                textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(),
            )
            PasswordField(password, { password = it; vm.clearFormError() }, "Your password", enabled = !saving, isError = error == "Your password is incorrect.")

            error?.let {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                    Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }

            Button(
                onClick = { scope?.let { vm.clear(it.code, password) } },
                enabled = valid && !saving,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                shape = MaterialTheme.shapes.extraLarge,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) {
                if (saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onError)
                else Icon(Icons.Default.DeleteForever, null)
                Spacer(Modifier.width(8.dp))
                Text(if (saving) "Deleting…" else if (scope == ClearScope.EVERYTHING) "Delete everything" else "Delete field data")
            }
        }
    }
}

@Composable
private fun ScopeOption(s: ClearScope, selected: Boolean, enabled: Boolean, onSelect: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = if (selected) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f) else MaterialTheme.colorScheme.surfaceContainerHigh,
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.error) else null,
        modifier = Modifier.fillMaxWidth().selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = null, enabled = enabled)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(s.title, style = MaterialTheme.typography.titleMedium)
                Text(s.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ClearedSummary(r: ClearDataResult, onDone: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Default.CheckCircle, null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
        Text("Data cleared", style = MaterialTheme.typography.headlineSmall)
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                BoldValue("Trees", "%,d".format(r.trees))
                BoldValue("Visits", "%,d".format(r.visits))
                BoldValue("Photos", "%,d".format(r.photos))
                if (r.scope == "EVERYTHING") BoldValue("Projects", "%,d".format(r.projects))
            }
        }
        Text("This phone is syncing to match.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onDone, shape = MaterialTheme.shapes.extraLarge, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Done") }
    }
}
