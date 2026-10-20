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
import com.teasoo.tms.data.local.AreaShare
import com.teasoo.tms.data.local.SectorEntity
import com.teasoo.tms.data.local.SubSectorEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.ui.AppViewModel
import com.teasoo.tms.ui.components.Notice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
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
    val projectId = MutableStateFlow<String?>(null)
    val sectors = projectId.filterNotNull().flatMapLatest { db.reference().sectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { db.reference().subSectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val shares = projectId.filterNotNull().flatMapLatest { db.trees().shareBySubSector(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
}

/** Green when mostly alive, through amber, to red when mostly dead; grey when nothing observed yet. */
internal fun shareColor(share: Double?): String = when {
    share == null -> "#9e9e9e"
    share < 0.1 -> "#2e7d32"
    share < 0.25 -> "#9ccc65"
    share < 0.5 -> "#ffb300"
    else -> "#d32f2f"
}

/**
 * Sector and sub-sector boundaries and their reference points, from the local database (works offline).
 * A licensed basemap is shown only when MAP_STYLE_URL is configured; trees are never drawn as points.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AreaMapScreen(app: AppViewModel, onBack: () -> Unit, vm: AreaMapViewModel = hiltViewModel()) {
    val projectId by app.selectedProjectId.collectAsStateWithLifecycle()
    LaunchedEffect(projectId) { vm.projectId.value = projectId }
    val sectors by vm.sectors.collectAsStateWithLifecycle()
    val subs by vm.subSectors.collectAsStateWithLifecycle()
    val shares by vm.shares.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    Scaffold(topBar = {
        TopAppBar(title = { Text("Area map") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding)) {
            if (BuildConfig.MAP_STYLE_URL.isBlank()) {
                Notice("Showing area boundaries only. A background map appears when the organisation configures licensed map data.", modifier = Modifier.padding(8.dp))
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
                update = { view -> view.getMapAsync { map -> map.setStyle(styleBuilder()) { style -> render(map, style, sectors, subs, shares) } } },
            )
            AreaShareList(sectors, subs, shares, Modifier.fillMaxWidth().weight(0.8f))
        }
    }
}

private fun styleBuilder(): Style.Builder =
    if (BuildConfig.MAP_STYLE_URL.isNotBlank()) Style.Builder().fromUri(BuildConfig.MAP_STYLE_URL)
    else Style.Builder().fromJson("""{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#e9ede6"}}]}""")

private fun render(map: org.maplibre.android.maps.MapLibreMap, style: Style, sectors: List<SectorEntity>, subs: List<SubSectorEntity>, shares: List<AreaShare>) {
    val polygons = mutableListOf<Feature>()
    val points = mutableListOf<Feature>()
    val bounds = LatLngBounds.Builder()
    var count = 0
    val byId = shares.associateBy { it.subSectorId }
    fun add(kind: String, lat: Double, lon: Double, boundary: String?, share: AreaShare? = null) {
        points += Feature.fromGeometry(Point.fromLngLat(lon, lat)).apply {
            addStringProperty("kind", kind)
            addStringProperty("color", if (kind == "sector") "#2a78d6" else shareColor(share?.deadShare))
            // Bigger circles for sub-sectors with more trees.
            addNumberProperty("radius", if (kind == "sector") 5f else 7f + kotlin.math.min(13f, kotlin.math.sqrt((share?.total ?: 0).toFloat())))
        }
        bounds.include(LatLng(lat, lon)); count++
        boundary?.let { json ->
            val polygon = Polygon.fromJson(json)
            polygons += Feature.fromGeometry(polygon).apply { addStringProperty("kind", kind) }
            polygon.coordinates().flatten().forEach { bounds.include(LatLng(it.latitude(), it.longitude())); count++ }
        }
    }
    sectors.forEach { add("sector", it.referenceLatitude, it.referenceLongitude, it.boundaryJson) }
    subs.forEach { add("sub_sector", it.referenceLatitude, it.referenceLongitude, it.boundaryJson, byId[it.id]) }
    style.addSource(GeoJsonSource("areas", FeatureCollection.fromFeatures(polygons)))
    style.addSource(GeoJsonSource("refs", FeatureCollection.fromFeatures(points)))
    style.addLayer(FillLayer("sub-fill", "areas").withProperties(fillColor("#1baf7a"), fillOpacity(0.2f)).also { it.setFilter(org.maplibre.android.style.expressions.Expression.eq(org.maplibre.android.style.expressions.Expression.get("kind"), "sub_sector")) })
    style.addLayer(LineLayer("lines", "areas").withProperties(lineColor("#1d6b45"), lineWidth(2f)))
    style.addLayer(
        CircleLayer("ref-points", "refs").withProperties(
            circleRadius(org.maplibre.android.style.expressions.Expression.get("radius")),
            circleColor(org.maplibre.android.style.expressions.Expression.get("color")),
            circleStrokeColor("#ffffff"), circleStrokeWidth(2f),
        ),
    )
    if (count >= 2) map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 48))
    else if (count == 1) map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(sectors.firstOrNull()?.referenceLatitude ?: 0.0, sectors.firstOrNull()?.referenceLongitude ?: 0.0), 14.0))
}

/** Alive / dead / not yet observed per sub-sector, with the same colours as the map. */
@Composable
private fun AreaShareList(sectors: List<SectorEntity>, subs: List<SubSectorEntity>, shares: List<AreaShare>, modifier: Modifier) {
    val byId = shares.associateBy { it.subSectorId }
    androidx.compose.foundation.lazy.LazyColumn(modifier, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Alive and dead by area", style = MaterialTheme.typography.titleSmall)
            Text("From each tree’s latest visit, for trees on this device. Circle colour: green mostly alive → red mostly dead; grey not yet observed.",
                style = MaterialTheme.typography.bodySmall)
        }
        sectors.forEach { sector ->
            val inSector = subs.filter { it.sectorId == sector.id }
            item(key = sector.id) { Text("${sector.shortCode} · ${sector.name}", style = MaterialTheme.typography.labelLarge) }
            inSector.forEach { ss ->
                val s = byId[ss.id]
                item(key = ss.id) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row {
                            Text("${ss.shortCode} · ${ss.name}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Text(s?.deadShare?.let { "${(it * 100).toInt()}% dead" } ?: "—", style = MaterialTheme.typography.bodyMedium)
                        }
                        ShareBar(s)
                        Text(
                            s?.let { "${it.total} trees · ${it.alive} alive · ${it.dead} dead · ${it.unknown} not observed" } ?: "No trees recorded",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ShareBar(s: AreaShare?) {
    val alive = androidx.compose.ui.graphics.Color(0xFF2E7D32)
    val dead = androidx.compose.ui.graphics.Color(0xFFD32F2F)
    val unknown = MaterialTheme.colorScheme.surfaceVariant
    androidx.compose.foundation.Canvas(Modifier.fillMaxWidth().height(10.dp)) {
        val total = (s?.total ?: 0).coerceAtLeast(1).toFloat()
        var x = 0f
        listOf((s?.alive ?: 0) to alive, (s?.dead ?: 0) to dead, ((s?.unknown ?: 0) + if (s == null) 1 else 0) to unknown).forEach { (n, c) ->
            val w = size.width * n / total
            drawRect(c, topLeft = androidx.compose.ui.geometry.Offset(x, 0f), size = androidx.compose.ui.geometry.Size(w, size.height))
            x += w
        }
    }
}
