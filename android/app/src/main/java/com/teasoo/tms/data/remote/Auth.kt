package com.teasoo.tms.data.remote

import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.session.SessionStore
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

class AuthInterceptor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = session.accessTokenBlocking()
        val request = if (token != null && chain.request().header("Authorization") == null) {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else chain.request()
        return chain.proceed(request)
    }
}

/**
 * Refreshes the access token once on 401 using the rotating refresh token. If the server refuses
 * (revoked device, deactivated account, reused token) the session is locked; local records are kept.
 */
class TokenAuthenticator(private val session: SessionStore, private val plainClient: OkHttpClient) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.contains("/auth/")) return null
        // A wrong password on a confirmed action is not an expired session: never refresh and resend it.
        if (response.request.url.encodedPath.endsWith("/admin/clear-data")) return null
        if (responseCount(response) > 1) return null
        synchronized(lock) {
            val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")
            val current = session.accessTokenBlocking()
            // Another request already refreshed while we waited.
            if (current != null && current != failedToken) return response.request.withToken(current)
            val refresh = runBlocking { session.refreshToken() } ?: return null
            val body = TmsJson.encodeToString(RefreshRequest.serializer(), RefreshRequest(refresh)).toRequestBody(JSON)
            val call = plainClient.newCall(Request.Builder().url(BuildConfig.API_BASE_URL + "api/v1/auth/refresh").post(body).build())
            val result = runCatching { call.execute() }.getOrNull() ?: return null // offline: keep tokens, retry later
            result.use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    if (res.code == 401) {
                        val message = runCatching { TmsJson.decodeFromString(ApiErrorBody.serializer(), text).message }.getOrNull()
                        runBlocking { session.lock(message ?: "Your session has ended. Sign in again.") }
                    }
                    return null
                }
                val tokens = TmsJson.decodeFromString(TokenResponse.serializer(), text)
                runBlocking { session.save(tokens) }
                return response.request.withToken(tokens.accessToken)
            }
        }
    }

    private fun Request.withToken(token: String) = newBuilder().header("Authorization", "Bearer $token").build()

    private fun responseCount(response: Response): Int {
        var r: Response? = response
        var count = 0
        while (r != null) { count++; r = r.priorResponse }
        return count
    }

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
