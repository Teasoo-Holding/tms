package com.teasoo.tms

import com.teasoo.tms.data.local.ObservationEntity
import com.teasoo.tms.data.local.StatusEntity
import com.teasoo.tms.data.local.SyncState
import com.teasoo.tms.data.local.TreeEntity
import com.teasoo.tms.ui.screens.maintenanceDue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class MaintenanceDueTest {
    private val alive = StatusEntity("st-a", "ALIVE", "Alive", false, false, false, 1, true)
    private val dead = StatusEntity("st-d", "DEAD", "Dead", true, true, false, 2, true)
    private fun tree(plantedOn: String?, state: String = "ACTIVE") = TreeEntity(
        id = "t1", physicalTreeId = "T4L-2026-000001", physicalTreeIdNormalized = "T4L2026000001", serialNumber = "000001",
        serialScopeKey = "k", idSchemeId = "s", idSchemeVersion = 1, componentsSnapshotJson = "{}", projectId = "p1",
        plantingYearId = "y", sectorId = "s1", subSectorId = "ss1", speciesId = "sp", currentStatusId = "st-a",
        lastObservedAt = null, vendorId = null, replacesTreeId = null, plantedOn = plantedOn, notes = null, createdBy = "u",
        createdAt = "2026-01-01T09:00:00Z", serverRevision = 1, recordState = state, syncState = SyncState.SYNCED, syncMessage = null,
    )
    private fun visit(id: String, day: LocalDate, type: String, amends: String? = null) = ObservationEntity(
        id, "t1", "st-a", day.atTime(10, 0).atZone(ZoneId.systemDefault()).toInstant().toString(), "2026-01-01T00:00:00Z", "u",
        null, false, amends, amends?.let { "fix" }, SyncState.SYNCED, null, visitType = type,
    )

    @Test
    fun dueAnIntervalAfterPlantingThenAfterTheLastMaintenance() {
        val planted = LocalDate.now().minusDays(100)
        val m = maintenanceDue(tree(planted.toString()), alive, emptyList(), 90)!!
        assertEquals(planted.plusDays(90), m.proposedOn)
        assertTrue(m.overdue)
        // A monitoring visit doesn't count; a maintenance visit resets the clock.
        val maintained = LocalDate.now().minusDays(80)
        val after = maintenanceDue(tree(planted.toString()), alive, listOf(visit("o1", LocalDate.now(), "VISIT"), visit("o2", maintained, "MAINTENANCE")), 90)!!
        assertEquals(maintained.plusDays(90), after.proposedOn)
        assertTrue(after.dueSoon)
    }

    @Test
    fun correctedMaintenanceAndDeadTreesAreHandled() {
        val planted = LocalDate.now().minusDays(10)
        // A maintenance visit that was corrected (superseded) no longer counts.
        val visits = listOf(visit("o1", LocalDate.now(), "MAINTENANCE"), visit("o2", LocalDate.now(), "VISIT", amends = "o1"))
        assertEquals(planted.plusDays(90), maintenanceDue(tree(planted.toString()), alive, visits, 90)!!.proposedOn)
        assertNull(maintenanceDue(tree(planted.toString()), dead, emptyList(), 90))
        assertNull(maintenanceDue(tree(planted.toString(), state = "REJECTED"), alive, emptyList(), 90))
    }
}
