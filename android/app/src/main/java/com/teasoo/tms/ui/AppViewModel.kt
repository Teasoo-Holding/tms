package com.teasoo.tms.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.local.KeyValueEntity
import com.teasoo.tms.data.local.Keys
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.ApiFailure
import com.teasoo.tms.data.remote.LoginRequest
import com.teasoo.tms.data.remote.RefreshRequest
import com.teasoo.tms.data.remote.TmsApi
import com.teasoo.tms.data.remote.toApiFailure
import com.teasoo.tms.data.repo.PhotoStore
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.sync.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SyncSummary(
    val pendingOperations: Int = 0,
    val needsAttention: Int = 0,
    val unsentPhotos: Int = 0,
    val failedPhotos: Int = 0,
    val oldestPending: String? = null,
    val lastSuccess: String? = null,
    val lastError: String? = null,
    val running: Boolean = false,
    val lowStorage: Boolean = false,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AppViewModel @Inject constructor(
    private val app: Application,
    private val session: SessionStore,
    private val api: TmsApi,
    private val db: TmsDatabase,
    private val photos: PhotoStore,
    private val fieldSessions: com.teasoo.tms.data.repo.FieldSessionRepository,
    private val updates: com.teasoo.tms.data.repo.UpdateChecker,
) : AndroidViewModel(app) {
    /** A newer app version, when one is published (checked once per app start, when online). */
    val update = MutableStateFlow<com.teasoo.tms.data.repo.AppUpdate?>(null)
    /** Download progress (0..1) while an update is being fetched; null otherwise. */
    val updateProgress = MutableStateFlow<Float?>(null)
    val updateMessage = MutableStateFlow<String?>(null)

    /**
     * Downloads the new version and opens Android's install screen. Apps installed outside Google Play need the
     * person's one-time permission to install updates, and Android always asks them to confirm; records stay on the device.
     */
    fun installUpdate() {
        val u = update.value ?: return
        if (updateProgress.value != null) return
        val pm = app.packageManager
        if (!pm.canRequestPackageInstalls()) {
            updateMessage.value = "Allow TMS Field to install updates (turn on “Allow from this source”), then tap Update now again."
            app.startActivity(
                android.content.Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${app.packageName}"))
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        updateMessage.value = null
        updateProgress.value = 0f
        viewModelScope.launch {
            try {
                val file = updates.download(u, java.io.File(app.cacheDir, "updates")) { updateProgress.value = it }
                val uri = androidx.core.content.FileProvider.getUriForFile(app, "${app.packageName}.updates", file)
                app.startActivity(
                    android.content.Intent(android.content.Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (e: Throwable) {
                updateMessage.value = "The update could not be downloaded. Check the connection and try again."
            } finally {
                updateProgress.value = null
            }
        }
    }

    val sessionState = session.state.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val projects = db.reference().projects().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val selectedProjectId: StateFlow<String?> = db.kv().observe(Keys.SELECTED_PROJECT)
        .combine(projects) { saved, list -> saved?.takeIf { id -> list.any { it.id == id } } ?: list.firstOrNull()?.id }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    init {
        // Records saved before records carried their author belong to the person who used the device last.
        viewModelScope.launch { db.kv().get(Keys.LAST_USER)?.let { db.outbox().claimUnowned(it) } }
        viewModelScope.launch { update.value = updates.check() }
    }

    // The signed-in person's own unsent records (other people's wait for them on a shared tablet).
    private val myPending: Flow<Int> = session.state.flatMapLatest { st ->
        (st as? com.teasoo.tms.data.session.SessionState.Active)?.user?.id?.let { db.outbox().pendingCountFor(it) } ?: db.outbox().pendingCount()
    }

    private val running = SyncScheduler.isRunning(app).map { infos -> infos.any { !it.state.isFinished } }

    val sync: StateFlow<SyncSummary> = combine(
        listOf(
            myPending,
            db.outbox().attentionCount(), db.media().pendingCount(), db.media().failedCount(),
            db.outbox().oldestPending(), db.kv().observe(Keys.LAST_SUCCESSFUL_SYNC), db.kv().observe(Keys.LAST_SYNC_ERROR), running,
        ),
    ) { v ->
        SyncSummary(
            pendingOperations = v[0] as Int, needsAttention = v[1] as Int, unsentPhotos = v[2] as Int, failedPhotos = v[3] as Int,
            oldestPending = v[4] as String?, lastSuccess = v[5] as String?, lastError = v[6] as String?, running = v[7] as Boolean,
            lowStorage = photos.freeBytes() < PhotoStore.LOW_STORAGE_BYTES,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, SyncSummary())

    val treeCount = selectedProjectId.flatMapLatest { id -> if (id == null) flowOf(0) else db.trees().count(id) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    fun selectProject(id: String) = viewModelScope.launch { db.kv().put(KeyValueEntity(Keys.SELECTED_PROJECT, id)) }

    fun syncNow() {
        viewModelScope.launch { db.outbox().retryAllNow() }
        SyncScheduler.syncNow(app)
    }

    // ---------------------------------------------------------------- sign-in
    private val _loginError = MutableStateFlow<String?>(null)
    val loginError = _loginError.asStateFlow()
    private val _loggingIn = MutableStateFlow(false)
    val loggingIn = _loggingIn.asStateFlow()

    /** [allowOffline]: fall back to this device's offline check when there is no internet (not when sending records). */
    fun login(email: String, password: String, allowOffline: Boolean = true) = viewModelScope.launch {
        _loggingIn.value = true
        _loginError.value = null
        val previous = db.kv().get(Keys.LAST_USER)
        // A field session belongs to the person who started it: another account (e.g. switching from an
        // officer to an administrator) starts with none. Each person's records are sent under their own account.
        suspend fun signedIn(userId: String) {
            if (previous != userId) fieldSessions.end()
            db.kv().put(KeyValueEntity(Keys.LAST_USER, userId))
            SyncScheduler.syncNow(app)
        }
        try {
            val tokens = api.login(LoginRequest(email.trim(), password, session.deviceId(), "${Build.MANUFACTURER} ${Build.MODEL}", BuildConfig.VERSION_NAME))
            session.save(tokens)
            session.rememberForOffline(email, password, tokens.user)
            signedIn(tokens.user.id)
        } catch (e: Throwable) {
            val failure = e.toApiFailure()
            // No internet (or the server is unreachable): anyone who has signed in on this device before can carry on.
            if (!allowOffline && (failure is ApiFailure.Offline || (failure is ApiFailure.Server && failure.status >= 500))) {
                _loginError.value = "No internet yet. Your records stay saved; try again when you are connected."
            } else if (failure is ApiFailure.Offline || (failure is ApiFailure.Server && failure.status >= 500)) {
                val user = session.signInOffline(email, password)
                when {
                    user != null -> signedIn(user.id)
                    session.knowsOffline(email) -> _loginError.value = "Wrong password. (No internet: checked against this device's last sign-in.)"
                    else -> _loginError.value = "No internet. The first sign-in on a device needs internet; after that you can sign in offline."
                }
            } else {
                _loginError.value = failure.message
            }
        } finally {
            _loggingIn.value = false
        }
    }

    /** Signing out keeps records on the device; unsynced work is sent after the next sign-in. */
    fun signOut() = viewModelScope.launch {
        session.refreshToken()?.let { token -> runCatching { api.logout(RefreshRequest(token)) } }
        session.signOut()
    }
}
