package com.teasoo.tms.ui.admin

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.AdminProjectDto
import com.teasoo.tms.data.remote.AnalyticsStatusByGroup
import com.teasoo.tms.data.remote.AnalyticsSummary
import com.teasoo.tms.ui.components.*
import com.teasoo.tms.ui.theme.StatusColors
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import javax.inject.Inject

@HiltViewModel
class AnalyticsViewModel @Inject constructor(@ApplicationContext context: Context, private val api: AdminApi) : AdminBaseViewModel(context) {
    val summary = MutableStateFlow<AnalyticsSummary?>(null)
    val projects = MutableStateFlow<List<AdminProjectDto>>(emptyList())
    val projectId = MutableStateFlow<String?>(null)

    init { refresh() }

    fun select(id: String?) {
        if (id == projectId.value) return
        projectId.value = id
        summary.value = null
        refresh()
    }

    fun refresh() = load {
        coroutineScope {
            val p = async { runCatching { api.projects() }.getOrNull() }
            summary.value = api.summary(projectId.value)
            p.await()?.let { projects.value = it }
        }
    }
}

private val WEEK_LABEL = DateTimeFormatter.ofPattern("d MMM")
private val MONTH_LABEL = DateTimeFormatter.ofPattern("MMM yy")

/**
 * Analytics for administrators and executives: what has been registered and observed, by status,
 * area and species, field activity and data quality. Counts are registered trees, not survival rates.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsDashboardScreen(onBack: (() -> Unit)?, actions: @Composable RowScope.() -> Unit = {}, vm: AnalyticsViewModel = hiltViewModel()) {
    val summary = collect(vm.summary)
    val projects = collect(vm.projects)
    val projectId = collect(vm.projectId)
    val loading = collect(vm.loading)
    val error = collect(vm.error)

    AdminScaffold(
        title = "Dashboard",
        subtitle = projects.find { it.id == projectId }?.name ?: "All my projects",
        onBack = onBack,
        actions = {
            IconButton(onClick = { vm.refresh() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") }
            actions()
        },
    ) { padding ->
        AdminLoadState(loading && summary == null, error, summary != null, onRetry = { vm.refresh() }, modifier = Modifier.padding(padding)) {
            PullToRefreshBox(isRefreshing = loading && summary != null, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (projects.size > 1 || projectId != null) {
                        val options = listOf<Pair<String?, String>>(null to "All my projects") + projects.map { it.id to it.name }
                        Picker(
                            label = "Project",
                            items = options,
                            selected = options.find { it.first == projectId },
                            itemLabel = { it.second },
                            onSelect = { vm.select(it.first) },
                        )
                    }
                    summary?.let { DashboardBody(it) }
                }
            }
        }
    }
}

@Composable
private fun DashboardBody(s: AnalyticsSummary) {
    Notice(
        "Server data as of ${formatInstant(s.lastServerSyncAt ?: s.generatedAt)}. Records still on field devices appear after they sync.",
    )

    // KPI tiles
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kpi("Registered trees", s.totals.plantingEvents, Modifier.weight(1f), "Planting events")
        Kpi("Original trees", s.totals.originalTrees, Modifier.weight(1f))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kpi("Replacements", s.totals.replacementTrees, Modifier.weight(1f))
        Kpi("Dead or missing", s.totals.terminalStatusTrees, Modifier.weight(1f), "Latest status", tone = StatusColors.critical)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kpi("Unknown / overdue", s.totals.overdueUnknownTrees, Modifier.weight(1f), "No visit in ${s.overdueDays} days", tone = StatusColors.warning)
        Kpi("Open conflicts", s.completeness.openConflicts, Modifier.weight(1f), tone = if (s.completeness.openConflicts > 0) StatusColors.warning else null)
    }

    // Status donut
    ChartCard("Registered trees by current status", "Counts are registered trees, not survival rates.") {
        if (s.byStatus.all { it.count == 0 }) EmptyChart("No trees registered yet.")
        else DonutChart(
            s.byStatus.filter { it.count > 0 }.mapIndexed { i, row -> ChartSlice(row.name, row.count.toFloat(), StatusPalette.color(row.code, i)) },
            centerLabel = "trees",
        )
    }

    // Weekly activity
    ChartCard("Field activity by week", "Last 12 weeks: trees registered and visits recorded.") {
        val weeks = s.activityByWeek
        if (weeks.isEmpty() || weeks.all { it.registrations == 0 && it.observations == 0 }) EmptyChart("No field activity in the last 12 weeks.")
        else ColumnChart(
            groups = weeks.map { w ->
                ColumnGroup(runCatching { LocalDate.parse(w.week).format(WEEK_LABEL) }.getOrDefault(w.week), listOf(w.registrations.toFloat(), w.observations.toFloat()))
            },
            seriesLabels = listOf("Registrations", "Observations"),
        )
    }

    // Growth
    ChartCard("Average height by species", "Monthly average of measured heights, for the most measured species.") {
        val bySpecies = s.growth.filter { it.avgHeightCm != null }.groupBy { it.speciesId }
        if (bySpecies.isEmpty()) EmptyChart("No height measurements yet. Heights recorded at visits appear here.")
        else {
            val months = s.growth.map { it.month }.distinct().sorted()
            val top = bySpecies.entries.sortedByDescending { e -> e.value.sumOf { it.measuredTrees } }.take(4)
            val series = top.mapIndexed { i, (_, rows) ->
                val first = rows.first()
                ChartSeries(
                    first.speciesCommonName?.takeIf { it.isNotBlank() } ?: first.speciesName,
                    rows.map { ChartPoint(months.indexOf(it.month).toFloat(), it.avgHeightCm!!.toFloat()) },
                    ChartPalette.series(i),
                )
            }
            LineChart(
                series = series,
                xLabel = { x -> months.getOrNull(x.toInt())?.let { m -> runCatching { YearMonth.parse(m).format(MONTH_LABEL) }.getOrDefault(m) } ?: "" },
                yUnit = "cm",
                xTicks = months.indices.map { it.toFloat() },
            )
        }
    }

    // Status by sector / species
    val statusOrder = s.byStatus.mapNotNull { it.code }
    ChartCard("Status by sector", "Registered trees in each sector, split by latest status. Tap a bar for numbers.") {
        StatusBars(s.statusBySector, statusOrder, emptyText = "No trees in any sector yet.")
    }
    ChartCard("Status by species", "Tap a bar for numbers.") {
        StatusBars(s.statusBySpecies, statusOrder, emptyText = "No trees registered yet.")
    }

    // Officer activity
    ChartCard("Field officer activity", "Last 30 days.") {
        if (s.officers.isEmpty()) EmptyChart("No field officers assigned to these projects.")
        else {
            val reg = MaterialTheme.colorScheme.primary
            val obs = MaterialTheme.colorScheme.tertiary
            StackedBarChart(
                s.officers.sortedByDescending { it.treesRegistered30d + it.observations30d }.map { o ->
                    StackedBar(o.fullName, listOf(StackSegment("Trees registered", o.treesRegistered30d.toFloat(), reg), StackSegment("Observations", o.observations30d.toFloat(), obs)))
                },
                legend = listOf(LegendItem("Trees registered", reg), LegendItem("Observations", obs)),
            )
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Text("Last sync", style = MaterialTheme.typography.labelLarge)
            s.officers.forEach { o ->
                val stale = isStale(o.lastSyncAt)
                BoldValue(o.fullName, relativeTime(o.lastSyncAt), valueColor = if (stale) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        }
    }

    // Data completeness
    ChartCard("Data completeness", "Things to follow up so the records are complete.") {
        val c = s.completeness
        CompletenessRow("Never observed after registration", c.neverObserved)
        CompletenessRow("Missing planted date", c.missingPlantedOn)
        CompletenessRow("Trees with photos not yet verified", c.unverifiedPhotos)
        CompletenessRow("Open sync conflicts", c.openConflicts)
        CompletenessRow("Devices not synced in 7 days", c.devicesNotSynced7Days)
    }

    if (s.byPlantingYear.isNotEmpty()) ChartCard("By planting year", null) {
        s.byPlantingYear.forEach { y -> BoldValue(y.name, "${y.originalTrees} original · ${y.replacementTrees} replacement") }
    }

    s.notes.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun StatusBars(rows: List<AnalyticsStatusByGroup>, statusOrder: List<String>, emptyText: String) {
    if (rows.isEmpty()) { EmptyChart(emptyText); return }
    val codes = (statusOrder + rows.mapNotNull { it.code }).distinct()
    val names = rows.associate { (it.code ?: "UNKNOWN") to (it.statusName ?: it.code ?: "Not observed") }
    val colors = codes.mapIndexed { i, c -> c to StatusPalette.color(c, i) }.toMap()
    val groups = rows.groupBy { it.groupCode ?: it.groupName ?: "—" }
        .map { (_, list) ->
            val first = list.first()
            StackedBar(
                first.groupName ?: first.groupCode ?: "—",
                codes.mapNotNull { code ->
                    val n = list.filter { (it.code ?: "UNKNOWN") == code }.sumOf { it.count }
                    if (n == 0) null else StackSegment(names[code] ?: code, n.toFloat(), colors[code] ?: StatusPalette.color(code))
                },
            )
        }
        .sortedByDescending { it.total }
    val shown = groups.take(10)
    StackedBarChart(
        shown,
        legend = codes.filter { names.containsKey(it) }.map { LegendItem(names[it] ?: it, colors[it] ?: Color.Gray) },
    )
    if (groups.size > shown.size) Text("Showing the ${shown.size} largest of ${groups.size}.", style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun Kpi(label: String, value: Int, modifier: Modifier, foot: String? = null, tone: Color? = null) {
    OutlinedCard(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            Text(
                "%,d".format(value), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
                color = if (tone != null && value > 0) tone else Color.Unspecified,
            )
            foot?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
        }
    }
}

@Composable
fun ChartCard(title: String, subtitle: String?, content: @Composable ColumnScope.() -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            content()
        }
    }
}

@Composable
private fun EmptyChart(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp))
}

@Composable
private fun CompletenessRow(label: String, value: Int) {
    BoldValue(label, "%,d".format(value), valueColor = if (value > 0) MaterialTheme.colorScheme.error else StatusColors.good)
}
