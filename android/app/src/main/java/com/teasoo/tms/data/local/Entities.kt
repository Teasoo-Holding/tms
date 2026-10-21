package com.teasoo.tms.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// ---------------------------------------------------------------- reference data (server-owned)

@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    val name: String,
    val shortCode: String,
    val status: String,
    val physicalIdUniqueness: String,
    val location: String?,
)

@Entity(tableName = "planting_years", indices = [Index("projectId")])
data class PlantingYearEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val yearLabel: String,
    val active: Boolean,
)

@Entity(tableName = "id_schemes", indices = [Index("projectId")])
data class IdSchemeEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val version: Int,
    /** JSON array of {type, required}. */
    val componentsJson: String,
    val separator: String,
    val serialWidth: Int,
    /** JSON array of scope dimensions. */
    val serialScopeJson: String,
    val active: Boolean,
    /** Narrows the format to one vendor and/or planting year; both null = the project's default format. */
    val vendorId: String? = null,
    val plantingYearId: String? = null,
)

@Entity(tableName = "sectors", indices = [Index("projectId")])
data class SectorEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val name: String,
    val shortCode: String,
    val referenceLatitude: Double,
    val referenceLongitude: Double,
    /** GeoJSON Polygon, or null. */
    val boundaryJson: String?,
    val active: Boolean,
    /** The planting year whose land survey defined this sector; null = an older area usable in any year. */
    val plantingYearId: String? = null,
)

@Entity(tableName = "sub_sectors", indices = [Index("sectorId"), Index("projectId")])
data class SubSectorEntity(
    @PrimaryKey val id: String,
    val sectorId: String,
    val projectId: String,
    val name: String,
    val shortCode: String,
    val referenceLatitude: Double,
    val referenceLongitude: Double,
    val boundaryJson: String?,
    val active: Boolean,
)

@Entity(tableName = "species")
data class SpeciesEntity(
    @PrimaryKey val id: String,
    val scientificName: String,
    val commonName: String?,
    val active: Boolean,
)

@Entity(tableName = "statuses")
data class StatusEntity(
    @PrimaryKey val id: String,
    val code: String,
    val name: String,
    val isTerminal: Boolean,
    val allowsReplacement: Boolean,
    val requiresPhoto: Boolean,
    val sortOrder: Int,
    val active: Boolean,
)

@Entity(tableName = "vendors")
data class VendorEntity(
    @PrimaryKey val id: String,
    val name: String,
    val shortCode: String?,
    val active: Boolean,
)

/** A vendor planting across a planting year's whole area. */
@Entity(tableName = "planting_year_vendors", indices = [Index("plantingYearId")])
data class PlantingYearVendorEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val plantingYearId: String,
    val vendorId: String,
    val active: Boolean,
)

@Entity(tableName = "assignments")
data class AssignmentEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val sectorId: String?,
    val subSectorId: String?,
    val active: Boolean,
)

@Entity(tableName = "serial_allocations", indices = [Index("scopeKey")])
data class SerialAllocationEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val scopeKey: String,
    val userId: String?,
    val rangeStart: Long,
    val rangeEnd: Long,
    val active: Boolean,
)

/** Administrator-defined extra field (e.g. nursery batch number) for a project's trees or observations. */
@Entity(tableName = "custom_fields", indices = [Index("projectId")])
data class CustomFieldEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    /** TREE (asked once, at registration) or OBSERVATION (asked at every visit). */
    val appliesTo: String,
    val key: String,
    val label: String,
    /** TEXT, NUMBER, DATE, SELECT or BOOLEAN. */
    val fieldType: String,
    /** JSON array of choices for SELECT. */
    val optionsJson: String,
    val required: Boolean,
    /** Pre-filled with the last value for the rest of the field session. */
    val sticky: Boolean,
    val helpText: String?,
    val sortOrder: Int,
    val active: Boolean,
)

// ---------------------------------------------------------------- field records

object SyncState {
    const val PENDING = "PENDING"
    const val SYNCED = "SYNCED"
    const val CONFLICT = "CONFLICT"
    const val REJECTED = "REJECTED"
}

@Entity(
    tableName = "trees",
    indices = [Index("physicalTreeIdNormalized"), Index("projectId"), Index("subSectorId"), Index("replacesTreeId")],
)
data class TreeEntity(
    @PrimaryKey val id: String,
    val physicalTreeId: String,
    val physicalTreeIdNormalized: String,
    val serialNumber: String,
    val serialScopeKey: String?,
    val idSchemeId: String,
    val idSchemeVersion: Int,
    val componentsSnapshotJson: String,
    val projectId: String,
    val plantingYearId: String,
    val sectorId: String,
    val subSectorId: String,
    val speciesId: String,
    val currentStatusId: String?,
    val lastObservedAt: String?,
    val vendorId: String?,
    val replacesTreeId: String?,
    val plantedOn: String?,
    val notes: String?,
    val createdBy: String,
    val createdAt: String,
    /** Server revision this copy is based on; null until the server has accepted the record. */
    val serverRevision: Int?,
    /** Server registry state: ACTIVE, CONFLICT or REJECTED. */
    val recordState: String,
    val syncState: String,
    val syncMessage: String?,
    /** JSON object of custom field values keyed by field key. */
    @ColumnInfo(defaultValue = "{}") val customFieldsJson: String = "{}",
    val createdByName: String? = null,
)

@Entity(tableName = "observations", indices = [Index("treeId"), Index("amendsObservationId")])
data class ObservationEntity(
    @PrimaryKey val id: String,
    val treeId: String,
    val statusId: String,
    val observedAt: String,
    val recordedAt: String,
    val recordedBy: String,
    val remarks: String?,
    val isInitial: Boolean,
    val amendsObservationId: String?,
    val amendmentReason: String?,
    val syncState: String,
    val syncMessage: String?,
    @ColumnInfo(defaultValue = "{}") val customFieldsJson: String = "{}",
    val heightCm: Double? = null,
    /** MANUAL or PHOTO_REFERENCE. */
    val heightMethod: String? = null,
    /** Reference length and marked points when measured on a photo. */
    val heightMeasurementJson: String? = null,
    val recordedByName: String? = null,
    /** VISIT, FIRST_INSTANCE, PLANTING or MAINTENANCE. */
    @ColumnInfo(defaultValue = "VISIT") val visitType: String = "VISIT",
)

/** Why a visit was made (the kind of data collection). */
enum class VisitType(val code: String, val label: String) {
    VISIT("VISIT", "Visit"),
    FIRST_INSTANCE("FIRST_INSTANCE", "First data collection"),
    PLANTING("PLANTING", "At planting"),
    MAINTENANCE("MAINTENANCE", "Maintenance");

    companion object {
        fun label(code: String?) = entries.find { it.code == code }?.label ?: "Visit"
    }
}

object MediaState {
    /** On device only, waiting for upload. */
    const val LOCAL = "LOCAL"
    /** Server verified storage, checksum and association; local copy may be offloaded. */
    const val VERIFIED = "VERIFIED"
    /** Last verification failed; will be re-uploaded. */
    const val FAILED = "FAILED"
}

@Entity(tableName = "media", indices = [Index("treeId"), Index("observationId")])
data class MediaEntity(
    @PrimaryKey val id: String,
    val treeId: String,
    val observationId: String?,
    /** App-private file; null once offloaded after verification. */
    val localPath: String?,
    val checksumSha256: String,
    val byteSize: Long,
    val mimeType: String,
    val capturedAt: String,
    val state: String,
    val serverChecksum: String? = null,
    val serverByteSize: Long? = null,
    val remoteVerifiedAt: String? = null,
    val associationVerifiedAt: String? = null,
    /** Set in the same transaction that stores the server's verification facts. */
    val ackPersistedAt: String? = null,
    val localDeletedAt: String? = null,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val lastError: String? = null,
)

object OutboxState {
    const val PENDING = "PENDING"
    const val CONFLICT = "CONFLICT"
    const val REJECTED = "REJECTED"
}

/** Persistent outbox. Written in the same transaction as the record it describes. */
@Entity(tableName = "outbox", indices = [Index(value = ["operationId"], unique = true), Index("entityId")])
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val operationId: String,
    val entityType: String,
    val entityId: String,
    val operationType: String,
    val baseRevision: Int?,
    val clientRecordedAt: String,
    val payloadJson: String,
    val state: String = OutboxState.PENDING,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val lastError: String? = null,
    val resultCode: String? = null,
)

@Entity(tableName = "kv")
data class KeyValueEntity(@PrimaryKey val key: String, val value: String)
