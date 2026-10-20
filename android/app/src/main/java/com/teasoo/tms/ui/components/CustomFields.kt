package com.teasoo.tms.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.local.CustomFieldEntity
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.repo.FieldValues
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.time.LocalDate

/*
 * Administrator-defined fields (e.g. nursery batch number). Forms hold every value as text;
 * [toFieldValues] turns them into typed JSON for saving.
 */

fun CustomFieldEntity.options(): List<String> =
    runCatching { TmsJson.decodeFromString(ListSerializer(String.serializer()), optionsJson) }.getOrDefault(emptyList())

/** Typed values to save; blanks and unparseable numbers are left out. */
fun toFieldValues(defs: List<CustomFieldEntity>, values: Map<String, String>): FieldValues =
    defs.mapNotNull { d ->
        val raw = values[d.key]?.trim().orEmpty()
        if (raw.isEmpty()) return@mapNotNull null
        val v = when (d.fieldType) {
            "NUMBER" -> raw.replace(',', '.').toDoubleOrNull()?.let(::JsonPrimitive)
            "BOOLEAN" -> JsonPrimitive(raw == "true")
            else -> JsonPrimitive(raw)
        }
        v?.let { d.key to it }
    }.toMap()

/** Labels of required fields still empty. */
fun missingRequired(defs: List<CustomFieldEntity>, values: Map<String, String>): List<String> =
    defs.filter { it.required && values[it.key].isNullOrBlank() }.map { it.label }

/** Stored JSON values as form text. */
fun storedFieldText(json: String?): Map<String, String> =
    runCatching { TmsJson.parseToJsonElement(json ?: "{}") as JsonObject }.getOrNull()
        ?.mapValues { (_, v) -> runCatching { v.jsonPrimitive.content }.getOrDefault(v.toString()) }
        .orEmpty()

/** Label/value pairs for display, labelled by definition (including deactivated ones). */
fun displayFields(defs: List<CustomFieldEntity>, json: String?): List<Pair<String, String>> {
    val stored = runCatching { TmsJson.parseToJsonElement(json ?: "{}") as JsonObject }.getOrNull() ?: return emptyList()
    return stored.map { (key, v) ->
        val d = defs.find { it.key == key }
        val p = runCatching { v.jsonPrimitive }.getOrNull()
        val text = when {
            p?.booleanOrNull != null -> if (p.booleanOrNull == true) "Yes" else "No"
            p != null -> p.content
            else -> v.toString()
        }
        (d?.label ?: key) to text
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CustomFieldsForm(
    defs: List<CustomFieldEntity>,
    values: Map<String, String>,
    onChange: (key: String, value: String) -> Unit,
    showErrors: Boolean = false,
) {
    if (defs.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        defs.forEach { d ->
            val value = values[d.key].orEmpty()
            val label = d.label + if (d.required) " *" else ""
            val missing = showErrors && d.required && value.isBlank()
            val support = listOfNotNull(d.helpText, if (d.sticky) "Remembered for this session" else null).joinToString(" · ").ifBlank { null }
            when (d.fieldType) {
                "BOOLEAN" -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.weight(1f))
                    FilterChip(selected = value == "true", onClick = { onChange(d.key, if (value == "true") "" else "true") }, label = { Text("Yes") })
                    Spacer(Modifier.width(8.dp))
                    FilterChip(selected = value == "false", onClick = { onChange(d.key, if (value == "false") "" else "false") }, label = { Text("No") })
                }
                "SELECT" -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(label, style = MaterialTheme.typography.labelMedium, color = if (missing) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        d.options().forEach { o -> FilterChip(selected = value == o, onClick = { onChange(d.key, if (value == o) "" else o) }, label = { Text(o) }) }
                    }
                    support?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
                "DATE" -> DateField(label, value.takeIf { it.isNotBlank() }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }, { onChange(d.key, it?.toString().orEmpty()) })
                else -> OutlinedTextField(
                    value = value,
                    onValueChange = { onChange(d.key, it) },
                    label = { Text(label) },
                    singleLine = true,
                    isError = missing || (d.fieldType == "NUMBER" && value.isNotBlank() && value.replace(',', '.').toDoubleOrNull() == null),
                    supportingText = support?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = if (d.fieldType == "NUMBER") KeyboardType.Decimal else KeyboardType.Text),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
