package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "trees")
data class Tree(
    @PrimaryKey @ColumnInfo(name = "tree_id") val treeId: String,
    @ColumnInfo(name = "first_recorded_at") val firstRecordedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "first_recorded_by") val firstRecordedBy: String
)
