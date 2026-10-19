package com.teasoo.tms.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit
import kotlin.random.Random

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val engine: SyncEngine,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = when (engine.run()) {
        SyncOutcome.Success -> Result.success()
        is SyncOutcome.Retry -> Result.retry()
        is SyncOutcome.Blocked -> Result.failure()
    }
}

/** Persistent, retryable background sync. Survives app closure and reboot (WorkManager). */
object SyncScheduler {
    private const val PERIODIC = "tms-sync-periodic"
    private const val NOW = "tms-sync-now"
    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES)
            .setConstraints(constraints)
            // Jitter keeps a fleet of devices from syncing in lock-step.
            .setInitialDelay(Random.nextLong(0, 300), TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Runs as soon as there is connectivity; called after each save and from "Sync now". */
    fun syncNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun isRunning(context: Context) =
        WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(NOW)
}
