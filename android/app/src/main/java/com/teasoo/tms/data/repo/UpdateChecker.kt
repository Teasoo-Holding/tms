package com.teasoo.tms.data.repo

import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.remote.TmsJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/** A newer app version than the one installed, with the link to download it. */
data class AppUpdate(val version: String, val downloadUrl: String) {
    /** This exact version's file, so a release published meanwhile can't swap in under the same name. */
    val versionedUrl get() = "https://github.com/${BuildConfig.RELEASES_REPO}/releases/download/android-v$version/tms-field-$version.apk"
}

/**
 * Checks the latest published Android release (the same one the landing page offers). Silent when offline or when
 * nothing newer exists; installing stays the person's choice.
 */
@Singleton
class UpdateChecker @Inject constructor(@Named("upload") private val client: OkHttpClient) {
    suspend fun check(): AppUpdate? = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url("https://api.github.com/repos/${BuildConfig.RELEASES_REPO}/releases/latest")
                .header("Accept", "application/vnd.github+json").build()
            client.newCall(request).execute().use { res ->
                if (!res.isSuccessful) return@runCatching null
                val tag = TmsJson.parseToJsonElement(res.body!!.string()).jsonObject["tag_name"]?.jsonPrimitive?.content ?: return@runCatching null
                val latest = tag.removePrefix("android-v")
                if (isNewer(latest, BuildConfig.VERSION_NAME)) {
                    AppUpdate(latest, "https://github.com/${BuildConfig.RELEASES_REPO}/releases/latest/download/tms-field.apk")
                } else null
            }
        }.getOrNull()
    }

    /**
     * Downloads the update into the app's cache (shared with the installer only through the FileProvider), reporting
     * progress from 0 to 1. Returns the file, or throws when the download fails.
     */
    suspend fun download(update: AppUpdate, dir: java.io.File, onProgress: (Float) -> Unit): java.io.File = withContext(Dispatchers.IO) {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() } // only the newest download is kept
        val target = java.io.File(dir, "tms-field-${update.version}.apk")
        val part = java.io.File(dir, target.name + ".part")
        client.newCall(Request.Builder().url(update.versionedUrl).build()).execute().use { res ->
            if (!res.isSuccessful) throw java.io.IOException("Download failed (${res.code})")
            val body = res.body ?: throw java.io.IOException("Empty download")
            val total = body.contentLength().takeIf { it > 0 }
            body.byteStream().use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        total?.let { onProgress((done.toFloat() / it).coerceIn(0f, 1f)) }
                    }
                }
            }
        }
        if (!part.renameTo(target)) throw java.io.IOException("Could not save the update")
        target
    }

    companion object {
        /** Compares dotted version numbers (1.0.12 > 1.0.9); anything unparsable counts as not newer. */
        fun isNewer(candidate: String, installed: String): Boolean {
            val a = candidate.split('.').map { it.toIntOrNull() ?: return false }
            val b = installed.split('.').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(a.size, b.size)) {
                val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
                if (x != y) return x > y
            }
            return false
        }
    }
}
