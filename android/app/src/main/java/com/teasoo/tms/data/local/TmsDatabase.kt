package com.teasoo.tms.data.local

import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    version = 5,
    exportSchema = true,
    // Additive changes only; field records on the device are kept across upgrades.
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3), AutoMigration(from = 3, to = 4), AutoMigration(from = 4, to = 5)],
    entities = [
        ProjectEntity::class, PlantingYearEntity::class, IdSchemeEntity::class, SectorEntity::class, SubSectorEntity::class,
        SpeciesEntity::class, StatusEntity::class, VendorEntity::class, AssignmentEntity::class, SerialAllocationEntity::class,
        TreeEntity::class, ObservationEntity::class, MediaEntity::class, OutboxEntity::class, KeyValueEntity::class,
        CustomFieldEntity::class, PlantingYearVendorEntity::class, SpeciesImageEntity::class,
    ],
)
abstract class TmsDatabase : RoomDatabase() {
    abstract fun reference(): ReferenceDao
    abstract fun trees(): TreeDao
    abstract fun observations(): ObservationDao
    abstract fun media(): MediaDao
    abstract fun outbox(): OutboxDao
    abstract fun kv(): KeyValueDao

    companion object {
        const val NAME = "tms.db"
    }
}

object Keys {
    const val CURSOR = "sync.cursor"
    const val ASSIGNMENT_FINGERPRINT = "sync.assignment_fingerprint"
    const val LAST_SUCCESSFUL_SYNC = "sync.last_success"
    const val LAST_SYNC_ERROR = "sync.last_error"
    const val SELECTED_PROJECT = "ui.project"
    /** Owner of any unsynced records; another officer cannot sign in until they are synced. */
    const val LAST_USER = "session.last_user"
    /** Server data generation last seen; a change means an administrator cleared the data. */
    const val DATA_GENERATION = "sync.data_generation"
}
