package com.teasoo.tms.data.repo

import android.content.Context
import android.os.StatFs
import dagger.hilt.android.qualifiers.ApplicationContext
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
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

    /** Shrinks the capture and fixes its orientation, then fingerprints the stored bytes. Call off the main thread. */
    fun finalize(mediaId: String, file: File): CapturedPhoto {
        runCatching { shrink(file) } // if anything fails the original capture is kept: never lose the photo
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

    /**
     * At most [MAX_EDGE_PX] on the long edge, JPEG ~300 KB, with the EXIF rotation applied to the pixels
     * so every viewer (phone, web) shows the same upright image and measurement points line up.
     */
    private fun shrink(file: File) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        val longEdge = maxOf(bounds.outWidth, bounds.outHeight)
        if (longEdge <= 0) return
        var sample = 1
        while (longEdge / (sample * 2) >= MAX_EDGE_PX) sample *= 2
        val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return
        val scale = minOf(1f, MAX_EDGE_PX.toFloat() / maxOf(decoded.width, decoded.height))
        val matrix = Matrix().apply {
            postScale(scale, scale)
            when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
            }
        }
        val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        val tmp = File(file.path + ".tmp")
        tmp.outputStream().use { upright.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
        if (upright !== decoded) upright.recycle()
        decoded.recycle()
        if (!tmp.renameTo(file)) tmp.delete()
    }

    /** Removes a capture the officer discarded before saving the record. */
    fun discard(photo: CapturedPhoto) {
        photo.file.delete()
    }

    fun freeBytes(): Long = StatFs(context.filesDir.path).availableBytes

    companion object {
        const val MAX_EDGE_PX = 1600
        const val JPEG_QUALITY = 80
        /** Warn the officer below this much free space. */
        const val LOW_STORAGE_BYTES = 500L * 1024 * 1024
        /** Refuse new photos below this, so the database always has room to save records. */
        const val CRITICAL_STORAGE_BYTES = 100L * 1024 * 1024
    }
}
