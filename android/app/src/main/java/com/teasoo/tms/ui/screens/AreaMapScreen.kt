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
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    Scaffold(topBar = {
        TopAppBar(title = { Text("Area map") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding)) {
            if (BuildConfig.MAP_STYLE_URL.isBlank()) {
                Notice("Showing area boundaries only. A background map appears when the organisation configures licensed map data.", modifier = Modifier.padding(8.dp))
            }
            AndroidView(
                modifier = Modifier.fillMaxSize(),
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
                update = { view -> view.getMapAsync { map -> map.setStyle(styleBuilder()) { style -> render(map, style, sectors, subs) } } },
            )
        }
    }
}

private fun styleBuilder(): Style.Builder =
    if (BuildConfig.MAP_STYLE_URL.isNotBlank()) Style.Builder().fromUri(BuildConfig.MAP_STYLE_URL)
    else Style.Builder().fromJson("""{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#e9ede6"}}]}""")

private fun render(map: org.maplibre.android.maps.MapLibreMap, style: Style, sectors: List<SectorEntity>, subs: List<SubSectorEntity>) {
    val polygons = mutableListOf<Feature>()
    val points = mutableListOf<Feature>()
    val bounds = LatLngBounds.Builder()
    var count = 0
    fun add(kind: String, lat: Double, lon: Double, boundary: String?) {
        points += Feature.fromGeometry(Point.fromLngLat(lon, lat)).apply { addStringProperty("kind", kind) }
        bounds.include(LatLng(lat, lon)); count++
        boundary?.let { json ->
            val polygon = Polygon.fromJson(json)
            polygons += Feature.fromGeometry(polygon).apply { addStringProperty("kind", kind) }
            polygon.coordinates().flatten().forEach { bounds.include(LatLng(it.latitude(), it.longitude())); count++ }
        }
    }
    sectors.forEach { add("sector", it.referenceLatitude, it.referenceLongitude, it.boundaryJson) }
    subs.forEach { add("sub_sector", it.referenceLatitude, it.referenceLongitude, it.boundaryJson) }
    style.addSource(GeoJsonSource("areas", FeatureCollection.fromFeatures(polygons)))
    style.addSource(GeoJsonSource("refs", FeatureCollection.fromFeatures(points)))
    style.addLayer(FillLayer("sub-fill", "areas").withProperties(fillColor("#1baf7a"), fillOpacity(0.2f)).also { it.setFilter(org.maplibre.android.style.expressions.Expression.eq(org.maplibre.android.style.expressions.Expression.get("kind"), "sub_sector")) })
    style.addLayer(LineLayer("lines", "areas").withProperties(lineColor("#1d6b45"), lineWidth(2f)))
    style.addLayer(CircleLayer("ref-points", "refs").withProperties(circleRadius(5f), circleColor("#2a78d6"), circleStrokeColor("#ffffff"), circleStrokeWidth(2f)))
    if (count >= 2) map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 48))
    else if (count == 1) map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(sectors.firstOrNull()?.referenceLatitude ?: 0.0, sectors.firstOrNull()?.referenceLongitude ?: 0.0), 14.0))
}
