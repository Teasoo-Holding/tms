package com.teasoo.tms.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
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
                IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
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
