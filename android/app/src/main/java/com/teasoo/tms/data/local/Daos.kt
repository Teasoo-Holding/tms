package com.teasoo.tms.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ReferenceDao {
    @Upsert suspend fun upsertProjects(rows: List<ProjectEntity>)
    @Upsert suspend fun upsertYears(rows: List<PlantingYearEntity>)
    @Upsert suspend fun upsertSchemes(rows: List<IdSchemeEntity>)
    @Upsert suspend fun upsertSectors(rows: List<SectorEntity>)
    @Upsert suspend fun upsertSubSectors(rows: List<SubSectorEntity>)
    @Upsert suspend fun upsertSpecies(rows: List<SpeciesEntity>)
    @Upsert suspend fun upsertStatuses(rows: List<StatusEntity>)
    @Upsert suspend fun upsertVendors(rows: List<VendorEntity>)
    @Upsert suspend fun upsertAssignments(rows: List<AssignmentEntity>)
    @Upsert suspend fun upsertAllocations(rows: List<SerialAllocationEntity>)

    @Query("DELETE FROM assignments") suspend fun clearAssignments()
    @Query("DELETE FROM serial_allocations") suspend fun clearAllocations()
    @Query("DELETE FROM sectors WHERE id NOT IN (:keep)") suspend fun pruneSectors(keep: List<String>)
    @Query("DELETE FROM sub_sectors WHERE id NOT IN (:keep)") suspend fun pruneSubSectors(keep: List<String>)
    @Query("DELETE FROM projects WHERE id NOT IN (:keep)") suspend fun pruneProjects(keep: List<String>)

    @Query("SELECT * FROM projects WHERE status NOT IN ('ARCHIVED') ORDER BY name") fun projects(): Flow<List<ProjectEntity>>
    @Query("SELECT * FROM projects WHERE id = :id") suspend fun project(id: String): ProjectEntity?
    @Query("SELECT * FROM planting_years WHERE projectId = :projectId ORDER BY yearLabel DESC") fun years(projectId: String): Flow<List<PlantingYearEntity>>
    @Query("SELECT * FROM planting_years WHERE id = :id") suspend fun year(id: String): PlantingYearEntity?
    @Query("SELECT * FROM id_schemes WHERE projectId = :projectId AND active") suspend fun activeSchemes(projectId: String): List<IdSchemeEntity>
    @Query("SELECT * FROM id_schemes WHERE id = :id") suspend fun scheme(id: String): IdSchemeEntity?
    @Query("SELECT * FROM sectors WHERE projectId = :projectId ORDER BY shortCode") fun sectors(projectId: String): Flow<List<SectorEntity>>
    /** The planting year's surveyed sectors, plus older sectors not tied to a year. */
    @Query("SELECT * FROM sectors WHERE projectId = :projectId AND (plantingYearId = :yearId OR plantingYearId IS NULL) ORDER BY shortCode")
    fun sectorsForYear(projectId: String, yearId: String): Flow<List<SectorEntity>>
    @Upsert suspend fun upsertYearVendors(rows: List<PlantingYearVendorEntity>)
    @Query("DELETE FROM planting_year_vendors WHERE id NOT IN (:keep)") suspend fun pruneYearVendors(keep: List<String>)
    /** Vendors planting in a year; empty when the administrator has not linked any. */
    @Query(
        """SELECT v.* FROM vendors v JOIN planting_year_vendors l ON l.vendorId = v.id
            WHERE l.plantingYearId = :yearId AND l.active AND v.active ORDER BY v.name""",
    )
    fun vendorsForYear(yearId: String): Flow<List<VendorEntity>>
    @Query("SELECT * FROM sectors WHERE id = :id") suspend fun sector(id: String): SectorEntity?
    @Query("SELECT * FROM sub_sectors WHERE projectId = :projectId ORDER BY shortCode") fun subSectors(projectId: String): Flow<List<SubSectorEntity>>
    @Query("SELECT * FROM sub_sectors WHERE id = :id") suspend fun subSector(id: String): SubSectorEntity?
    @Query("SELECT * FROM species ORDER BY COALESCE(commonName, scientificName)") fun species(): Flow<List<SpeciesEntity>>
    @Query("SELECT * FROM statuses ORDER BY sortOrder") fun statuses(): Flow<List<StatusEntity>>
    @Query("SELECT * FROM statuses WHERE id = :id") suspend fun status(id: String): StatusEntity?
    @Query("SELECT * FROM vendors ORDER BY name") fun vendors(): Flow<List<VendorEntity>>
    @Query("SELECT * FROM vendors WHERE id = :id") suspend fun vendor(id: String): VendorEntity?

    @Upsert suspend fun upsertCustomFields(rows: List<CustomFieldEntity>)
    @Query("DELETE FROM custom_fields WHERE id NOT IN (:keep)") suspend fun pruneCustomFields(keep: List<String>)
    /** Active fields for a form, in the administrator's order. */
    @Query("SELECT * FROM custom_fields WHERE projectId = :projectId AND appliesTo = :appliesTo AND active ORDER BY sortOrder, label")
    fun customFields(projectId: String, appliesTo: String): Flow<List<CustomFieldEntity>>
    /** Every field, including deactivated ones, so stored values keep their labels. */
    @Query("SELECT * FROM custom_fields WHERE projectId = :projectId ORDER BY appliesTo, sortOrder, label")
    fun allCustomFields(projectId: String): Flow<List<CustomFieldEntity>>
    @Query("SELECT * FROM assignments WHERE active") fun assignments(): Flow<List<AssignmentEntity>>
    @Query("SELECT * FROM serial_allocations WHERE active AND scopeKey = :scopeKey") suspend fun allocations(scopeKey: String): List<SerialAllocationEntity>
}

data class TreeListRow(
    val id: String,
    val physicalTreeId: String,
    val yearLabel: String,
    val sectorCode: String,
    val subSectorCode: String,
    val speciesName: String,
    val statusName: String?,
    val statusCode: String?,
    val lastObservedAt: String?,
    val syncState: String,
    val recordState: String,
    val replacesTreeId: String?,
)

@Dao
interface TreeDao {
    @Insert suspend fun insert(tree: TreeEntity)
    @Upsert suspend fun upsert(tree: TreeEntity)
    @Query("SELECT * FROM trees WHERE id = :id") suspend fun get(id: String): TreeEntity?
    @Query("SELECT * FROM trees WHERE id = :id") fun observe(id: String): Flow<TreeEntity?>

    /** Local duplicate check: only this device's records and its downloaded cache are visible offline. */
    @Query("SELECT * FROM trees WHERE physicalTreeIdNormalized = :normalized AND projectId = :projectId AND recordState = 'ACTIVE' LIMIT 1")
    suspend fun findByNormalizedInProject(normalized: String, projectId: String): TreeEntity?
    @Query("SELECT * FROM trees WHERE physicalTreeIdNormalized = :normalized AND recordState = 'ACTIVE' LIMIT 1")
    suspend fun findByNormalized(normalized: String): TreeEntity?
    @Query("SELECT * FROM trees WHERE serialScopeKey = :scopeKey AND serialNumber = :serial AND recordState = 'ACTIVE' LIMIT 1")
    suspend fun findBySerial(scopeKey: String, serial: String): TreeEntity?
    @Query("SELECT * FROM trees WHERE replacesTreeId = :id AND recordState = 'ACTIVE' LIMIT 1") suspend fun replacementOf(id: String): TreeEntity?

    @Query(
        """SELECT t.id, t.physicalTreeId, y.yearLabel, s.shortCode AS sectorCode, ss.shortCode AS subSectorCode,
                  COALESCE(sp.commonName, sp.scientificName) AS speciesName, st.name AS statusName, st.code AS statusCode,
                  t.lastObservedAt, t.syncState, t.recordState, t.replacesTreeId
             FROM trees t
             JOIN planting_years y ON y.id = t.plantingYearId
             JOIN sectors s ON s.id = t.sectorId
             JOIN sub_sectors ss ON ss.id = t.subSectorId
             JOIN species sp ON sp.id = t.speciesId
             LEFT JOIN statuses st ON st.id = t.currentStatusId
            WHERE t.projectId = :projectId
              AND (:query = '' OR t.physicalTreeIdNormalized LIKE '%' || :query || '%')
              AND (:subSectorId IS NULL OR t.subSectorId = :subSectorId)
            ORDER BY t.physicalTreeId LIMIT 500"""
    )
    fun search(projectId: String, query: String, subSectorId: String?): Flow<List<TreeListRow>>

    @Query("SELECT count(*) FROM trees WHERE projectId = :projectId AND recordState = 'ACTIVE'") fun count(projectId: String): Flow<Int>

    /** Highest serial used in a uniqueness scope, to suggest the next label in sequence. */
    @Query("SELECT MAX(CAST(serialNumber AS INTEGER)) FROM trees WHERE serialScopeKey = :scopeKey")
    suspend fun maxSerial(scopeKey: String): Long?

    @Query("SELECT count(*) FROM trees WHERE createdBy = :userId AND createdAt >= :since")
    fun countCreatedSince(userId: String, since: String): Flow<Int>

    /**
     * Trees to visit in the current area, least recently observed first, so overdue trees surface
     * at the top. [serial] narrows to labels whose serial matches the digits typed.
     */
    @Query(
        """SELECT t.id, t.physicalTreeId, y.yearLabel, s.shortCode AS sectorCode, ss.shortCode AS subSectorCode,
                  COALESCE(sp.commonName, sp.scientificName) AS speciesName, st.name AS statusName, st.code AS statusCode,
                  t.lastObservedAt, t.syncState, t.recordState, t.replacesTreeId
             FROM trees t
             JOIN planting_years y ON y.id = t.plantingYearId
             JOIN sectors s ON s.id = t.sectorId
             JOIN sub_sectors ss ON ss.id = t.subSectorId
             JOIN species sp ON sp.id = t.speciesId
             LEFT JOIN statuses st ON st.id = t.currentStatusId
            WHERE t.projectId = :projectId AND t.plantingYearId = :plantingYearId AND t.sectorId = :sectorId
              AND (:subSectorId IS NULL OR t.subSectorId = :subSectorId)
              AND t.recordState <> 'REJECTED'
              AND (:serial = '' OR CAST(t.serialNumber AS INTEGER) = CAST(:serial AS INTEGER))
            ORDER BY (t.lastObservedAt IS NOT NULL), t.lastObservedAt, t.physicalTreeId
            LIMIT 500"""
    )
    fun visitList(projectId: String, plantingYearId: String, sectorId: String, subSectorId: String?, serial: String): Flow<List<TreeListRow>>

    @Query("UPDATE trees SET syncState = :state, syncMessage = :message WHERE id = :id")
    suspend fun setSyncState(id: String, state: String, message: String?)

    /** Mirrors the server: the latest observation that no correction supersedes defines current status. */
    @Query(
        """UPDATE trees SET
             currentStatusId = (SELECT o.statusId FROM observations o WHERE o.treeId = :id
                                  AND NOT EXISTS (SELECT 1 FROM observations a WHERE a.amendsObservationId = o.id)
                                ORDER BY o.observedAt DESC, o.recordedAt DESC LIMIT 1),
             lastObservedAt = (SELECT o.observedAt FROM observations o WHERE o.treeId = :id
                                  AND NOT EXISTS (SELECT 1 FROM observations a WHERE a.amendsObservationId = o.id)
                                ORDER BY o.observedAt DESC, o.recordedAt DESC LIMIT 1)
           WHERE id = :id"""
    )
    suspend fun recomputeStatus(id: String)

    /** Retention: drop synced trees (and their records) not updated recently, keeping anything unsynced. */
    @Query(
        """DELETE FROM trees WHERE syncState = 'SYNCED' AND lastObservedAt < :before
             AND id NOT IN (SELECT treeId FROM media WHERE localPath IS NOT NULL)
             AND id NOT IN (SELECT entityId FROM outbox)
             AND id NOT IN (SELECT treeId FROM observations WHERE syncState <> 'SYNCED')"""
    )
    suspend fun pruneSynced(before: String): Int
    @Query("SELECT * FROM trees WHERE syncState <> 'SYNCED' ORDER BY createdAt") suspend fun unsynced(): List<TreeEntity>

    /** Alive/dead share per sub-sector from each tree's latest status (trees on this device). */
    @Query(
        """SELECT t.subSectorId, count(*) AS total,
                  sum(CASE WHEN st.id IS NOT NULL AND NOT st.isTerminal THEN 1 ELSE 0 END) AS alive,
                  sum(CASE WHEN st.isTerminal THEN 1 ELSE 0 END) AS dead,
                  sum(CASE WHEN st.id IS NULL THEN 1 ELSE 0 END) AS unknown
             FROM trees t LEFT JOIN statuses st ON st.id = t.currentStatusId
            WHERE t.projectId = :projectId AND t.recordState <> 'REJECTED'
            GROUP BY t.subSectorId""",
    )
    fun shareBySubSector(projectId: String): Flow<List<AreaShare>>
}

@Dao
interface ObservationDao {
    @Insert suspend fun insert(o: ObservationEntity)
    @Upsert suspend fun upsert(o: ObservationEntity)
    @Query("SELECT * FROM observations WHERE id = :id") suspend fun get(id: String): ObservationEntity?
    @Query("SELECT * FROM observations WHERE treeId = :treeId ORDER BY observedAt DESC, recordedAt DESC")
    fun forTree(treeId: String): Flow<List<ObservationEntity>>
    @Query("UPDATE observations SET syncState = :state, syncMessage = :message WHERE id = :id")
    suspend fun setSyncState(id: String, state: String, message: String?)
    @Query("SELECT count(*) FROM observations WHERE recordedBy = :userId AND recordedAt >= :since AND NOT isInitial")
    fun countRecordedSince(userId: String, since: String): Flow<Int>
    @Query("SELECT DISTINCT treeId FROM observations WHERE recordedBy = :userId AND recordedAt >= :since AND NOT isInitial")
    fun treesObservedSince(userId: String, since: String): Flow<List<String>>
    @Query("UPDATE observations SET syncState = 'SYNCED', syncMessage = NULL WHERE treeId = :treeId AND isInitial")
    suspend fun markInitialSynced(treeId: String)
    @Query("DELETE FROM observations WHERE treeId NOT IN (SELECT id FROM trees)") suspend fun pruneOrphans()
    @Query("SELECT * FROM observations WHERE syncState <> 'SYNCED' ORDER BY recordedAt") suspend fun unsynced(): List<ObservationEntity>

    /** This person's own visits (registrations included), newest first. */
    @Query(
        """SELECT o.id, o.treeId, t.physicalTreeId, o.observedAt, o.recordedAt, o.isInitial, o.amendsObservationId IS NOT NULL AS isCorrection,
                  st.name AS statusName, st.code AS statusCode, o.heightCm, o.remarks, o.syncState, o.syncMessage,
                  s.shortCode AS sectorCode, ss.shortCode AS subSectorCode,
                  (SELECT count(*) FROM media m WHERE m.observationId = o.id) AS photoCount
             FROM observations o JOIN trees t ON t.id = o.treeId
             LEFT JOIN statuses st ON st.id = o.statusId
             LEFT JOIN sectors s ON s.id = t.sectorId LEFT JOIN sub_sectors ss ON ss.id = t.subSectorId
            WHERE o.recordedBy = :userId AND o.recordedAt >= :since
            ORDER BY o.recordedAt DESC LIMIT 1000""",
    )
    fun mine(userId: String, since: String): Flow<List<MyVisitRow>>
}

data class AreaShare(val subSectorId: String, val total: Int, val alive: Int, val dead: Int, val unknown: Int) {
    /** Dead out of observed trees; null when none has been observed. */
    val deadShare: Double? get() = (alive + dead).takeIf { it > 0 }?.let { dead.toDouble() / it }
}

data class MyVisitRow(
    val id: String,
    val treeId: String,
    val physicalTreeId: String,
    val observedAt: String,
    val recordedAt: String,
    val isInitial: Boolean,
    val isCorrection: Boolean,
    val statusName: String?,
    val statusCode: String?,
    val heightCm: Double?,
    val remarks: String?,
    val syncState: String,
    val syncMessage: String?,
    val sectorCode: String?,
    val subSectorCode: String?,
    val photoCount: Int,
)

@Dao
interface MediaDao {
    @Insert suspend fun insert(m: MediaEntity)
    @Upsert suspend fun upsert(m: MediaEntity)
    @Query("SELECT * FROM media WHERE id = :id") suspend fun get(id: String): MediaEntity?
    @Query("SELECT * FROM media WHERE treeId = :treeId ORDER BY capturedAt") fun forTree(treeId: String): Flow<List<MediaEntity>>
    @Query("SELECT * FROM media WHERE state <> 'VERIFIED' AND localPath IS NOT NULL AND nextAttemptAt <= :now ORDER BY capturedAt")
    suspend fun dueForUpload(now: Long): List<MediaEntity>
    @Query("SELECT * FROM media WHERE state = 'VERIFIED' AND localPath IS NOT NULL") suspend fun verifiedWithLocalCopy(): List<MediaEntity>
    @Query("SELECT * FROM media WHERE state <> 'VERIFIED' AND localPath IS NOT NULL ORDER BY capturedAt") suspend fun unsent(): List<MediaEntity>
    @Query("SELECT count(*) FROM media WHERE state <> 'VERIFIED' AND localPath IS NOT NULL") fun pendingCount(): Flow<Int>
    @Query("SELECT count(*) FROM media WHERE state = 'FAILED'") fun failedCount(): Flow<Int>
    @Query("UPDATE media SET localPath = NULL, localDeletedAt = :at WHERE id = :id") suspend fun markOffloaded(id: String, at: String)
    @Query("DELETE FROM media WHERE treeId NOT IN (SELECT id FROM trees) AND localPath IS NULL") suspend fun pruneOrphans()
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(op: OutboxEntity)
    @Query("SELECT * FROM outbox WHERE state = 'PENDING' AND nextAttemptAt <= :now ORDER BY seq LIMIT :limit")
    suspend fun due(now: Long, limit: Int): List<OutboxEntity>
    @Query("SELECT * FROM outbox WHERE state = 'PENDING' AND entityId = :entityId AND operationType = 'update' AND attempts = 0 LIMIT 1")
    suspend fun unsentUpdateFor(entityId: String): OutboxEntity?
    @Query("UPDATE outbox SET payloadJson = :payload, clientRecordedAt = :at WHERE seq = :seq") suspend fun replacePayload(seq: Long, payload: String, at: String)
    @Query("DELETE FROM outbox WHERE operationId = :operationId") suspend fun delete(operationId: String)
    @Query("UPDATE outbox SET state = :state, resultCode = :code, lastError = :message WHERE operationId = :operationId")
    suspend fun finish(operationId: String, state: String, code: String?, message: String?)
    @Query("UPDATE outbox SET attempts = attempts + 1, nextAttemptAt = :next, lastError = :error WHERE operationId = :operationId")
    suspend fun retryLater(operationId: String, next: Long, error: String)
    @Query("UPDATE outbox SET nextAttemptAt = 0 WHERE state = 'PENDING'") suspend fun retryAllNow()
    @Query("SELECT * FROM outbox ORDER BY seq") fun all(): Flow<List<OutboxEntity>>
    @Query("SELECT * FROM outbox WHERE state = 'PENDING' ORDER BY seq") suspend fun pendingList(): List<OutboxEntity>
    @Query("SELECT count(*) FROM outbox WHERE state = 'PENDING'") fun pendingCount(): Flow<Int>
    @Query("SELECT count(*) FROM outbox WHERE state <> 'PENDING'") fun attentionCount(): Flow<Int>
    @Query("SELECT min(clientRecordedAt) FROM outbox WHERE state = 'PENDING'") fun oldestPending(): Flow<String?>
    @Query("SELECT count(*) FROM outbox WHERE state = 'PENDING' AND (entityId = :treeId OR entityId = :observationId)")
    suspend fun pendingReferencing(treeId: String, observationId: String?): Int
    @Query("SELECT count(*) FROM outbox WHERE entityId = :entityId") suspend fun countFor(entityId: String): Int
    @Query("DELETE FROM outbox WHERE operationId = :operationId AND state <> 'PENDING'") suspend fun dismiss(operationId: String)
    @Query("DELETE FROM outbox WHERE entityId = :entityId AND state <> 'PENDING'") suspend fun deleteSettled(entityId: String)
}

@Dao
interface KeyValueDao {
    @Upsert suspend fun put(kv: KeyValueEntity)
    @Query("SELECT value FROM kv WHERE `key` = :key") suspend fun get(key: String): String?
    @Query("SELECT value FROM kv WHERE `key` = :key") fun observe(key: String): Flow<String?>
    @Query("DELETE FROM kv WHERE `key` = :key") suspend fun remove(key: String)
}
