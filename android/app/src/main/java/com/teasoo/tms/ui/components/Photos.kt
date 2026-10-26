package com.teasoo.tms.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.teasoo.tms.data.local.MediaEntity
import com.teasoo.tms.data.local.MediaState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

typealias PhotoSource = suspend (MediaEntity, Int) -> ImageBitmap?

/** Thumbnails for an observation's photos; tap to view full screen (with any height measurement drawn on it). */
@Composable
fun PhotoStrip(media: List<MediaEntity>, load: PhotoSource, measurement: HeightMeasurement? = null) {
    if (media.isEmpty()) return
    var open by remember { mutableStateOf<MediaEntity?>(null) }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        media.forEach { m -> Thumbnail(m, load) { open = m } }
    }
    open?.let { m -> PhotoViewer(m, load, measurement?.takeIf { it.mediaId == m.id }) { open = null } }
}

@Composable
private fun Thumbnail(m: MediaEntity, load: PhotoSource, onClick: () -> Unit) {
    val image by produceState<ImageBitmap?>(null, m.id, m.state) { value = load(m, 320) }
    Surface(
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(88.dp).clip(MaterialTheme.shapes.small).clickable(enabled = image != null, onClick = onClick),
    ) {
        Box(contentAlignment = Alignment.Center) {
            val img = image
            when {
                img != null -> Image(img, contentDescription = "Tree photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                m.state != MediaState.VERIFIED -> PhotoPlaceholder(Icons.Default.CloudUpload, "Uploading")
                else -> PhotoPlaceholder(Icons.Default.CloudOff, "Connect to view")
            }
        }
    }
}

/** The tree's most recent photo, whole and at its own shape, at the top of anything that describes the tree; tap for full screen. */
@Composable
fun TreePhoto(media: List<MediaEntity>, load: PhotoSource, modifier: Modifier = Modifier) {
    val latest = media.maxByOrNull { it.capturedAt }
    var open by remember { mutableStateOf(false) }
    val image by produceState<ImageBitmap?>(null, latest?.id, latest?.state) { value = latest?.let { load(it, 1024) } }
    val img = image
    if (img != null) {
        FittedImage(img, "Latest photo of the tree", modifier) { open = true }
    } else {
        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant, modifier = modifier.fillMaxWidth().height(140.dp)) {
            Box(contentAlignment = Alignment.Center) {
                when {
                    latest == null -> PhotoPlaceholder(Icons.Default.CloudOff, "No photo yet")
                    latest.state != MediaState.VERIFIED -> PhotoPlaceholder(Icons.Default.CloudUpload, "Uploading")
                    else -> PhotoPlaceholder(Icons.Default.CloudOff, "Connect to view")
                }
            }
        }
    }
    if (open && latest != null) PhotoViewer(latest, load, null) { open = false }
}

/**
 * A photo shown whole, as it was taken: as wide as the screen allows but never taller than [maxHeight], so a
 * portrait photo is narrower rather than cropped. Tap to open it full screen.
 */
@Composable
fun FittedImage(image: ImageBitmap, description: String, modifier: Modifier = Modifier, maxHeight: androidx.compose.ui.unit.Dp = 360.dp, onClick: () -> Unit) {
    val ratio = image.width.toFloat() / image.height.coerceAtLeast(1)
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Image(
            image, contentDescription = description, contentScale = ContentScale.Fit,
            modifier = Modifier.heightIn(max = maxHeight).aspectRatio(ratio).clip(MaterialTheme.shapes.medium).clickable(onClick = onClick),
        )
    }
}

/** Full-screen view of any image, pinch to zoom; closes with the button or Back. */
@Composable
fun ImageViewerDialog(image: ImageBitmap?, description: String, onClose: () -> Unit, loading: Boolean = true, overlay: @Composable BoxScope.() -> Unit = {}) {
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Box(Modifier.fillMaxSize()) {
                if (image == null) {
                    if (loading) CircularProgressIndicator(Modifier.align(Alignment.Center))
                } else {
                    Image(
                        image, contentDescription = description, contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                            .pointerInput(Unit) {
                                detectTransformGestures { _, pan, zoom, _ ->
                                    scale = (scale * zoom).coerceIn(1f, 5f)
                                    offset = if (scale == 1f) androidx.compose.ui.geometry.Offset.Zero else offset + pan
                                }
                            }
                            .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
                    )
                }
                overlay()
                IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).topSafe().padding(8.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                }
            }
        }
    }
}

/** A small square of a tree's latest photo for lists; blank when there is none or it can't be loaded offline. */
@Composable
fun TreeThumb(treeId: String, latest: suspend (String) -> MediaEntity?, load: PhotoSource, size: androidx.compose.ui.unit.Dp = 56.dp) {
    val image by produceState<ImageBitmap?>(null, treeId) { value = latest(treeId)?.let { load(it, 320) } }
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(size).clip(MaterialTheme.shapes.small)) {
        image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
    }
}

@Composable
private fun PhotoPlaceholder(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun PhotoViewer(m: MediaEntity, load: PhotoSource, measurement: HeightMeasurement?, onClose: () -> Unit) {
    val image by produceState<ImageBitmap?>(null, m.id) { value = load(m, 1600) }
    if (measurement == null) {
        ImageViewerDialog(image, "Tree photo", onClose)
        return
    }
    var box by remember { mutableStateOf(IntSize.Zero) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Box(Modifier.fillMaxSize().onSizeChanged { box = it }) {
                val img = image
                if (img == null) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                } else {
                    Image(img, contentDescription = "Tree photo", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                    if (measurement != null) {
                        val rect = fitRect(box, img.width, img.height)
                        Canvas(Modifier.fillMaxSize()) { drawMeasurement(measurement.points, rect) }
                    }
                }
                IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).topSafe().padding(8.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                }
                measurement?.heightCm()?.let { cm ->
                    Text(
                        "Height ≈ ${formatHeight(cm)} · stick ${formatHeight(measurement.referenceCm)}",
                        color = Color.White,
                        modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp).then(ScrimModifier).padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

private val SHORT_DATE = DateTimeFormatter.ofPattern("d MMM yy").withZone(ZoneId.systemDefault())

/** Height over time for one tree. */
@Composable
fun GrowthChart(points: List<Pair<Instant, Double>>, modifier: Modifier = Modifier) {
    val sorted = points.sortedBy { it.first }
    if (sorted.size < 2) {
        Text("Record the height on at least two visits to see this tree’s growth.", style = MaterialTheme.typography.bodySmall, modifier = modifier)
        return
    }
    val measurer = rememberTextMeasurer()
    val line = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val label = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
    Canvas(modifier.fillMaxWidth().height(180.dp)) {
        val left = 56f
        val bottom = size.height - 36f
        val top = 12f
        val right = size.width - 12f
        val t0 = sorted.first().first.epochSecond.toFloat()
        val t1 = sorted.last().first.epochSecond.toFloat().coerceAtLeast(t0 + 1)
        val maxY = (sorted.maxOf { it.second } * 1.1).toFloat()
        fun x(t: Instant) = left + (t.epochSecond - t0) / (t1 - t0) * (right - left)
        fun y(v: Double) = bottom - (v.toFloat() / maxY) * (bottom - top)
        for (i in 0..3) {
            val v = maxY * i / 3
            val yy = y(v.toDouble())
            drawLine(grid, androidx.compose.ui.geometry.Offset(left, yy), androidx.compose.ui.geometry.Offset(right, yy), strokeWidth = 1f)
            drawText(measurer, formatHeight(v.toDouble()), androidx.compose.ui.geometry.Offset(0f, yy - 14f), style = label)
        }
        val path = Path()
        sorted.forEachIndexed { i, (t, v) -> if (i == 0) path.moveTo(x(t), y(v)) else path.lineTo(x(t), y(v)) }
        drawPath(path, line, style = Stroke(width = 5f))
        sorted.forEach { (t, v) -> drawCircle(line, 8f, androidx.compose.ui.geometry.Offset(x(t), y(v))) }
        drawText(measurer, SHORT_DATE.format(sorted.first().first), androidx.compose.ui.geometry.Offset(left, bottom + 8f), style = label)
        val last = SHORT_DATE.format(sorted.last().first)
        val w = measurer.measure(last, label).size.width
        drawText(measurer, last, androidx.compose.ui.geometry.Offset(right - w, bottom + 8f), style = label)
    }
}
