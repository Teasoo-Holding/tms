package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.example.teasoo_tms.data.entity.VisitEdit
import kotlinx.coroutines.flow.Flow

@Dao
interface VisitEditDao {
    @Insert
    suspend fun insert(edit: VisitEdit)

    @Insert
    suspend fun insertAll(edits: List<VisitEdit>)

    @Query("SELECT * FROM visit_edits WHERE visit_id = :visitId ORDER BY edited_at DESC")
    fun getEditsForVisit(visitId: String): Flow<List<VisitEdit>>
}
