package com.teasoo.tms.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

val TmsJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

@Serializable
data class LoginRequest(
    /** Username, email or phone number. */
    val login: String,
    val password: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_name") val deviceName: String,
    @SerialName("app_version") val appVersion: String,
)

@Serializable data class RefreshRequest(@SerialName("refresh_token") val refreshToken: String)

@Serializable
data class UserDto(
    val id: String,
    val email: String? = null,
    val username: String? = null,
    val phone: String? = null,
    @SerialName("full_name") val fullName: String,
    val role: String,
) {
    /** What this person types to sign in. */
    val loginName get() = username ?: email ?: phone ?: ""
}

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("offline_valid_until") val offlineValidUntil: String,
    val user: UserDto,
)

@Serializable data class ApiErrorBody(val code: String? = null, val message: String? = null)

// ---------------------------------------------------------------- reference data

@Serializable
data class ProjectDto(
    val id: String, val name: String, @SerialName("short_code") val shortCode: String, val status: String,
    @SerialName("physical_id_uniqueness") val physicalIdUniqueness: String, val location: String? = null,
)

@Serializable
data class PlantingYearDto(val id: String, @SerialName("project_id") val projectId: String, @SerialName("year_label") val yearLabel: String, val active: Boolean)

@Serializable
data class SchemeComponentDto(val type: String, val required: Boolean = true, val value: String? = null)

@Serializable
data class IdSchemeDto(
    val id: String, @SerialName("project_id") val projectId: String, val version: Int,
    @SerialName("component_definition") val components: List<SchemeComponentDto>,
    val separator: String, @SerialName("serial_width") val serialWidth: Int,
    @SerialName("serial_uniqueness_scope") val serialUniquenessScope: List<String>, val active: Boolean,
    @SerialName("vendor_id") val vendorId: String? = null,
    @SerialName("planting_year_id") val plantingYearId: String? = null,
)

@Serializable
data class SectorDto(
    val id: String, @SerialName("project_id") val projectId: String, val name: String, @SerialName("short_code") val shortCode: String,
    @SerialName("reference_latitude") val referenceLatitude: Double, @SerialName("reference_longitude") val referenceLongitude: Double,
    val boundary: JsonElement? = null, val active: Boolean,
    @SerialName("planting_year_id") val plantingYearId: String? = null,
)

@Serializable
data class PlantingYearVendorDto(
    val id: String,
    @SerialName("project_id") val projectId: String,
    @SerialName("planting_year_id") val plantingYearId: String,
    @SerialName("vendor_id") val vendorId: String,
    val active: Boolean = true,
)

@Serializable
data class SubSectorDto(
    val id: String, @SerialName("sector_id") val sectorId: String, @SerialName("project_id") val projectId: String, val name: String,
    @SerialName("short_code") val shortCode: String,
    @SerialName("reference_latitude") val referenceLatitude: Double, @SerialName("reference_longitude") val referenceLongitude: Double,
    val boundary: JsonElement? = null, val active: Boolean,
)

@Serializable
data class SpeciesDto(val id: String, @SerialName("scientific_name") val scientificName: String, @SerialName("common_name") val commonName: String? = null, val active: Boolean)

@Serializable
data class StatusDto(
    val id: String, val code: String, val name: String, @SerialName("is_terminal") val isTerminal: Boolean,
    @SerialName("allows_replacement") val allowsReplacement: Boolean, @SerialName("requires_photo") val requiresPhoto: Boolean,
    @SerialName("sort_order") val sortOrder: Int, val active: Boolean,
)

@Serializable
data class VendorDto(val id: String, val name: String, @SerialName("short_code") val shortCode: String? = null, val active: Boolean)

@Serializable
data class AssignmentDto(
    val id: String, @SerialName("project_id") val projectId: String, @SerialName("sector_id") val sectorId: String? = null,
    @SerialName("sub_sector_id") val subSectorId: String? = null, val active: Boolean,
)

@Serializable
data class SerialAllocationDto(
    val id: String, @SerialName("project_id") val projectId: String, @SerialName("scope_key") val scopeKey: String,
    @SerialName("user_id") val userId: String? = null, @SerialName("range_start") val rangeStart: Long, @SerialName("range_end") val rangeEnd: Long,
    val active: Boolean,
)

@Serializable
data class CustomFieldDto(
    val id: String,
    @SerialName("project_id") val projectId: String,
    @SerialName("applies_to") val appliesTo: String,
    val key: String,
    val label: String,
    @SerialName("field_type") val fieldType: String,
    val options: List<String> = emptyList(),
    val required: Boolean = false,
    val sticky: Boolean = false,
    @SerialName("help_text") val helpText: String? = null,
    @SerialName("sort_order") val sortOrder: Int = 0,
    val active: Boolean = true,
)

@Serializable
data class BootstrapResponse(
    val cursor: String,
    @SerialName("assignment_fingerprint") val assignmentFingerprint: String,
    val projects: List<ProjectDto>,
    @SerialName("planting_years") val plantingYears: List<PlantingYearDto>,
    @SerialName("tree_id_schemes") val schemes: List<IdSchemeDto>,
    val sectors: List<SectorDto>,
    @SerialName("sub_sectors") val subSectors: List<SubSectorDto>,
    val species: List<SpeciesDto>,
    val statuses: List<StatusDto>,
    val vendors: List<VendorDto>,
    val assignments: List<AssignmentDto>,
    @SerialName("serial_allocations") val serialAllocations: List<SerialAllocationDto>,
    @SerialName("custom_fields") val customFields: List<CustomFieldDto> = emptyList(),
    @SerialName("planting_year_vendors") val plantingYearVendors: List<PlantingYearVendorDto> = emptyList(),
)

// ---------------------------------------------------------------- field records

@Serializable
data class TreeDto(
    val id: String,
    @SerialName("physical_tree_id") val physicalTreeId: String,
    @SerialName("physical_tree_id_normalized") val physicalTreeIdNormalized: String,
    @SerialName("serial_number") val serialNumber: String,
    @SerialName("id_scheme_id") val idSchemeId: String,
    @SerialName("id_scheme_version") val idSchemeVersion: Int,
    @SerialName("id_components_snapshot") val snapshot: JsonElement,
    @SerialName("project_id") val projectId: String,
    @SerialName("planting_year_id") val plantingYearId: String,
    @SerialName("sector_id") val sectorId: String,
    @SerialName("sub_sector_id") val subSectorId: String,
    @SerialName("species_id") val speciesId: String,
    @SerialName("current_status_id") val currentStatusId: String? = null,
    @SerialName("last_observed_at") val lastObservedAt: String? = null,
    @SerialName("vendor_id") val vendorId: String? = null,
    @SerialName("replaces_tree_id") val replacesTreeId: String? = null,
    @SerialName("planted_on") val plantedOn: String? = null,
    val notes: String? = null,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_by_name") val createdByName: String? = null,
    @SerialName("created_at") val createdAt: String,
    val revision: Int,
    @SerialName("record_state") val recordState: String,
    @SerialName("custom_fields") val customFields: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class ObservationDto(
    val id: String,
    @SerialName("tree_id") val treeId: String,
    @SerialName("observed_status_id") val statusId: String,
    @SerialName("observed_at") val observedAt: String,
    @SerialName("recorded_at") val recordedAt: String,
    @SerialName("recorded_by") val recordedBy: String,
    val remarks: String? = null,
    @SerialName("is_initial") val isInitial: Boolean = false,
    @SerialName("amends_observation_id") val amendsObservationId: String? = null,
    @SerialName("amendment_reason") val amendmentReason: String? = null,
    @SerialName("custom_fields") val customFields: JsonObject = JsonObject(emptyMap()),
    @SerialName("height_cm") val heightCm: Double? = null,
    @SerialName("height_method") val heightMethod: String? = null,
    @SerialName("height_measurement") val heightMeasurement: JsonElement? = null,
    @SerialName("recorded_by_name") val recordedByName: String? = null,
    @SerialName("visit_type") val visitType: String = "VISIT",
)

@Serializable
data class MediaStateDto(
    val id: String,
    @SerialName("tree_id") val treeId: String,
    @SerialName("observation_id") val observationId: String? = null,
    @SerialName("mime_type") val mimeType: String = "image/jpeg",
    @SerialName("captured_at") val capturedAt: String? = null,
    @SerialName("upload_state") val uploadState: String,
    @SerialName("checksum_sha256") val checksumSha256: String,
    @SerialName("byte_size") val byteSize: Long,
    @SerialName("remote_verified_at") val remoteVerifiedAt: String? = null,
    @SerialName("association_verified_at") val associationVerifiedAt: String? = null,
)

@Serializable
data class MobileTreesResponse(
    val trees: List<TreeDto>,
    val observations: List<ObservationDto>,
    val media: List<MediaStateDto> = emptyList(),
    @SerialName("next_after_id") val nextAfterId: String? = null,
)

@Serializable data class ChangeDto(val seq: Long, @SerialName("entity_type") val entityType: String, val data: JsonObject)

@Serializable
data class ChangesResponse(
    val changes: List<ChangeDto>,
    @SerialName("next_cursor") val nextCursor: String,
    @SerialName("has_more") val hasMore: Boolean,
    @SerialName("assignment_fingerprint") val assignmentFingerprint: String,
)

@Serializable
data class OperationDto(
    @SerialName("operation_id") val operationId: String,
    @SerialName("entity_type") val entityType: String,
    @SerialName("entity_id") val entityId: String,
    @SerialName("operation_type") val operationType: String,
    @SerialName("base_revision") val baseRevision: Int? = null,
    @SerialName("client_recorded_at") val clientRecordedAt: String,
    val payload: JsonObject,
)

@Serializable data class SyncBatchRequest(@SerialName("device_id") val deviceId: String, val operations: List<OperationDto>)

@Serializable
data class OperationResultDto(
    @SerialName("operation_id") val operationId: String,
    val status: String,
    val code: String? = null,
    val message: String? = null,
    val entity: JsonObject? = null,
    @SerialName("original_status") val originalStatus: String? = null,
)

@Serializable data class SyncBatchResponse(val results: List<OperationResultDto>)

@Serializable
data class UploadSessionRequest(
    @SerialName("media_id") val mediaId: String,
    @SerialName("tree_id") val treeId: String,
    @SerialName("observation_id") val observationId: String?,
    @SerialName("checksum_sha256") val checksumSha256: String,
    @SerialName("byte_size") val byteSize: Long,
    @SerialName("mime_type") val mimeType: String,
    @SerialName("captured_at") val capturedAt: String,
)

@Serializable
data class UploadSessionResponse(
    @SerialName("already_verified") val alreadyVerified: Boolean,
    @SerialName("upload_url") val uploadUrl: String? = null,
    @SerialName("upload_headers") val uploadHeaders: Map<String, String> = emptyMap(),
)

@Serializable
data class MediaVerificationDto(
    @SerialName("media_id") val mediaId: String,
    @SerialName("upload_state") val uploadState: String,
    @SerialName("failure_reason") val failureReason: String? = null,
    @SerialName("checksum_sha256") val checksumSha256: String,
    @SerialName("byte_size") val byteSize: Long,
    @SerialName("remote_verified_at") val remoteVerifiedAt: String? = null,
    @SerialName("association_verified_at") val associationVerifiedAt: String? = null,
    @SerialName("safe_to_delete_local_copy") val safeToDelete: Boolean,
)

// ---------------------------------------------------------------- oversight (administrators, executives)

@Serializable
data class SummaryTotals(
    @SerialName("planting_events") val plantingEvents: Int = 0,
    @SerialName("original_trees") val originalTrees: Int = 0,
    @SerialName("replacement_trees") val replacementTrees: Int = 0,
    @SerialName("terminal_status_trees") val terminalStatusTrees: Int = 0,
    @SerialName("overdue_unknown_trees") val overdueUnknownTrees: Int = 0,
)

@Serializable data class SummaryCount(val name: String, val count: Int, val code: String? = null)

@Serializable
data class SummaryYear(
    val name: String,
    @SerialName("original_trees") val originalTrees: Int = 0,
    @SerialName("replacement_trees") val replacementTrees: Int = 0,
)

@Serializable
data class SummaryCompleteness(
    @SerialName("never_observed") val neverObserved: Int = 0,
    @SerialName("missing_planted_on") val missingPlantedOn: Int = 0,
    @SerialName("trees_with_unverified_photos") val unverifiedPhotos: Int = 0,
    @SerialName("open_conflicts") val openConflicts: Int = 0,
    @SerialName("devices_not_synced_7_days") val devicesNotSynced: Int = 0,
)

@Serializable
data class SummaryOfficer(
    @SerialName("full_name") val fullName: String,
    @SerialName("trees_registered_30d") val trees: Int = 0,
    @SerialName("observations_30d") val observations: Int = 0,
    @SerialName("last_sync_at") val lastSyncAt: String? = null,
)

@Serializable
data class ReportSummary(
    @SerialName("generated_at") val generatedAt: String,
    @SerialName("last_server_sync_at") val lastServerSyncAt: String? = null,
    @SerialName("overdue_days") val overdueDays: Int = 90,
    val totals: SummaryTotals,
    @SerialName("by_status") val byStatus: List<SummaryCount> = emptyList(),
    @SerialName("by_planting_year") val byPlantingYear: List<SummaryYear> = emptyList(),
    @SerialName("data_completeness") val completeness: SummaryCompleteness = SummaryCompleteness(),
    @SerialName("officer_activity") val officers: List<SummaryOfficer> = emptyList(),
    val notes: List<String> = emptyList(),
)

@Serializable
data class ConflictDto(
    val id: String,
    @SerialName("conflict_type") val type: String,
    @SerialName("project_name") val projectName: String? = null,
    @SerialName("incoming_physical_id") val incomingPhysicalId: String? = null,
    @SerialName("existing_physical_id") val existingPhysicalId: String? = null,
    @SerialName("submitted_by_name") val submittedBy: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("entity_id") val incomingTreeId: String,
    @SerialName("existing_entity_id") val existingTreeId: String? = null,
)

@Serializable
data class ResolveConflictRequest(
    val resolution: String,
    val notes: String,
    @SerialName("serial_input") val serialInput: String? = null,
)

@Serializable
data class SerialCorrectionRequest(
    @SerialName("serial_input") val serialInput: String,
    val reason: String,
)

@Serializable data class ViewUrlDto(val url: String, @SerialName("expires_in") val expiresIn: Int = 300)
