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
import com.teasoo.tms.data.remote.AdminSectorDto
import com.teasoo.tms.data.remote.AdminSubSectorDto
import com.teasoo.tms.data.remote.AreaRequest
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

private sealed interface AreaEdit {
    data class Sector(val sector: AdminSectorDto?) : AreaEdit
    data class SubSector(val parent: AdminSectorDto, val sub: AdminSubSectorDto?) : AreaEdit
}

@Composable
internal fun AreasTab(vm: ProjectSetupViewModel) {
    val areas = collect(vm.areas)
    val saving = collect(vm.saving)
    val formError = collect(vm.formError)
    var edit by remember { mutableStateOf<AreaEdit?>(null) }
    fun open(e: AreaEdit) { vm.clearFormError(); edit = e }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            "Areas",
            supporting = "Sectors and their sub-sectors. Officers record every tree in a sub-sector. Boundaries drawn in the web portal are kept when you edit here.",
            action = { if (areas.isNotEmpty()) TextButton(onClick = { open(AreaEdit.Sector(null)) }) { Icon(Icons.Default.Add, null); Text("Sector") } },
        )
        if (areas.isEmpty()) {
            EmptyState(Icons.Default.Map, "No areas yet", "Add a sector (for example North Ridge, code N), then its sub-sectors. A reference GPS point helps officers find each area.",
                "Add sector", { open(AreaEdit.Sector(null)) })
        }
        areas.forEach { s ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(vertical = 8.dp)) {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(s.name, style = MaterialTheme.typography.titleMedium)
                                if (!s.active) InactiveTag()
                            }
                            Text("${s.shortCode} · ${coords(s.referenceLatitude, s.referenceLongitude)}", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
                        }
                        IconButton(onClick = { open(AreaEdit.Sector(s)) }) { Icon(Icons.Default.Edit, "Edit ${s.name}") }
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
                            supportingContent = { Text("${ss.shortCode} · ${coords(ss.referenceLatitude, ss.referenceLongitude)}", fontFamily = FontFamily.Monospace) },
                            trailingContent = { IconButton(onClick = { open(AreaEdit.SubSector(s, ss)) }) { Icon(Icons.Default.Edit, "Edit ${ss.name}") } },
                            modifier = Modifier.padding(start = 12.dp),
                        )
                    }
                    TextButton(onClick = { open(AreaEdit.SubSector(s, null)) }, modifier = Modifier.padding(start = 8.dp).heightIn(min = 48.dp)) {
                        Icon(Icons.Default.Add, null); Spacer(Modifier.width(4.dp)); Text("Add sub-sector to ${s.shortCode}")
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    when (val e = edit) {
        is AreaEdit.Sector -> AreaDialog(
            title = if (e.sector == null) "Add sector" else "Edit sector",
            initial = e.sector?.let { AreaRequest(it.name, it.shortCode, it.description, it.referenceLatitude ?: 0.0, it.referenceLongitude ?: 0.0, it.active) },
            saving = saving, error = formError,
            onSave = { req -> vm.saveSector(e.sector?.id, req) { edit = null } },
            onDismiss = { edit = null },
        )
        is AreaEdit.SubSector -> AreaDialog(
            title = if (e.sub == null) "Add sub-sector to ${e.parent.name}" else "Edit sub-sector",
            initial = e.sub?.let { AreaRequest(it.name, it.shortCode, it.description, it.referenceLatitude ?: 0.0, it.referenceLongitude ?: 0.0, it.active) },
            saving = saving, error = formError,
            onSave = { req -> vm.saveSubSector(e.parent.id, e.sub?.id, req) { edit = null } },
            onDismiss = { edit = null },
        )
        null -> Unit
    }
}

private fun coords(lat: Double?, lon: Double?) = if (lat == null || lon == null) "no reference point" else "%.5f, %.5f".format(Locale.US, lat, lon)

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

@Composable
private fun AreaDialog(title: String, initial: AreaRequest?, saving: Boolean, error: String?, onSave: (AreaRequest) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(initial?.name.orEmpty()) }
    var code by remember { mutableStateOf(initial?.shortCode.orEmpty()) }
    var description by remember { mutableStateOf(initial?.description.orEmpty()) }
    var lat by remember { mutableStateOf(initial?.referenceLatitude?.let { "%.6f".format(Locale.US, it) }.orEmpty()) }
    var lon by remember { mutableStateOf(initial?.referenceLongitude?.let { "%.6f".format(Locale.US, it) }.orEmpty()) }
    var active by remember { mutableStateOf(initial?.active ?: true) }
    var locating by remember { mutableStateOf(false) }
    var locationNote by remember { mutableStateOf<String?>(null) }

    fun fetch() {
        locating = true
        locationNote = "Getting your location… Stand in the open for a better fix."
        scope.launch {
            val loc = currentLocation(context)
            locating = false
            if (loc == null) {
                locationNote = "Couldn’t get a location. Check that location is on, or type the coordinates."
            } else {
                lat = "%.6f".format(Locale.US, loc.latitude)
                lon = "%.6f".format(Locale.US, loc.longitude)
                locationNote = if (loc.hasAccuracy()) "Filled from this phone (±${loc.accuracy.toInt()} m)." else "Filled from this phone."
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (grants.values.any { it }) fetch() else locationNote = "Location permission was not granted. You can still type the coordinates."
    }

    val latValue = lat.replace(',', '.').trim().toDoubleOrNull()
    val lonValue = lon.replace(',', '.').trim().toDoubleOrNull()
    val latOk = latValue != null && latValue in -90.0..90.0
    val lonOk = lonValue != null && lonValue in -180.0..180.0

    FormDialog(
        title, if (initial == null) "Add" else "Save", name.isNotBlank() && code.isNotBlank() && latOk && lonOk, saving, error,
        onConfirm = { onSave(AreaRequest(name.trim(), code.trim(), description.trim().ifBlank { null }, latValue!!, lonValue!!, active)) },
        onDismiss = onDismiss,
    ) {
        TextInput(name, { name = it }, "Name")
        CodeInput(code, { code = it }, supporting = if (initial != null && code != initial.shortCode) "Existing tree IDs keep the old code." else "Letters and digits, up to 16")
        TextInput(description, { description = it }, "Description (optional)", singleLine = false)
        Text("Reference point", style = MaterialTheme.typography.labelLarge)
        OutlinedButton(
            onClick = { if (hasLocationPermission(context)) fetch() else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) },
            enabled = !locating, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            if (locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Default.MyLocation, null)
            Spacer(Modifier.width(8.dp))
            Text("Use my current location")
        }
        locationNote?.let { Hint(it) }
        val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(lat, { lat = it }, label = { Text("Latitude") }, singleLine = true, keyboardOptions = decimal,
                isError = lat.isNotBlank() && !latOk, supportingText = { Text("−90 to 90") }, modifier = Modifier.weight(1f))
            OutlinedTextField(lon, { lon = it }, label = { Text("Longitude") }, singleLine = true, keyboardOptions = decimal,
                isError = lon.isNotBlank() && !lonOk, supportingText = { Text("−180 to 180") }, modifier = Modifier.weight(1f))
        }
        SwitchRow("Active", active, { active = it }, supporting = if (active) "Officers can choose this area" else "Hidden from new field sessions; existing trees are kept")
    }
}
