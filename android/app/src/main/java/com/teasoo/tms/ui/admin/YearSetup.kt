package com.teasoo.tms.ui.admin

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.teasoo.tms.data.remote.AdminPlantingYearDto
import com.teasoo.tms.data.remote.AdminSchemeDto
import com.teasoo.tms.data.remote.AdminSectorDto
import com.teasoo.tms.data.remote.CornerDto
import com.teasoo.tms.data.remote.AdminYearVendorDto
import com.teasoo.tms.data.remote.ProjectDetailDto
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sqrt

/*
 * Shared pieces of the per-year project setup: the planting-year selector, which ID format applies to a
 * vendor in a year, example IDs with the project's real codes, and a small sketch of an area's outline.
 */

// ---------------------------------------------------------------- planting years

/** Years newest first (labels such as 2024, 2024A sort naturally). */
fun ProjectDetailDto.yearsNewestFirst(): List<AdminPlantingYearDto> = plantingYears.sortedByDescending { it.yearLabel }

/** The year to show first: the newest open year, else the newest year. */
fun ProjectDetailDto.defaultYear(): AdminPlantingYearDto? =
    yearsNewestFirst().firstOrNull { it.active } ?: yearsNewestFirst().firstOrNull()

/** Vendors linked (and not unlinked) to [yearId], by name. */
fun ProjectDetailDto.linkedVendors(yearId: String?): List<AdminYearVendorDto> =
    plantingYearVendors.filter { it.active && it.plantingYearId == yearId }.sortedBy { (it.vendorName ?: "").lowercase() }

/** Chips for choosing the planting year that the Areas, Vendors and ID format sections show. */
@Composable
fun YearChips(years: List<AdminPlantingYearDto>, selectedId: String?, onSelect: (String) -> Unit, onAdd: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text("Planting year", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            years.forEach { y ->
                FilterChip(
                    selected = y.id == selectedId,
                    onClick = { onSelect(y.id) },
                    label = { Text(if (y.active) y.yearLabel else "${y.yearLabel} (closed)") },
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
            AssistChip(
                onClick = onAdd,
                label = { Text("Add year") },
                leadingIcon = { Icon(Icons.Default.Add, null, Modifier.size(18.dp)) },
                modifier = Modifier.heightIn(min = 48.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- ID formats

enum class FormatScope { DEFAULT, YEAR, VENDOR, VENDOR_YEAR }

fun AdminSchemeDto.scopeKind(): FormatScope = when {
    vendorId != null && plantingYearId != null -> FormatScope.VENDOR_YEAR
    vendorId != null -> FormatScope.VENDOR
    plantingYearId != null -> FormatScope.YEAR
    else -> FormatScope.DEFAULT
}

/** "Project default", "Year 2025", "Green Earth (all years)", "Green Earth in 2025". */
fun AdminSchemeDto.scopeTitle(): String = when (scopeKind()) {
    FormatScope.DEFAULT -> "Project default"
    FormatScope.YEAR -> "Year ${yearLabel ?: ""}".trim()
    FormatScope.VENDOR -> "${vendorName ?: "Vendor"} (all years)"
    FormatScope.VENDOR_YEAR -> "${vendorName ?: "Vendor"} in ${yearLabel ?: "this year"}"
}

/** The active format in exactly this scope, if any. */
fun List<AdminSchemeDto>.activeIn(vendorId: String?, yearId: String?): AdminSchemeDto? =
    firstOrNull { it.active && it.vendorId == vendorId && it.plantingYearId == yearId }

/**
 * The format officers use for [vendorId]'s trees in [yearId]: vendor + year, then vendor, then year, then the project default.
 */
fun List<AdminSchemeDto>.effectiveFor(vendorId: String?, yearId: String?): AdminSchemeDto? =
    (if (vendorId != null && yearId != null) activeIn(vendorId, yearId) else null)
        ?: (if (vendorId != null) activeIn(vendorId, null) else null)
        ?: (if (yearId != null) activeIn(null, yearId) else null)
        ?: activeIn(null, null)

/** Real codes for example IDs: this project, the chosen year and vendor, and the year's first area. */
fun idSamples(p: ProjectDetailDto, year: AdminPlantingYearDto?, vendorCode: String?, areas: List<AdminSectorDto>): Map<String, String> {
    val yearAreas = areas.filter { it.active && (year == null || it.plantingYearId == year.id) }.ifEmpty { areas.filter { it.active } }
    val sector = yearAreas.firstOrNull { s -> s.subSectors.any { it.active } } ?: yearAreas.firstOrNull()
    return mapOf(
        "PROJECT_CODE" to p.shortCode,
        "PLANTING_YEAR" to (year?.yearLabel ?: p.defaultYear()?.yearLabel ?: "2025"),
        "VENDOR_CODE" to (vendorCode?.takeIf { it.isNotBlank() }
            ?: p.linkedVendors(year?.id).firstOrNull { !it.vendorShortCode.isNullOrBlank() }?.vendorShortCode ?: "V01"),
        "SECTOR_CODE" to (sector?.shortCode ?: "S1"),
        "SUB_SECTOR_CODE" to (sector?.subSectors?.firstOrNull { it.active }?.shortCode ?: "A1"),
    )
}

// ---------------------------------------------------------------- area geometry

/** Corners ordered around their centre, the way the server builds the outline (entry order doesn't matter). */
fun orderedCorners(corners: List<CornerDto>): List<CornerDto> {
    if (corners.size < 3) return corners
    val cx = corners.sumOf { it.longitude } / corners.size
    val cy = corners.sumOf { it.latitude } / corners.size
    return corners.sortedBy { atan2(it.latitude - cy, it.longitude - cx) }
}

private const val METRES_PER_DEGREE = 111_320.0

/** Approximate distance in metres between two nearby points. */
fun distanceMetres(a: CornerDto, b: CornerDto): Double {
    val k = cos(Math.toRadians((a.latitude + b.latitude) / 2))
    val dx = (a.longitude - b.longitude) * METRES_PER_DEGREE * k
    val dy = (a.latitude - b.latitude) * METRES_PER_DEGREE
    return sqrt(dx * dx + dy * dy)
}

/** Approximate area in hectares of the outline through [corners]. */
fun areaHectares(corners: List<CornerDto>): Double {
    val ring = orderedCorners(corners)
    if (ring.size < 3) return 0.0
    val k = cos(Math.toRadians(ring.sumOf { it.latitude } / ring.size))
    var twice = 0.0
    for (i in ring.indices) {
        val a = ring[i]
        val b = ring[(i + 1) % ring.size]
        twice += (a.longitude * k * METRES_PER_DEGREE) * (b.latitude * METRES_PER_DEGREE) - (b.longitude * k * METRES_PER_DEGREE) * (a.latitude * METRES_PER_DEGREE)
    }
    return abs(twice) / 2 / 10_000
}

/** True when [p] lies inside the outline through [polygon] (ray casting; no GPS tolerance). */
fun insideOutline(p: CornerDto, polygon: List<CornerDto>): Boolean {
    val ring = orderedCorners(polygon)
    if (ring.size < 3) return true
    var inside = false
    var j = ring.lastIndex
    for (i in ring.indices) {
        val a = ring[i]
        val b = ring[j]
        if ((a.latitude > p.latitude) != (b.latitude > p.latitude) &&
            p.longitude < (b.longitude - a.longitude) * (p.latitude - a.latitude) / (b.latitude - a.latitude) + a.longitude
        ) inside = !inside
        j = i
    }
    return inside
}

/**
 * A small drawing of an area: [outline] (the sector), [inner] outlines (its sub-sectors) and [focus] (the area being
 * edited, drawn boldest). All points are scaled together to fit the box.
 */
@Composable
fun AreaSketch(
    outline: List<CornerDto>,
    modifier: Modifier = Modifier,
    inner: List<List<CornerDto>> = emptyList(),
    focus: List<CornerDto> = emptyList(),
    description: String = "Sketch of the area outline",
) {
    val outlineColor = MaterialTheme.colorScheme.outline
    val fill = MaterialTheme.colorScheme.primaryContainer
    val primary = MaterialTheme.colorScheme.primary
    val innerColor = MaterialTheme.colorScheme.tertiary
    val shapes = (listOf(outline) + inner + listOf(focus)).filter { it.isNotEmpty() }
    val all = shapes.flatten()
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = modifier) {
        Canvas(Modifier.fillMaxSize().padding(8.dp).semantics { contentDescription = description }) {
            if (all.isEmpty()) return@Canvas
            // Longitude degrees shrink towards the poles; scale them so the sketch keeps its real shape.
            val k = cos(Math.toRadians(all.sumOf { it.latitude } / all.size))
            val minX = all.minOf { it.longitude * k }
            val maxX = all.maxOf { it.longitude * k }
            val minY = all.minOf { it.latitude }
            val maxY = all.maxOf { it.latitude }
            val span = maxOf(maxX - minX, maxY - minY).takeIf { it > 0 } ?: 1e-6
            val scale = minOf(size.width, size.height) / span
            val offX = (size.width - (maxX - minX) * scale) / 2
            val offY = (size.height - (maxY - minY) * scale) / 2
            fun at(c: CornerDto) = Offset((offX + (c.longitude * k - minX) * scale).toFloat(), (offY + (maxY - c.latitude) * scale).toFloat())
            fun path(points: List<CornerDto>) = Path().apply {
                val ring = orderedCorners(points)
                ring.forEachIndexed { i, c -> val o = at(c); if (i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) }
                if (ring.size >= 3) close()
            }
            if (outline.size >= 3) {
                val p = path(outline)
                drawPath(p, fill)
                drawPath(p, if (focus.isEmpty()) primary else outlineColor, style = Stroke(width = 2.dp.toPx()))
            }
            inner.filter { it.size >= 3 }.forEach { drawPath(path(it), innerColor.copy(alpha = 0.6f), style = Stroke(width = 1.5.dp.toPx())) }
            if (focus.size >= 3) {
                val p = path(focus)
                drawPath(p, primary.copy(alpha = 0.25f))
                drawPath(p, primary, style = Stroke(width = 2.5.dp.toPx()))
            }
            (focus.ifEmpty { outline }).forEach { drawCircle(primary, radius = 3.5.dp.toPx(), center = at(it)) }
        }
    }
}
