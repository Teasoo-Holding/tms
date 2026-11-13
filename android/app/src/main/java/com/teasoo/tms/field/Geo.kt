package com.teasoo.tms.field

import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** Straight-line distance and compass bearing between two GPS points (on the ground, not along any path). */
object Geo {
    private const val EARTH_RADIUS_M = 6_371_000.0

    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_M * atan2(sqrt(a), sqrt(1 - a))
    }

    /** Degrees clockwise from north (0–360) from the first point to the second. */
    fun bearingDegrees(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dLon = Math.toRadians(lon2 - lon1)
        val y = sin(dLon) * cos(p2)
        val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dLon)
        return (Math.toDegrees(atan2(y, x)) + 360) % 360
    }

    private val DIRECTIONS = listOf("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west")
    fun compassWord(bearing: Double): String = DIRECTIONS[((bearing + 22.5) / 45).toInt() % 8]

    fun formatDistance(m: Double): String = when {
        m < 1000 -> "${(m / 5).roundToInt() * 5} m"
        else -> String.format(java.util.Locale.US, "%.1f km", m / 1000)
    }

    /** Ray casting on a GeoJSON Polygon's outer ring ([[lon, lat], …]). */
    fun contains(ring: List<Pair<Double, Double>>, lat: Double, lon: Double): Boolean {
        var inside = false
        var j = ring.size - 1
        for (i in ring.indices) {
            val (xi, yi) = ring[i]
            val (xj, yj) = ring[j]
            if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
            j = i
        }
        return inside
    }

    /** The outer ring of a GeoJSON Polygon string, or null. */
    fun outerRing(geoJson: String?): List<Pair<Double, Double>>? = geoJson?.let { json ->
        runCatching {
            val coords = kotlinx.serialization.json.Json.parseToJsonElement(json).jsonObject["coordinates"]!!.jsonArray[0].jsonArray
            coords.map { c -> c.jsonArray.let { it[0].jsonPrimitive.double to it[1].jsonPrimitive.double } }
        }.getOrNull()
    }

    /** Length of a trail in metres. */
    fun pathLength(points: List<Pair<Double, Double>>): Double =
        points.zipWithNext().sumOf { (a, b) -> distanceMeters(a.first, a.second, b.first, b.second) }
}
