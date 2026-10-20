package com.teasoo.tms.data.repo

import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.domain.TreeIdAssembler
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

private fun JsonElement?.asText(): String? = if (this == null || this is JsonNull) null else toString()

fun ProjectDto.toEntity() = ProjectEntity(id, name, shortCode, status, physicalIdUniqueness, location)
fun PlantingYearDto.toEntity() = PlantingYearEntity(id, projectId, yearLabel, active)
fun IdSchemeDto.toEntity() = IdSchemeEntity(
    id = id, projectId = projectId, version = version,
    componentsJson = TmsJson.encodeToString(ListSerializer(SchemeComponentDto.serializer()), components),
    separator = separator, serialWidth = serialWidth,
    serialScopeJson = TmsJson.encodeToString(ListSerializer(String.serializer()), serialUniquenessScope),
    active = active,
)
fun SectorDto.toEntity() = SectorEntity(id, projectId, name, shortCode, referenceLatitude, referenceLongitude, boundary.asText(), active)
fun SubSectorDto.toEntity() = SubSectorEntity(id, sectorId, projectId, name, shortCode, referenceLatitude, referenceLongitude, boundary.asText(), active)
fun SpeciesDto.toEntity() = SpeciesEntity(id, scientificName, commonName, active)
fun StatusDto.toEntity() = StatusEntity(id, code, name, isTerminal, allowsReplacement, requiresPhoto, sortOrder, active)
fun VendorDto.toEntity() = VendorEntity(id, name, shortCode, active)
fun AssignmentDto.toEntity() = AssignmentEntity(id, projectId, sectorId, subSectorId, active)
fun SerialAllocationDto.toEntity() = SerialAllocationEntity(id, projectId, scopeKey, userId, rangeStart, rangeEnd, active)

fun TreeDto.toEntity(serialScopeKey: String?) = TreeEntity(
    id = id, physicalTreeId = physicalTreeId, physicalTreeIdNormalized = physicalTreeIdNormalized, serialNumber = serialNumber,
    serialScopeKey = serialScopeKey, idSchemeId = idSchemeId, idSchemeVersion = idSchemeVersion, componentsSnapshotJson = snapshot.toString(),
    projectId = projectId, plantingYearId = plantingYearId, sectorId = sectorId, subSectorId = subSectorId, speciesId = speciesId,
    currentStatusId = currentStatusId, lastObservedAt = lastObservedAt, vendorId = vendorId, replacesTreeId = replacesTreeId,
    plantedOn = plantedOn, notes = notes, createdBy = createdBy, createdAt = createdAt, serverRevision = revision,
    recordState = recordState, customFieldsJson = customFields.toString(), createdByName = createdByName,
    syncState = when (recordState) { "CONFLICT" -> SyncState.CONFLICT; "REJECTED" -> SyncState.REJECTED; else -> SyncState.SYNCED },
    syncMessage = when (recordState) {
        "CONFLICT" -> "Duplicate ID under administrator review."
        "REJECTED" -> "Set aside by an administrator after review."
        else -> null
    },
)

fun ObservationDto.toEntity() = ObservationEntity(
    id, treeId, statusId, observedAt, recordedAt, recordedBy, remarks, isInitial, amendsObservationId, amendmentReason, SyncState.SYNCED, null,
    customFieldsJson = customFields.toString(), heightCm = heightCm, heightMethod = heightMethod,
    heightMeasurementJson = heightMeasurement?.takeUnless { it is kotlinx.serialization.json.JsonNull }?.toString(), recordedByName = recordedByName,
)

fun CustomFieldDto.toEntity() = CustomFieldEntity(
    id, projectId, appliesTo, key, label, fieldType, TmsJson.encodeToString(ListSerializer(String.serializer()), options),
    required, sticky, helpText, sortOrder, active,
)

fun IdSchemeEntity.toScheme() = TreeIdAssembler.Scheme(
    separator = separator,
    serialWidth = serialWidth,
    components = TmsJson.decodeFromString(ListSerializer(SchemeComponentDto.serializer()), componentsJson).map { TreeIdAssembler.Component(it.type, it.required, it.value) },
    serialUniquenessScope = TmsJson.decodeFromString(ListSerializer(String.serializer()), serialScopeJson),
)
