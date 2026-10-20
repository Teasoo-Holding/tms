package com.teasoo.tms.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.repo.FieldSessionRepository
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.ui.components.StatusChip
import com.teasoo.tms.ui.components.SyncBadge
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import java.time.Duration
import java.time.Instant
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@HiltViewModel
class VisitViewModel @Inject constructor(db: TmsDatabase, sessions: FieldSessionRepository, auth: SessionStore) : ViewModel() {
    val serial = MutableStateFlow("")
    val wholeSector = MutableStateFlow(false)
    private val session = sessions.session.filterNotNull()

    val rows = combine(session, serial.debounce(150), wholeSector) { s, q, all -> Triple(s, q, all) }
        .flatMapLatest { (s, q, all) -> db.trees().visitList(s.projectId, s.plantingYearId, s.sectorId, if (all) null else s.subSectorId, q) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /** Trees this officer has already observed in the current session, ticked off in the list. */
    val visited: StateFlow<Set<String>> = combine(session, auth.state) { s, a -> s to (a as? SessionState.Active)?.user?.id }
        .flatMapLatest { (s, u) -> if (u == null) flowOf(emptyList()) else db.observations().treesObservedSince(u, s.startedAt) }
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VisitScreen(onObserve: (String) -> Unit, onOpenTree: (String) -> Unit, onRegister: () -> Unit, onBack: () -> Unit,
                vm: VisitViewModel = hiltViewModel(), sessionVm: FieldSessionViewModel = hiltViewModel()) {
    val ctx by sessionVm.context.collectAsStateWithLifecycle()
    val rows by vm.rows.collectAsStateWithLifecycle()
    val visited by vm.visited.collectAsStateWithLifecycle()
    val serial by vm.serial.collectAsStateWithLifecycle()
    val wholeSector by vm.wholeSector.collectAsStateWithLifecycle()

    Scaffold(topBar = {
        TopAppBar(
            title = { Column { Text("Visit trees"); ctx?.let { Text(it.title, style = MaterialTheme.typography.bodySmall) } } },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 16.dp)) {
            ctx?.let { SubSectorChips(it) { id -> sessionVm.switchSubSector(id) } }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(wholeSector, { vm.wholeSector.value = it })
                Text("Show the whole sector", style = MaterialTheme.typography.bodyMedium)
            }
            OutlinedTextField(
                serial, { vm.serial.value = it.filter(Char::isDigit) },
                label = { Text("Find by label serial") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
            )
            val done = rows.count { it.id in visited }
            Text(
                if (serial.isBlank()) "${rows.size} trees here · $done visited this session · not seen longest first"
                else "${rows.size} match",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 8.dp),
            )
            if (serial.isNotBlank() && rows.isEmpty()) {
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("No tree with serial $serial in this area on this device.")
                        TextButton(onClick = onRegister) { Text("Register a new tree instead") }
                    }
                }
            }
            LazyColumn {
                items(rows, key = { it.id }) { t ->
                    ListItem(
                        modifier = Modifier.clickable { onObserve(t.id) },
                        leadingContent = {
                            if (t.id in visited) Icon(Icons.Default.CheckCircle, contentDescription = "Visited this session", tint = MaterialTheme.colorScheme.primary)
                        },
                        headlineContent = { Text(t.physicalTreeId, fontFamily = FontFamily.Monospace) },
                        supportingContent = {
                            Column {
                                Text("${t.subSectorCode} · ${t.speciesName} · ${lastSeen(t.lastObservedAt)}")
                                SyncBadge(t.syncState)
                            }
                        },
                        trailingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                StatusChip(t.statusCode, t.statusName)
                                IconButton(onClick = { onOpenTree(t.id) }) { Icon(Icons.Outlined.Info, contentDescription = "Tree details") }
                            }
                        },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

private fun lastSeen(iso: String?): String {
    if (iso == null) return "never observed"
    val days = runCatching { Duration.between(Instant.parse(iso), Instant.now()).toDays() }.getOrNull() ?: return "observed"
    return when {
        days < 1 -> "seen today"
        days == 1L -> "seen yesterday"
        else -> "last seen $days days ago"
    }
}
