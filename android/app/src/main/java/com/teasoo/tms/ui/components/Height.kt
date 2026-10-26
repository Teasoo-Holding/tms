package com.teasoo.tms.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.repo.CapturedPhoto
import com.teasoo.tms.data.repo.HeightReading
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import kotlin.math.hypot
import kotlin.math.roundToInt

/*
 * Tree height from a photo. The officer stands a stick of known length (e.g. a 1 m pole) upright beside
 * the tree, photographs both, then marks the top and bottom of the stick and of the tree. Because the stick
 * and the tree are at about the same distance from the camera, height = stick length × (tree length on the
 * photo ÷ stick length on the photo). The marked points are saved so anyone can review the measurement.
 */

/** Points are fractions (0..1) of the photo's width and height. */
data class HeightMeasurement(
    val referenceCm: Double,
    val points: Map<String, Offset>,
    val mediaId: String?,
    val imageWidth: Int,
    val imageHeight: Int,
) {
    fun heightCm(): Double? {
        val (rt, rb, tt, tb) = POINTS.map { points[it] ?: return null }
        val ref = pixelDistance(rt, rb)
        if (ref < 10 || referenceCm <= 0) return null
        return referenceCm * pixelDistance(tt, tb) / ref
    }

    private fun pixelDistance(a: Offset, b: Offset) = hypot(((a.x - b.x) * imageWidth).toDouble(), ((a.y - b.y) * imageHeight).toDouble())

    fun toJson(): String = buildJsonObject {
        put("reference_cm", referenceCm)
        putJsonObject("points") { points.forEach { (k, o) -> putJsonArray(k) { add(o.x); add(o.y) } } }
        mediaId?.let { put("media_id", it) }
        put("image_width", imageWidth)
        put("image_height", imageHeight)
    }.toString()

    companion object {
        val POINTS = listOf("ref_top", "ref_bottom", "tree_top", "tree_base")

        fun parse(json: String?): HeightMeasurement? = runCatching {
            val o = TmsJson.parseToJsonElement(json ?: return null).jsonObject
            HeightMeasurement(
                referenceCm = o["reference_cm"]!!.jsonPrimitive.double,
                points = o["points"]!!.jsonObject.mapValues { (_, v) -> v.jsonArray.let { Offset(it[0].jsonPrimitive.float, it[1].jsonPrimitive.float) } },
                mediaId = o["media_id"]?.jsonPrimitive?.contentOrNull,
                imageWidth = o["image_width"]?.jsonPrimitive?.int ?: 1,
                imageHeight = o["image_height"]?.jsonPrimitive?.int ?: 1,
            )
        }.getOrNull()
    }
}

private val STEP_TEXT = mapOf(
    "ref_top" to "Tap the TOP of the measuring stick",
    "ref_bottom" to "Tap the BOTTOM of the measuring stick",
    "tree_top" to "Tap the TOP of the tree (highest leaf or bud)",
    "tree_base" to "Tap the BASE of the tree, where the stem meets the ground",
)
private val STICK_COLOR = Color(0xFFFFC107)
private val TREE_COLOR = Color(0xFF4CAF50)

fun formatHeight(cm: Double): String = if (cm >= 100) "%.2f m".format(cm / 100) else "${cm.roundToInt()} cm"

/** Units a height can be typed in, with their size in centimetres. Heights are stored in centimetres. */
enum class HeightUnit(val code: String, val label: String, val cm: Double) {
    CM("cm", "cm", 1.0), M("m", "m", 100.0), IN("in", "inches", 2.54), FT("ft", "feet", 30.48);

    companion object {
        fun of(code: String?) = entries.find { it.code == code } ?: CM
    }
}

private fun formatIn(cm: Double, unit: HeightUnit): String {
    val v = cm / unit.cm
    return if (v == kotlin.math.floor(v)) v.toLong().toString() else "%.2f".format(java.util.Locale.US, v).trimEnd('0').trimEnd('.')
}

/** Optional tree height: a number and its unit (cm unless the officer picks another, which is remembered). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeightInput(cm: Double?, onChange: (Double?) -> Unit, unit: HeightUnit, onUnit: (HeightUnit) -> Unit) {
    var text by remember { mutableStateOf(cm?.let { formatIn(it, unit) }.orEmpty()) }
    // A cleared form (next tree) clears the box too.
    LaunchedEffect(cm) { if (cm == null && text.toDoubleOrNull() != null) text = "" }
    var menu by remember { mutableStateOf(false) }
    val value = text.replace(',', '.').toDoubleOrNull()
    val invalid = text.isNotBlank() && (value == null || value <= 0 || value * unit.cm > 10_000)
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            text,
            { raw ->
                text = raw.filter { it.isDigit() || it == '.' || it == ',' }.take(8)
                val v = text.replace(',', '.').toDoubleOrNull()
                onChange(v?.takeIf { it > 0 && it * unit.cm <= 10_000 }?.let { it * unit.cm })
            },
            label = { Text("Tree height (optional)") },
            singleLine = true, isError = invalid,
            supportingText = if (invalid) { { Text("Enter a height up to 100 m.") } } else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.weight(1f),
        )
        ExposedDropdownMenuBox(menu, { menu = it }, modifier = Modifier.width(132.dp)) {
            OutlinedTextField(
                unit.label, {}, readOnly = true, label = { Text("Unit") }, singleLine = true,
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(menu) },
                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(menu, { menu = false }) {
                HeightUnit.entries.forEach { u ->
                    DropdownMenuItem(text = { Text(u.label) }, onClick = {
                        menu = false
                        if (u != unit) {
                            onUnit(u)
                            // Keep the same height, shown in the new unit.
                            cm?.let { text = formatIn(it, u) }
                        }
                    })
                }
            }
        }
    }
}

/** Height entry for an observation: type it in, or measure it on the photo just taken. */
@Composable
fun HeightSection(
    height: HeightReading?,
    onChange: (HeightReading?) -> Unit,
    photos: List<CapturedPhoto>,
    referenceCm: Double,
    onReferenceCm: (Double) -> Unit,
) {
    var measuring by remember { mutableStateOf(false) }
    var text by remember(height?.cm, height?.method) { mutableStateOf(height?.cm?.let { "%.1f".format(it).removeSuffix(".0") }.orEmpty()) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Height", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = text,
                onValueChange = { v ->
                    text = v
                    val cm = v.replace(',', '.').toDoubleOrNull()
                    onChange(cm?.takeIf { it > 0 }?.let { HeightReading(it, "MANUAL") })
                },
                label = { Text("cm (optional)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f),
            )
            FilledTonalButton(onClick = { measuring = true }, enabled = photos.isNotEmpty()) { Text("Measure on photo") }
        }
        when {
            height?.method == "PHOTO_REFERENCE" -> Text(
                "Measured on the photo against a ${formatHeight(HeightMeasurement.parse(height.measurementJson)?.referenceCm ?: referenceCm)} stick: ${formatHeight(height.cm)}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
            )
            photos.isEmpty() -> Text("To measure on a photo, stand a stick of known length upright beside the tree and take a photo showing both from top to bottom.",
                style = MaterialTheme.typography.bodySmall)
        }
    }
    if (measuring && photos.isNotEmpty()) {
        HeightMeasureDialog(
            photo = photos.last(),
            referenceCm = referenceCm,
            onDone = { reading, ref -> onReferenceCm(ref); onChange(reading); measuring = false },
            onDismiss = { measuring = false },
        )
    }
}

@Composable
fun HeightMeasureDialog(photo: CapturedPhoto, referenceCm: Double, onDone: (HeightReading, Double) -> Unit, onDismiss: () -> Unit) {
    val image by produceState<ImageBitmap?>(null, photo.file) {
        value = withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(photo.file.path, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
            BitmapFactory.decodeFile(photo.file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }
    }
    var points by remember { mutableStateOf(mapOf<String, Offset>()) }
    var refText by remember { mutableStateOf(referenceCm.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }) }
    var box by remember { mutableStateOf(IntSize.Zero) }
    val next = HeightMeasurement.POINTS.firstOrNull { it !in points }
    val img = image
    val measurement = img?.let { HeightMeasurement(refText.replace(',', '.').toDoubleOrNull() ?: 0.0, points, photo.mediaId, it.width, it.height) }
    val result = measurement?.heightCm()

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Column {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        Text("Measure height", style = MaterialTheme.typography.titleMedium)
                        Text(next?.let { STEP_TEXT[it] } ?: "Drag any point to adjust it.", style = MaterialTheme.typography.bodyMedium,
                            color = if (next?.startsWith("ref") == true) Color(0xFF9A6C00) else MaterialTheme.colorScheme.primary)
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth().onSizeChanged { box = it }) {
                    if (img == null) {
                        CircularProgressIndicator(Modifier.align(Alignment.Center))
                    } else {
                        val rect = fitRect(box, img.width, img.height)
                        fun toImage(p: Offset) = Offset(((p.x - rect.left) / rect.width).coerceIn(0f, 1f), ((p.y - rect.top) / rect.height).coerceIn(0f, 1f))
                        fun nearest(p: Offset) = points.minByOrNull { (_, o) -> (toScreen(o, rect) - p).getDistance() }?.key
                        Image(img, contentDescription = "Photo to measure", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                        Canvas(
                            Modifier.fillMaxSize()
                                .pointerInput(img, next, rect) {
                                    detectTapGestures { p ->
                                        if (!rect.contains(p)) return@detectTapGestures
                                        val key = next ?: nearest(p) ?: return@detectTapGestures
                                        points = points + (key to toImage(p))
                                    }
                                }
                                .pointerInput(img, rect) {
                                    var dragging: String? = null
                                    detectDragGestures(
                                        onDragStart = { p -> dragging = nearest(p) },
                                        onDrag = { change, _ -> dragging?.let { k -> points = points + (k to toImage(change.position)) } },
                                        onDragEnd = { dragging = null },
                                    )
                                },
                        ) { drawMeasurement(points, rect) }
                    }
                }
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedTextField(
                                refText, { refText = it }, label = { Text("Stick length (cm)") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(160.dp),
                            )
                            Text(result?.let { "Tree height ≈ ${formatHeight(it)}" } ?: "Mark all four points", style = MaterialTheme.typography.titleMedium)
                        }
                        Text("Keep the stick upright and beside the tree, and hold the phone level, for a good reading.", style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = onDismiss) { Text("Cancel") }
                            TextButton(onClick = { points = emptyMap() }, enabled = points.isNotEmpty()) { Text("Start again") }
                            Spacer(Modifier.weight(1f))
                            Button(
                                onClick = {
                                    val m = measurement ?: return@Button
                                    onDone(HeightReading(Math.round(result!! * 10) / 10.0, "PHOTO_REFERENCE", m.toJson()), m.referenceCm)
                                },
                                enabled = result != null,
                            ) { Text("Use height") }
                        }
                    }
                }
            }
        }
    }
}

/** Where an image of the given size is drawn inside [box] with ContentScale.Fit. */
fun fitRect(box: IntSize, w: Int, h: Int): Rect {
    if (box.width == 0 || box.height == 0 || w == 0 || h == 0) return Rect.Zero
    val scale = minOf(box.width.toFloat() / w, box.height.toFloat() / h)
    val dw = w * scale
    val dh = h * scale
    val left = (box.width - dw) / 2
    val top = (box.height - dh) / 2
    return Rect(left, top, left + dw, top + dh)
}

private fun toScreen(o: Offset, rect: Rect) = Offset(rect.left + o.x * rect.width, rect.top + o.y * rect.height)

/** Stick in amber, tree in green; also used to show a saved measurement on the photo viewer. */
fun DrawScope.drawMeasurement(points: Map<String, Offset>, rect: Rect) {
    fun line(a: String, b: String, color: Color) {
        val p = points[a] ?: return
        val q = points[b] ?: return
        drawLine(Color.Black.copy(alpha = 0.5f), toScreen(p, rect), toScreen(q, rect), strokeWidth = 9f)
        drawLine(color, toScreen(p, rect), toScreen(q, rect), strokeWidth = 5f)
    }
    line("ref_top", "ref_bottom", STICK_COLOR)
    line("tree_top", "tree_base", TREE_COLOR)
    points.forEach { (k, o) ->
        val c = if (k.startsWith("ref")) STICK_COLOR else TREE_COLOR
        val s = toScreen(o, rect)
        drawCircle(Color.Black.copy(alpha = 0.5f), radius = 16f, center = s)
        drawCircle(c, radius = 12f, center = s, style = Stroke(width = 5f))
        drawCircle(Color.White, radius = 3f, center = s)
    }
}

/** Shared background for photo overlays. */
val ScrimModifier = Modifier.background(Color.Black.copy(alpha = 0.55f))
