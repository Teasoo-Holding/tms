package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

enum class SyncState { PENDING, SYNCED, FAILED }

@Entity(
    tableName = "visits",
    foreignKeys = [
        ForeignKey(entity = Tree::class, parentColumns = ["tree_id"], childColumns = ["tree_id"], onDelete = ForeignKey.RESTRICT),
        ForeignKey(entity = Sector::class, parentColumns = ["id"], childColumns = ["sector_id"], onDelete = ForeignKey.RESTRICT),
        ForeignKey(entity = Subsector::class, parentColumns = ["id"], childColumns = ["subsector_id"], onDelete = ForeignKey.RESTRICT),
        ForeignKey(entity = Species::class, parentColumns = ["id"], childColumns = ["species_id"], onDelete = ForeignKey.RESTRICT),
        ForeignKey(entity = Status::class, parentColumns = ["id"], childColumns = ["status_id"], onDelete = ForeignKey.RESTRICT)
    ],
    indices = [
        Index("tree_id"),
        Index("sector_id"),
        Index("subsector_id"),
        Index("species_id"),
        Index("status_id"),
        Index("recorded_by"),
        Index("recorded_at")
    ]
)
data class Visit(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    @ColumnInfo(name = "tree_id") val treeId: String,
    @ColumnInfo(name = "sector_id") val sectorId: String,
    @ColumnInfo(name = "subsector_id") val subsectorId: String,
    @ColumnInfo(name = "species_id") val speciesId: String,
    @ColumnInfo(name = "status_id") val statusId: String,
    val note: String? = null,
    @ColumnInfo(name = "photo_path") val photoPath: String? = null,
    @ColumnInfo(name = "recorded_by") val recordedBy: String,
    @ColumnInfo(name = "recorded_at") val recordedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at") val updatedAt: Long = System.currentTimeMillis(),
    val version: Int = 1,
    @ColumnInfo(name = "device_id") val deviceId: String? = null,
    @ColumnInfo(name = "sync_state") val syncState: SyncState = SyncState.PENDING,
    @ColumnInfo(name = "photo_sync_state") val photoSyncState: SyncState = SyncState.PENDING
)
