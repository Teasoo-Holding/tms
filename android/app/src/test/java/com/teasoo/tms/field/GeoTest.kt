package com.teasoo.tms.field

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoTest {
    @Test fun distanceAndBearingBetweenNearbyPoints() {
        // About 111 m north of a point at the project's latitude.
        val d = Geo.distanceMeters(6.62, 5.90, 6.621, 5.90)
        assertEquals(111.2, d, 0.5)
        assertEquals(0.0, Geo.bearingDegrees(6.62, 5.90, 6.621, 5.90), 0.1)
        assertEquals(90.0, Geo.bearingDegrees(6.62, 5.90, 6.62, 5.901), 0.1)
        assertEquals("south-west", Geo.compassWord(225.0))
        assertEquals("north", Geo.compassWord(350.0))
    }

    @Test fun formatsDistances() {
        assertEquals("340 m", Geo.formatDistance(338.0))
        assertEquals("1.2 km", Geo.formatDistance(1234.0))
    }

    @Test fun findsWhetherAPointIsInsideAnArea() {
        val ring = Geo.outerRing("""{"type":"Polygon","coordinates":[[[5.9,6.6],[5.91,6.6],[5.91,6.61],[5.9,6.61],[5.9,6.6]]]}""")!!
        assertTrue(Geo.contains(ring, 6.605, 5.905))
        assertFalse(Geo.contains(ring, 6.62, 5.905))
    }

    @Test fun measuresATrail() {
        assertEquals(222.4, Geo.pathLength(listOf(6.62 to 5.90, 6.621 to 5.90, 6.622 to 5.90)), 1.0)
    }
}
