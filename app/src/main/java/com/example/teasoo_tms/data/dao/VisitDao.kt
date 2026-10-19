package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import com.example.teasoo_tms.data.entity.Visit
import kotlinx.coroutines.flow.Flow

@Dao
interface VisitDao {
    @Insert
    suspend fun insert(visit: Visit)

    @Update
    suspend fun update(visit: Visit)

    @Query("SELECT * FROM visits WHERE recorded_by = :userId ORDER BY recorded_at DESC")
    fun getVisitsByUser(userId: String): Flow<List<Visit>>

    @Query("SELECT * FROM visits WHERE tree_id = :treeId ORDER BY recorded_at DESC LIMIT 1")
    suspend fun getLatestVisitForTree(treeId: String): Visit?

    @Query("SELECT * FROM visits WHERE tree_id = :treeId ORDER BY recorded_at DESC")
    fun getVisitHistoryForTree(treeId: String): Flow<List<Visit>>

    @Query("SELECT * FROM visits WHERE id = :visitId")
    suspend fun getById(visitId: String): Visit?

    @Query("SELECT COUNT(*) FROM visits WHERE sync_state = 'PENDING'")
    fun getPendingSyncCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM visits WHERE photo_sync_state = 'PENDING' AND photo_path IS NOT NULL")
    fun getPendingPhotoSyncCount(): Flow<Int>
}
