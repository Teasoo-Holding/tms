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
private const val CORNER_HINT = "Stand at each corner and tap Use my location, in any order."

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
    val actions = rememberItemActions()
    fun open(e: AreaEdit) { vm.clearFormError(); edit = e }
    fun sectorActions(s: AdminSectorDto) = actions.open(
        s.name, onEdit = { open(AreaEdit.Sector(s)) }, active = s.active,
        onSetActive = { on -> vm.setSectorActive(s, on) },
        extra = listOf(SheetAction("Add sub-sector", Icons.Default.Add) { open(AreaEdit.SubSector(s, null)) }),
        delete = PendingDelete(
            s.name, detail = if (s.subSectors.isEmpty()) null else "Its ${s.subSectors.size} sub-sector(s) are deleted too.",
            run = { done -> vm.deleteSector(s, done) },
            deactivate = { done: () -> Unit -> vm.setSectorActive(s, false, done); Unit }.takeIf { s.active },
        ),
    )
    fun subActions(parent: AdminSectorDto, ss: AdminSubSectorDto) = actions.open(
        "${parent.shortCode} › ${ss.name}", onEdit = { open(AreaEdit.SubSector(parent, ss)) }, active = ss.active,
        onSetActive = { on -> vm.setSubSectorActive(ss, on) },
        delete = PendingDelete(
            ss.name, run = { done -> vm.deleteSubSector(ss, done) },
            deactivate = { done: () -> Unit -> vm.setSubSectorActive(ss, false, done); Unit }.takeIf { ss.active },
        ),
    )

    if (year == null) { NoYearState(onAddYear); return }
    val yearSectors = areas.filter { it.plantingYearId == year.id }
    val olderSectors = areas.filter { it.plantingYearId == null }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        QuickAreaSetup(year, prominent = yearSectors.isEmpty(), saving = saving) { n, k -> vm.generateAreas(year, n, k) }
        if (yearSectors.isEmpty()) {
            TextButton(onClick = { open(AreaEdit.Sector(null)) }) { Text("Or add sectors one by one") }
        } else {
            FilledTonalButton(onClick = { open(AreaEdit.Sector(null)) }, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add sector")
            }
        }
        yearSectors.forEach { s ->
            SectorGroup(s, onEdit = { open(AreaEdit.Sector(s)) }, onActions = { sectorActions(s) },
                onEditSub = { open(AreaEdit.SubSector(s, it)) }, onSubActions = { subActions(s, it) }, onAddSub = { open(AreaEdit.SubSector(s, null)) })
        }

        if (olderSectors.isNotEmpty()) {
            SectionHeader("Not tied to a year")
            olderSectors.forEach { s ->
                SectorGroup(s, onEdit = { open(AreaEdit.Sector(s)) }, onActions = { sectorActions(s) },
                    onEditSub = { open(AreaEdit.SubSector(s, it)) }, onSubActions = { subActions(s, it) }, onAddSub = { open(AreaEdit.SubSector(s, null)) })
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    ItemActionsHost(actions, vm)

    when (val e = edit) {
        is AreaEdit.Sector -> {
            val s = e.sector
            AreaDialog(
                title = if (s == null) "Add sector to ${year.yearLabel}" else "Edit sector ${s.name}",
                initial = s?.let { AreaRequest(it.name, it.shortCode, it.description, it.referenceLatitude, it.referenceLongitude, it.active) },
                initialOutline = s?.boundary?.let(::boundaryCorners).orEmpty(),
                codeHelp = "e.g. N1",
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
                codeHelp = "e.g. A1",
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

/** A sector and, indented below it, its sub-sectors; each row has its own long-press / swipe actions. */
@Composable
private fun SectorGroup(
    s: AdminSectorDto,
    onEdit: () -> Unit,
    onActions: () -> Unit,
    onEditSub: (AdminSubSectorDto) -> Unit,
    onSubActions: (AdminSubSectorDto) -> Unit,
    onAddSub: () -> Unit,
) {
    val outline = boundaryCorners(s.boundary)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
        ActionItem(onClick = onEdit, onActions = onActions, tonal = true, onEdit = onEdit, editLabel = "Edit ${s.name}") {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (outline.size >= MIN_CORNERS) {
                    AreaSketch(outline, Modifier.size(56.dp), inner = s.subSectors.map { boundaryCorners(it.boundary) }, description = "Outline of ${s.name}")
                    Spacer(Modifier.width(12.dp))
                }
                Column(Modifier.weight(1f)) {
                    ItemTitle(s.name, s.active)
                    ItemSubtitle("${s.shortCode} · ${shapeText(outline)}")
                }
            }
        }
        Column(Modifier.padding(start = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            s.subSectors.forEach { ss ->
                ActionItem(onClick = { onEditSub(ss) }, onActions = { onSubActions(ss) }, onEdit = { onEditSub(ss) }, editLabel = "Edit ${ss.name}") {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                        ItemTitle(ss.name, ss.active)
                        ItemSubtitle("${ss.shortCode} · ${shapeText(boundaryCorners(ss.boundary))}")
                    }
                }
            }
            TextButton(onClick = onAddSub, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(4.dp))
                Text(if (s.subSectors.isEmpty()) "Add a sub-sector (needed for trees)" else "Add sub-sector",
                    color = if (s.subSectors.isEmpty()) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
            }
        }
    }
}

private fun shapeText(outline: List<CornerDto>) = when {
    outline.size >= MIN_CORNERS -> "about ${hectares(outline)}"
    else -> "no GPS yet – tap to add corners"
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
        locationNote = "Getting location for corner ${index + 1}…"
        scope.launch {
            val loc = currentLocation(context)
            locating = null
            val row = corners.getOrNull(index) ?: return@launch
            if (loc == null) {
                locationNote = "No location. Turn location on, or type the coordinates."
            } else {
                row.lat = fmt(loc.latitude)
                row.lon = fmt(loc.longitude)
                row.accuracy = if (loc.hasAccuracy()) loc.accuracy else null
                locationNote = "Corner ${index + 1} saved" + (row.accuracy?.let { " (±${it.toInt()} m)." } ?: ".") +
                    if (index < corners.lastIndex) " Walk to the next corner." else ""
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val i = pending
        pending = null
        if (grants.values.any { it } && i != null) fetch(i) else locationNote = "No location permission. Type the coordinates instead."
    }
    fun useLocation(i: Int) {
        if (hasLocationPermission(context)) fetch(i)
        else { pending = i; permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
    }

    val filled = corners.mapNotNull { it.corner }
    val anyInvalid = corners.any { it.invalid }
    val isNew = initial == null
    // GPS is optional: an area can be saved with just its name and code, and corners added later.
    val cornersOk = !anyInvalid && (filled.isEmpty() || filled.size >= MIN_CORNERS)
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
        Text("GPS corners (optional)", style = MaterialTheme.typography.titleSmall)
        Hint("You can save without them and add them later. $CORNER_HINT")
        if (filled.isNotEmpty() && filled.size < MIN_CORNERS) {
            Text("Enter at least $MIN_CORNERS corners, or clear them to save without GPS.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        if (!isNew && prefill == null && initialOutline.size > MAX_CORNERS) Hint("Outline from the web portal is kept unless you enter corners.")

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

        }
        problems.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        close.forEach { (a, b) ->
            Text("• Corners ${a + 1} and ${b + 1} are less than 3 m apart.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
        }
        if (outside.isNotEmpty()) {
            Text("• Corner ${outside.joinToString(", ")} may be outside $parentName (15 m allowed).",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
        }

        val focus = filled.takeIf { it.size >= MIN_CORNERS } ?: if (filled.isEmpty()) initialOutline else filled
        if (focus.size >= MIN_CORNERS || parentOutline.size >= MIN_CORNERS) {
            if (parentOutline.size >= MIN_CORNERS) {
                AreaSketch(parentOutline, Modifier.fillMaxWidth().height(180.dp), inner = others, focus = focus,
                    description = "Sketch of the sub-sector inside $parentName")
            } else {
                AreaSketch(focus, Modifier.fillMaxWidth().height(180.dp), inner = others, description = "Sketch of the area outline")
            }
            if (focus.size >= MIN_CORNERS) Hint("About ${hectares(focus)}")
        }

        SwitchRow("Active", active, { active = it })
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
                Text("Weak GPS. Wait in the open and try again.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/**
 * "How many sectors are in this planting area?" creates Sector 1..n (S1..Sn), each with sub-sectors SS1..SS4 by default.
 * Names, codes and GPS can be changed afterwards; existing sectors are kept.
 */
@Composable
private fun QuickAreaSetup(year: AdminPlantingYearDto, prominent: Boolean, saving: Boolean, onCreate: (Int, Int) -> Unit) {
    var open by remember(year.id) { mutableStateOf(prominent) }
    var sectors by remember(year.id) { mutableStateOf("") }
    var subs by remember(year.id) { mutableStateOf("4") }
    if (!open) {
        TextButton(onClick = { open = true }) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(4.dp)); Text("Quick setup: add numbered sectors") }
        return
    }
    val n = sectors.toIntOrNull()
    val k = subs.toIntOrNull()
    val ok = n != null && n in 1..200 && k != null && k in 1..26
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("How many sectors are in the ${year.yearLabel} planting area?", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(sectors, { sectors = it.filter(Char::isDigit).take(3) }, label = { Text("Sectors") }, singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    modifier = Modifier.weight(1f))
                OutlinedTextField(subs, { subs = it.filter(Char::isDigit).take(2) }, label = { Text("Sub-sectors each") }, singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    modifier = Modifier.weight(1f))
            }
            Hint(if (n != null && n > 0) "Creates Sector 1 (S1) … Sector $n (S$n), each with ${k ?: 0} sub-sectors (SS1…SS${k ?: 0}). GPS can be added later."
                else "Sectors are named Sector 1, Sector 2… with codes S1, S2…; sub-sectors SS1, SS2…")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onCreate(n!!, k!!) }, enabled = ok && !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text(if (saving) "Creating…" else "Create") }
                if (!prominent) OutlinedButton(onClick = { open = false }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Cancel") }
            }
        }
    }
}
