package com.teasoo.tms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.local.SectorEntity
import com.teasoo.tms.data.local.SubSectorEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.Picker
import androidx.compose.foundation.background
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.eq
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.literal
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AreaMapViewModel @Inject constructor(db: TmsDatabase) : ViewModel() {
    private val ref = db.reference()
    val projects = ref.projects().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val projectId = MutableStateFlow<String?>(null)
    val years = projectId.filterNotNull().flatMapLatest { ref.years(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    /** Each planting year has its own land survey, so the map shows one year at a time. */
    val yearId = MutableStateFlow<String?>(null)
    val sectors = combine(projectId.filterNotNull(), yearId) { p, y -> p to y }
        .flatMapLatest { (p, y) -> if (y == null) ref.sectors(p) else ref.sectorsForYear(p, y) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { ref.subSectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val shares = projectId.filterNotNull().flatMapLatest { db.trees().shareBySubSector(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    fun selectProject(id: String) { if (projectId.value != id) { projectId.value = id; yearId.value = null } }
}

/** Trees, area and density for one surveyed area (a sector, or a sub-sector inside it). */
data class AreaDensity(val id: String, val label: String, val hectares: Double?, val trees: Int, val alive: Int, val dead: Int) {
    val perHectare: Double? get() = hectares?.takeIf { it > 0 }?.let { trees / it }
}

/** Area in hectares of a GeoJSON Polygon's outer ring, on the sphere (accurate for plantation-sized areas). */
internal fun hectares(geoJson: String?): Double? = runCatching {
    val ring = Polygon.fromJson(geoJson ?: return null).coordinates().firstOrNull() ?: return null
    if (ring.size < 4) return null
    val r = 6_378_137.0
    var sum = 0.0
    for (i in 0 until ring.size - 1) {
        val a = ring[i]; val b = ring[i + 1]
        sum += Math.toRadians(b.longitude() - a.longitude()) * (2 + kotlin.math.sin(Math.toRadians(a.latitude())) + kotlin.math.sin(Math.toRadians(b.latitude())))
    }
    kotlin.math.abs(sum * r * r / 2) / 10_000
}.getOrNull()

private const val ALIVE_DOT = "#2e9e4f"
private const val DEAD_DOT = "#d32f2f"
private const val UNSEEN_DOT = "#8d8d8d"
private const val MAX_DOTS_PER_AREA = 1_500
private const val MAX_DOTS = 20_000

/** How many trees each dot stands for, so very large plantings still draw quickly. */
internal fun treesPerDot(areaTrees: List<Int>): Int {
    val total = areaTrees.sum()
    val biggest = areaTrees.maxOrNull() ?: 0
    return maxOf(1, (total + MAX_DOTS - 1) / MAX_DOTS, (biggest + MAX_DOTS_PER_AREA - 1) / MAX_DOTS_PER_AREA)
}

/**
 * [count] points scattered inside a polygon's outer ring. Trees have no GPS, so the positions only illustrate how
 * many trees an area holds; they are seeded by the area so the picture is the same every time.
 */
internal fun scatter(ring: List<Pair<Double, Double>>, count: Int, seed: Long): List<Pair<Double, Double>> {
    if (ring.size < 4 || count <= 0) return emptyList()
    val minX = ring.minOf { it.first }; val maxX = ring.maxOf { it.first }
    val minY = ring.minOf { it.second }; val maxY = ring.maxOf { it.second }
    fun inside(x: Double, y: Double): Boolean {
        var hit = false
        var j = ring.size - 1
        for (i in ring.indices) {
            val (xi, yi) = ring[i]; val (xj, yj) = ring[j]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
            j = i
        }
        return hit
    }
    val random = java.util.Random(seed)
    val out = ArrayList<Pair<Double, Double>>(count)
    var attempts = 0
    while (out.size < count && attempts < count * 50) {
        attempts++
        val x = minX + random.nextDouble() * (maxX - minX)
        val y = minY + random.nextDouble() * (maxY - minY)
        if (inside(x, y)) out += x to y
    }
    return out
}

/**
 * For administrators: each surveyed sector and sub-sector, drawn from its corner points, with one dot per registered
 * tree scattered inside it (green alive, red dead, grey not yet visited), so planting density shows at a glance.
 * Trees have no GPS of their own: the number of dots per area is exact, their positions inside it are illustrative.
 * Works offline from the data on this phone; a licensed basemap is shown only when MAP_STYLE_URL is configured.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AreaMapScreen(app: AppViewModel, onBack: () -> Unit, vm: AreaMapViewModel = hiltViewModel()) {
    val selected by app.selectedProjectId.collectAsStateWithLifecycle()
    val projects by vm.projects.collectAsStateWithLifecycle()
    val projectId by vm.projectId.collectAsStateWithLifecycle()
    LaunchedEffect(selected, projects) { if (projectId == null) (selected ?: projects.firstOrNull()?.id)?.let(vm::selectProject) }
    val years by vm.years.collectAsStateWithLifecycle()
    val yearId by vm.yearId.collectAsStateWithLifecycle()
    // Latest year first by default: the survey being planted now.
    LaunchedEffect(years) { if (yearId == null) years.maxByOrNull { it.yearLabel }?.let { vm.yearId.value = it.id } }
    val sectors by vm.sectors.collectAsStateWithLifecycle()
    val subs = vm.subSectors.collectAsStateWithLifecycle().value.filter { s -> sectors.any { it.id == s.sectorId } }
    val shares by vm.shares.collectAsStateWithLifecycle()
    val byId = shares.associateBy { it.subSectorId }
    val subDensity = subs.associate { ss ->
        val sh = byId[ss.id]
        ss.id to AreaDensity(ss.id, "${ss.shortCode} · ${ss.name}", hectares(ss.boundaryJson), sh?.total ?: 0, sh?.alive ?: 0, sh?.dead ?: 0)
    }
    val sectorDensity = sectors.associate { sec ->
        val inside = subs.filter { it.sectorId == sec.id }.mapNotNull { subDensity[it.id] }
        sec.id to AreaDensity(
            sec.id, "${sec.shortCode} · ${sec.name}",
            hectares(sec.boundaryJson) ?: inside.mapNotNull { it.hectares }.takeIf { it.isNotEmpty() }?.sum(),
            inside.sumOf { it.trees }, inside.sumOf { it.alive }, inside.sumOf { it.dead },
        )
    }
    // Areas whose trees are drawn: sub-sectors with an outline, and sectors that are not split into outlined sub-sectors.
    val splitSectors = sectors.filter { s -> subs.any { it.sectorId == s.id && it.boundaryJson != null } }.map { it.id }.toSet()
    val dotted = subs.filter { it.boundaryJson != null }.mapNotNull { subDensity[it.id] } +
        sectors.filter { it.id !in splitSectors && it.boundaryJson != null }.mapNotNull { sectorDensity[it.id] }
    val perDot = treesPerDot(dotted.map { it.trees })
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    Scaffold(topBar = {
        TopAppBar(title = { Text("Tree density map") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding)) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Picker("Project", projects, projects.find { it.id == projectId }, { it.name }, { vm.selectProject(it.id) }, modifier = Modifier.weight(1.4f), supportingText = null)
                Picker("Planting year", years, years.find { it.id == yearId }, { it.yearLabel }, { vm.yearId.value = it.id }, modifier = Modifier.weight(1f), supportingText = null)
            }
            if (BuildConfig.MAP_STYLE_URL.isBlank()) {
                Text("Area outlines only (no background map configured).", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp))
            }
            AndroidView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                factory = { ctx ->
                    MapLibre.getInstance(ctx)
                    MapView(ctx).also { view ->
                        view.onCreate(null)
                        lifecycle.addObserver(LifecycleEventObserver { _, e ->
                            when (e) {
                                Lifecycle.Event.ON_START -> view.onStart()
                                Lifecycle.Event.ON_RESUME -> view.onResume()
                                Lifecycle.Event.ON_PAUSE -> view.onPause()
                                Lifecycle.Event.ON_STOP -> view.onStop()
                                Lifecycle.Event.ON_DESTROY -> view.onDestroy()
                                else -> {}
                            }
                        })
                    }
                },
                update = { view ->
                    view.getMapAsync { map -> map.setStyle(styleBuilder()) { style -> render(map, style, sectors, subs, sectorDensity, subDensity, splitSectors, perDot) } }
                },
            )
            DensityList(sectors, subs, sectorDensity, subDensity, perDot, Modifier.fillMaxWidth().weight(0.9f))
        }
    }
}

private fun styleBuilder(): Style.Builder =
    if (BuildConfig.MAP_STYLE_URL.isNotBlank()) Style.Builder().fromUri(BuildConfig.MAP_STYLE_URL)
    else Style.Builder().fromJson("""{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#f4f5f1"}}]}""")

private fun render(
    map: org.maplibre.android.maps.MapLibreMap,
    style: Style,
    sectors: List<SectorEntity>,
    subs: List<SubSectorEntity>,
    sectorDensity: Map<String, AreaDensity>,
    subDensity: Map<String, AreaDensity>,
    splitSectors: Set<String>,
    perDot: Int,
) {
    val polygons = mutableListOf<Feature>()
    val dots = mutableListOf<Feature>()
    val bounds = LatLngBounds.Builder()
    var count = 0
    fun add(kind: String, id: String, lat: Double, lon: Double, boundary: String?, d: AreaDensity?, withDots: Boolean) {
        bounds.include(LatLng(lat, lon)); count++
        val polygon = boundary?.let { runCatching { Polygon.fromJson(it) }.getOrNull() }
        if (polygon != null) {
            polygons += Feature.fromGeometry(polygon).apply { addStringProperty("kind", kind) }
            polygon.coordinates().flatten().forEach { bounds.include(LatLng(it.latitude(), it.longitude())); count++ }
        }
        if (!withDots || d == null || d.trees == 0) return
        val unseen = (d.trees - d.alive - d.dead).coerceAtLeast(0)
        val colours = List((d.alive + perDot - 1) / perDot) { ALIVE_DOT } + List((d.dead + perDot - 1) / perDot) { DEAD_DOT } +
            List((unseen + perDot - 1) / perDot) { UNSEEN_DOT }
        val ring = polygon?.coordinates()?.firstOrNull()?.map { it.longitude() to it.latitude() }
        val spots = if (ring != null) scatter(ring, colours.size, id.hashCode().toLong())
        else List(colours.size) { lon to lat } // no corner points: stacked on the reference point
        // Mix the colours so dead and unvisited trees are spread through the area rather than clustered.
        val mixed = colours.shuffled(java.util.Random(id.hashCode().toLong() xor 0x5DEECE66DL))
        spots.forEachIndexed { i, (x, y) ->
            dots += Feature.fromGeometry(Point.fromLngLat(x, y)).apply { addStringProperty("color", mixed[i]) }
        }
    }
    sectors.forEach { s ->
        val split = s.id in splitSectors
        add(if (split) "sector_outline" else "area", s.id, s.referenceLatitude, s.referenceLongitude, s.boundaryJson, sectorDensity[s.id], withDots = !split)
    }
    subs.forEach { add("area", it.id, it.referenceLatitude, it.referenceLongitude, it.boundaryJson, subDensity[it.id], withDots = true) }
    style.addSource(GeoJsonSource("areas", FeatureCollection.fromFeatures(polygons)))
    style.addSource(GeoJsonSource("trees", FeatureCollection.fromFeatures(dots)))
    style.addLayer(FillLayer("area-fill", "areas").withProperties(fillColor("#e3efe5"), fillOpacity(0.6f)).also { it.setFilter(eq(get("kind"), literal("area"))) })
    style.addLayer(LineLayer("area-lines", "areas").withProperties(lineColor("#1d6b45"), lineWidth(1.5f)))
    style.addLayer(
        LineLayer("sector-lines", "areas").withProperties(lineColor("#0b2e1d"), lineWidth(3f))
            .also { it.setFilter(eq(get("kind"), literal("sector_outline"))) },
    )
    // Small dots that grow a little as the map is zoomed in.
    style.addLayer(
        CircleLayer("tree-dots", "trees").withProperties(
            circleColor(get("color")),
            circleRadius(
                org.maplibre.android.style.expressions.Expression.interpolate(
                    org.maplibre.android.style.expressions.Expression.linear(), org.maplibre.android.style.expressions.Expression.zoom(),
                    org.maplibre.android.style.expressions.Expression.stop(12, 1.5f), org.maplibre.android.style.expressions.Expression.stop(16, 3f),
                    org.maplibre.android.style.expressions.Expression.stop(19, 6f),
                ),
            ),
            circleOpacity(0.9f),
        ),
    )
    if (count >= 2) map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 48))
    else if (count == 1) map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(sectors.firstOrNull()?.referenceLatitude ?: 0.0, sectors.firstOrNull()?.referenceLongitude ?: 0.0), 14.0))
}

private fun Double.oneDecimal() = String.format(java.util.Locale.US, "%.1f", this)

/** The numbers behind the map: area, trees, trees per hectare and how many are alive, per sector and sub-sector. */
@Composable
private fun DensityList(
    sectors: List<SectorEntity>,
    subs: List<SubSectorEntity>,
    sectorDensity: Map<String, AreaDensity>,
    subDensity: Map<String, AreaDensity>,
    perDot: Int,
    modifier: Modifier,
) {
    androidx.compose.foundation.lazy.LazyColumn(modifier, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { DensityLegend(perDot) }
        if (sectors.isEmpty()) item { Notice("No surveyed areas for this planting year on this phone. Sync, or add the year's sectors in Projects.") }
        sectors.forEach { sector ->
            item(key = sector.id) { DensityRow(sectorDensity[sector.id], heading = true) }
            subs.filter { it.sectorId == sector.id }.forEach { ss -> item(key = ss.id) { DensityRow(subDensity[ss.id], heading = false) } }
        }
    }
}

@Composable
private fun DensityLegend(perDot: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (perDot == 1) "Each dot is one tree" else "Each dot is $perDot trees", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(ALIVE_DOT to "Alive", DEAD_DOT to "Dead", UNSEEN_DOT to "Not visited yet").forEach { (c, label) ->
                Dot(c); Text(label, style = MaterialTheme.typography.bodySmall); Spacer(Modifier.width(6.dp))
            }
        }
        Text("Trees have no GPS: the number of dots in each area is exact, their positions inside it are illustrative.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Dot(color: String, size: androidx.compose.ui.unit.Dp = 12.dp) {
    androidx.compose.foundation.layout.Box(
        Modifier.size(size).background(androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(color)), androidx.compose.foundation.shape.CircleShape),
    )
}

@Composable
private fun DensityRow(d: AreaDensity?, heading: Boolean) {
    d ?: return
    Row(Modifier.fillMaxWidth().padding(start = if (heading) 0.dp else 16.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Dot(if (d.trees > 0) ALIVE_DOT else UNSEEN_DOT, 14.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(d.label, style = if (heading) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium)
            Text(
                listOfNotNull(
                    d.hectares?.let { "${it.oneDecimal()} ha" } ?: "no corner points",
                    "${d.trees} trees",
                    d.trees.takeIf { it > 0 }?.let { "${d.alive} alive · ${d.dead} dead" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(d.perHectare?.let { "${it.oneDecimal()} /ha" } ?: "—", style = MaterialTheme.typography.titleSmall)
    }
}
