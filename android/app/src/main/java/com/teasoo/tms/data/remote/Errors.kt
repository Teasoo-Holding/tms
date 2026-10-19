package com.teasoo.tms.data.remote

import retrofit2.HttpException
import java.io.IOException

/** Classifies failures so callers can decide between retry, re-authentication and user action. */
sealed class ApiFailure(message: String) : Exception(message) {
    class Offline(cause: IOException) : ApiFailure("No connection to the server. Your work is saved on this device.")
    class Unauthorized(val code: String, message: String) : ApiFailure(message)
    class Server(val status: Int, val code: String?, message: String) : ApiFailure(message)
}

fun Throwable.toApiFailure(): ApiFailure = when (this) {
    is ApiFailure -> this
    is IOException -> ApiFailure.Offline(this)
    is HttpException -> {
        val body = runCatching { response()?.errorBody()?.string()?.let { TmsJson.decodeFromString(ApiErrorBody.serializer(), it) } }.getOrNull()
        val message = body?.message ?: "The server returned an error (${code()})."
        if (code() == 401) ApiFailure.Unauthorized(body?.code ?: "UNAUTHENTICATED", message) else ApiFailure.Server(code(), body?.code, message)
    }
    else -> ApiFailure.Server(0, null, message ?: "Unexpected error.")
}
