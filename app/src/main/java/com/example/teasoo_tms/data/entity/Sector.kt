package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "sectors")
data class Sector(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val name: String,
    val code: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val active: Boolean = true,
    @ColumnInfo(name = "updated_at") val updatedAt: Long = System.currentTimeMillis()
)
