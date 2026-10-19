package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.teasoo_tms.data.entity.Species
import kotlinx.coroutines.flow.Flow

@Dao
interface SpeciesDao {
    @Query("SELECT * FROM species WHERE active = 1 ORDER BY common_name")
    fun getActiveSpecies(): Flow<List<Species>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(species: List<Species>)
}
