package com.teasoo.tms.field

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.teasoo.tms.MainActivity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.local.TrackPointEntity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Records the officer's trail while they work (#128), also with the screen off: a position is saved when it is fairly
 * accurate and at least a few metres from the last one. Everything stays on the phone and works without internet.
 */
@AndroidEntryPoint
class TrailService : Service() {
    @Inject lateinit var db: TmsDatabase
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        ensureChannel(this)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, TrailService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Recording your trail")
            .setContentText("TMS Field is saving your path so you can find your way back.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .build()
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )
        if (!running) {
            running = true
            FieldLocation.start(this)
            scope.launch {
                FieldLocation.fix.filterNotNull().collect { f ->
                    if ((f.accuracyMeters ?: 0f) > MAX_ACCURACY_M) return@collect
                    val last = db.track().last()
                    val far = last == null || Geo.distanceMeters(last.latitude, last.longitude, f.latitude, f.longitude) >= MIN_STEP_M
                    if (far) db.track().insert(TrackPointEntity(kind = "TRACK", latitude = f.latitude, longitude = f.longitude, accuracyMeters = f.accuracyMeters, recordedAt = f.time))
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        FieldLocation.stop()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "trail"
        private const val NOTIFICATION_ID = 4711
        private const val ACTION_STOP = "stop"
        /** Positions worse than this are not added to the trail. */
        const val MAX_ACCURACY_M = 35f
        /** A new trail point at least this far from the last one. */
        const val MIN_STEP_M = 5.0
        @Volatile var running = false
            private set

        fun start(context: Context) {
            context.startForegroundService(Intent(context, TrailService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TrailService::class.java))
        }

        private fun ensureChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Trail recording", NotificationManager.IMPORTANCE_LOW))
            }
        }
    }
}
