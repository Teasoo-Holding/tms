package com.teasoo.tms.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/*
 * Small, dependency-free Canvas charts. Every chart prints its numbers (legend values, axis labels or
 * a tap-to-read caption), so nothing relies on colour alone.
 */

data class ChartSlice(val label: String, val value: Float, val color: Color)

data class ChartPoint(val x: Float, val y: Float)

data class ChartSeries(val label: String, val points: List<ChartPoint>, val color: Color)

/** One x-axis group of a [ColumnChart]; [values] holds one value per series, in series order. */
data class ColumnGroup(val label: String, val values: List<Float>)

data class StackSegment(val label: String, val value: Float, val color: Color)

data class StackedBar(val label: String, val segments: List<StackSegment>) {
    val total: Float get() = segments.sumOf { it.value.toDouble() }.toFloat()
}

data class LegendItem(val label: String, val color: Color, val value: String? = null)

// ---------------------------------------------------------------- palettes

/** Consistent colours for tree statuses; DEAD and MISSING use the error colours. Unknown codes fall back to [ChartPalette]. */
object StatusPalette {
    @Composable
    fun color(code: String?, fallbackIndex: Int = 0): Color {
        val scheme = MaterialTheme.colorScheme
        return when (code?.uppercase()) {
            "HEALTHY", "GOOD", "ALIVE", "ESTABLISHED" -> Color(0xFF2E9E44)
            "PLANTED", "NEW" -> Color(0xFF7CC47F)
            "NEEDS_INSPECTION", "STRESSED", "AT_RISK" -> Color(0xFFF2B000)
            "DAMAGED", "DISEASED", "PEST" -> Color(0xFFE5761E)
            "DEAD" -> scheme.error
            "MISSING", "REMOVED", "STOLEN" -> lerp(scheme.error, scheme.onSurface, 0.45f)
            "REPLACED" -> Color(0xFF5B8DEF)
            null, "", "UNKNOWN", "NOT_OBSERVED" -> scheme.outline
            else -> ChartPalette.color(fallbackIndex + 2)
        }
    }
}

/** Categorical series colours, distinguishable in light and dark themes. */
object ChartPalette {
    private val colors = listOf(
        Color(0xFF1D6B45), Color(0xFF2A78D6), Color(0xFFE07B39), Color(0xFF8E6CEF),
        Color(0xFF2A9D8F), Color(0xFFC2185B), Color(0xFF9E7C0C), Color(0xFF5C6BC0),
    )
    fun color(index: Int): Color = colors[((index % colors.size) + colors.size) % colors.size]

    @Composable
    fun series(index: Int): Color = when (index) {
        0 -> MaterialTheme.colorScheme.primary
        1 -> MaterialTheme.colorScheme.tertiary
        else -> color(index)
    }
}

// ---------------------------------------------------------------- shared helpers

private fun niceMax(value: Float): Float {
    if (value <= 0f) return 1f
    val exp = floor(log10(value.toDouble()))
    val base = 10.0.pow(exp)
    val f = value / base
    val nice = when {
        f <= 1.0 -> 1.0
        f <= 2.0 -> 2.0
        f <= 2.5 -> 2.5
        f <= 5.0 -> 5.0
        else -> 10.0
    }
    return (nice * base).toFloat()
}

fun formatChartNumber(v: Float): String = when {
    abs(v) >= 10_000 -> "${(v / 1000f).roundToInt()}k"
    abs(v) >= 1_000 -> String.format("%.1fk", v / 1000f)
    v == floor(v) -> v.toInt().toString()
    abs(v) < 10 -> String.format("%.1f", v)
    else -> v.roundToInt().toString()
}

@Composable
private fun chartTextStyle(): TextStyle = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)

private fun DrawScope.drawYAxis(measurer: TextMeasurer, style: TextStyle, gridColor: Color, top: Float, bottom: Float, left: Float, right: Float, maxValue: Float, ticks: Int, unit: String) {
    for (i in 0..ticks) {
        val v = maxValue * i / ticks
        val y = bottom - (bottom - top) * i / ticks
        drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1f,
            pathEffect = if (i == 0) null else PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
        val label = formatChartNumber(v) + if (i == ticks && unit.isNotBlank()) " $unit" else ""
        val layout = measurer.measure(label, style)
        drawText(layout, topLeft = Offset(left + 2f, y - layout.size.height - 1f))
    }
}

/** Colour swatch + label (+ value) list that wraps on narrow screens. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChartLegend(items: List<LegendItem>, modifier: Modifier = Modifier) {
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(item.color, RoundedCornerShape(2.dp)))
                Spacer(Modifier.width(6.dp))
                Text(item.label, style = MaterialTheme.typography.bodySmall)
                item.value?.let {
                    Spacer(Modifier.width(4.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ChartCaption(text: String?) {
    Text(
        text ?: "Tap the chart to read exact values.",
        style = MaterialTheme.typography.bodySmall,
        color = if (text == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        fontWeight = if (text == null) FontWeight.Normal else FontWeight.SemiBold,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

// ---------------------------------------------------------------- donut

/** Donut with the total in the middle and a legend listing each slice's value and share. */
@Composable
fun DonutChart(
    slices: List<ChartSlice>,
    modifier: Modifier = Modifier,
    centerLabel: String = "total",
    size: Dp = 168.dp,
    thickness: Dp = 26.dp,
) {
    val total = slices.sumOf { it.value.toDouble() }.toFloat()
    val track = MaterialTheme.colorScheme.surfaceVariant
    val description = slices.joinToString { "${it.label} ${formatChartNumber(it.value)}" }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(size).semantics { contentDescription = "Donut chart, total ${formatChartNumber(total)}: $description" }, contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = thickness.toPx()
                val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
                val topLeft = Offset(stroke / 2, stroke / 2)
                drawArc(track, 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
                if (total > 0f) {
                    val gap = if (slices.count { it.value > 0f } > 1) 1.5f else 0f
                    var start = -90f
                    slices.forEach { s ->
                        if (s.value <= 0f) return@forEach
                        val sweep = 360f * s.value / total
                        drawArc(s.color, start + gap / 2, max(0.5f, sweep - gap), false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Butt))
                        start += sweep
                    }
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(formatChartNumber(total), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(centerLabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            slices.forEach { s ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).background(s.color, CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(s.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(formatChartNumber(s.value), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        if (total > 0f) " · ${(100f * s.value / total).roundToInt()}%" else "",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.widthIn(min = 44.dp),
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------- grouped columns

/**
 * Grouped vertical columns (typically two series, e.g. registrations vs observations per week).
 * X labels are thinned automatically so they never overlap; tap a group to read its values.
 */
@Composable
fun ColumnChart(
    groups: List<ColumnGroup>,
    seriesLabels: List<String>,
    modifier: Modifier = Modifier,
    seriesColors: List<Color> = seriesLabels.indices.map { ChartPalette.series(it) },
    height: Dp = 200.dp,
    yUnit: String = "",
) {
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outlineVariant
    val highlight = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)
    var selected by remember(groups) { mutableStateOf<Int?>(null) }
    val maxValue = niceMax(groups.flatMap { it.values }.maxOrNull() ?: 0f)
    val caption = selected?.let { i -> groups.getOrNull(i) }?.let { g ->
        g.label + ": " + seriesLabels.mapIndexed { i, l -> "$l ${formatChartNumber(g.values.getOrElse(i) { 0f })}" }.joinToString(" · ")
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChartCaption(caption)
        Canvas(
            Modifier.fillMaxWidth().height(height)
                .semantics { contentDescription = "Column chart. " + groups.joinToString { g -> g.label + " " + g.values.joinToString("/") { formatChartNumber(it) } } }
                .pointerInput(groups) {
                    detectTapGestures { pos ->
                        if (groups.isEmpty()) return@detectTapGestures
                        val slot = size.width.toFloat() / groups.size
                        val i = (pos.x / slot).toInt().coerceIn(0, groups.lastIndex)
                        selected = if (selected == i) null else i
                    }
                },
        ) {
            val labelHeight = measurer.measure("0", style).size.height + 6f
            val bottom = size.height - labelHeight
            val top = labelHeight
            drawYAxis(measurer, style, grid, top, bottom, 0f, size.width, maxValue, 4, yUnit)
            if (groups.isEmpty()) return@Canvas
            val slot = size.width / groups.size
            val seriesCount = max(1, seriesLabels.size)
            val inner = slot * 0.72f
            val barWidth = inner / seriesCount
            // Thin x labels so they fit.
            val widest = groups.maxOf { measurer.measure(it.label, style).size.width }.toFloat() + 8f
            val step = max(1, ceil(widest / slot).toInt())
            groups.forEachIndexed { gi, g ->
                val x0 = gi * slot + (slot - inner) / 2
                if (selected == gi) drawRect(highlight, Offset(gi * slot, top), Size(slot, bottom - top))
                g.values.forEachIndexed { si, v ->
                    val h = (bottom - top) * (v / maxValue).coerceIn(0f, 1f)
                    if (h > 0f) drawRoundRect(
                        seriesColors.getOrElse(si) { ChartPalette.color(si) },
                        Offset(x0 + si * barWidth + 1f, bottom - h),
                        Size(max(1f, barWidth - 2f), h),
                        CornerRadius(3f, 3f),
                    )
                }
                if (gi % step == 0) {
                    val layout = measurer.measure(g.label, style)
                    val lx = (gi * slot + slot / 2 - layout.size.width / 2).coerceIn(0f, size.width - layout.size.width)
                    drawText(layout, topLeft = Offset(lx, bottom + 4f))
                }
            }
        }
        ChartLegend(seriesLabels.mapIndexed { i, l -> LegendItem(l, seriesColors.getOrElse(i) { ChartPalette.color(i) }) })
    }
}

// ---------------------------------------------------------------- lines

/**
 * Multi-series line chart over numeric x values (months as indices, days since planting, ...).
 * [xLabel] formats an x value for the axis and the tap caption; [yFormatter] formats y values.
 */
@Composable
fun LineChart(
    series: List<ChartSeries>,
    xLabel: (Float) -> String,
    yUnit: String,
    modifier: Modifier = Modifier,
    xTicks: List<Float>? = null,
    yFormatter: (Float) -> String = ::formatChartNumber,
    height: Dp = 200.dp,
    showLegend: Boolean = true,
    yFromZero: Boolean = true,
) {
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outlineVariant
    val cursor = MaterialTheme.colorScheme.onSurfaceVariant
    val surface = MaterialTheme.colorScheme.surface
    val all = series.flatMap { it.points }
    val ticks = xTicks ?: all.map { it.x }.distinct().sorted()
    var selectedX by remember(series) { mutableStateOf<Float?>(null) }
    val minX = (ticks + all.map { it.x }).minOrNull() ?: 0f
    val maxX = (ticks + all.map { it.x }).maxOrNull() ?: 1f
    val rawMinY = all.minOfOrNull { it.y } ?: 0f
    val maxY = niceMax(all.maxOfOrNull { it.y } ?: 0f)
    val minY = if (yFromZero || rawMinY >= 0f && rawMinY < maxY / 2) 0f else floor(rawMinY)
    val caption = selectedX?.let { x ->
        val values = series.mapNotNull { s -> s.points.firstOrNull { it.x == x }?.let { "${s.label} ${yFormatter(it.y)}${if (yUnit.isBlank()) "" else " $yUnit"}" } }
        if (values.isEmpty()) null else xLabel(x) + ": " + values.joinToString(" · ")
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChartCaption(caption)
        Canvas(
            Modifier.fillMaxWidth().height(height)
                .semantics { contentDescription = "Line chart in $yUnit. " + series.joinToString(". ") { s -> s.label + ": " + s.points.joinToString { xLabel(it.x) + " " + yFormatter(it.y) } } }
                .pointerInput(series, ticks) {
                    detectTapGestures { pos ->
                        if (ticks.isEmpty()) return@detectTapGestures
                        val pad = 12.dp.toPx()
                        val span = (maxX - minX).takeIf { it > 0f } ?: 1f
                        val x = minX + ((pos.x - pad) / (size.width - 2 * pad)).coerceIn(0f, 1f) * span
                        val nearest = ticks.minByOrNull { abs(it - x) }
                        selectedX = if (selectedX == nearest) null else nearest
                    }
                },
        ) {
            val labelHeight = measurer.measure("0", style).size.height + 6f
            val pad = 12.dp.toPx()
            val top = labelHeight
            val bottom = size.height - labelHeight
            val left = pad
            val right = size.width - pad
            val ySpan = (maxY - minY).takeIf { it > 0f } ?: 1f
            val xSpan = (maxX - minX).takeIf { it > 0f } ?: 1f
            fun px(x: Float) = if (maxX == minX) (left + right) / 2 else left + (right - left) * (x - minX) / xSpan
            fun py(y: Float) = bottom - (bottom - top) * ((y - minY) / ySpan).coerceIn(0f, 1f)
            // Y grid, labelled with the formatter.
            for (i in 0..4) {
                val v = minY + ySpan * i / 4
                val y = bottom - (bottom - top) * i / 4
                drawLine(grid, Offset(0f, y), Offset(size.width, y), 1f, pathEffect = if (i == 0) null else PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                val label = yFormatter(v) + if (i == 4 && yUnit.isNotBlank()) " $yUnit" else ""
                val layout = measurer.measure(label, style)
                drawText(layout, topLeft = Offset(2f, y - layout.size.height - 1f))
            }
            // X labels, thinned to fit.
            if (ticks.isNotEmpty()) {
                val widest = ticks.maxOf { measurer.measure(xLabel(it), style).size.width }.toFloat() + 8f
                val perTick = (right - left) / max(1, ticks.size - 1)
                val step = if (ticks.size <= 1) 1 else max(1, ceil(widest / perTick).toInt())
                ticks.forEachIndexed { i, t ->
                    if (i % step != 0 && i != ticks.lastIndex) return@forEachIndexed
                    if (i == ticks.lastIndex && i % step != 0 && (i - (i / step) * step) * perTick < widest) return@forEachIndexed
                    val layout = measurer.measure(xLabel(t), style)
                    val lx = (px(t) - layout.size.width / 2).coerceIn(0f, size.width - layout.size.width)
                    drawText(layout, topLeft = Offset(lx, bottom + 4f))
                }
            }
            selectedX?.let { x -> drawLine(cursor, Offset(px(x), top), Offset(px(x), bottom), 1.5f) }
            series.forEach { s ->
                val pts = s.points.sortedBy { it.x }
                if (pts.size > 1) {
                    val path = Path()
                    pts.forEachIndexed { i, p -> if (i == 0) path.moveTo(px(p.x), py(p.y)) else path.lineTo(px(p.x), py(p.y)) }
                    drawPath(path, s.color, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
                }
                pts.forEach { p ->
                    val r = if (p.x == selectedX) 5.dp.toPx() else 3.5.dp.toPx()
                    drawCircle(s.color, r, Offset(px(p.x), py(p.y)))
                    drawCircle(surface, r * 0.45f, Offset(px(p.x), py(p.y)))
                }
            }
        }
        if (showLegend && series.size > 1) ChartLegend(series.map { LegendItem(it.label, it.color) })
    }
}

// ---------------------------------------------------------------- stacked horizontal bars

/**
 * One horizontal bar per group (sector, species, officer), split into segments (statuses).
 * Bars are scaled to the largest total so both size and mix read at a glance; the total is printed.
 * With [normalize] every bar fills the width (share of each status).
 */
@Composable
fun StackedBarChart(
    bars: List<StackedBar>,
    modifier: Modifier = Modifier,
    normalize: Boolean = false,
    legend: List<LegendItem>? = null,
    barHeight: Dp = 18.dp,
    valueSuffix: String = "",
) {
    val maxTotal = bars.maxOfOrNull { it.total }?.takeIf { it > 0f } ?: 1f
    val track = MaterialTheme.colorScheme.surfaceVariant
    var selected by remember(bars) { mutableStateOf<Int?>(null) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        bars.forEachIndexed { index, bar ->
            Column(
                Modifier.fillMaxWidth()
                    .pointerInput(bar) { detectTapGestures { selected = if (selected == index) null else index } }
                    .semantics { contentDescription = bar.label + ": " + bar.segments.joinToString { "${it.label} ${formatChartNumber(it.value)}" } },
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row(Modifier.fillMaxWidth()) {
                    Text(bar.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(formatChartNumber(bar.total) + valueSuffix, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                }
                Canvas(Modifier.fillMaxWidth().height(barHeight)) {
                    val full = size.width
                    drawRoundRect(track, size = Size(full, size.height), cornerRadius = CornerRadius(4f, 4f))
                    val scale = if (normalize) (if (bar.total > 0f) full / bar.total else 0f) else full / maxTotal
                    var x = 0f
                    bar.segments.forEach { s ->
                        val w = s.value * scale
                        if (w > 0f) {
                            drawRect(s.color, Offset(x, 0f), Size(max(1f, w - if (x + w < full) 1f else 0f), size.height))
                            x += w
                        }
                    }
                }
                if (selected == index) {
                    Text(
                        bar.segments.filter { it.value > 0f }.joinToString(" · ") { "${it.label} ${formatChartNumber(it.value)}" },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        val items = legend ?: bars.flatMap { b -> b.segments.map { it.label to it.color } }.distinctBy { it.first }.map { LegendItem(it.first, it.second) }
        if (items.size > 1) ChartLegend(items)
    }
}

/** Simple horizontal bars with one value each (e.g. a single series). */
@Composable
fun HorizontalBars(items: List<Pair<String, Float>>, color: Color = MaterialTheme.colorScheme.primary, modifier: Modifier = Modifier) {
    StackedBarChart(items.map { (label, v) -> StackedBar(label, listOf(StackSegment(label, v, color))) }, modifier, legend = emptyList())
}
