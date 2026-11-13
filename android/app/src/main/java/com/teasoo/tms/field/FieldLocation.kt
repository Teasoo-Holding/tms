package com.teasoo.tms.field

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A GPS fix: where, how sure, and when. */
data class Fix(val latitude: Double, val longitude: Double, val accuracyMeters: Float?, val time: Long, val bearing: Float?)

/**
 * The phone's live GPS position, shared by the field map and the trail service. Uses the phone's own GPS receiver
 * (LocationManager), which needs no internet or mobile signal and no Google services.
 */
object FieldLocation {
    private val _fix = MutableStateFlow<Fix?>(null)
    val fix: StateFlow<Fix?> = _fix.asStateFlow()
    private var listeners = 0
    private var manager: LocationManager? = null
    private val listener = LocationListener { publish(it) }

    fun publish(l: Location) {
        _fix.value = Fix(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else null, l.time, if (l.hasBearing()) l.bearing else null)
    }

    /** Starts GPS updates (counted, so the map and the service can both hold them). Location permission is checked by the caller. */
    @SuppressLint("MissingPermission")
    fun start(context: Context) {
        val lm = context.getSystemService(LocationManager::class.java) ?: return
        manager = lm
        if (listeners++ > 0) return
        runCatching {
            lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.takeIf { System.currentTimeMillis() - it.time < 120_000 }?.let(::publish)
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2_000L, 0f, listener, Looper.getMainLooper())
        }
        // The network provider helps only where there is signal; harmless offline.
        runCatching { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10_000L, 0f, listener, Looper.getMainLooper()) }
    }

    fun stop() {
        if (listeners == 0) return
        if (--listeners == 0) runCatching { manager?.removeUpdates(listener) }
    }

    fun gpsEnabled(context: Context): Boolean =
        context.getSystemService(LocationManager::class.java)?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
}
