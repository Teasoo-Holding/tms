package com.teasoo.tms.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.local.KeyValueEntity
import com.teasoo.tms.data.local.Keys
import com.teasoo.tms.data.local.TmsDatabase
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
) : AndroidViewModel(app) {
    val sessionState = session.state.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val projects = db.reference().projects().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val selectedProjectId: StateFlow<String?> = db.kv().observe(Keys.SELECTED_PROJECT)
        .combine(projects) { saved, list -> saved?.takeIf { id -> list.any { it.id == id } } ?: list.firstOrNull()?.id }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val running = SyncScheduler.isRunning(app).map { infos -> infos.any { !it.state.isFinished } }

    val sync: StateFlow<SyncSummary> = combine(
        listOf(
            db.outbox().pendingCount(), db.outbox().attentionCount(), db.media().pendingCount(), db.media().failedCount(),
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

    fun login(email: String, password: String) = viewModelScope.launch {
        _loggingIn.value = true
        _loginError.value = null
        try {
            val previous = db.kv().get(Keys.LAST_USER)
            val tokens = api.login(LoginRequest(email.trim(), password, session.deviceId(), "${Build.MANUFACTURER} ${Build.MODEL}", BuildConfig.VERSION_NAME))
            // A different officer on a shared device: unsent work of the previous officer must sync first.
            if (previous != null && previous != tokens.user.id && db.outbox().pendingCount().first() > 0) {
                _loginError.value = "This device still holds unsynced records from another officer. They must sign in and sync first."
                runCatching { api.logout(RefreshRequest(tokens.refreshToken)) }
                return@launch
            }
            session.save(tokens)
            db.kv().put(KeyValueEntity(Keys.LAST_USER, tokens.user.id))
            SyncScheduler.syncNow(app)
        } catch (e: Throwable) {
            _loginError.value = e.toApiFailure().message
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
