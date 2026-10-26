package com.teasoo.tms.data.repo

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.teasoo.tms.data.local.SpeciesImageEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.TmsApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reference photos of each species, kept on the phone (app storage, not the evictable cache) so officers can
 * compare a tree with them offline. Downloaded after each sync; files of deleted images are removed.
 */
@Singleton
class SpeciesImageStore @Inject constructor(@ApplicationContext context: Context, private val api: TmsApi, private val db: TmsDatabase) {
    private val dir = File(context.filesDir, "species-images").apply { mkdirs() }
    private val memory = LruCache<String, ImageBitmap>(32)

    private fun file(id: String, full: Boolean) = File(dir, if (full) "$id.jpg" else "$id.thumb.jpg")

    /** Fetches what is missing (small copies first, so every card has a picture soon) and drops files no longer used. */
    suspend fun prefetch() = withContext(Dispatchers.IO) {
        val images = db.reference().allSpeciesImages()
        val keep = images.flatMap { listOf(file(it.id, false).name, file(it.id, true).name) }.toSet()
        dir.listFiles()?.filter { it.name !in keep }?.forEach { it.delete() }
        for (full in listOf(false, true)) images.forEach { runCatching { download(it.id, full) } }
    }

    private suspend fun download(id: String, full: Boolean): File? {
        val target = file(id, full)
        if (target.exists()) return target
        val body = api.speciesImage(id, if (full) "full" else "thumb")
        val tmp = File(target.path + ".part")
        body.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
        return if (tmp.renameTo(target)) target else null.also { tmp.delete() }
    }

    /** The image no larger than [maxPx] on its long edge; downloaded now if it is not on the phone yet (null when offline). */
    suspend fun load(image: SpeciesImageEntity, maxPx: Int): ImageBitmap? = withContext(Dispatchers.IO) {
        val full = maxPx > 400
        val key = "${image.id}:$full"
        memory.get(key)?.let { return@withContext it }
        val f = file(image.id, full).takeIf { it.exists() } ?: runCatching { download(image.id, full) }.getOrNull()
            ?: if (full) file(image.id, false).takeIf { it.exists() } else null
        f ?: return@withContext null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()?.also { memory.put(key, it) }
    }
}
