package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "subsectors",
    foreignKeys = [ForeignKey(
        entity = Sector::class,
        parentColumns = ["id"],
        childColumns = ["sector_id"],
        onDelete = ForeignKey.RESTRICT
    )],
    indices = [Index("sector_id")]
)
data class Subsector(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    @ColumnInfo(name = "sector_id") val sectorId: String,
    val name: String,
    val code: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val active: Boolean = true,
    @ColumnInfo(name = "updated_at") val updatedAt: Long = System.currentTimeMillis()
)
