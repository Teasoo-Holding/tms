package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "visit_edits",
    foreignKeys = [ForeignKey(
        entity = Visit::class,
        parentColumns = ["id"],
        childColumns = ["visit_id"],
        onDelete = ForeignKey.CASCADE
    )],
    indices = [Index("visit_id")]
)
data class VisitEdit(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    @ColumnInfo(name = "visit_id") val visitId: String,
    @ColumnInfo(name = "edited_by") val editedBy: String,
    @ColumnInfo(name = "edited_at") val editedAt: Long = System.currentTimeMillis(),
    val field: String,
    @ColumnInfo(name = "old_value") val oldValue: String?,
    @ColumnInfo(name = "new_value") val newValue: String?
)
