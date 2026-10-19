package com.example.teasoo_tms.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.teasoo_tms.data.entity.Tree

@Dao
interface TreeDao {
    @Query("SELECT * FROM trees WHERE tree_id = :treeId")
    suspend fun getByTreeId(treeId: String): Tree?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(tree: Tree)
}
