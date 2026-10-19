package com.teasoo.tms.data.repo

import androidx.room.withTransaction
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.domain.TreeIdAssembler
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class AreaSelection(
    val projectId: String,
    val plantingYearId: String,
    val sectorId: String,
    val subSectorId: String,
    val vendorId: String?,
)

data class PrefixInfo(
    val scheme: IdSchemeEntity,
    val prefix: String,
    val componentValues: Map<String, String?>,
    val serialWidth: Int,
)

sealed interface SerialCheck {
    data class Ok(val assembled: TreeIdAssembler.Assembled, val scopeKey: String) : SerialCheck
    data class Invalid(val message: String) : SerialCheck
    /** Already registered in this device's database or downloaded cache. */
    data class LocalDuplicate(val physicalId: String, val existingTreeId: String) : SerialCheck
    data class NotAllocated(val message: String) : SerialCheck
}

data class NewTree(
    val area: AreaSelection,
    val speciesId: String,
    val serialInput: String,
    val confirmedPhysicalId: String,
    val statusId: String,
    val observedAt: Instant,
    val plantedOn: String?,
    val notes: String?,
    val remarks: String?,
    val photos: List<CapturedPhoto>,
    val replacesTreeId: String? = null,
)

class RegistrationException(message: String) : Exception(message)

@Singleton
class TreeRepository @Inject constructor(private val db: TmsDatabase) {
    private val ref get() = db.reference()

    /** The read-only part of the ID that the officer does not type. */
    suspend fun prefix(a: AreaSelection): PrefixInfo {
        val project = ref.project(a.projectId) ?: throw RegistrationException("Project not found. Sync to refresh.")
        val scheme = ref.activeScheme(a.projectId) ?: throw RegistrationException("This project has no tree ID format yet. Ask an administrator.")
        val year = ref.year(a.plantingYearId)
        val sector = ref.sector(a.sectorId)
        val sub = ref.subSector(a.subSectorId)
        val vendor = a.vendorId?.let { ref.vendor(it) }
        val values = mapOf(
            "PROJECT_CODE" to project.shortCode,
            "PLANTING_YEAR" to year?.yearLabel,
            "VENDOR_CODE" to vendor?.shortCode,
            "SECTOR_CODE" to sector?.shortCode,
            "SUB_SECTOR_CODE" to sub?.shortCode,
        )
        val s = scheme.toScheme()
        val prefix = try {
            TreeIdAssembler.prefix(s, values)
        } catch (e: TreeIdAssembler.TreeIdException) {
            throw RegistrationException(TreeIdAssembler.message(e.code))
        }
        return PrefixInfo(scheme, prefix, values.filterKeys { k -> s.components.any { it.type == k } }, s.serialWidth)
    }

    suspend fun checkSerial(a: AreaSelection, info: PrefixInfo, serialInput: String, userId: String): SerialCheck {
        val scheme = info.scheme.toScheme()
        val assembled = try {
            TreeIdAssembler.assemble(scheme, info.componentValues, serialInput)
        } catch (e: TreeIdAssembler.TreeIdException) {
            return SerialCheck.Invalid(TreeIdAssembler.message(e.code))
        }
        val project = ref.project(a.projectId)!!
        val dup = if (project.physicalIdUniqueness == "GLOBAL") db.trees().findByNormalized(assembled.normalized)
        else db.trees().findByNormalizedInProject(assembled.normalized, a.projectId)
        if (dup != null) return SerialCheck.LocalDuplicate(dup.physicalTreeId, dup.id)
        val scopeKey = TreeIdAssembler.serialScopeKey(
            scheme.serialUniquenessScope,
            TreeIdAssembler.ScopeEntities(a.projectId, a.plantingYearId, a.vendorId, a.sectorId, a.subSectorId),
        )
        db.trees().findBySerial(scopeKey, assembled.serial)?.let { return SerialCheck.LocalDuplicate(it.physicalTreeId, it.id) }
        val ranges = ref.allocations(scopeKey)
        if (ranges.isNotEmpty()) {
            val n = assembled.serial.toLong()
            val mine = ranges.filter { it.userId == null || it.userId == userId }
            if (mine.none { n in it.rangeStart..it.rangeEnd }) {
                val text = mine.joinToString { "${it.rangeStart}–${it.rangeEnd}" }.ifEmpty { "none" }
                return SerialCheck.NotAllocated("Serial ${assembled.serial} is outside your allocated ranges ($text).")
            }
        }
        return SerialCheck.Ok(assembled, scopeKey)
    }

    /**
     * Saves the tree, its initial observation, its photos and the outbox operation in ONE transaction,
     * so a crash can never leave a saved record without its queued sync operation.
     */
    suspend fun register(t: NewTree, userId: String): String {
        val info = prefix(t.area)
        val check = checkSerial(t.area, info, t.serialInput, userId)
        val ok = when (check) {
            is SerialCheck.Ok -> check
            is SerialCheck.Invalid -> throw RegistrationException(check.message)
            is SerialCheck.NotAllocated -> throw RegistrationException(check.message)
            is SerialCheck.LocalDuplicate -> throw RegistrationException("${check.physicalId} is already registered on this device.")
        }
        if (TreeIdAssembler.normalize(t.confirmedPhysicalId) != ok.assembled.normalized) {
            throw RegistrationException("The confirmed ID does not match the assembled ID. Check the serial.")
        }
        val status = ref.status(t.statusId) ?: throw RegistrationException("Choose a status.")
        if (status.requiresPhoto && t.photos.isEmpty()) throw RegistrationException("Status “${status.name}” requires a photo.")
        if (t.replacesTreeId != null) assertReplaceable(t.replacesTreeId)

        val treeId = UUID.randomUUID().toString()
        val observationId = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val snapshot = buildJsonObject {
            put("scheme_version", info.scheme.version)
            put("separator", info.scheme.separator)
            put("serial_width", info.scheme.serialWidth)
        }
        val tree = TreeEntity(
            id = treeId, physicalTreeId = ok.assembled.physicalId, physicalTreeIdNormalized = ok.assembled.normalized,
            serialNumber = ok.assembled.serial, serialScopeKey = ok.scopeKey, idSchemeId = info.scheme.id, idSchemeVersion = info.scheme.version,
            componentsSnapshotJson = snapshot.toString(), projectId = t.area.projectId, plantingYearId = t.area.plantingYearId,
            sectorId = t.area.sectorId, subSectorId = t.area.subSectorId, speciesId = t.speciesId, currentStatusId = t.statusId,
            lastObservedAt = t.observedAt.toString(), vendorId = t.area.vendorId, replacesTreeId = t.replacesTreeId,
            plantedOn = t.plantedOn, notes = t.notes, createdBy = userId, createdAt = now, serverRevision = null,
            recordState = "ACTIVE", syncState = SyncState.PENDING, syncMessage = null,
        )
        val payload = buildJsonObject {
            put("id", treeId)
            put("project_id", t.area.projectId)
            put("planting_year_id", t.area.plantingYearId)
            put("sector_id", t.area.sectorId)
            put("sub_sector_id", t.area.subSectorId)
            put("species_id", t.speciesId)
            t.area.vendorId?.let { put("vendor_id", it) }
            put("id_scheme_id", info.scheme.id)
            put("serial_input", ok.assembled.serial)
            put("physical_tree_id", ok.assembled.physicalId)
            putJsonObject("id_component_values") { info.componentValues.forEach { (k, v) -> put(k, v) } }
            t.replacesTreeId?.let { put("replaces_tree_id", it) }
            t.plantedOn?.let { put("planted_on", it) }
            t.notes?.let { put("notes", it) }
            putJsonObject("initial_observation") {
                put("id", observationId)
                put("status_id", t.statusId)
                put("observed_at", t.observedAt.toString())
                t.remarks?.let { put("remarks", it) }
            }
        }
        db.withTransaction {
            db.trees().insert(tree)
            db.observations().insert(
                ObservationEntity(observationId, treeId, t.statusId, t.observedAt.toString(), now, userId, t.remarks, true, null, null, SyncState.PENDING, null),
            )
            t.photos.forEach { db.media().insert(it.toEntity(treeId, observationId, now)) }
            db.outbox().insert(operation("tree", treeId, "create", null, payload, now))
        }
        return treeId
    }

    suspend fun addObservation(
        treeId: String, statusId: String, observedAt: Instant, remarks: String?, photos: List<CapturedPhoto>, userId: String,
        amendsObservationId: String? = null, amendmentReason: String? = null,
    ): String {
        val status = ref.status(statusId) ?: throw RegistrationException("Choose a status.")
        if (status.requiresPhoto && photos.isEmpty()) throw RegistrationException("Status “${status.name}” requires a photo.")
        if (observedAt.isAfter(Instant.now().plusSeconds(300))) throw RegistrationException("The observation date cannot be in the future.")
        if (amendsObservationId != null && amendmentReason.isNullOrBlank()) throw RegistrationException("Give a reason for the correction.")
        val id = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val payload = buildJsonObject {
            put("id", id)
            put("tree_id", treeId)
            put("observed_status_id", statusId)
            put("observed_at", observedAt.toString())
            remarks?.let { put("remarks", it) }
            amendsObservationId?.let { put("amends_observation_id", it) }
            amendmentReason?.let { put("amendment_reason", it) }
        }
        db.withTransaction {
            db.observations().insert(ObservationEntity(id, treeId, statusId, observedAt.toString(), now, userId, remarks, false, amendsObservationId, amendmentReason, SyncState.PENDING, null))
            photos.forEach { db.media().insert(it.toEntity(treeId, id, now)) }
            db.outbox().insert(operation("observation", id, if (amendsObservationId != null) "amendment" else "observation", null, payload, now))
            db.trees().recomputeStatus(treeId)
        }
        return id
    }

    /**
     * Edits permitted metadata. Unsent edits to the same tree are merged into one operation so the
     * base revision stays the one the officer started from (no self-inflicted revision conflicts).
     */
    suspend fun updateTree(treeId: String, speciesId: String?, plantedOn: String?, notes: String?) {
        val now = Instant.now().toString()
        db.withTransaction {
            val tree = db.trees().get(treeId) ?: throw RegistrationException("Tree not found.")
            val changes = buildJsonObject {
                speciesId?.let { put("species_id", it) }
                put("planted_on", plantedOn)
                put("notes", notes)
            }
            db.trees().upsert(tree.copy(speciesId = speciesId ?: tree.speciesId, plantedOn = plantedOn, notes = notes, syncState = SyncState.PENDING))
            val unsent = db.outbox().unsentUpdateFor(treeId)
            if (unsent != null) {
                val previous = TmsJson.parseToJsonElement(unsent.payloadJson) as JsonObject
                val merged = buildJsonObject {
                    put("id", treeId)
                    put("changes", JsonObject((previous["changes"] as JsonObject) + changes))
                }
                db.outbox().replacePayload(unsent.seq, merged.toString(), now)
            } else {
                val payload = buildJsonObject {
                    put("id", treeId)
                    put("changes", changes)
                }
                // A tree not yet accepted by the server will be created at revision 1, and the outbox
                // is processed in order, so the create always lands before this update.
                db.outbox().insert(operation("tree", treeId, "update", tree.serverRevision ?: 1, payload, now))
            }
        }
    }

    suspend fun assertReplaceable(originalId: String) {
        val original = db.trees().get(originalId) ?: throw RegistrationException("The original tree is not on this device.")
        val status = original.currentStatusId?.let { ref.status(it) }
        if (status?.allowsReplacement != true) {
            throw RegistrationException("Record this tree as dead or missing before planting a replacement.")
        }
        db.trees().replacementOf(originalId)?.let {
            throw RegistrationException("This tree has already been replaced by ${it.physicalTreeId}.")
        }
    }

    private fun CapturedPhoto.toEntity(treeId: String, observationId: String, now: String) =
        MediaEntity(mediaId, treeId, observationId, file.absolutePath, sha256, byteSize, mimeType, now, MediaState.LOCAL)

    private fun operation(entityType: String, entityId: String, type: String, baseRevision: Int?, payload: JsonObject, now: String) =
        OutboxEntity(
            operationId = UUID.randomUUID().toString(), entityType = entityType, entityId = entityId, operationType = type,
            baseRevision = baseRevision, clientRecordedAt = now, payloadJson = payload.toString(),
        )
}
