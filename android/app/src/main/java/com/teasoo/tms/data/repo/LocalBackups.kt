package com.teasoo.tms.data.repo

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.teasoo.tms.data.local.MediaEntity
import com.teasoo.tms.data.local.MediaState
import com.teasoo.tms.data.local.OutboxEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.TmsJson
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.serialization.json.*
import java.io.File
import java.io.OutputStream
import java.time.LocalDate
import java.util.zip.ZipInputStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A safety copy of unsent work outside the app's private storage, so it survives clearing the
 * app's data or reinstalling it.
 *
 * - Light backup: whenever records are waiting to be sent, "TMS-backup.zip" in Downloads/TMS is
 *   rewritten with them (records only, a few KB per tree). It is replaced, not accumulated.
 * - Restore re-queues the operations from a light backup or a full "Export backup" file (which also
 *   carries photos). The server ignores anything it already has, so restoring twice is harmless.
 */
@OptIn(FlowPreview::class)
@Singleton
class LocalBackups @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: TmsDatabase,
    private val exporter: BackupExporter,
    private val photos: PhotoStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Keeps the light backup current; call once at app start. */
    fun start() {
        scope.launch {
            db.outbox().pendingCount().distinctUntilChanged().debounce(3_000).collect { pending ->
                if (pending > 0) runCatching { writeLight() }
            }
        }
    }

    suspend fun writeLight() = write(LIGHT_NAME, includePhotos = false)

    /** A dated full copy (with photos), e.g. before the phone resets after an administrator cleared the data. */
    suspend fun writeSnapshot(reason: String) = write("TMS-backup-$reason-${LocalDate.now()}.zip", includePhotos = true)

    private suspend fun write(name: String, includePhotos: Boolean) = withContext(Dispatchers.IO) {
        open(name).use { exporter.export(it, includePhotos) }
    }

    /** Downloads/TMS on Android 10+, otherwise the app's external files folder. */
    private fun open(name: String): OutputStream {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
            val existing = resolver.query(
                collection, arrayOf(MediaStore.Downloads._ID),
                "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} = ?", arrayOf(name, "$FOLDER/"), null,
            )?.use { c -> if (c.moveToFirst()) Uri.withAppendedPath(collection, c.getLong(0).toString()) else null }
            val uri = existing ?: resolver.insert(
                collection,
                ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/zip")
                    put(MediaStore.Downloads.RELATIVE_PATH, FOLDER)
                },
            )!!
            return resolver.openOutputStream(uri, "wt")!!
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "TMS").apply { mkdirs() }
        return File(dir, name).outputStream()
    }

    data class RestoreResult(val operations: Int, val photos: Int)

    /** Re-queues what a backup holds that this phone does not already have. */
    suspend fun restore(uri: Uri): RestoreResult = withContext(Dispatchers.IO) {
        val entries = mutableMapOf<String, ByteArray>()
        context.contentResolver.openInputStream(uri)!!.use { input ->
            ZipInputStream(input.buffered()).use { zip ->
                while (true) {
                    val e = zip.nextEntry ?: break
                    if (!e.isDirectory && e.size <= MAX_ENTRY) entries[e.name] = zip.readBytes()
                }
            }
        }
        val manifest = entries["manifest.json"]?.let { TmsJson.parseToJsonElement(it.decodeToString()).jsonObject }
        require(manifest?.get("format")?.jsonPrimitive?.content?.startsWith("tms-field-backup/") == true) { "This is not a TMS backup file." }

        var ops = 0
        val operations = entries["operations.json"]?.let { TmsJson.parseToJsonElement(it.decodeToString()).jsonArray }.orEmpty()
        for (o in operations.map { it.jsonObject }) {
            val id = o["operation_id"]!!.jsonPrimitive.content
            if (db.outbox().byOperationId(id) != null) continue
            db.outbox().insert(
                OutboxEntity(
                    operationId = id,
                    entityType = o["entity_type"]!!.jsonPrimitive.content,
                    entityId = o["entity_id"]!!.jsonPrimitive.content,
                    operationType = o["operation_type"]!!.jsonPrimitive.content,
                    baseRevision = o["base_revision"]?.jsonPrimitive?.intOrNull,
                    clientRecordedAt = o["client_recorded_at"]!!.jsonPrimitive.content,
                    payloadJson = o["payload"]!!.toString(),
                ),
            )
            ops++
        }

        var restoredPhotos = 0
        val photoList = entries["photos.json"]?.let { TmsJson.parseToJsonElement(it.decodeToString()).jsonArray }.orEmpty()
        for (p in photoList.map { it.jsonObject }) {
            val bytes = entries[p["file"]?.jsonPrimitive?.content ?: continue] ?: continue
            val id = p["id"]!!.jsonPrimitive.content
            if (db.media().get(id) != null) continue
            val (_, file) = photos.newFile()
            file.writeBytes(bytes)
            db.media().insert(
                MediaEntity(
                    id = id, treeId = p["tree_id"]!!.jsonPrimitive.content, observationId = p["observation_id"]?.jsonPrimitive?.contentOrNull,
                    localPath = file.absolutePath, checksumSha256 = p["sha256"]!!.jsonPrimitive.content, byteSize = bytes.size.toLong(),
                    mimeType = p["mime_type"]?.jsonPrimitive?.content ?: "image/jpeg", capturedAt = p["captured_at"]!!.jsonPrimitive.content,
                    state = MediaState.LOCAL,
                ),
            )
            restoredPhotos++
        }
        RestoreResult(ops, restoredPhotos)
    }

    companion object {
        const val FOLDER = "Download/TMS"
        const val LIGHT_NAME = "TMS-backup.zip"
        private const val MAX_ENTRY = 50L * 1024 * 1024
    }
}
