package com.teasoo.tms.data.repo

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.teasoo.tms.data.local.MediaEntity
import com.teasoo.tms.data.local.MediaState
import com.teasoo.tms.data.remote.TmsApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Photos for viewing: the app-private original while it is still on the device, otherwise the
 * server copy, fetched on demand through a short-lived link and kept in the (evictable) cache.
 * Viewing never touches the upload lifecycle or the files the outbox depends on.
 */
@Singleton
class PhotoLoader @Inject constructor(
    @ApplicationContext context: Context,
    private val api: TmsApi,
    @Named("upload") private val plain: OkHttpClient,
) {
    private val cacheDir = File(context.cacheDir, "remote-photos").apply { mkdirs() }
    private val memory = LruCache<String, ImageBitmap>(48)

    private companion object {
        const val THUMB_MAX = 400
    }

    /** Decoded image no larger than [maxPx] on its long edge, or null when it cannot be shown (offline, still uploading). */
    suspend fun load(m: MediaEntity, maxPx: Int): ImageBitmap? = withContext(Dispatchers.IO) {
        val key = "${m.id}:$maxPx"
        memory.get(key)?.let { return@withContext it }
        // Lists use the server's small copy (~20 KB); the full photo is fetched only when opened.
        val thumb = maxPx <= THUMB_MAX
        val file = localFile(m) ?: (if (thumb) cached(m, true) ?: download(m, true) else null) ?: cached(m, false) ?: download(m, false) ?: return@withContext null
        decode(file, maxPx)?.also { memory.put(key, it) }
    }

    private fun localFile(m: MediaEntity): File? = m.localPath?.let(::File)?.takeIf { it.exists() }

    private fun cacheFile(m: MediaEntity, thumb: Boolean) = File(cacheDir, if (thumb) "${m.id}.thumb.jpg" else "${m.id}.jpg")
    private fun cached(m: MediaEntity, thumb: Boolean) = cacheFile(m, thumb).takeIf { it.exists() }

    private suspend fun download(m: MediaEntity, thumb: Boolean): File? {
        if (m.state != MediaState.VERIFIED) return null
        val url = runCatching { api.mediaViewUrl(m.id, if (thumb) "thumb" else null).url }.getOrNull() ?: return null
        return runCatching {
            plain.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val target = cacheFile(m, thumb)
                val tmp = File(cacheDir, "${m.id}.${if (thumb) "t" else "f"}.part")
                tmp.outputStream().use { out -> res.body!!.byteStream().copyTo(out) }
                tmp.renameTo(target)
                target
            }
        }.getOrNull()
    }

    private fun decode(file: File, maxPx: Int): ImageBitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }
}
