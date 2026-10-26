package com.teasoo.tms.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Park
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.local.SpeciesEntity
import com.teasoo.tms.data.local.SpeciesImageEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.repo.SpeciesImageStore
import com.teasoo.tms.ui.components.ImageViewerDialog
import com.teasoo.tms.ui.components.bottomSafe
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class SpeciesImagesViewModel @Inject constructor(db: TmsDatabase, private val store: SpeciesImageStore) : ViewModel() {
    /** Reference photos by species, in the administrator's order. */
    val bySpecies = db.reference().speciesImages().map { l -> l.groupBy { it.speciesId } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())
    suspend fun load(image: SpeciesImageEntity, maxPx: Int) = store.load(image, maxPx)
}

private fun SpeciesEntity.title() = commonName ?: scientificName

/**
 * Species as picture cards. Once one is chosen (it is remembered from tree to tree) only that card shows, with
 * "Change"; tap a card's photo icon, or long-press it, to see all of the species' reference photos full screen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SpeciesChooser(species: List<SpeciesEntity>, selectedId: String?, onSelect: (String) -> Unit, vm: SpeciesImagesViewModel = hiltViewModel()) {
    val images by vm.bySpecies.collectAsStateWithLifecycle()
    var choosing by remember { mutableStateOf(false) }
    var gallery by remember { mutableStateOf<SpeciesEntity?>(null) }
    var filter by remember { mutableStateOf("") }
    val selected = species.find { it.id == selectedId }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Species", style = MaterialTheme.typography.titleMedium)
        if (selected != null && !choosing) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SpeciesCard(selected, images[selected.id].orEmpty(), vm::load, selected = true, Modifier.width(180.dp), onClick = { gallery = selected }, onGallery = { gallery = selected })
                OutlinedButton(onClick = { choosing = true }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Change") }
            }
        } else {
            if (species.size > 8) {
                OutlinedTextField(filter, { filter = it }, label = { Text("Search species") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            val shown = species.filter { s -> filter.isBlank() || listOfNotNull(s.commonName, s.scientificName).any { it.contains(filter.trim(), ignoreCase = true) } }
            // Two cards per row: large enough to recognise the tree, small enough to compare several.
            shown.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    pair.forEach { s ->
                        SpeciesCard(
                            s, images[s.id].orEmpty(), vm::load, selected = s.id == selectedId, Modifier.weight(1f),
                            onClick = { onSelect(s.id); choosing = false; filter = "" }, onGallery = { gallery = s },
                        )
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (species.isEmpty()) Text("No species on this device yet. Sync while connected.", style = MaterialTheme.typography.bodySmall)
            if (selected != null) TextButton(onClick = { choosing = false; filter = "" }) { Text("Keep ${selected.title()}") }
        }
    }
    gallery?.let { s ->
        SpeciesGallery(s, images[s.id].orEmpty(), vm::load, isSelected = s.id == selectedId,
            onChoose = { onSelect(s.id); choosing = false; filter = ""; gallery = null }, onClose = { gallery = null })
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SpeciesCard(
    s: SpeciesEntity,
    images: List<SpeciesImageEntity>,
    load: suspend (SpeciesImageEntity, Int) -> ImageBitmap?,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
    onGallery: () -> Unit,
) {
    val first = images.firstOrNull()
    val image by produceState<ImageBitmap?>(null, first?.id) { value = first?.let { load(it, 400) } }
    val border = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        modifier = modifier.clip(MaterialTheme.shapes.medium).border(if (selected) 3.dp else 1.dp, border, MaterialTheme.shapes.medium)
            .combinedClickable(onClick = onClick, onLongClick = onGallery),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f), contentAlignment = Alignment.Center) {
                val img = image
                if (img != null) Image(img, contentDescription = s.title(), contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Icon(Icons.Default.Park, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(48.dp))
                if (selected) Surface(shape = androidx.compose.foundation.shape.CircleShape, color = MaterialTheme.colorScheme.primary, modifier = Modifier.align(Alignment.TopStart).padding(6.dp)) {
                    Icon(Icons.Default.Check, contentDescription = "Selected", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.padding(4.dp).size(24.dp))
                }
                if (images.isNotEmpty()) FilledTonalIconButton(onClick = onGallery, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(40.dp)) {
                    Icon(Icons.Default.Collections, contentDescription = "See ${images.size} reference photos")
                }
            }
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                Text(s.title(), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (s.commonName != null) Text(s.scientificName, style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** All reference photos of a species, swiped one by one, whole and zoomable, with the option to choose it. */
@Composable
private fun SpeciesGallery(
    s: SpeciesEntity,
    images: List<SpeciesImageEntity>,
    load: suspend (SpeciesImageEntity, Int) -> ImageBitmap?,
    isSelected: Boolean,
    onChoose: () -> Unit,
    onClose: () -> Unit,
) {
    val pager = rememberPagerState { images.size.coerceAtLeast(1) }
    ImageViewerDialog(image = null, description = s.title(), onClose = onClose, loading = false) {
        if (images.isEmpty()) {
            Text("No reference photos for ${s.title()} yet.", color = Color.White, modifier = Modifier.align(Alignment.Center).padding(24.dp))
        } else {
            HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
                val img by produceState<ImageBitmap?>(null, images[page].id) { value = load(images[page], 1600) }
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    img?.let { Image(it, contentDescription = s.title(), contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
                        ?: CircularProgressIndicator()
                }
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0x99000000)).bottomSafe().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(s.title(), color = Color.White, style = MaterialTheme.typography.titleLarge)
            if (s.commonName != null) Text(s.scientificName, color = Color.White, fontStyle = FontStyle.Italic)
            images.getOrNull(pager.currentPage)?.caption?.let { Text(it, color = Color.White) }
            if (images.size > 1) Text("Photo ${pager.currentPage + 1} of ${images.size} · swipe for more", color = Color.White, style = MaterialTheme.typography.bodySmall)
            Button(onClick = onChoose, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text(if (isSelected) "Keep this species" else "Choose ${s.title()}", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

