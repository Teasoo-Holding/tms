package com.teasoo.tms.data.repo

import android.content.Context
import android.os.StatFs
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class CapturedPhoto(val mediaId: String, val file: File, val sha256: String, val byteSize: Long, val mimeType: String = "image/jpeg")

/** App-private photo files. Nothing here is visible to other apps or included in backups. */
@Singleton
class PhotoStore @Inject constructor(@ApplicationContext private val context: Context) {
    private val dir = File(context.filesDir, "photos").apply { mkdirs() }

    fun newFile(): Pair<String, File> {
        val id = UUID.randomUUID().toString()
        return id to File(dir, "$id.jpg")
    }

    fun finalize(mediaId: String, file: File): CapturedPhoto {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return CapturedPhoto(mediaId, file, digest.digest().joinToString("") { "%02x".format(it) }, file.length())
    }

    /** Removes a capture the officer discarded before saving the record. */
    fun discard(photo: CapturedPhoto) {
        photo.file.delete()
    }

    fun freeBytes(): Long = StatFs(context.filesDir.path).availableBytes

    companion object {
        /** Warn the officer below this much free space. */
        const val LOW_STORAGE_BYTES = 500L * 1024 * 1024
        /** Refuse new photos below this, so the database always has room to save records. */
        const val CRITICAL_STORAGE_BYTES = 100L * 1024 * 1024
    }
}
