package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.teasoo_tms.data.entity.Status
import kotlinx.coroutines.flow.Flow

@Dao
interface StatusDao {
    @Query("SELECT * FROM statuses WHERE active = 1 ORDER BY name")
    fun getActiveStatuses(): Flow<List<Status>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(statuses: List<Status>)
}
