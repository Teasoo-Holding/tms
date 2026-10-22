package com.teasoo.tms.data.repo

import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.File
import java.io.OutputStream
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Export backup": everything on this phone that has not reached the server, in one zip file the
 * officer can copy off the phone (USB, Drive, WhatsApp…). It holds the queued sync operations exactly
 * as the server accepts them, the unsynced records for reading, and the unsent photo files.
 * Nothing on the phone is changed or removed by exporting.
 */
@Singleton
class BackupExporter @Inject constructor(private val db: TmsDatabase, private val session: SessionStore) {
    data class Summary(val operations: Int, val trees: Int, val observations: Int, val photos: Int)

    /** [includePhotos] false gives the light backup: records only (a few KB per tree). */
    suspend fun export(out: OutputStream, includePhotos: Boolean = true): Summary = withContext(Dispatchers.IO) {
        val ops = db.outbox().pendingList()
        val trees = db.trees().unsynced()
        val observations = db.observations().unsynced()
        val media = db.media().unsent()
        val user = (session.current() as? SessionState.Active)?.user
        ZipOutputStream(out.buffered()).use { zip ->
            fun json(name: String, value: JsonElement) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(TmsJson.encodeToString(JsonElement.serializer(), value).toByteArray())
                zip.closeEntry()
            }
            json(
                "manifest.json",
                buildJsonObject {
                    put("format", "tms-field-backup/1")
                    put("includes_photos", includePhotos)
                    put("created_at", Instant.now().toString())
                    put("app_version", BuildConfig.VERSION_NAME)
                    put("device_id", session.deviceId())
                    user?.let { u -> putJsonObject("user") { put("id", u.id); put("name", u.fullName); put("login", u.loginName) } }
                    put("operations", ops.size)
                    put("trees", trees.size)
                    put("observations", observations.size)
                    put("photos", media.size)
                    put("note", "operations.json holds the records in the order the phone would send them to /api/v1/sync/batches.")
                },
            )
            json(
                "operations.json",
                JsonArray(
                    ops.map { op ->
                        buildJsonObject {
                            put("operation_id", op.operationId)
                            put("entity_type", op.entityType)
                            put("entity_id", op.entityId)
                            put("operation_type", op.operationType)
                            op.baseRevision?.let { put("base_revision", it) }
                            put("client_recorded_at", op.clientRecordedAt)
                            put("payload", TmsJson.parseToJsonElement(op.payloadJson))
                            put("attempts", op.attempts)
                            op.lastError?.let { put("last_error", it) }
                        }
                    },
                ),
            )
            json(
                "trees.json",
                JsonArray(
                    trees.map { t ->
                        buildJsonObject {
                            put("id", t.id); put("physical_tree_id", t.physicalTreeId); put("project_id", t.projectId)
                            put("planting_year_id", t.plantingYearId); put("sector_id", t.sectorId); put("sub_sector_id", t.subSectorId)
                            put("species_id", t.speciesId); put("current_status_id", t.currentStatusId); put("vendor_id", t.vendorId)
                            put("replaces_tree_id", t.replacesTreeId); put("planted_on", t.plantedOn); put("notes", t.notes)
                            put("custom_fields", TmsJson.parseToJsonElement(t.customFieldsJson)); put("created_by", t.createdBy)
                            put("created_at", t.createdAt); put("sync_state", t.syncState); put("sync_message", t.syncMessage)
                        }
                    },
                ),
            )
            json(
                "observations.json",
                JsonArray(
                    observations.map { o ->
                        buildJsonObject {
                            put("id", o.id); put("tree_id", o.treeId); put("status_id", o.statusId); put("observed_at", o.observedAt)
                            put("recorded_at", o.recordedAt); put("recorded_by", o.recordedBy); put("remarks", o.remarks)
                            put("is_initial", o.isInitial); put("amends_observation_id", o.amendsObservationId); put("amendment_reason", o.amendmentReason)
                            put("height_cm", o.heightCm); put("height_method", o.heightMethod)
                            put("custom_fields", TmsJson.parseToJsonElement(o.customFieldsJson)); put("sync_state", o.syncState)
                        }
                    },
                ),
            )
            json(
                "photos.json",
                JsonArray(
                    media.map { m ->
                        buildJsonObject {
                            put("id", m.id); put("tree_id", m.treeId); m.observationId?.let { put("observation_id", it) }
                            put("file", "photos/${m.id}.jpg"); put("sha256", m.checksumSha256); put("byte_size", m.byteSize)
                            put("mime_type", m.mimeType); put("captured_at", m.capturedAt)
                        }
                    },
                ),
            )
            for (m in media) {
                if (!includePhotos) break
                val f = m.localPath?.let(::File)?.takeIf { it.exists() } ?: continue
                zip.putNextEntry(ZipEntry("photos/${m.id}.jpg"))
                f.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        Summary(ops.size, trees.size, observations.size, media.size)
    }

    fun fileName() = "tms-backup-${Instant.now().toString().take(16).replace(':', '-')}.zip"
}
