package com.teasoo.tms.sync

import androidx.room.withTransaction
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.data.repo.ReferenceRepository
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.domain.Backoff
import com.teasoo.tms.domain.MediaDeletionPolicy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

sealed interface SyncOutcome {
    data object Success : SyncOutcome
    /** Transient problem (offline, server error): try again later. Nothing is lost. */
    data class Retry(val reason: String) : SyncOutcome
    /** Needs the officer (sign in again). */
    data class Blocked(val reason: String) : SyncOutcome
}

/**
 * One sync cycle (architecture §8.2): push outbox operations, upload and verify photos,
 * pull authorised server changes with the cursor, then offload only verified photos.
 */
@Singleton
class SyncEngine @Inject constructor(
    private val db: TmsDatabase,
    private val api: TmsApi,
    private val session: SessionStore,
    private val reference: ReferenceRepository,
    @Named("upload") private val uploadClient: OkHttpClient,
) {
    suspend fun run(): SyncOutcome {
        val current = session.current() as? SessionState.Active ?: return SyncOutcome.Blocked("Sign in to sync.")
        // Executives have read-only, online reporting; there is no field data to push or download.
        if (current.user.role == "EXECUTIVE") return SyncOutcome.Success
        val outcome = try {
            checkDataGeneration()
            push()
            uploadMedia()
            pull()
            cleanupMedia()
            db.kv().put(KeyValueEntity(Keys.LAST_SUCCESSFUL_SYNC, Instant.now().toString()))
            db.kv().remove(Keys.LAST_SYNC_ERROR)
            SyncOutcome.Success
        } catch (e: Throwable) {
            when (val f = e.toApiFailure()) {
                is ApiFailure.Offline -> SyncOutcome.Retry(f.message!!)
                is ApiFailure.Unauthorized -> {
                    session.lock(f.message ?: "Sign in again to continue syncing.")
                    SyncOutcome.Blocked(f.message!!)
                }
                is ApiFailure.Server -> SyncOutcome.Retry(f.message!!)
            }
        }
        if (outcome !is SyncOutcome.Success) {
            db.kv().put(KeyValueEntity(Keys.LAST_SYNC_ERROR, (outcome as? SyncOutcome.Retry)?.reason ?: (outcome as SyncOutcome.Blocked).reason))
        }
        return outcome
    }

    // ------------------------------------------------------------------ push
    private suspend fun push() {
        val deviceId = session.deviceId()
        while (true) {
            val ops = db.outbox().due(System.currentTimeMillis(), BATCH)
            if (ops.isEmpty()) return
            val response = try {
                api.submit(SyncBatchRequest(deviceId, ops.map { it.toDto() }))
            } catch (e: Throwable) {
                val f = e.toApiFailure()
                // A batch-level 4xx is not the records' fault; back off rather than spin.
                if (f is ApiFailure.Server && f.status in 400..499) {
                    ops.forEach { db.outbox().retryLater(it.operationId, System.currentTimeMillis() + Backoff.delayMs(it.attempts), f.message!!) }
                    return
                }
                throw f
            }
            val byId = response.results.associateBy { it.operationId }
            for (op in ops) {
                val r = byId[op.operationId]
                if (r == null) {
                    db.outbox().retryLater(op.operationId, System.currentTimeMillis() + Backoff.delayMs(op.attempts), "No result returned")
                } else {
                    applyResult(op, r)
                }
            }
        }
    }

    /** Item-level outcome handling. Each result is applied atomically with the outbox update. */
    internal suspend fun applyResult(op: OutboxEntity, r: OperationResultDto) = db.withTransaction {
        val status = if (r.status == "ALREADY_PROCESSED") r.originalStatus ?: "ACCEPTED" else r.status
        when (status) {
            "ACCEPTED" -> {
                db.outbox().delete(op.operationId)
                when (op.entityType) {
                    "tree" -> r.entity?.let { e ->
                        val tree = db.trees().get(op.entityId)
                        if (tree != null) {
                            val stillPending = db.outbox().countFor(op.entityId) > 0
                            db.trees().upsert(
                                tree.copy(
                                    serverRevision = e.int("revision") ?: tree.serverRevision,
                                    recordState = e.str("record_state") ?: tree.recordState,
                                    physicalTreeId = e.str("physical_tree_id") ?: tree.physicalTreeId,
                                    componentsSnapshotJson = e["id_components_snapshot"]?.toString() ?: tree.componentsSnapshotJson,
                                    syncState = if (stillPending) SyncState.PENDING else SyncState.SYNCED,
                                    syncMessage = null,
                                ),
                            )
                        }
                        // The initial observation is created by the same server operation.
                        if (op.operationType == "create") markInitialObservationSynced(op.entityId)
                    }
                    "observation" -> db.observations().setSyncState(op.entityId, SyncState.SYNCED, null)
                }
            }
            "CONFLICT" -> {
                db.outbox().finish(op.operationId, OutboxState.CONFLICT, r.code, r.message)
                when (op.entityType) {
                    "tree" -> {
                        db.trees().get(op.entityId)?.let { t ->
                            val created = op.operationType == "create"
                            db.trees().upsert(
                                t.copy(
                                    recordState = if (created) "CONFLICT" else t.recordState,
                                    serverRevision = if (created) r.entity?.int("revision") ?: 1 else t.serverRevision,
                                    syncState = SyncState.CONFLICT,
                                    syncMessage = r.message,
                                ),
                            )
                        }
                        if (op.operationType == "create") markInitialObservationSynced(op.entityId)
                    }
                    "observation" -> db.observations().setSyncState(op.entityId, SyncState.CONFLICT, r.message)
                }
            }
            else -> {
                db.outbox().finish(op.operationId, OutboxState.REJECTED, r.code, r.message)
                when (op.entityType) {
                    "tree" -> db.trees().setSyncState(op.entityId, SyncState.REJECTED, r.message)
                    "observation" -> db.observations().setSyncState(op.entityId, SyncState.REJECTED, r.message)
                }
            }
        }
    }

    private suspend fun markInitialObservationSynced(treeId: String) = db.observations().markInitialSynced(treeId)

    // ------------------------------------------------------------------ media
    private suspend fun uploadMedia() {
        for (m in db.media().dueForUpload(System.currentTimeMillis())) {
            // The server must already hold the tree/observation so it can verify the association.
            val tree = db.trees().get(m.treeId) ?: continue
            if (tree.serverRevision == null) continue
            val obs = m.observationId?.let { db.observations().get(it) }
            if (obs != null && obs.syncState !in listOf(SyncState.SYNCED, SyncState.CONFLICT)) continue
            val file = m.localPath?.let(::File)
            if (file == null || !file.exists()) {
                db.media().upsert(m.copy(state = MediaState.FAILED, lastError = "The photo file is missing on this device.", nextAttemptAt = Long.MAX_VALUE))
                continue
            }
            try {
                val session = api.uploadSession(
                    UploadSessionRequest(m.id, m.treeId, m.observationId, m.checksumSha256, m.byteSize, m.mimeType, m.capturedAt),
                )
                if (!session.alreadyVerified) put(session, file, m.mimeType)
                recordVerification(m, api.completeUpload(m.id))
            } catch (e: Throwable) {
                val f = e.toApiFailure()
                if (f is ApiFailure.Offline || f is ApiFailure.Unauthorized) throw f
                db.media().upsert(m.copy(attempts = m.attempts + 1, nextAttemptAt = System.currentTimeMillis() + Backoff.delayMs(m.attempts), lastError = f.message))
            }
        }
    }

    private fun put(session: UploadSessionResponse, file: File, mimeType: String) {
        val builder = Request.Builder().url(session.uploadUrl!!).put(file.asRequestBody(mimeType.toMediaType()))
        session.uploadHeaders.forEach { (k, v) -> builder.header(k, v) }
        uploadClient.newCall(builder.build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiFailure.Server(res.code, "UPLOAD_FAILED", "Photo upload failed (${res.code}).")
        }
    }

    /** Stores the server's verification facts and the acknowledgement in one transaction. */
    private suspend fun recordVerification(m: MediaEntity, v: MediaVerificationDto) = db.withTransaction {
        if (v.uploadState == "VERIFIED") {
            db.media().upsert(
                m.copy(
                    state = MediaState.VERIFIED, serverChecksum = v.checksumSha256, serverByteSize = v.byteSize,
                    remoteVerifiedAt = v.remoteVerifiedAt, associationVerifiedAt = v.associationVerifiedAt,
                    ackPersistedAt = Instant.now().toString(), lastError = null,
                ),
            )
        } else {
            db.media().upsert(
                m.copy(
                    state = MediaState.FAILED, attempts = m.attempts + 1,
                    nextAttemptAt = System.currentTimeMillis() + Backoff.delayMs(m.attempts),
                    lastError = "Verification failed (${v.failureReason}); the photo will be uploaded again.",
                ),
            )
        }
    }

    /** Deletes local copies only when every deletion condition holds. Unsynced photos are never purged. */
    /** Called when the server's data was cleared by an administrator. Saves a full backup first. */
    internal var onReset: suspend () -> Unit = {}

    /**
     * When an administrator clears all data, every phone must start afresh: otherwise queued records
     * from before would be sent again. A full backup (records and photos) is written before the reset.
     */
    internal suspend fun checkDataGeneration() {
        val generation = api.changes(db.kv().get(Keys.CURSOR) ?: "0", 1).dataGeneration.toString()
        val seen = db.kv().get(Keys.DATA_GENERATION)
        if (seen != null && seen != generation) {
            runCatching { onReset() }
            val files = db.media().all().mapNotNull { it.localPath }
            withContext(Dispatchers.IO) { db.clearAllTables() }
            files.forEach { File(it).delete() }
        }
        if (seen != generation) db.kv().put(KeyValueEntity(Keys.DATA_GENERATION, generation))
    }

    /** Verified photos stay on the phone as a second copy this long, unless storage runs low. */
    internal var retentionDays = 30L
    internal var freeBytes: () -> Long = { android.os.StatFs(android.os.Environment.getDataDirectory().path).availableBytes }

    /**
     * Removes local copies of photos the server has verified. [now] = true is the officer's
     * "Free up space": the 30-day second copy is given up, but never a photo not yet verified.
     * Returns the bytes freed.
     */
    internal suspend fun cleanupMedia(now: Boolean = false): Long {
        var freed = 0L
        val keepAfter = Instant.now().minus(java.time.Duration.ofDays(retentionDays))
        val storageLow = now || freeBytes() < com.teasoo.tms.data.repo.PhotoStore.LOW_STORAGE_BYTES
        for (m in db.media().verifiedWithLocalCopy()) {
            val captured = runCatching { Instant.parse(m.capturedAt) }.getOrDefault(Instant.EPOCH)
            if (!storageLow && captured.isAfter(keepAfter)) continue
            val facts = MediaDeletionPolicy.Facts(
                remoteVerifiedAt = m.remoteVerifiedAt, associationVerifiedAt = m.associationVerifiedAt,
                serverChecksum = m.serverChecksum, localChecksum = m.checksumSha256,
                serverByteSize = m.serverByteSize, localByteSize = m.byteSize,
                acknowledgementPersisted = m.ackPersistedAt != null,
                pendingOperationsReferencingFile = db.outbox().pendingReferencing(m.treeId, m.observationId),
            )
            if (!MediaDeletionPolicy.mayDelete(facts)) continue
            val file = File(m.localPath!!)
            val size = file.length()
            if (!file.exists() || file.delete()) {
                db.media().markOffloaded(m.id, Instant.now().toString())
                freed += size
            }
        }
        return freed
    }

    // ------------------------------------------------------------------ pull
    private suspend fun pull() {
        val cursor = db.kv().get(Keys.CURSOR)
        if (cursor == null) return fullRefresh()
        var next: String = cursor
        while (true) {
            val page = api.changes(next)
            if (page.assignmentFingerprint != db.kv().get(Keys.ASSIGNMENT_FINGERPRINT)) return fullRefresh()
            reference.applyChanges(page)
            next = page.nextCursor
            if (!page.hasMore) return
        }
    }

    /** First sync, or assignments changed: download configuration and every authorised tree. */
    private suspend fun fullRefresh() {
        val boot = api.bootstrap()
        reference.applyBootstrap(boot)
        for (project in boot.projects) {
            var after: String? = null
            do {
                val page = api.trees(project.id, after)
                reference.applyTreesPage(page)
                after = page.nextAfterId
            } while (after != null)
        }
        // Cursor and fingerprint are written last: an interrupted refresh simply runs again.
        db.withTransaction {
            db.kv().put(KeyValueEntity(Keys.CURSOR, boot.cursor))
            db.kv().put(KeyValueEntity(Keys.ASSIGNMENT_FINGERPRINT, boot.assignmentFingerprint))
        }
        pull()
    }

    private fun OutboxEntity.toDto() = OperationDto(
        operationId = operationId, entityType = entityType, entityId = entityId, operationType = operationType,
        baseRevision = baseRevision, clientRecordedAt = clientRecordedAt, payload = TmsJson.parseToJsonElement(payloadJson) as JsonObject,
    )

    private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content?.takeIf { it != "null" }
    private fun JsonObject.int(k: String) = this[k]?.jsonPrimitive?.content?.toIntOrNull()

    private companion object {
        const val BATCH = 100
    }
}
