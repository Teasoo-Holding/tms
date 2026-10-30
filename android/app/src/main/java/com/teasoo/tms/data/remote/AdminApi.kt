package com.teasoo.tms.data.remote

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Online administration endpoints. PATCH bodies are JSON objects (see [toPatchBody]) so a form
 * can clear an optional field with an explicit null.
 */
interface AdminApi {
    // ---------------------------------------------------------------- projects
    @GET("api/v1/projects") suspend fun projects(): List<AdminProjectDto>
    @GET("api/v1/projects/{id}") suspend fun project(@Path("id") id: String): ProjectDetailDto
    @POST("api/v1/projects") suspend fun createProject(@Body body: ProjectRequest): AdminProjectDto
    @PATCH("api/v1/projects/{id}") suspend fun updateProject(@Path("id") id: String, @Body body: JsonObject): AdminProjectDto

    @POST("api/v1/projects/{id}/planting-years") suspend fun createPlantingYear(@Path("id") projectId: String, @Body body: PlantingYearRequest): AdminPlantingYearDto
    @PATCH("api/v1/planting-years/{id}") suspend fun updatePlantingYear(@Path("id") id: String, @Body body: JsonObject): AdminPlantingYearDto

    @POST("api/v1/projects/{id}/tree-id-schemes") suspend fun createScheme(@Path("id") projectId: String, @Body body: SchemeRequest): AdminSchemeDto
    /** Retires a vendor or year format so the broader one applies again (the project default cannot be retired: 400 DEFAULT_FORMAT). */
    @POST("api/v1/tree-id-schemes/{id}/retire") suspend fun retireScheme(@Path("id") id: String): JsonElement

    // ---------------------------------------------------------------- vendors per planting year
    @POST("api/v1/planting-years/{id}/vendors") suspend fun linkVendor(@Path("id") plantingYearId: String, @Body body: LinkVendorRequest): JsonElement
    @POST("api/v1/planting-year-vendors/{id}/unlink") suspend fun unlinkVendor(@Path("id") linkId: String): JsonElement

    // ---------------------------------------------------------------- areas
    /** Decode with [decodeAreas]. */
    @GET("api/v1/projects/{id}/areas")
    suspend fun areasRaw(@Path("id") projectId: String, @Query("planting_year_id") plantingYearId: String? = null): JsonElement
    /** The body must carry `planting_year_id`. */
    @POST("api/v1/projects/{id}/sectors") suspend fun createSector(@Path("id") projectId: String, @Body body: AreaRequest): JsonElement
    @PATCH("api/v1/sectors/{id}") suspend fun updateSector(@Path("id") id: String, @Body body: JsonObject): JsonElement
    @POST("api/v1/sectors/{id}/sub-sectors") suspend fun createSubSector(@Path("id") sectorId: String, @Body body: AreaRequest): JsonElement
    @PATCH("api/v1/sub-sectors/{id}") suspend fun updateSubSector(@Path("id") id: String, @Body body: JsonObject): JsonElement

    // ---------------------------------------------------------------- custom fields
    @GET("api/v1/projects/{id}/custom-fields") suspend fun customFields(@Path("id") projectId: String): List<AdminCustomFieldDto>
    @POST("api/v1/projects/{id}/custom-fields") suspend fun createCustomField(@Path("id") projectId: String, @Body body: CustomFieldRequest): AdminCustomFieldDto
    @PATCH("api/v1/custom-fields/{id}") suspend fun updateCustomField(@Path("id") id: String, @Body body: JsonObject): AdminCustomFieldDto

    // ---------------------------------------------------------------- reference data
    @GET("api/v1/tree-species") suspend fun species(): List<AdminSpeciesDto>
    @POST("api/v1/tree-species") suspend fun createSpecies(@Body body: SpeciesRequest): AdminSpeciesDto
    @PATCH("api/v1/tree-species/{id}") suspend fun updateSpecies(@Path("id") id: String, @Body body: JsonObject): AdminSpeciesDto

    @GET("api/v1/tree-statuses") suspend fun statuses(): List<AdminStatusDto>
    @POST("api/v1/tree-statuses") suspend fun createStatus(@Body body: StatusRequest): AdminStatusDto
    @PATCH("api/v1/tree-statuses/{id}") suspend fun updateStatus(@Path("id") id: String, @Body body: JsonObject): AdminStatusDto

    @GET("api/v1/vendors") suspend fun vendors(): List<AdminVendorDto>
    @POST("api/v1/vendors") suspend fun createVendor(@Body body: VendorRequest): AdminVendorDto
    @PATCH("api/v1/vendors/{id}") suspend fun updateVendor(@Path("id") id: String, @Body body: JsonObject): AdminVendorDto

    // ---------------------------------------------------------------- users and assignments
    @GET("api/v1/users") suspend fun users(): List<AdminUserDto>
    @POST("api/v1/users") suspend fun createUser(@Body body: UserCreateRequest): AdminUserDto
    @PATCH("api/v1/users/{id}") suspend fun updateUser(@Path("id") id: String, @Body body: JsonObject): AdminUserDto

    @GET("api/v1/assignments")
    suspend fun assignments(@Query("project_id") projectId: String? = null, @Query("user_id") userId: String? = null): List<AdminAssignmentDto>
    @POST("api/v1/assignments") suspend fun createAssignment(@Body body: AssignmentRequest): JsonElement
    @POST("api/v1/assignments/{id}/revoke") suspend fun revokeAssignment(@Path("id") id: String): JsonElement

    // ---------------------------------------------------------------- audit
    @GET("api/v1/audit-logs")
    suspend fun auditLogs(
        @Query("actor_id") actorId: String? = null,
        @Query("action") actionPrefix: String? = null,
        @Query("entity_type") entityType: String? = null,
        @Query("project_id") projectId: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("before_id") beforeId: Long? = null,
        @Query("limit") limit: Int = 50,
    ): List<AuditEntryDto>

    // ---------------------------------------------------------------- deletes
    // Each returns {deleted: true}, or 409 {code: IN_USE | HAS_TREES, message} suggesting deactivation instead.
    @DELETE("api/v1/tree-species/{id}") suspend fun deleteSpecies(@Path("id") id: String): JsonElement

    /** Creates Sector 1..n (S1..Sn) with sub-sectors SS1..SSk in each; existing codes are kept. */
    @POST("api/v1/planting-years/{id}/areas/generate") suspend fun generateAreas(@Path("id") yearId: String, @Body body: GenerateAreasRequest): GenerateAreasResponse

    // ---------------------------------------------------------------- field activity
    @GET("api/v1/reports/field-activity")
    suspend fun fieldActivity(
        @Query("project_id") projectId: String?,
        @Query("from") from: String,
        @Query("to") to: String,
        @Query("tz") tz: String,
        @Query("user_id") userId: String? = null,
    ): FieldActivityResponse

    // ---------------------------------------------------------------- species reference photos
    @GET("api/v1/species/{id}/images") suspend fun speciesImages(@Path("id") speciesId: String): SpeciesImagesResponse
    @retrofit2.http.Multipart
    @POST("api/v1/admin/species/{id}/images")
    suspend fun uploadSpeciesImages(@Path("id") speciesId: String, @retrofit2.http.Part files: List<okhttp3.MultipartBody.Part>): SpeciesImagesResponse
    @DELETE("api/v1/admin/species-images/{id}") suspend fun deleteSpeciesImage(@Path("id") id: String): retrofit2.Response<Unit>
    @retrofit2.http.Streaming
    @GET("api/v1/species-images/{id}/content") suspend fun speciesImageContent(@Path("id") id: String, @Query("size") size: String): okhttp3.ResponseBody
    @DELETE("api/v1/tree-statuses/{id}") suspend fun deleteStatus(@Path("id") id: String): JsonElement
    @DELETE("api/v1/vendors/{id}") suspend fun deleteVendor(@Path("id") id: String): JsonElement
    /** Only a project without trees; its configuration goes with it. */
    @DELETE("api/v1/projects/{id}") suspend fun deleteProject(@Path("id") id: String): JsonElement
    /** With its sectors, sub-sectors, vendor links and year formats; refused if it has trees. */
    @DELETE("api/v1/planting-years/{id}") suspend fun deletePlantingYear(@Path("id") id: String): JsonElement
    @DELETE("api/v1/sectors/{id}") suspend fun deleteSector(@Path("id") id: String): JsonElement
    @DELETE("api/v1/sub-sectors/{id}") suspend fun deleteSubSector(@Path("id") id: String): JsonElement
    /** An unused format version. */
    @DELETE("api/v1/tree-id-schemes/{id}") suspend fun deleteScheme(@Path("id") id: String): JsonElement
    /** Refused once values exist. */
    @DELETE("api/v1/custom-fields/{id}") suspend fun deleteCustomField(@Path("id") id: String): JsonElement
    @DELETE("api/v1/planting-year-vendors/{id}") suspend fun deleteYearVendor(@Path("id") id: String): JsonElement

    // ---------------------------------------------------------------- clear data
    /** 400 CONFIRMATION_REQUIRED, 401 PASSWORD_INCORRECT. */
    @POST("api/v1/admin/clear-data") suspend fun clearData(@Body body: ClearDataRequest): ClearDataResult

    // ---------------------------------------------------------------- client share links
    @GET("api/v1/projects/{id}/share-links") suspend fun shareLinks(@Path("id") projectId: String): List<ShareLinkDto>
    /** The token is returned once only. */
    @POST("api/v1/projects/{id}/share-links") suspend fun createShareLink(@Path("id") projectId: String, @Body body: ShareLinkRequest): CreatedShareLinkDto
    @POST("api/v1/share-links/{id}/revoke") suspend fun revokeShareLink(@Path("id") id: String): JsonElement

    // ---------------------------------------------------------------- analytics
    @GET("api/v1/reports/summary")
    suspend fun summary(
        @Query("project_id") projectId: String?,
        @Query("sector_id") sectorId: String? = null,
        @Query("sub_sector_id") subSectorId: String? = null,
        @Query("species_id") speciesId: String? = null,
        @Query("status_id") statusId: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("vendor_id") vendorId: String? = null,
    ): AnalyticsSummary
}

/** All sectors, or with [plantingYearId] that year's survey plus older areas not tied to a year. */
suspend fun AdminApi.areas(projectId: String, plantingYearId: String? = null): List<AdminSectorDto> = decodeAreas(areasRaw(projectId, plantingYearId))
