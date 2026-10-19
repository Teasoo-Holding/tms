package com.teasoo.tms.data.session

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.remote.TokenResponse
import com.teasoo.tms.data.remote.UserDto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private val Context.sessionStore: DataStore<Preferences> by preferencesDataStore("session")

sealed interface SessionState {
    data object SignedOut : SessionState
    /** Working normally; may be offline until [offlineValidUntil]. */
    data class Active(val user: UserDto, val offlineValidUntil: Instant) : SessionState
    /** The offline access window has passed: data stays on the device but the officer must sign in online. */
    data class RevalidationRequired(val user: UserDto, val reason: String) : SessionState
}

/**
 * Session tokens (encrypted with a Keystore key), the user's offline access window and the stable
 * device identity. Records stay in the local database across sign-ins so nothing unsynced is lost.
 */
@Singleton
class SessionStore @Inject constructor(@ApplicationContext private val context: Context) {
    private val cipher by lazy { KeystoreCipher() }
    private val store get() = context.sessionStore

    private object K {
        val ACCESS = stringPreferencesKey("access")
        val REFRESH = stringPreferencesKey("refresh")
        val USER = stringPreferencesKey("user")
        val OFFLINE_UNTIL = stringPreferencesKey("offline_until")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val LOCK_REASON = stringPreferencesKey("lock_reason")
    }

    val state: Flow<SessionState> = store.data.map { p -> toState(p) }

    private fun toState(p: Preferences): SessionState {
        val user = p[K.USER]?.let { TmsJson.decodeFromString(UserDto.serializer(), it) } ?: return SessionState.SignedOut
        p[K.LOCK_REASON]?.let { return SessionState.RevalidationRequired(user, it) }
        val until = p[K.OFFLINE_UNTIL]?.let(Instant::parse) ?: Instant.EPOCH
        if (Instant.now().isAfter(until)) {
            return SessionState.RevalidationRequired(user, "You have worked offline for longer than allowed. Connect and sign in again to continue.")
        }
        return SessionState.Active(user, until)
    }

    suspend fun current(): SessionState = toState(store.data.first())

    suspend fun deviceId(): String {
        store.data.first()[K.DEVICE_ID]?.let { return it }
        val id = UUID.randomUUID().toString()
        store.edit { it[K.DEVICE_ID] = id }
        return id
    }

    suspend fun save(tokens: TokenResponse) {
        store.edit {
            it[K.ACCESS] = cipher.encrypt(tokens.accessToken)
            it[K.REFRESH] = cipher.encrypt(tokens.refreshToken)
            it[K.USER] = TmsJson.encodeToString(UserDto.serializer(), tokens.user)
            it[K.OFFLINE_UNTIL] = tokens.offlineValidUntil
            it.remove(K.LOCK_REASON)
        }
    }

    /** Server rejected the session (revoked, deactivated, expired): lock until the officer signs in again. */
    suspend fun lock(reason: String) {
        store.edit {
            it.remove(K.ACCESS)
            it.remove(K.REFRESH)
            it[K.LOCK_REASON] = reason
        }
    }

    suspend fun signOut() {
        store.edit {
            it.remove(K.ACCESS); it.remove(K.REFRESH); it.remove(K.USER); it.remove(K.OFFLINE_UNTIL); it.remove(K.LOCK_REASON)
        }
    }

    suspend fun accessToken(): String? = store.data.first()[K.ACCESS]?.let(cipher::decrypt)
    suspend fun refreshToken(): String? = store.data.first()[K.REFRESH]?.let(cipher::decrypt)
    suspend fun userId(): String? = (current() as? SessionState.Active)?.user?.id

    // OkHttp interceptors run on background threads and need synchronous access.
    fun accessTokenBlocking(): String? = runBlocking { accessToken() }
}
