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
import kotlinx.serialization.builtins.serializer
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private val Context.sessionStore: DataStore<Preferences> by preferencesDataStore("session")

sealed interface SessionState {
    data object SignedOut : SessionState
    /**
     * Working; field work never stops for lack of a connection. [onlineSignInReason] is set when records can't be
     * sent until the person signs in online again (signed in offline, server session ended, or long offline).
     */
    data class Active(val user: UserDto, val offlineValidUntil: Instant, val onlineSignInReason: String? = null) : SessionState {
        val needsOnlineSignIn get() = onlineSignInReason != null
    }
    /** Kept for older stored states; no longer produced: a session never locks the officer out of field work. */
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
        /** Set when signed in with the offline password check: there are no server tokens yet. */
        val OFFLINE_ONLY = stringPreferencesKey("offline_only")
        /** Offline sign-in checks, one per sign-in name (JSON map). */
        val VERIFIERS = stringPreferencesKey("verifiers")
    }

    val state: Flow<SessionState> = store.data.map { p -> toState(p) }

    private fun toState(p: Preferences): SessionState {
        val user = p[K.USER]?.let { TmsJson.decodeFromString(UserDto.serializer(), it) } ?: return SessionState.SignedOut
        val until = p[K.OFFLINE_UNTIL]?.let(Instant::parse) ?: Instant.EPOCH
        val reason = p[K.LOCK_REASON]
            ?: if (p[K.OFFLINE_ONLY] != null) "Signed in without internet. Connect and sign in to send your records." else null
            ?: if (Instant.now().isAfter(until)) "You have worked offline for a long time. Connect and sign in to send your records." else null
        return SessionState.Active(user, until, reason)
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
            it.remove(K.OFFLINE_ONLY)
        }
    }

    /**
     * After a successful online sign-in, remembers a salted, slow hash of the password under each name the person can
     * sign in with, so they can sign in again on this device without internet. The password itself is never stored.
     */
    suspend fun rememberForOffline(typedName: String, password: String, user: UserDto) {
        val salt = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
        val entry = OfflineVerifier(user, b64(salt), b64(OfflinePasswords.hash(password, salt, OfflinePasswords.ITERATIONS)), OfflinePasswords.ITERATIONS)
        store.edit { p ->
            val all = verifiers(p).toMutableMap()
            // Another person's old entries under the same names are replaced.
            listOfNotNull(typedName, user.username, user.email, user.phone).map(::normalize).filter { it.isNotEmpty() }.forEach { all[it] = entry }
            p[K.VERIFIERS] = TmsJson.encodeToString(VERIFIER_MAP, all)
        }
    }

    /** Whether [typedName] has signed in online on this device before (so an offline sign-in is possible). */
    suspend fun knowsOffline(typedName: String) = verifiers(store.data.first()).containsKey(normalize(typedName))

    /**
     * Signs in without internet when the name and password match the last online sign-in on this device. Records made
     * are kept on the device and sent after the next online sign-in. Returns the user, or null when they don't match.
     */
    suspend fun signInOffline(typedName: String, password: String): UserDto? {
        val v = verifiers(store.data.first())[normalize(typedName)] ?: return null
        val expected = java.util.Base64.getDecoder().decode(v.hash)
        val actual = OfflinePasswords.hash(password, java.util.Base64.getDecoder().decode(v.salt), v.iterations)
        if (!java.security.MessageDigest.isEqual(expected, actual)) return null
        store.edit {
            val sameUser = it[K.USER]?.let { u -> TmsJson.decodeFromString(UserDto.serializer(), u).id } == v.user.id
            // Another person's tokens must not be used to send this person's records.
            if (!sameUser) { it.remove(K.ACCESS); it.remove(K.REFRESH) }
            it[K.USER] = TmsJson.encodeToString(UserDto.serializer(), v.user)
            it[K.OFFLINE_UNTIL] = Instant.now().plus(java.time.Duration.ofDays(OFFLINE_SIGN_IN_DAYS)).toString()
            if (!sameUser || it[K.REFRESH] == null) it[K.OFFLINE_ONLY] = "1"
        }
        return v.user
    }

    private fun verifiers(p: Preferences): Map<String, OfflineVerifier> =
        p[K.VERIFIERS]?.let { runCatching { TmsJson.decodeFromString(VERIFIER_MAP, it) }.getOrNull() }.orEmpty()

    private fun normalize(name: String) = name.trim().lowercase()
    private fun b64(bytes: ByteArray) = java.util.Base64.getEncoder().encodeToString(bytes)

    /**
     * The server ended the session (revoked, deactivated, expired, or the sign-in went stale). Field work carries on;
     * records wait on the device until the person signs in online again.
     */
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
            it.remove(K.OFFLINE_ONLY)
        }
    }

    suspend fun accessToken(): String? = store.data.first()[K.ACCESS]?.let(cipher::decrypt)
    suspend fun refreshToken(): String? = store.data.first()[K.REFRESH]?.let(cipher::decrypt)
    suspend fun userId(): String? = (current() as? SessionState.Active)?.user?.id

    private companion object {
        const val OFFLINE_SIGN_IN_DAYS = 30L
        val VERIFIER_MAP = kotlinx.serialization.builtins.MapSerializer(String.serializer(), OfflineVerifier.serializer())
    }

    // OkHttp interceptors run on background threads and need synchronous access.
    fun accessTokenBlocking(): String? = runBlocking { accessToken() }
}

@kotlinx.serialization.Serializable
internal data class OfflineVerifier(val user: UserDto, val salt: String, val hash: String, val iterations: Int)

/** PBKDF2 password hashing for offline sign-in: slow on purpose, so a lost tablet doesn't give passwords away easily. */
internal object OfflinePasswords {
    const val ITERATIONS = 120_000

    fun hash(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = javax.crypto.spec.PBEKeySpec(password.toCharArray(), salt, iterations, 256)
        return try {
            javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }
}
