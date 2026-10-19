package com.example.teasoo_tms.data

import androidx.room.TypeConverter
import com.example.teasoo_tms.data.entity.SyncState
import com.example.teasoo_tms.data.entity.UserRole

class Converters {
    @TypeConverter fun fromUserRole(value: UserRole): String = value.name
    @TypeConverter fun toUserRole(value: String): UserRole = UserRole.valueOf(value)

    @TypeConverter fun fromSyncState(value: SyncState): String = value.name
    @TypeConverter fun toSyncState(value: String): SyncState = SyncState.valueOf(value)
}
