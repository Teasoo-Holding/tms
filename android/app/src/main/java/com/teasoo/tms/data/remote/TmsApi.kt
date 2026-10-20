package com.teasoo.tms.data.remote

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface TmsApi {
    @POST("api/v1/auth/login") suspend fun login(@Body body: LoginRequest): TokenResponse
    @POST("api/v1/auth/logout") suspend fun logout(@Body body: RefreshRequest)

    @GET("api/v1/mobile/bootstrap") suspend fun bootstrap(): BootstrapResponse
    @GET("api/v1/mobile/trees")
    suspend fun trees(@Query("project_id") projectId: String, @Query("after_id") afterId: String?, @Query("limit") limit: Int = 500): MobileTreesResponse

    @POST("api/v1/sync/batches") suspend fun submit(@Body body: SyncBatchRequest): SyncBatchResponse
    @GET("api/v1/sync/changes") suspend fun changes(@Query("cursor") cursor: String, @Query("limit") limit: Int = 500): ChangesResponse

    @POST("api/v1/media/upload-sessions") suspend fun uploadSession(@Body body: UploadSessionRequest): UploadSessionResponse
    @POST("api/v1/media/{id}/complete") suspend fun completeUpload(@Path("id") mediaId: String): MediaVerificationDto

    // Oversight: online-only views for administrators (and the read-only summary for executives).
    @GET("api/v1/reports/summary") suspend fun summary(@Query("project_id") projectId: String?): ReportSummary
    @GET("api/v1/conflicts") suspend fun conflicts(@Query("status") status: String = "OPEN"): List<ConflictDto>
    @POST("api/v1/conflicts/{id}/resolve") suspend fun resolveConflict(@Path("id") id: String, @Body body: ResolveConflictRequest)
    @POST("api/v1/trees/{id}/physical-id-corrections") suspend fun correctSerial(@Path("id") treeId: String, @Body body: SerialCorrectionRequest)
}
