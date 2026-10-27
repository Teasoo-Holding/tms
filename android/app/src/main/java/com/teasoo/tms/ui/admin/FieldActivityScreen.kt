package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.DayActivityDto
import com.teasoo.tms.data.remote.FieldActivityResponse
import com.teasoo.tms.data.remote.SessionActivityDto
import com.teasoo.tms.ui.components.Picker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

enum class ActivityPeriod(val label: String, val days: Long) { TODAY("Today", 0), WEEK("7 days", 6), MONTH("30 days", 29) }

@HiltViewModel
class FieldActivityViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi, db: TmsDatabase) : AdminBaseViewModel(context) {
    val projects = db.reference().projects().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val projectId = MutableStateFlow<String?>(null)
    val period = MutableStateFlow(ActivityPeriod.WEEK)
    val report = MutableStateFlow<FieldActivityResponse?>(null)

    init { refresh() }

    fun refresh() = load {
        val to = LocalDate.now()
        report.value = api.fieldActivity(projectId.value, to.minusDays(period.value.days).toString(), to.toString(), ZoneId.systemDefault().id)
    }

    fun setProject(id: String?) { projectId.value = id; refresh() }
    fun setPeriod(p: ActivityPeriod) { period.value = p; refresh() }
}

private val DAY = DateTimeFormatter.ofPattern("EEE d MMM")
private val TIME = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
private fun time(iso: String?) = iso?.let { runCatching { TIME.format(Instant.parse(it)) }.getOrNull() } ?: "–"
private fun dayLabel(date: String) = runCatching {
    val d = LocalDate.parse(date)
    when (d) { LocalDate.now() -> "Today"; LocalDate.now().minusDays(1) -> "Yesterday"; else -> DAY.format(d) }
}.getOrDefault(date)

/** How much each field officer recorded, per day and per field session, to follow data collection. Online only. */
@Composable
fun FieldActivityScreen(onBack: () -> Unit, vm: FieldActivityViewModel = hiltViewModel()) {
    val projects by vm.projects.collectAsStateWithLifecycle()
    val projectId = collect(vm.projectId)
    val period = collect(vm.period)
    val report = collect(vm.report)
    val loading = collect(vm.loading)
    val error = collect(vm.error)
    AdminScaffold(title = "Field activity", onBack = onBack, actions = {
        IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") }
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Picker("Project", listOf<com.teasoo.tms.data.local.ProjectEntity?>(null) + projects, projects.find { it.id == projectId },
                    { it?.name ?: "All projects" }, { vm.setProject(it?.id) }, supportingText = null)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActivityPeriod.entries.forEach { p -> FilterChip(p == period, { vm.setPeriod(p) }, { Text(p.label) }, modifier = Modifier.heightIn(min = 48.dp)) }
                }
            }
            AdminLoadState(loading, error, report != null, onRetry = { vm.refresh() }) {
                val r = report ?: return@AdminLoadState
                LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (r.officers.isEmpty()) item { EmptyState(Icons.Default.Timeline, "Nothing recorded in this period") }
                    if (r.officers.isNotEmpty()) item { SectionHeader("By officer", supporting = "${dayLabel(r.from)} – ${dayLabel(r.to)}") }
                    items(r.officers, key = { "o" + it.userId }) { o ->
                        OutlinedCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(o.userName ?: "Unknown", style = MaterialTheme.typography.titleSmall)
                                Text("${o.treesRegistered} trees registered · ${o.visits} visits · ${o.photos} photos", style = MaterialTheme.typography.bodyMedium)
                                Text("${o.daysActive} day${if (o.daysActive == 1) "" else "s"} active · ${o.sessions} session${if (o.sessions == 1) "" else "s"}" +
                                    if (o.corrections > 0) " · ${o.corrections} corrections" else "",
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (r.days.isNotEmpty()) item { SectionHeader("By day", supporting = "Tap an officer's day to see each session") }
                    r.days.groupBy { it.date }.forEach { (date, rows) ->
                        item(key = "d$date") { Text(dayLabel(date), style = MaterialTheme.typography.titleMedium) }
                        items(rows, key = { "r$date${it.userId}" }) { DayRow(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayRow(d: DayActivityDto) {
    var open by remember { mutableStateOf(false) }
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.clickable { open = !open }.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(d.userName ?: "Unknown", style = MaterialTheme.typography.titleSmall)
                    Text("${d.treesRegistered} registered · ${d.visits} visits · ${d.photos} photos", style = MaterialTheme.typography.bodyMedium)
                    Text("${time(d.firstAt)} – ${time(d.lastAt)} · ${d.sessions.size} session${if (d.sessions.size == 1) "" else "s"}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(if (open) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight, if (open) "Hide sessions" else "Show sessions")
            }
            if (open) d.sessions.forEach { SessionRow(it) }
        }
    }
}

@Composable
private fun SessionRow(s: SessionActivityDto) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${time(s.firstAt)} – ${time(s.lastAt)}" + if (s.fieldSessionId == null) " · without a session" else "", style = MaterialTheme.typography.labelLarge)
            Text(
                listOfNotNull(
                    s.projectName, s.plantingYear,
                    s.vendors.takeIf { it.isNotEmpty() }?.joinToString(", ")?.let { "vendor $it" },
                    (s.subSectors.ifEmpty { s.sectors }).takeIf { it.isNotEmpty() }?.joinToString(", "),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
            )
            Text("${s.treesRegistered} registered · ${s.visits} visits · ${s.photos} photos" + if (s.corrections > 0) " · ${s.corrections} corrections" else "",
                style = MaterialTheme.typography.bodyMedium)
        }
    }
}
