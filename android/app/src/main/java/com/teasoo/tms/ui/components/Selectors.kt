package com.teasoo.tms.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.local.StatusEntity
import com.teasoo.tms.data.local.VisitType

/** Measuring height on the photo is withdrawn until it is reliable; heights are typed in instead (shown everywhere). */
const val SHOW_HEIGHT = false

/** Large, one-tap status choice (e.g. Alive / Dead); the selected one is ticked. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatusSelector(statuses: List<StatusEntity>, selectedId: String?, onSelect: (String) -> Unit, label: String = "Tree status") {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            statuses.forEach { st ->
                val selected = st.id == selectedId
                FilterChip(
                    selected = selected,
                    onClick = { onSelect(st.id) },
                    label = { Text(st.name, style = MaterialTheme.typography.titleSmall) },
                    leadingIcon = if (selected) ({ Icon(Icons.Default.Check, contentDescription = null) }) else null,
                    colors = if (st.isTerminal) FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.errorContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onErrorContainer,
                        selectedLeadingIconColor = MaterialTheme.colorScheme.onErrorContainer,
                    ) else FilterChipDefaults.filterChipColors(),
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
        }
        if (statuses.isEmpty()) Text("No statuses on this device yet. Sync while connected.", style = MaterialTheme.typography.bodySmall)
    }
}

/** Why this visit is made: monitoring (default) or maintenance, which resets the tree's maintenance due date. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VisitTypeSelector(selected: String, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Type of visit", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VisitType.forVisits.forEach { t ->
                FilterChip(
                    selected = t.code == selected, onClick = { onSelect(t.code) },
                    label = { Text(t.label, style = MaterialTheme.typography.titleSmall) },
                    leadingIcon = if (t.code == selected) ({ Icon(Icons.Default.Check, contentDescription = null) }) else null,
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
        }
    }
}
