package com.teasoo.tms

import com.teasoo.tms.ui.screens.scatter
import com.teasoo.tms.ui.screens.treesPerDot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DensityDotsTest {
    // A triangle: dots must fall inside it, not just inside its bounding box.
    private val ring = listOf(0.0 to 0.0, 1.0 to 0.0, 0.0 to 1.0, 0.0 to 0.0)

    @Test
    fun dotsLandInsideTheAreaAndAreTheSameEveryTime() {
        val a = scatter(ring, 300, 42)
        assertEquals(300, a.size)
        assertTrue(a.all { (x, y) -> x >= 0 && y >= 0 && x + y <= 1 })
        assertEquals(a, scatter(ring, 300, 42))
    }

    @Test
    fun largePlantingsAreDrawnWithOneDotPerSeveralTrees() {
        assertEquals(1, treesPerDot(listOf(100, 900)))
        assertEquals(2, treesPerDot(listOf(3_000)))
        // 10,000 trees in one area, at most 1,500 dots per area.
        assertEquals(7, treesPerDot(List(10) { 10_000 }))
    }
}
