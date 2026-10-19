package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.teasoo_tms.data.entity.Sector
import kotlinx.coroutines.flow.Flow

@Dao
interface SectorDao {
    @Query("SELECT * FROM sectors WHERE active = 1 ORDER BY name")
    fun getActiveSectors(): Flow<List<Sector>>

    @Query("SELECT * FROM sectors ORDER BY name")
    fun getAllSectors(): Flow<List<Sector>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(sectors: List<Sector>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(sector: Sector)
}
