package com.teasoo.tms.data.repo

import androidx.room.withTransaction
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.domain.TreeIdAssembler
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject
import javax.inject.Singleton

/** Applies server state (bootstrap pages and change-feed entries) to the local database. */
@Singleton
class ReferenceRepository @Inject constructor(private val db: TmsDatabase) {
    private val ref get() = db.reference()

    suspend fun applyBootstrap(b: BootstrapResponse) = db.withTransaction {
        ref.upsertProjects(b.projects.map { it.toEntity() })
        ref.pruneProjects(b.projects.map { it.id })
        ref.upsertYears(b.plantingYears.map { it.toEntity() })
        ref.upsertSchemes(b.schemes.map { it.toEntity() })
        ref.upsertSectors(b.sectors.map { it.toEntity() })
        ref.pruneSectors(b.sectors.map { it.id })
        ref.upsertSubSectors(b.subSectors.map { it.toEntity() })
        ref.pruneSubSectors(b.subSectors.map { it.id })
        ref.upsertSpecies(b.species.map { it.toEntity() })
        ref.upsertStatuses(b.statuses.map { it.toEntity() })
        ref.upsertVendors(b.vendors.map { it.toEntity() })
        ref.clearAssignments()
        ref.upsertAssignments(b.assignments.map { it.toEntity() })
        ref.clearAllocations()
        ref.upsertAllocations(b.serialAllocations.map { it.toEntity() })
    }

    suspend fun applyTreesPage(page: MobileTreesResponse) = db.withTransaction {
        page.trees.forEach { applyTree(it) }
        page.observations.forEach { applyObservation(it) }
        page.trees.forEach { db.trees().recomputeStatus(it.id) }
    }

    /** Applies one page of the change feed and advances the cursor in the same transaction. */
    suspend fun applyChanges(page: ChangesResponse) = db.withTransaction {
        for (c in page.changes) applyChange(c.entityType, c.data)
        db.kv().put(KeyValueEntity(Keys.CURSOR, page.nextCursor))
    }

    private suspend fun applyChange(type: String, data: JsonObject) {
        fun <T> decode(s: kotlinx.serialization.KSerializer<T>) = TmsJson.decodeFromJsonElement(s, data)
        when (type) {
            "project" -> ref.upsertProjects(listOf(decode(ProjectDto.serializer()).toEntity()))
            "planting_year" -> ref.upsertYears(listOf(decode(PlantingYearDto.serializer()).toEntity()))
            "tree_id_scheme" -> ref.upsertSchemes(listOf(decode(IdSchemeDto.serializer()).toEntity()))
            "sector" -> ref.upsertSectors(listOf(decode(SectorDto.serializer()).toEntity()))
            "sub_sector" -> ref.upsertSubSectors(listOf(decode(SubSectorDto.serializer()).toEntity()))
            "species" -> ref.upsertSpecies(listOf(decode(SpeciesDto.serializer()).toEntity()))
            "status" -> ref.upsertStatuses(listOf(decode(StatusDto.serializer()).toEntity()))
            "vendor" -> ref.upsertVendors(listOf(decode(VendorDto.serializer()).toEntity()))
            "assignment" -> ref.upsertAssignments(listOf(decode(AssignmentDto.serializer()).toEntity()))
            "serial_allocation" -> ref.upsertAllocations(listOf(decode(SerialAllocationDto.serializer()).toEntity()))
            "tree" -> applyTree(decode(TreeDto.serializer()))
            "observation" -> {
                val o = decode(ObservationDto.serializer())
                applyObservation(o)
                db.trees().recomputeStatus(o.treeId)
            }
            "media" -> applyMedia(decode(MediaStateDto.serializer()))
        }
    }

    /**
     * Server state wins for synced records. A record with local operations still pending is left
     * alone so the officer's unsent work is never overwritten; the server resolves it at push time.
     */
    suspend fun applyTree(t: TreeDto) {
        val pending = db.outbox().countFor(t.id) > 0 && db.trees().get(t.id)?.syncState == SyncState.PENDING
        if (pending) return
        db.trees().upsert(t.toEntity(serialScopeKey(t)))
        if (t.recordState != "CONFLICT") clearSettledOperations(t.id)
    }

    suspend fun applyObservation(o: ObservationDto) {
        val local = db.observations().get(o.id)
        if (local?.syncState == SyncState.PENDING) return
        db.observations().upsert(o.toEntity())
    }

    /** The feed can confirm a verification whose direct response was lost (e.g. crash after upload). */
    private suspend fun applyMedia(m: MediaStateDto) {
        val local = db.media().get(m.id) ?: return
        if (m.uploadState != "VERIFIED" || local.state == MediaState.VERIFIED) return
        if (m.checksumSha256 != local.checksumSha256 || m.byteSize != local.byteSize) return
        db.media().upsert(
            local.copy(
                state = MediaState.VERIFIED, serverChecksum = m.checksumSha256, serverByteSize = m.byteSize,
                remoteVerifiedAt = m.remoteVerifiedAt, associationVerifiedAt = m.associationVerifiedAt,
                ackPersistedAt = if (m.associationVerifiedAt != null) java.time.Instant.now().toString() else null,
            ),
        )
    }

    /** Conflict/rejection notices for this tree are settled once the server reports it ACTIVE or REJECTED. */
    private suspend fun clearSettledOperations(entityId: String) = db.outbox().deleteSettled(entityId)

    /** Recomputes the serial scope key for server records so local duplicate checks cover them. */
    private suspend fun serialScopeKey(t: TreeDto): String? {
        val scheme = ref.scheme(t.idSchemeId) ?: return null
        val scope = scheme.toScheme().serialUniquenessScope
        return TreeIdAssembler.serialScopeKey(scope, TreeIdAssembler.ScopeEntities(t.projectId, t.plantingYearId, t.vendorId, t.sectorId, t.subSectorId))
    }
}
