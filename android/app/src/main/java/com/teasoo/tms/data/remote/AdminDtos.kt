package com.teasoo.tms.data.remote

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer

/*
 * Online administration (projects, areas, reference data, users, audit, analytics).
 * Postgres returns count(*) and numeric columns as strings unless cast, so every number the
 * server computes is decoded leniently: a number, a numeric string, or null all decode.
 */

// ---------------------------------------------------------------- lenient numbers

private fun JsonElement.numberOrNull(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.trim()?.toDoubleOrNull()

/** Int that also accepts "12", 12.0 and null (→ 0). */
object LenientInt : KSerializer<Int> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("tms.LenientInt", PrimitiveKind.INT)
    override fun serialize(encoder: Encoder, value: Int) = encoder.encodeInt(value)
    override fun deserialize(decoder: Decoder): Int =
        if (decoder is JsonDecoder) decoder.decodeJsonElement().numberOrNull()?.toInt() ?: 0 else decoder.decodeInt()
}

/** Long that also accepts numeric strings (bigserial ids). */
object LenientLong : KSerializer<Long> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("tms.LenientLong", PrimitiveKind.LONG)
    override fun serialize(encoder: Encoder, value: Long) = encoder.encodeLong(value)
    override fun deserialize(decoder: Decoder): Long =
        if (decoder is JsonDecoder) {
            val e = decoder.decodeJsonElement()
            (e as? JsonPrimitive)?.content?.trim()?.toLongOrNull() ?: e.numberOrNull()?.toLong() ?: 0L
        } else decoder.decodeLong()
}

/** Nullable double that also accepts numeric strings ("12.5000"). */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
object LenientDouble : KSerializer<Double?> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("tms.LenientDouble", PrimitiveKind.DOUBLE)
    override fun serialize(encoder: Encoder, value: Double?) {
        if (value == null) encoder.encodeNull() else encoder.encodeDouble(value)
    }
    override fun deserialize(decoder: Decoder): Double? =
        if (decoder is JsonDecoder) decoder.decodeJsonElement().numberOrNull() else decoder.decodeDouble()
}

/** Encoder that keeps explicit nulls, so a PATCH can clear an optional field. */
val AdminPatchJson = Json(TmsJson) { explicitNulls = true }

/**
 * Encodes a request as a JSON object for PATCH. With [keepNulls] a null clears the field on the server;
 * without it a null means "leave unchanged".
 */
inline fun <reified T> T.toPatchBody(keepNulls: Boolean = true): JsonObject {
    val o = AdminPatchJson.encodeToJsonElement(serializer<T>(), this).jsonObject
    return if (keepNulls) o else JsonObject(o.filterValues { it !is JsonNull })
}

// ---------------------------------------------------------------- projects

@Serializable
data class AdminProjectDto(
    val id: String,
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    val location: String? = null,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val status: String = "DRAFT",
    @SerialName("physical_id_uniqueness") val physicalIdUniqueness: String = "PROJECT",
    @Serializable(with = LenientInt::class) @SerialName("tree_count") val treeCount: Int = 0,
)

@Serializable
data class AdminPlantingYearDto(
    val id: String,
    @SerialName("year_label") val yearLabel: String,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val active: Boolean = true,
)

@Serializable
data class SchemeComponent(val type: String, val required: Boolean = true)

@Serializable
data class AdminSchemeDto(
    val id: String,
    @Serializable(with = LenientInt::class) val version: Int = 1,
    @SerialName("component_definition") val components: List<SchemeComponent> = emptyList(),
    val separator: String = "",
    @Serializable(with = LenientInt::class) @SerialName("serial_width") val serialWidth: Int = 6,
    @SerialName("serial_uniqueness_scope") val serialUniquenessScope: List<String> = emptyList(),
    val active: Boolean = false,
    @SerialName("active_from") val activeFrom: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ProjectDetailDto(
    val id: String,
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    val location: String? = null,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val status: String = "DRAFT",
    @SerialName("physical_id_uniqueness") val physicalIdUniqueness: String = "PROJECT",
    @SerialName("planting_years") val plantingYears: List<AdminPlantingYearDto> = emptyList(),
    @SerialName("tree_id_schemes") val schemes: List<AdminSchemeDto> = emptyList(),
)

@Serializable
data class ProjectRequest(
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    val location: String? = null,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val status: String,
    /** Only on create: it cannot change once trees exist. */
    @SerialName("physical_id_uniqueness") val physicalIdUniqueness: String? = null,
)

@Serializable
data class PlantingYearRequest(
    @SerialName("year_label") val yearLabel: String,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val active: Boolean = true,
)

@Serializable
data class PlantingYearPatch(
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val active: Boolean,
)

@Serializable
data class SchemeRequest(
    val components: List<SchemeComponent>,
    val separator: String,
    @SerialName("serial_width") val serialWidth: Int,
    @SerialName("serial_uniqueness_scope") val serialUniquenessScope: List<String>,
)

// ---------------------------------------------------------------- areas

@Serializable
data class AdminSubSectorDto(
    val id: String,
    @SerialName("sector_id") val sectorId: String,
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    @Serializable(with = LenientDouble::class) @SerialName("reference_latitude") val referenceLatitude: Double? = null,
    @Serializable(with = LenientDouble::class) @SerialName("reference_longitude") val referenceLongitude: Double? = null,
    val boundary: JsonElement? = null,
    val active: Boolean = true,
)

@Serializable
data class AdminSectorDto(
    val id: String,
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    @Serializable(with = LenientDouble::class) @SerialName("reference_latitude") val referenceLatitude: Double? = null,
    @Serializable(with = LenientDouble::class) @SerialName("reference_longitude") val referenceLongitude: Double? = null,
    val boundary: JsonElement? = null,
    val active: Boolean = true,
    @SerialName("sub_sectors") val subSectors: List<AdminSubSectorDto> = emptyList(),
)

/** The boundary is deliberately absent: sending null would erase a polygon drawn in the web portal. */
@Serializable
data class AreaRequest(
    val name: String,
    @SerialName("short_code") val shortCode: String,
    val description: String? = null,
    @SerialName("reference_latitude") val referenceLatitude: Double,
    @SerialName("reference_longitude") val referenceLongitude: Double,
    val active: Boolean = true,
)

/** `GET projects/{id}/areas` returns a bare array of sectors; an object `{sectors: [...]}` is accepted too. */
fun decodeAreas(element: JsonElement): List<AdminSectorDto> {
    val array: JsonArray = when (element) {
        is JsonArray -> element
        is JsonObject -> element["sectors"]?.jsonArray ?: JsonArray(emptyList())
        else -> JsonArray(emptyList())
    }
    return TmsJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AdminSectorDto.serializer()), array)
}

// ---------------------------------------------------------------- custom fields

@Serializable
data class AdminCustomFieldDto(
    val id: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("applies_to") val appliesTo: String = "TREE",
    val key: String = "",
    val label: String,
    @SerialName("field_type") val fieldType: String = "TEXT",
    val options: List<String> = emptyList(),
    val required: Boolean = false,
    val sticky: Boolean = false,
    @SerialName("help_text") val helpText: String? = null,
    @Serializable(with = LenientInt::class) @SerialName("sort_order") val sortOrder: Int = 0,
    val active: Boolean = true,
)

@Serializable
data class CustomFieldRequest(
    @SerialName("applies_to") val appliesTo: String,
    val label: String,
    @SerialName("field_type") val fieldType: String,
    val options: List<String> = emptyList(),
    val required: Boolean = false,
    val sticky: Boolean = false,
    @SerialName("help_text") val helpText: String? = null,
    @SerialName("sort_order") val sortOrder: Int = 0,
    val active: Boolean = true,
)

/** Key and type are fixed once created. */
@Serializable
data class CustomFieldPatch(
    val label: String,
    val options: List<String>,
    val required: Boolean,
    val sticky: Boolean,
    @SerialName("help_text") val helpText: String? = null,
    @SerialName("sort_order") val sortOrder: Int,
    val active: Boolean,
)

// ---------------------------------------------------------------- reference data

@Serializable
data class AdminSpeciesDto(
    val id: String,
    @SerialName("scientific_name") val scientificName: String,
    @SerialName("common_name") val commonName: String? = null,
    val code: String? = null,
    val active: Boolean = true,
)

@Serializable
data class SpeciesRequest(
    @SerialName("scientific_name") val scientificName: String,
    @SerialName("common_name") val commonName: String? = null,
    val code: String? = null,
    val active: Boolean = true,
)

@Serializable
data class AdminStatusDto(
    val id: String,
    val code: String,
    val name: String,
    val description: String? = null,
    @SerialName("is_terminal") val isTerminal: Boolean = false,
    @SerialName("allows_replacement") val allowsReplacement: Boolean = false,
    @SerialName("requires_photo") val requiresPhoto: Boolean = false,
    @Serializable(with = LenientInt::class) @SerialName("sort_order") val sortOrder: Int = 0,
    val active: Boolean = true,
)

@Serializable
data class StatusRequest(
    val code: String,
    val name: String,
    val description: String? = null,
    @SerialName("is_terminal") val isTerminal: Boolean = false,
    @SerialName("allows_replacement") val allowsReplacement: Boolean = false,
    @SerialName("requires_photo") val requiresPhoto: Boolean = false,
    @SerialName("sort_order") val sortOrder: Int = 0,
    val active: Boolean = true,
)

/** The code is immutable; the server rejects a PATCH that carries it. */
@Serializable
data class StatusPatch(
    val name: String,
    val description: String? = null,
    @SerialName("is_terminal") val isTerminal: Boolean,
    @SerialName("allows_replacement") val allowsReplacement: Boolean,
    @SerialName("requires_photo") val requiresPhoto: Boolean,
    @SerialName("sort_order") val sortOrder: Int,
    val active: Boolean,
)

@Serializable
data class AdminVendorDto(
    val id: String,
    val name: String,
    @SerialName("short_code") val shortCode: String? = null,
    @SerialName("contact_name") val contactName: String? = null,
    @SerialName("contact_phone") val contactPhone: String? = null,
    @SerialName("contact_email") val contactEmail: String? = null,
    val location: String? = null,
    val active: Boolean = true,
)

@Serializable
data class VendorRequest(
    val name: String,
    @SerialName("short_code") val shortCode: String? = null,
    @SerialName("contact_name") val contactName: String? = null,
    @SerialName("contact_phone") val contactPhone: String? = null,
    @SerialName("contact_email") val contactEmail: String? = null,
    val location: String? = null,
    val active: Boolean = true,
)

// ---------------------------------------------------------------- users and assignments

@Serializable
data class AdminUserDto(
    val id: String,
    val email: String,
    @SerialName("full_name") val fullName: String,
    val role: String,
    val active: Boolean = true,
    @SerialName("created_at") val createdAt: String? = null,
    @Serializable(with = LenientInt::class) @SerialName("trees_registered") val treesRegistered: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("observations_recorded") val observationsRecorded: Int = 0,
    @SerialName("last_sync_at") val lastSyncAt: String? = null,
)

@Serializable
data class UserCreateRequest(
    val email: String,
    @SerialName("full_name") val fullName: String,
    val role: String,
    val password: String,
    val active: Boolean = true,
)

/** Sent with keepNulls = false: only the non-null fields change. A password resets it. */
@Serializable
data class UserPatch(
    val email: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val role: String? = null,
    val active: Boolean? = null,
    val password: String? = null,
)

@Serializable
data class AdminAssignmentDto(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("project_id") val projectId: String,
    @SerialName("sector_id") val sectorId: String? = null,
    @SerialName("sub_sector_id") val subSectorId: String? = null,
    val active: Boolean = true,
    @SerialName("user_name") val userName: String? = null,
    @SerialName("user_role") val userRole: String? = null,
    @SerialName("project_name") val projectName: String? = null,
    @SerialName("sector_name") val sectorName: String? = null,
    @SerialName("sub_sector_name") val subSectorName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class AssignmentRequest(
    @SerialName("user_id") val userId: String,
    @SerialName("project_id") val projectId: String,
    @SerialName("sector_id") val sectorId: String? = null,
    @SerialName("sub_sector_id") val subSectorId: String? = null,
)

// ---------------------------------------------------------------- audit

@Serializable
data class AuditEntryDto(
    @Serializable(with = LenientLong::class) val id: Long,
    @SerialName("actor_id") val actorId: String? = null,
    @SerialName("actor_name") val actorName: String? = null,
    @SerialName("actor_role") val actorRole: String? = null,
    val action: String,
    @SerialName("entity_type") val entityType: String? = null,
    @SerialName("entity_id") val entityId: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("project_name") val projectName: String? = null,
    @SerialName("entity_label") val entityLabel: String? = null,
    @SerialName("tree_id") val treeId: String? = null,
    val before: JsonElement? = null,
    val after: JsonElement? = null,
    val metadata: JsonElement? = null,
    @SerialName("created_at") val createdAt: String,
)

// ---------------------------------------------------------------- analytics (reports/summary)

@Serializable
data class AnalyticsTotals(
    @Serializable(with = LenientInt::class) @SerialName("planting_events") val plantingEvents: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("original_trees") val originalTrees: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("replacement_trees") val replacementTrees: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("terminal_status_trees") val terminalStatusTrees: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("overdue_unknown_trees") val overdueUnknownTrees: Int = 0,
)

@Serializable
data class AnalyticsStatusCount(
    val code: String? = null,
    val name: String = "",
    @SerialName("is_terminal") val isTerminal: Boolean = false,
    @Serializable(with = LenientInt::class) val count: Int = 0,
)

@Serializable
data class AnalyticsYear(
    val id: String? = null,
    val name: String = "",
    @Serializable(with = LenientInt::class) @SerialName("original_trees") val originalTrees: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("replacement_trees") val replacementTrees: Int = 0,
    @Serializable(with = LenientInt::class) val count: Int = 0,
)

@Serializable
data class AnalyticsGroupCount(
    val id: String? = null,
    val name: String = "",
    @SerialName("short_code") val shortCode: String? = null,
    @SerialName("common_name") val commonName: String? = null,
    @Serializable(with = LenientInt::class) val count: Int = 0,
)

@Serializable
data class AnalyticsTrend(
    val month: String,
    val code: String? = null,
    val name: String? = null,
    @Serializable(with = LenientInt::class) val count: Int = 0,
)

@Serializable
data class AnalyticsGrowth(
    val month: String,
    @SerialName("species_id") val speciesId: String,
    @SerialName("species_name") val speciesName: String = "",
    @SerialName("species_common_name") val speciesCommonName: String? = null,
    @Serializable(with = LenientDouble::class) @SerialName("avg_height_cm") val avgHeightCm: Double? = null,
    @Serializable(with = LenientInt::class) @SerialName("measured_trees") val measuredTrees: Int = 0,
)

@Serializable
data class AnalyticsWeek(
    val week: String,
    @Serializable(with = LenientInt::class) val registrations: Int = 0,
    @Serializable(with = LenientInt::class) val observations: Int = 0,
)

@Serializable
data class AnalyticsStatusByGroup(
    @SerialName("group_code") val groupCode: String? = null,
    @SerialName("group_name") val groupName: String? = null,
    val code: String? = null,
    @SerialName("status_name") val statusName: String? = null,
    @Serializable(with = LenientInt::class) val count: Int = 0,
)

@Serializable
data class AnalyticsCompleteness(
    @Serializable(with = LenientInt::class) @SerialName("missing_planted_on") val missingPlantedOn: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("never_observed") val neverObserved: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("trees_with_unverified_photos") val unverifiedPhotos: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("open_conflicts") val openConflicts: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("devices_not_synced_7_days") val devicesNotSynced7Days: Int = 0,
)

@Serializable
data class AnalyticsOfficer(
    val id: String? = null,
    @SerialName("full_name") val fullName: String = "",
    @Serializable(with = LenientInt::class) @SerialName("trees_registered_30d") val treesRegistered30d: Int = 0,
    @Serializable(with = LenientInt::class) @SerialName("observations_30d") val observations30d: Int = 0,
    @SerialName("last_sync_at") val lastSyncAt: String? = null,
)

@Serializable
data class AnalyticsSummary(
    @SerialName("generated_at") val generatedAt: String? = null,
    @SerialName("last_server_sync_at") val lastServerSyncAt: String? = null,
    @Serializable(with = LenientInt::class) @SerialName("overdue_days") val overdueDays: Int = 90,
    val totals: AnalyticsTotals = AnalyticsTotals(),
    @SerialName("by_status") val byStatus: List<AnalyticsStatusCount> = emptyList(),
    @SerialName("by_planting_year") val byPlantingYear: List<AnalyticsYear> = emptyList(),
    @SerialName("by_sector") val bySector: List<AnalyticsGroupCount> = emptyList(),
    @SerialName("by_species") val bySpecies: List<AnalyticsGroupCount> = emptyList(),
    @SerialName("observation_trend") val observationTrend: List<AnalyticsTrend> = emptyList(),
    val growth: List<AnalyticsGrowth> = emptyList(),
    @SerialName("activity_by_week") val activityByWeek: List<AnalyticsWeek> = emptyList(),
    @SerialName("status_by_sector") val statusBySector: List<AnalyticsStatusByGroup> = emptyList(),
    @SerialName("status_by_species") val statusBySpecies: List<AnalyticsStatusByGroup> = emptyList(),
    @SerialName("data_completeness") val completeness: AnalyticsCompleteness = AnalyticsCompleteness(),
    @SerialName("officer_activity") val officers: List<AnalyticsOfficer> = emptyList(),
    val notes: List<String> = emptyList(),
)
