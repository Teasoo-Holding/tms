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
data class AppUpdate(val version: String, val downloadUrl: String)

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
