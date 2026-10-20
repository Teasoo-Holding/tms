package com.teasoo.tms.ui.admin

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.teasoo.tms.data.remote.AdminPlantingYearDto
import com.teasoo.tms.data.remote.AdminSectorDto
import com.teasoo.tms.data.remote.AdminSubSectorDto
import com.teasoo.tms.data.remote.AreaRequest
import com.teasoo.tms.data.remote.CornerDto
import com.teasoo.tms.data.remote.ProjectDetailDto
import com.teasoo.tms.data.remote.boundaryCorners
import com.teasoo.tms.ui.theme.StatusColors
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

private const val MIN_CORNERS = 3
private const val MAX_CORNERS = 12
private const val USUAL_CORNERS = 4
private const val CORNER_HINT = "Stand at each corner of the surveyed area and tap Use my location. The order doesn't matter."

private sealed interface AreaEdit {
    data class Sector(val sector: AdminSectorDto?) : AreaEdit
    data class SubSector(val parent: AdminSectorDto, val sub: AdminSubSectorDto?) : AreaEdit
}

/** Sectors and sub-sectors surveyed for [year], plus older areas not tied to any year. */
@Composable
internal fun AreasTab(year: AdminPlantingYearDto?, vm: ProjectSetupViewModel, onAddYear: () -> Unit) {
    val areas = collect(vm.areas)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var edit by remember { mutableStateOf<AreaEdit?>(null) }
    fun open(e: AreaEdit) { vm.clearFormError(); edit = e }

    if (year == null) { NoYearState(onAddYear); return }
    val yearSectors = areas.filter { it.plantingYearId == year.id }
    val olderSectors = areas.filter { it.plantingYearId == null }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            "Areas surveyed for ${year.yearLabel}",
            supporting = "The land survey maps this year's planting area into sectors and sub-sectors. Trees have no GPS of their own: " +
                "officers record each tree's sector and sub-sector.",
            action = {
                if (yearSectors.isNotEmpty()) TextButton(onClick = { open(AreaEdit.Sector(null)) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.Add, null); Text("Sector")
                }
            },
        )
        if (yearSectors.isEmpty()) {
            EmptyState(
                Icons.Default.Map, "No areas for ${year.yearLabel} yet",
                "Add a sector by walking its corners with this phone (for example North Ridge, code N1), then add its sub-sectors the same way.",
                "Add sector", { open(AreaEdit.Sector(null)) },
            )
        }
        yearSectors.forEach { s -> SectorCard(s, onEdit = { open(AreaEdit.Sector(s)) }, onEditSub = { open(AreaEdit.SubSector(s, it)) }, onAddSub = { open(AreaEdit.SubSector(s, null)) }) }

        if (olderSectors.isNotEmpty()) {
            SectionHeader(
                "Not tied to a year",
                supporting = "Older areas recorded before each year had its own survey. Officers can still use them; new sectors belong to the selected year.",
            )
            olderSectors.forEach { s -> SectorCard(s, onEdit = { open(AreaEdit.Sector(s)) }, onEditSub = { open(AreaEdit.SubSector(s, it)) }, onAddSub = { open(AreaEdit.SubSector(s, null)) }) }
        }
        Spacer(Modifier.height(24.dp))
    }

    when (val e = edit) {
        is AreaEdit.Sector -> {
            val s = e.sector
            AreaDialog(
                title = if (s == null) "Add sector to ${year.yearLabel}" else "Edit sector ${s.name}",
                initial = s?.let { AreaRequest(it.name, it.shortCode, it.description, it.referenceLatitude, it.referenceLongitude, it.active) },
                initialOutline = s?.boundary?.let(::boundaryCorners).orEmpty(),
                codeHelp = "Unique within the year, e.g. N1. Can be part of tree IDs.",
                parentOutline = emptyList(),
                parentName = null,
                others = s?.subSectors?.map { boundaryCorners(it.boundary) }.orEmpty(),
                saving = saving, error = formError,
                onSave = { req -> vm.saveSector(s?.id, year.id, req) { edit = null } },
                onDismiss = { edit = null },
            )
        }
        is AreaEdit.SubSector -> {
            val sub = e.sub
            AreaDialog(
                title = if (sub == null) "Add sub-sector to ${e.parent.name}" else "Edit sub-sector ${sub.name}",
                initial = sub?.let { AreaRequest(it.name, it.shortCode, it.description, it.referenceLatitude, it.referenceLongitude, it.active) },
                initialOutline = sub?.boundary?.let(::boundaryCorners).orEmpty(),
                codeHelp = "Unique within ${e.parent.shortCode}, e.g. A1. Can be part of tree IDs.",
                parentOutline = boundaryCorners(e.parent.boundary),
                parentName = e.parent.name,
                others = e.parent.subSectors.filter { it.id != sub?.id }.map { boundaryCorners(it.boundary) },
                saving = saving, error = formError,
                onSave = { req -> vm.saveSubSector(e.parent.id, sub?.id, req) { edit = null } },
                onDismiss = { edit = null },
            )
        }
        null -> Unit
    }
}

@Composable
private fun SectorCard(s: AdminSectorDto, onEdit: () -> Unit, onEditSub: (AdminSubSectorDto) -> Unit, onAddSub: () -> Unit) {
    val outline = boundaryCorners(s.boundary)
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 8.dp)) {
            Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (outline.size >= MIN_CORNERS) {
                    AreaSketch(outline, Modifier.size(72.dp), inner = s.subSectors.map { boundaryCorners(it.boundary) }, description = "Outline of ${s.name} and its sub-sectors")
                    Spacer(Modifier.width(12.dp))
                }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(s.name, style = MaterialTheme.typography.titleMedium)
                        if (!s.active) InactiveTag()
                    }
                    Text(s.shortCode, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
                    Text(shapeText(outline), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, "Edit ${s.name}") }
            }
            if (s.subSectors.isEmpty()) {
                Text("No sub-sectors yet. Trees cannot be registered here until one exists.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            s.subSectors.forEach { ss ->
                ListItem(
                    headlineContent = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(ss.name)
                            if (!ss.active) InactiveTag()
                        }
                    },
                    supportingContent = { Text("${ss.shortCode} · ${shapeText(boundaryCorners(ss.boundary))}") },
                    trailingContent = { IconButton(onClick = { onEditSub(ss) }) { Icon(Icons.Default.Edit, "Edit ${ss.name}") } },
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
            TextButton(onClick = onAddSub, modifier = Modifier.padding(start = 8.dp).heightIn(min = 48.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(4.dp)); Text("Add sub-sector to ${s.shortCode}")
            }
        }
    }
}

private fun shapeText(outline: List<CornerDto>) = when {
    outline.size in MIN_CORNERS..MAX_CORNERS -> "${outline.size} corners · about ${hectares(outline)}"
    outline.size > MAX_CORNERS -> "Outline drawn in the web portal · about ${hectares(outline)}"
    else -> "No corners yet – edit to walk its corners"
}

private fun hectares(outline: List<CornerDto>): String {
    val ha = areaHectares(outline)
    return if (ha < 1) "%.2f ha".format(Locale.US, ha) else "%.1f ha".format(Locale.US, ha)
}

// ---------------------------------------------------------------- location

private fun hasLocationPermission(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

/** One fresh fix from the platform LocationManager (no Play services), or the last known fix as a fallback. */
@SuppressLint("MissingPermission")
private suspend fun currentLocation(context: Context): Location? {
    if (!hasLocationPermission(context)) return null
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    val provider = when {
        lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && lm.isProviderEnabled(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
        else -> return null
    }
    val fresh = withTimeoutOrNull(30_000) {
        suspendCancellableCoroutine<Location?> { cont ->
            val signal = CancellationSignal()
            cont.invokeOnCancellation { signal.cancel() }
            LocationManagerCompat.getCurrentLocation(lm, provider, signal, ContextCompat.getMainExecutor(context)) { loc ->
                if (cont.isActive) cont.resume(loc)
            }
        }
    }
    return fresh ?: runCatching { lm.getLastKnownLocation(provider) }.getOrNull()
}

// ---------------------------------------------------------------- form

/** One corner row of the form; [accuracy] is set when the phone filled it. */
private class CornerInput(lat: String = "", lon: String = "", accuracy: Float? = null) {
    var lat by mutableStateOf(lat)
    var lon by mutableStateOf(lon)
    var accuracy by mutableStateOf(accuracy)
    val latValue get() = lat.replace(',', '.').trim().toDoubleOrNull()?.takeIf { it in -90.0..90.0 }
    val lonValue get() = lon.replace(',', '.').trim().toDoubleOrNull()?.takeIf { it in -180.0..180.0 }
    val blank get() = lat.isBlank() && lon.isBlank()
    val corner: CornerDto? get() = latValue?.let { a -> lonValue?.let { b -> CornerDto(a, b) } }
    val invalid get() = !blank && corner == null
}

private fun fmt(v: Double) = "%.6f".format(Locale.US, v)

@Composable
private fun AreaDialog(
    title: String,
    initial: AreaRequest?,
    initialOutline: List<CornerDto>,
    codeHelp: String,
    parentOutline: List<CornerDto>,
    parentName: String?,
    others: List<List<CornerDto>>,
    saving: Boolean,
    error: String?,
    onSave: (AreaRequest) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(initial?.name.orEmpty()) }
    var code by remember { mutableStateOf(initial?.shortCode.orEmpty()) }
    var description by remember { mutableStateOf(initial?.description.orEmpty()) }
    var active by remember { mutableStateOf(initial?.active ?: true) }
    val prefill = initialOutline.takeIf { it.size in MIN_CORNERS..MAX_CORNERS }
    val corners = remember {
        mutableStateListOf<CornerInput>().apply {
            prefill?.forEach { add(CornerInput(fmt(it.latitude), fmt(it.longitude))) }
            while (size < USUAL_CORNERS) add(CornerInput())
        }
    }
    var locating by remember { mutableStateOf<Int?>(null) }
    var pending by remember { mutableStateOf<Int?>(null) }
    var locationNote by remember { mutableStateOf<String?>(null) }

    fun fetch(index: Int) {
        locating = index
        locationNote = "Getting your location for corner ${index + 1}… Stand in the open for a better fix."
        scope.launch {
            val loc = currentLocation(context)
            locating = null
            val row = corners.getOrNull(index) ?: return@launch
            if (loc == null) {
                locationNote = "Couldn’t get a location. Check that location is on, or type the coordinates."
            } else {
                row.lat = fmt(loc.latitude)
                row.lon = fmt(loc.longitude)
                row.accuracy = if (loc.hasAccuracy()) loc.accuracy else null
                locationNote = "Corner ${index + 1} filled from this phone" + (row.accuracy?.let { " (±${it.toInt()} m)." } ?: ".") +
                    if (index < corners.lastIndex) " Walk to the next corner." else ""
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val i = pending
        pending = null
        if (grants.values.any { it } && i != null) fetch(i) else locationNote = "Location permission was not granted. You can still type the coordinates."
    }
    fun useLocation(i: Int) {
        if (hasLocationPermission(context)) fetch(i)
        else { pending = i; permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
    }

    val filled = corners.mapNotNull { it.corner }
    val anyInvalid = corners.any { it.invalid }
    val isNew = initial == null
    val cornersOk = !anyInvalid && (filled.size >= MIN_CORNERS || (!isNew && filled.isEmpty()))
    val close = buildList {
        for (i in filled.indices) for (j in i + 1 until filled.size) if (distanceMetres(filled[i], filled[j]) < 3) add(i to j)
    }
    val outside = if (parentOutline.size >= MIN_CORNERS) corners.withIndex().filter { (_, c) -> c.corner?.let { !insideOutline(it, parentOutline) } == true }.map { it.index + 1 } else emptyList()

    FormDialog(
        title, if (isNew) "Add" else "Save", name.isNotBlank() && code.isNotBlank() && cornersOk, saving, error,
        onConfirm = {
            onSave(
                AreaRequest(
                    name.trim(), code.trim(), description.trim().ifBlank { null },
                    // With corners the server places the reference point inside the outline.
                    referenceLatitude = null, referenceLongitude = null, active = active,
                    corners = filled.takeIf { it.size >= MIN_CORNERS },
                ),
            )
        },
        onDismiss = onDismiss,
    ) {
        TextInput(name, { name = it }, "Name")
        CodeInput(code, { code = it }, supporting = if (initial != null && code != initial.shortCode) "Existing tree IDs keep the old code." else codeHelp)
        TextInput(description, { description = it }, "Description (optional)", singleLine = false)

        HorizontalDivider()
        Text("Corners", style = MaterialTheme.typography.titleSmall)
        Hint(CORNER_HINT)
        if (parentName != null) Hint("The sub-sector must lie inside $parentName. Small GPS differences (up to 15 m) are allowed.")
        if (!isNew && prefill == null) {
            Hint(
                if (initialOutline.size > MAX_CORNERS) "This outline was drawn in the web portal with ${initialOutline.size} points. It is kept unless you enter corners here."
                else "No corners recorded yet. Walk the corners to draw the outline, or leave them empty to keep the current location.",
            )
        }

        corners.forEachIndexed { i, c ->
            CornerRow(
                index = i, input = c, locating = locating == i, busy = locating != null,
                canRemove = corners.size > MIN_CORNERS,
                onUseLocation = { useLocation(i) },
                onRemove = { corners.removeAt(i) },
            )
        }
        if (corners.size < MAX_CORNERS) {
            OutlinedButton(onClick = { corners.add(CornerInput()) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add corner")
            }
        }
        locationNote?.let { Hint(it) }

        val problems = buildList {
            if (anyInvalid) add("Fill both latitude and longitude for each corner you use, or clear the row.")
            if (filled.size in 1 until MIN_CORNERS) add("Enter at least $MIN_CORNERS corners (usually $USUAL_CORNERS).")
            if (isNew && filled.isEmpty()) add("Walk the corners of the area to record it.")
        }
        problems.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        close.forEach { (a, b) ->
            Text("• Corners ${a + 1} and ${b + 1} are less than 3 m apart. Did you move to the next corner?",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
        }
        if (outside.isNotEmpty()) {
            Text("• Corner ${outside.joinToString(", ")} seems to be outside $parentName. The server allows up to 15 m for GPS error.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
        }

        val focus = filled.takeIf { it.size >= MIN_CORNERS } ?: if (filled.isEmpty()) initialOutline else filled
        if (focus.size >= MIN_CORNERS || parentOutline.size >= MIN_CORNERS) {
            if (parentOutline.size >= MIN_CORNERS) {
                AreaSketch(parentOutline, Modifier.fillMaxWidth().height(180.dp), inner = others, focus = focus,
                    description = "Sketch of the sub-sector inside $parentName")
                Hint("Outer shape: $parentName. Bold: this sub-sector" + if (others.any { it.isNotEmpty() }) ". Thin lines: its other sub-sectors." else ".")
            } else {
                AreaSketch(focus, Modifier.fillMaxWidth().height(180.dp), inner = others, description = "Sketch of the area outline")
            }
            if (focus.size >= MIN_CORNERS) Hint("About ${hectares(focus)}. The outline joins the corners around their centre.")
        }

        SwitchRow("Active", active, { active = it }, supporting = if (active) "Officers can choose this area" else "Hidden from new field sessions; existing trees are kept")
    }
}

@Composable
private fun CornerRow(index: Int, input: CornerInput, locating: Boolean, busy: Boolean, canRemove: Boolean, onUseLocation: () -> Unit, onRemove: () -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Corner ${index + 1}", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                input.accuracy?.let { acc ->
                    Text(
                        "GPS ±${acc.toInt()} m",
                        style = MaterialTheme.typography.labelMedium,
                        color = when {
                            acc <= 10 -> StatusColors.good
                            acc <= 25 -> MaterialTheme.colorScheme.onSurfaceVariant
                            else -> MaterialTheme.colorScheme.error
                        },
                    )
                }
                if (canRemove) IconButton(onClick = onRemove) { Icon(Icons.Default.Close, "Remove corner ${index + 1}") }
                else Spacer(Modifier.height(48.dp))
            }
            FilledTonalButton(onClick = onUseLocation, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(end = 8.dp).heightIn(min = 48.dp)) {
                if (locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Default.MyLocation, null)
                Spacer(Modifier.width(8.dp))
                Text(if (locating) "Getting location…" else "Use my location")
            }
            val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)
            Row(Modifier.padding(end = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    input.lat, { input.lat = it; input.accuracy = null }, label = { Text("Latitude") }, singleLine = true, keyboardOptions = decimal,
                    isError = input.lat.isNotBlank() && input.latValue == null, modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    input.lon, { input.lon = it; input.accuracy = null }, label = { Text("Longitude") }, singleLine = true, keyboardOptions = decimal,
                    isError = input.lon.isNotBlank() && input.lonValue == null, modifier = Modifier.weight(1f),
                )
            }
            if (input.accuracy != null && input.accuracy!! > 25) {
                Text("Weak GPS signal. Wait in the open and tap again for a better fix.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
