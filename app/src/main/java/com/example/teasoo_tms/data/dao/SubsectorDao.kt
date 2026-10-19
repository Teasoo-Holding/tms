package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.teasoo_tms.data.entity.Subsector
import kotlinx.coroutines.flow.Flow

@Dao
interface SubsectorDao {
    @Query("SELECT * FROM subsectors WHERE sector_id = :sectorId AND active = 1 ORDER BY name")
    fun getActiveBySecor(sectorId: String): Flow<List<Subsector>>

    @Query("SELECT * FROM subsectors ORDER BY name")
    fun getAllSubsectors(): Flow<List<Subsector>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(subsectors: List<Subsector>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(subsector: Subsector)
}
