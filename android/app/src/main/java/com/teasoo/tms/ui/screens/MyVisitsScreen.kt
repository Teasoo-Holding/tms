package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.MyVisitRow
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

enum class VisitPeriod(val label: String) { TODAY("Today"), WEEK("Last 7 days"), ALL("All") }

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class MyVisitsViewModel @Inject constructor(db: TmsDatabase, auth: SessionStore) : ViewModel() {
    val period = MutableStateFlow(VisitPeriod.TODAY)
    private val userId = auth.state.map { (it as? SessionState.Active)?.user?.id }.filterNotNull().distinctUntilChanged()

    val rows: StateFlow<List<MyVisitRow>> = combine(userId, period) { u, p -> u to p }
        .flatMapLatest { (u, p) ->
            val since = when (p) {
                VisitPeriod.TODAY -> LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant()
                VisitPeriod.WEEK -> LocalDate.now().minusDays(6).atStartOfDay(ZoneId.systemDefault()).toInstant()
                VisitPeriod.ALL -> Instant.EPOCH
            }
            db.observations().mine(u, since.toString())
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
}

/** The collector's own visits, newest first, each with its sync state. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyVisitsScreen(onOpenTree: (String) -> Unit, onBack: () -> Unit, vm: MyVisitsViewModel = hiltViewModel()) {
    val rows by vm.rows.collectAsStateWithLifecycle()
    val period by vm.period.collectAsStateWithLifecycle()
    Scaffold(topBar = {
        TopAppBar(
            title = {
                Column {
                    Text("My visits")
                    Text("${rows.size} · ${rows.count { it.syncState == "PENDING" }} not sent yet", style = MaterialTheme.typography.bodySmall)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    VisitPeriod.entries.forEach { p -> FilterChip(p == period, { vm.period.value = p }, { Text(p.label) }) }
                }
            }
            if (rows.isEmpty()) item { Notice("No visits recorded by you in this period.") }
            items(rows, key = { it.id }) { r ->
                Card(onClick = { onOpenTree(r.treeId) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(r.physicalTreeId, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            SyncBadge(r.syncState)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip(r.statusCode, r.statusName)
                            Text(
                                listOfNotNull(
                                    when { r.isInitial -> "Registered"; r.isCorrection -> "Correction"; else -> "Visit" },
                                    listOfNotNull(r.sectorCode, r.subSectorCode).joinToString("/").ifBlank { null },
                                    r.heightCm?.let(::formatHeight),
                                    "${r.photoCount} photo${if (r.photoCount == 1) "" else "s"}",
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text("Saved ${formatInstant(r.recordedAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        r.remarks?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        r.syncMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}
