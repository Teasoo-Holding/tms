package com.example.teasoo_tms.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "species")
data class Species(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    @ColumnInfo(name = "common_name") val commonName: String,
    @ColumnInfo(name = "scientific_name") val scientificName: String? = null,
    val active: Boolean = true,
    @ColumnInfo(name = "updated_at") val updatedAt: Long = System.currentTimeMillis()
)
