package com.example.teasoo_tms.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase
import com.example.teasoo_tms.data.dao.SectorDao
import com.example.teasoo_tms.data.dao.SpeciesDao
import com.example.teasoo_tms.data.dao.StatusDao
import com.example.teasoo_tms.data.dao.SubsectorDao
import com.example.teasoo_tms.data.dao.TreeDao
import com.example.teasoo_tms.data.dao.VisitDao
import com.example.teasoo_tms.data.dao.VisitEditDao
import com.example.teasoo_tms.data.entity.Sector
import com.example.teasoo_tms.data.entity.Species
import com.example.teasoo_tms.data.entity.Status
import com.example.teasoo_tms.data.entity.Subsector
import com.example.teasoo_tms.data.entity.Tree
import com.example.teasoo_tms.data.entity.User
import com.example.teasoo_tms.data.entity.Visit
import com.example.teasoo_tms.data.entity.VisitEdit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        User::class,
        Sector::class,
        Subsector::class,
        Species::class,
        Status::class,
        Tree::class,
        Visit::class,
        VisitEdit::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun sectorDao(): SectorDao
    abstract fun subsectorDao(): SubsectorDao
    abstract fun speciesDao(): SpeciesDao
    abstract fun statusDao(): StatusDao
    abstract fun treeDao(): TreeDao
    abstract fun visitDao(): VisitDao
    abstract fun visitEditDao(): VisitEditDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "teasoo_tms.db"
            )
                .addCallback(SeedCallback())
                .build()
        }
    }

    private class SeedCallback : Callback() {
        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            INSTANCE?.let { database ->
                CoroutineScope(Dispatchers.IO).launch {
                    database.sectorDao().insertAll(SeedData.sectors)
                    database.subsectorDao().insertAll(SeedData.subsectors)
                    database.speciesDao().insertAll(SeedData.species)
                    database.statusDao().insertAll(SeedData.statuses)
                }
            }
        }
    }
}
