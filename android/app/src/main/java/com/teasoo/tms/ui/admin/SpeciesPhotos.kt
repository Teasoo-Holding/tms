package com.teasoo.tms.ui.admin

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.AdminSpeciesDto
import com.teasoo.tms.data.remote.SpeciesImageDto
import com.teasoo.tms.data.repo.PhotoStore
import com.teasoo.tms.ui.components.CameraCaptureDialog
import com.teasoo.tms.ui.components.ImageViewerDialog
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

@HiltViewModel
class SpeciesPhotosViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: AdminApi,
    val photoStore: PhotoStore,
) : AdminBaseViewModel(context) {
    val images = MutableStateFlow<List<SpeciesImageDto>?>(null)
    private var speciesId: String? = null

    fun open(id: String) {
        if (speciesId == id) return
        speciesId = id
        images.value = null
        load { images.value = api.speciesImages(id).images }
    }

    /** Uploads photos picked from the gallery (any number at once); the server shrinks them and makes thumbnails. */
    fun upload(uris: List<Uri>) {
        val id = speciesId ?: return
        if (uris.isEmpty()) return
        save("${uris.size} photo${if (uris.size == 1) "" else "s"} added", reload = { speciesId = null; open(id) }) {
            val parts = withContext(Dispatchers.IO) {
                uris.mapIndexed { i, uri ->
                    val type = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val bytes = context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                    MultipartBody.Part.createFormData("file", "photo$i.${type.substringAfter('/')}", bytes.toRequestBody(type.toMediaType()))
                }
            }
            api.uploadSpeciesImages(id, parts)
        }
    }

    /** A photo just taken with the camera (already shrunk and upright). */
    fun uploadFile(file: java.io.File) {
        val id = speciesId ?: return
        save("Photo added", reload = { speciesId = null; open(id) }) {
            val part = MultipartBody.Part.createFormData("file", file.name, file.readBytes().toRequestBody("image/jpeg".toMediaType()))
            try { api.uploadSpeciesImages(id, listOf(part)) } finally { file.delete() }
        }
    }

    fun delete(image: SpeciesImageDto, onDone: () -> Unit) {
        val id = speciesId ?: return
        save("Photo deleted", onDone, reload = { speciesId = null; open(id) }) {
            val r = api.deleteSpeciesImage(image.id)
            if (!r.isSuccessful && r.code() != 404) throw retrofit2.HttpException(r)
        }
    }

    suspend fun bitmap(image: SpeciesImageDto, full: Boolean): ImageBitmap? = withContext(Dispatchers.IO) {
        runCatching { api.speciesImageContent(image.id, if (full) "full" else "thumb").byteStream().use { BitmapFactory.decodeStream(it) }?.asImageBitmap() }.getOrNull()
    }
}

/** Reference photos of one species: add from the gallery or camera, view full size, delete. Phones get them on their next sync. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SpeciesPhotosDialog(species: AdminSpeciesDto, onClose: () -> Unit, vm: SpeciesPhotosViewModel = hiltViewModel()) {
    LaunchedEffect(species.id) { vm.open(species.id) }
    val images = collect(vm.images)
    val loading = collect(vm.loading)
    val saving = collect(vm.saving)
    val error = collect(vm.formError) ?: collect(vm.error)
    var camera by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<SpeciesImageDto?>(null) }
    var deleting by remember { mutableStateOf<SpeciesImageDto?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { vm.upload(it) }
    val name = species.commonName?.takeIf { it.isNotBlank() } ?: species.scientificName

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(topBar = {
            TopAppBar(
                title = { Column { Text("Reference photos"); Text(name, style = MaterialTheme.typography.bodySmall) } },
                navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Close") } },
            )
        }) { padding ->
            Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Field officers see these when choosing the species. Add several angles: leaves, bark, the whole young tree.", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Icon(Icons.Default.PhotoLibrary, null); Spacer(Modifier.width(8.dp)); Text("From gallery")
                    }
                    OutlinedButton(onClick = { camera = true }, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Icon(Icons.Default.CameraAlt, null); Spacer(Modifier.width(8.dp)); Text("Take photo")
                    }
                }
                if (saving) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                when {
                    images == null && loading -> CircularProgressIndicator()
                    images.isNullOrEmpty() -> Text("No photos yet.", style = MaterialTheme.typography.bodyMedium)
                    else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        images.forEach { img -> PhotoTile(img, vm, onOpen = { viewing = img }, onDelete = { deleting = img }) }
                    }
                }
            }
        }
    }
    if (camera) CameraCaptureDialog(vm.photoStore, onCaptured = { camera = false; vm.uploadFile(it.file) }, onDismiss = { camera = false })
    viewing?.let { img ->
        val full by produceState<ImageBitmap?>(null, img.id) { value = vm.bitmap(img, full = true) }
        ImageViewerDialog(full, name, onClose = { viewing = null })
    }
    deleting?.let { img ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete this photo?") },
            text = { Text("It is removed from every phone on their next sync.") },
            confirmButton = { TextButton(onClick = { vm.delete(img) { deleting = null } }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PhotoTile(img: SpeciesImageDto, vm: SpeciesPhotosViewModel, onOpen: () -> Unit, onDelete: () -> Unit) {
    val bitmap by produceState<ImageBitmap?>(null, img.id) { value = vm.bitmap(img, full = false) }
    Box(Modifier.size(150.dp).clip(MaterialTheme.shapes.medium).clickable(onClick = onOpen)) {
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxSize()) {
            bitmap?.let { Image(it, contentDescription = img.caption, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        FilledTonalIconButton(onClick = onDelete, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)) { Icon(Icons.Default.Delete, "Delete photo") }
    }
}
