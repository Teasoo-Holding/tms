package com.teasoo.tms.field

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.ProjectEntity
import com.teasoo.tms.data.local.SectorEntity
import com.teasoo.tms.data.local.SubSectorEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.local.TrackPointEntity
import com.teasoo.tms.data.remote.RallyPointDto
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.Picker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
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
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import javax.inject.Inject

/** Where the officer wants to go back to: their marked starting point or one of the project's rally points. */
data class Target(val name: String, val latitude: Double, val longitude: Double)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class FieldMapViewModel @Inject constructor(private val db: TmsDatabase) : ViewModel() {
    private val ref = db.reference()
    val projects = ref.projects().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val projectId = MutableStateFlow<String?>(null)
    val sectors = projectId.filterNotNull().flatMapLatest { ref.sectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val subSectors = projectId.filterNotNull().flatMapLatest { ref.subSectors(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val years = projectId.filterNotNull().flatMapLatest { ref.years(it) }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val trail = db.track().points().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /** Marks here as the starting point and starts a new trail (the old one is cleared). */
    fun markStart(fix: Fix) = viewModelScope.launch {
        db.track().clear()
        db.track().insert(TrackPointEntity(kind = "START", latitude = fix.latitude, longitude = fix.longitude, accuracyMeters = fix.accuracyMeters, recordedAt = fix.time))
    }

    fun clearTrail() = viewModelScope.launch { db.track().clear() }
}

fun rallyPoints(project: ProjectEntity?): List<RallyPointDto> =
    project?.rallyPointsJson?.let { runCatching { TmsJson.decodeFromString(ListSerializer(RallyPointDto.serializer()), it) }.getOrNull() } ?: emptyList()

/**
 * The offline field map (#128): the project's sectors and sub-sectors on a plain background, the officer's position,
 * the starting point they marked, the trail they walked and the project's rally points. Shows the straight-line distance
 * and direction to the chosen point, with an arrow that follows the phone's compass. Everything comes from this phone:
 * no internet, map tiles or paid service is needed. There are no roads or paths on the map, so there is no turn-by-turn
 * route: follow the arrow, or walk back along the trail.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldMapScreen(selectedProjectId: String?, onBack: () -> Unit, vm: FieldMapViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val projects by vm.projects.collectAsStateWithLifecycle()
    val projectId by vm.projectId.collectAsStateWithLifecycle()
    LaunchedEffect(selectedProjectId, projects) { if (projectId == null) vm.projectId.value = selectedProjectId ?: projects.firstOrNull()?.id }
    val project = projects.find { it.id == projectId }
    val sectors by vm.sectors.collectAsStateWithLifecycle()
    val subs by vm.subSectors.collectAsStateWithLifecycle()
    val years by vm.years.collectAsStateWithLifecycle()
    val trail by vm.trail.collectAsStateWithLifecycle()
    val fix by FieldLocation.fix.collectAsStateWithLifecycle()
    val rally = rallyPoints(project)
    val start = trail.lastOrNull { it.kind == "START" }
    val targets = listOfNotNull(start?.let { Target("My starting point", it.latitude, it.longitude) }) + rally.map { Target(it.name, it.latitude, it.longitude) }
    var targetName by rememberSaveable { mutableStateOf<String?>(null) }
    val target = targets.find { it.name == targetName } ?: targets.firstOrNull()
    var recording by remember { mutableStateOf(TrailService.running) }

    var granted by remember { mutableStateOf(hasLocation(context)) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r -> granted = r.values.any { it } }
    LaunchedEffect(Unit) {
        if (!granted) {
            val asks = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) asks += Manifest.permission.POST_NOTIFICATIONS
            permission.launch(asks.toTypedArray())
        }
    }
    DisposableEffect(granted) {
        if (granted) FieldLocation.start(context)
        onDispose { if (granted) FieldLocation.stop() }
    }
    val heading = rememberCompassHeading()
    // A fix older than 30 seconds is treated as lost.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(5_000); now = System.currentTimeMillis() } }
    val fresh = fix?.takeIf { now - it.time < 30_000 }

    // Which area the officer is standing in.
    val yearOf = years.associate { it.id to it.yearLabel }
    val here = fresh?.let { f ->
        subs.firstOrNull { ss -> Geo.outerRing(ss.boundaryJson)?.let { Geo.contains(it, f.latitude, f.longitude) } == true }?.let { ss ->
            val sec = sectors.find { it.id == ss.sectorId }
            "${sec?.shortCode ?: "?"} / ${ss.shortCode}${sec?.plantingYearId?.let { yearOf[it] }?.let { " ($it)" } ?: ""}"
        } ?: sectors.firstOrNull { s -> Geo.outerRing(s.boundaryJson)?.let { Geo.contains(it, f.latitude, f.longitude) } == true }?.let { s ->
            "${s.shortCode}${s.plantingYearId?.let { yearOf[it] }?.let { " ($it)" } ?: ""}"
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var follow by remember { mutableStateOf(true) }

    Scaffold(topBar = {
        TopAppBar(
            colors = com.teasoo.tms.ui.components.tmsTopBarColors(),
            title = { Text("Field map") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (projects.size > 1) {
                Picker("Project", projects, project, { it.name }, { vm.projectId.value = it.id }, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp), supportingText = null)
            }
            Box(Modifier.fillMaxWidth().weight(1f)) {
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
                            view.getMapAsync { map -> map.addOnCameraMoveStartedListener { reason -> if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) follow = false } }
                        }
                    },
                    update = { view ->
                        view.getMapAsync { map -> drawFieldMap(map, sectors, subs, trail, rally, fresh, target, follow) }
                    },
                )
                SmallFloatingActionButton(onClick = { follow = true }, modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
                    Icon(Icons.Default.MyLocation, contentDescription = "Centre on my position")
                }
            }
            Surface(tonalElevation = 2.dp) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        !granted -> Notice("Allow location to see where you are. Your position stays on this phone.")
                        !FieldLocation.gpsEnabled(context) -> Notice("Turn on Location in the phone's settings. GPS works without internet.")
                        fresh == null -> Text("Looking for GPS… Stand in the open, away from dense trees, for a minute.", style = MaterialTheme.typography.bodyMedium)
                        (fresh.accuracyMeters ?: 0f) > 25f -> Text(
                            "Weak GPS: your position could be up to ${fresh.accuracyMeters!!.toInt()} m off.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error,
                        )
                        else -> Text("GPS good: within about ${(fresh.accuracyMeters ?: 0f).toInt()} m.", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (fresh != null) {
                        Text(if (here != null) "You are in $here" else "You are outside the mapped sectors.", style = MaterialTheme.typography.titleMedium)
                    }
                    if (targets.size > 1) {
                        Picker("Go back to", targets, target, { it.name }, { targetName = it.name }, supportingText = null)
                    }
                    if (target != null && fresh != null) {
                        val d = Geo.distanceMeters(fresh.latitude, fresh.longitude, target.latitude, target.longitude)
                        val b = Geo.bearingDegrees(fresh.latitude, fresh.longitude, target.latitude, target.longitude)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            // The arrow points the way when the phone is held flat; without a compass it points to the map's north.
                            Icon(
                                Icons.Default.Navigation, contentDescription = null,
                                modifier = Modifier.size(48.dp).rotate(((b - (heading ?: 0.0)) % 360).toFloat()),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Column {
                                Text("${target.name}: ${Geo.formatDistance(d)} ${Geo.compassWord(b)}", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    (if (heading == null) "No compass on this phone: use the direction (north is up on the map). " else "Hold the phone flat; the arrow points the way. ") +
                                        "Straight-line distance: there are no paths on this map, so follow the arrow or walk back along your trail.",
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else if (target == null) {
                        Text("Mark your starting point to find your way back to it. Rally points set on the web appear here too.", style = MaterialTheme.typography.bodySmall)
                    }
                    val walked = Geo.pathLength(trail.map { it.latitude to it.longitude })
                    if (trail.size > 1) Text("Trail: ${Geo.formatDistance(walked)} walked since the starting point.", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                fresh?.let { vm.markStart(it) }
                                if (!recording) { TrailService.start(context); recording = true }
                            },
                            enabled = fresh != null && (fresh.accuracyMeters ?: 0f) <= 50f,
                            modifier = Modifier.weight(1f),
                        ) { Text(if (start == null) "Mark starting point here" else "New starting point here") }
                        if (recording) {
                            OutlinedButton(onClick = { TrailService.stop(context); recording = false }, modifier = Modifier.weight(1f)) { Text("Stop trail") }
                        } else if (start != null) {
                            OutlinedButton(onClick = { TrailService.start(context); recording = true }, modifier = Modifier.weight(1f)) { Text("Record trail") }
                        }
                    }
                }
            }
        }
    }
}

private fun hasLocation(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

/** Compass heading in degrees from north, or null when the phone has no compass. */
@Composable
private fun rememberCompassHeading(): Double? {
    val context = LocalContext.current
    var heading by remember { mutableStateOf<Double?>(null) }
    DisposableEffect(Unit) {
        val sm = context.getSystemService(SensorManager::class.java)
        val sensor = sm?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val matrix = FloatArray(9)
        val angles = FloatArray(3)
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                SensorManager.getRotationMatrixFromVector(matrix, e.values)
                SensorManager.getOrientation(matrix, angles)
                heading = (Math.toDegrees(angles[0].toDouble()) + 360) % 360
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        if (sensor != null) sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
        onDispose { sm?.unregisterListener(listener) }
    }
    return heading
}

private const val PLAIN_STYLE = """{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#f4f5f1"}}]}"""
private var framed = false

private fun drawFieldMap(
    map: MapLibreMap,
    sectors: List<SectorEntity>,
    subs: List<SubSectorEntity>,
    trail: List<TrackPointEntity>,
    rally: List<RallyPointDto>,
    fix: Fix?,
    target: Target?,
    follow: Boolean,
) {
    val style = map.style
    if (style == null || !style.isFullyLoaded) {
        map.setStyle(Style.Builder().fromJson(PLAIN_STYLE)) { s -> addLayers(s); drawFieldMap(map, sectors, subs, trail, rally, fix, target, follow) }
        return
    }
    val areas = mutableListOf<Feature>()
    val bounds = LatLngBounds.Builder()
    var count = 0
    fun polygon(json: String?, kind: String) {
        val p = json?.let { runCatching { Polygon.fromJson(it) }.getOrNull() } ?: return
        areas += Feature.fromGeometry(p).apply { addStringProperty("kind", kind) }
        p.coordinates().flatten().forEach { bounds.include(LatLng(it.latitude(), it.longitude())); count++ }
    }
    sectors.forEach { polygon(it.boundaryJson, "sector") }
    subs.forEach { polygon(it.boundaryJson, "sub") }
    (style.getSource("areas") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(areas))
    val path = trail.map { Point.fromLngLat(it.longitude, it.latitude) }
    (style.getSource("trail") as? GeoJsonSource)?.setGeoJson(
        if (path.size > 1) FeatureCollection.fromFeatures(listOf(Feature.fromGeometry(LineString.fromLngLats(path)))) else FeatureCollection.fromFeatures(emptyList()),
    )
    val points = mutableListOf<Feature>()
    trail.lastOrNull { it.kind == "START" }?.let { points += Feature.fromGeometry(Point.fromLngLat(it.longitude, it.latitude)).apply { addStringProperty("kind", "start") } }
    rally.forEach { points += Feature.fromGeometry(Point.fromLngLat(it.longitude, it.latitude)).apply { addStringProperty("kind", "rally") } }
    fix?.let { points += Feature.fromGeometry(Point.fromLngLat(it.longitude, it.latitude)).apply { addStringProperty("kind", "me") } }
    (style.getSource("points") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(points))
    (style.getSource("line") as? GeoJsonSource)?.setGeoJson(
        if (fix != null && target != null) FeatureCollection.fromFeatures(listOf(Feature.fromGeometry(LineString.fromLngLats(listOf(Point.fromLngLat(fix.longitude, fix.latitude), Point.fromLngLat(target.longitude, target.latitude))))))
        else FeatureCollection.fromFeatures(emptyList()),
    )
    when {
        follow && fix != null -> map.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(fix.latitude, fix.longitude), maxOf(map.cameraPosition.zoom, 16.0)))
        !framed && count >= 2 -> { map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 40)); framed = true }
    }
}

private fun addLayers(style: Style) {
    framed = false
    style.addSource(GeoJsonSource("areas"))
    style.addSource(GeoJsonSource("trail"))
    style.addSource(GeoJsonSource("line"))
    style.addSource(GeoJsonSource("points"))
    style.addLayer(FillLayer("area-fill", "areas").withProperties(fillColor("#e3efe5"), fillOpacity(0.5f)).also { it.setFilter(eq(get("kind"), literal("sub"))) })
    style.addLayer(LineLayer("sub-lines", "areas").withProperties(lineColor("#5b8f6f"), lineWidth(1f)).also { it.setFilter(eq(get("kind"), literal("sub"))) })
    style.addLayer(LineLayer("sector-lines", "areas").withProperties(lineColor("#0b2e1d"), lineWidth(2.5f)).also { it.setFilter(eq(get("kind"), literal("sector"))) })
    style.addLayer(LineLayer("to-target", "line").withProperties(lineColor("#1d6bd8"), lineWidth(2f), lineDasharray(arrayOf(2f, 2f))))
    style.addLayer(LineLayer("trail-line", "trail").withProperties(lineColor("#d97706"), lineWidth(4f), lineOpacity(0.85f)))
    style.addLayer(CircleLayer("rally", "points").withProperties(circleColor("#7c3aed"), circleRadius(8f), circleStrokeColor("#ffffff"), circleStrokeWidth(2f)).also { it.setFilter(eq(get("kind"), literal("rally"))) })
    style.addLayer(CircleLayer("start", "points").withProperties(circleColor("#16a34a"), circleRadius(8f), circleStrokeColor("#ffffff"), circleStrokeWidth(2f)).also { it.setFilter(eq(get("kind"), literal("start"))) })
    style.addLayer(CircleLayer("me", "points").withProperties(circleColor("#1d6bd8"), circleRadius(9f), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)).also { it.setFilter(eq(get("kind"), literal("me"))) })
}
