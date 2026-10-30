package com.teasoo.tms

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import com.teasoo.tms.data.local.TmsDatabase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Upgrading the app must keep every record already on the phone, synced or not. */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), TmsDatabase::class.java)

    @Test
    fun version1RecordsSurviveTheUpgradeToCustomFieldsAndHeight() {
        helper.createDatabase("migration-test", 1).apply {
            execSQL(
                """INSERT INTO trees (id, physicalTreeId, physicalTreeIdNormalized, serialNumber, serialScopeKey, idSchemeId, idSchemeVersion,
                   componentsSnapshotJson, projectId, plantingYearId, sectorId, subSectorId, speciesId, currentStatusId, lastObservedAt, vendorId,
                   replacesTreeId, plantedOn, notes, createdBy, createdAt, serverRevision, recordState, syncState, syncMessage)
                   VALUES ('t1', 'T4L-2024-000001', 'T4L2024000001', '000001', 'k', 's', 1, '{}', 'p', 'y', 'sec', 'sub', 'sp', 'st', NULL, NULL,
                   NULL, NULL, NULL, 'u', '2026-01-01T00:00:00Z', NULL, 'ACTIVE', 'PENDING', NULL)""",
            )
            execSQL(
                """INSERT INTO observations (id, treeId, statusId, observedAt, recordedAt, recordedBy, remarks, isInitial, amendsObservationId,
                   amendmentReason, syncState, syncMessage) VALUES ('o1', 't1', 'st', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'u', 'ok', 1, NULL, NULL, 'PENDING', NULL)""",
            )
            close()
        }
        val db = helper.runMigrationsAndValidate("migration-test", 2, true)
        db.query("SELECT customFieldsJson, syncState FROM trees WHERE id = 't1'").use {
            it.moveToFirst()
            assertEquals("{}", it.getString(0))
            assertEquals("PENDING", it.getString(1))
        }
        db.query("SELECT remarks, heightCm, customFieldsJson FROM observations WHERE id = 'o1'").use {
            it.moveToFirst()
            assertEquals("ok", it.getString(0))
            assertEquals(true, it.isNull(1))
            assertEquals("{}", it.getString(2))
        }
        // Version 3: areas per planting year, vendors per year, per-vendor ID formats.
        helper.runMigrationsAndValidate("migration-test", 3, true).close()
        // Version 4: visit type on observations (existing ones become ordinary visits).
        val v3 = helper.runMigrationsAndValidate("migration-test", 4, true)
        v3.query("SELECT visitType FROM observations WHERE id = 'o1'").use {
            it.moveToFirst()
            assertEquals("VISIT", it.getString(0))
        }
        v3.query("SELECT syncState FROM trees WHERE id = 't1'").use {
            it.moveToFirst()
            assertEquals("PENDING", it.getString(0))
        }
        v3.close()
        // Version 5: species reference photos; field records are untouched.
        val v5 = helper.runMigrationsAndValidate("migration-test", 5, true)
        v5.query("SELECT count(*) FROM species_images").use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
        v5.query("SELECT syncState FROM trees WHERE id = 't1'").use { it.moveToFirst(); assertEquals("PENDING", it.getString(0)) }
        v5.close()
        // Version 6: an area's GPS location is optional; existing areas keep theirs.
        val v6 = helper.runMigrationsAndValidate("migration-test", 6, true)
        v6.query("SELECT syncState FROM trees WHERE id = 't1'").use { it.moveToFirst(); assertEquals("PENDING", it.getString(0)) }
        v6.close()
        // Version 7: queued records remember who made them.
        val v7 = helper.runMigrationsAndValidate("migration-test", 7, true)
        v7.query("SELECT count(*) FROM outbox WHERE userId IS NOT NULL").use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
    }
}
