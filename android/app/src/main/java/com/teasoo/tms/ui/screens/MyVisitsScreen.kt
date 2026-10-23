package com.teasoo.tms.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
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
import com.teasoo.tms.data.local.MediaEntity
import com.teasoo.tms.data.local.MyVisitRow
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.repo.PhotoLoader
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

/** One day of the collector's work. */
data class VisitDay(val date: LocalDate, val rows: List<MyVisitRow>) {
    val registered get() = rows.count { it.isInitial }
    val visits get() = rows.count { !it.isInitial && !it.isCorrection }
    val unsent get() = rows.count { it.syncState == "PENDING" }
    val first get() = rows.minOf { it.observedAt }
    val last get() = rows.maxOf { it.observedAt }
}

private fun localDate(iso: String) = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrDefault(LocalDate.EPOCH)
private val TIME = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
private val DAY = DateTimeFormatter.ofPattern("EEE d MMM yyyy")
private fun time(iso: String) = runCatching { TIME.format(Instant.parse(iso)) }.getOrDefault("")
private fun dayLabel(d: LocalDate) = when (d) {
    LocalDate.now() -> "Today"
    LocalDate.now().minusDays(1) -> "Yesterday"
    else -> DAY.format(d)
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class MyVisitsViewModel @Inject constructor(private val db: TmsDatabase, auth: SessionStore, private val photos: PhotoLoader) : ViewModel() {
    private val userId = auth.state.map { (it as? SessionState.Active)?.user?.id }.filterNotNull().distinctUntilChanged()

    /** Days with any work by this person, newest first; the date is when the data was collected. */
    val days: StateFlow<List<VisitDay>> = userId.flatMapLatest { u -> db.observations().mine(u, Instant.EPOCH.toString()) }
        .map { rows -> rows.groupBy { localDate(it.observedAt) }.map { (d, r) -> VisitDay(d, r.sortedByDescending { it.observedAt }) }.sortedByDescending { it.date } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val openDay = MutableStateFlow<LocalDate?>(null)

    suspend fun firstPhoto(observationId: String): MediaEntity? = db.media().firstForObservation(observationId)
    suspend fun photo(m: MediaEntity, maxPx: Int) = photos.load(m, maxPx)
}

/** The collector's own work by day; open a day to see what was recorded, newest first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyVisitsScreen(onOpenTree: (String) -> Unit, onBack: () -> Unit, vm: MyVisitsViewModel = hiltViewModel()) {
    val days by vm.days.collectAsStateWithLifecycle()
    val openDate by vm.openDay.collectAsStateWithLifecycle()
    val open = days.find { it.date == openDate }
    BackHandler(enabled = open != null) { vm.openDay.value = null }
    Scaffold(topBar = {
        TopAppBar(
            title = {
                Column {
                    Text(open?.let { dayLabel(it.date) } ?: "My visits")
                    val unsent = (open?.let { listOf(it) } ?: days).sumOf { it.unsent }
                    val total = (open?.let { listOf(it) } ?: days).sumOf { it.rows.size }
                    Text("$total records" + if (unsent > 0) " · $unsent not sent yet" else "", style = MaterialTheme.typography.bodySmall)
                }
            },
            navigationIcon = {
                IconButton(onClick = { if (open != null) vm.openDay.value = null else onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (open == null) {
                if (days.isEmpty()) item { Notice("Nothing recorded by you on this phone yet.") }
                items(days, key = { it.date.toString() }) { d -> DayCard(d) { vm.openDay.value = d.date } }
            } else {
                items(open.rows, key = { it.id }) { r -> VisitCard(r, vm::firstPhoto, vm::photo) { onOpenTree(r.treeId) } }
            }
        }
    }
}

@Composable
private fun DayCard(d: VisitDay, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(dayLabel(d.date), style = MaterialTheme.typography.titleMedium)
                Text("${time(d.first)} – ${time(d.last)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    listOfNotNull(
                        "${d.registered} registered".takeIf { d.registered > 0 },
                        "${d.visits} visit${if (d.visits == 1) "" else "s"}".takeIf { d.visits > 0 },
                    ).joinToString(" · ").ifBlank { "Corrections only" },
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (d.unsent > 0) Text("${d.unsent} not sent yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Open")
        }
    }
}

@Composable
private fun VisitCard(r: MyVisitRow, firstPhoto: suspend (String) -> MediaEntity?, load: PhotoSource, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TreeThumb(r.id, firstPhoto, load, size = 72.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(time(r.observedAt), style = MaterialTheme.typography.titleSmall)
                    Text(r.physicalTreeId, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusChip(r.statusCode, r.statusName)
                    Text(
                        listOfNotNull(
                            when { r.isInitial -> "Registered"; r.isCorrection -> "Correction"; else -> "Visit" },
                            listOfNotNull(r.sectorCode, r.subSectorCode).joinToString("/").ifBlank { null },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                r.remarks?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                SyncBadge(r.syncState)
                r.syncMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
