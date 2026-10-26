package com.teasoo.tms.data.repo

import com.teasoo.tms.data.local.KeyValueEntity
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.TmsJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The context an officer works in for a day in the field: one project, one planting year and one
 * sector, chosen once. The sub-sector changes as they walk. Choices that repeat from tree to tree
 * (species, status, planted-on date) are remembered here too, so each new record only needs the
 * label's serial number.
 */
@Serializable
data class FieldSession(
    val projectId: String,
    val plantingYearId: String,
    val sectorId: String,
    val subSectorId: String,
    val vendorId: String? = null,
    val startedAt: String = Instant.now().toString(),
    val speciesId: String? = null,
    val statusId: String? = null,
    val plantedOn: String? = null,
    /** Last values of "remember during a session" custom fields, e.g. the nursery batch number. */
    val stickyValues: Map<String, String> = emptyMap(),
    /** The kind of collection this outing is for; "VISIT" unless chosen otherwise. */
    val visitType: String = "VISIT",
) {
    fun area() = AreaSelection(projectId, plantingYearId, sectorId, subSectorId, vendorId)
}

@Singleton
class FieldSessionRepository @Inject constructor(private val db: TmsDatabase) {
    val session: Flow<FieldSession?> = db.kv().observe(KEY).map { json ->
        json?.let { runCatching { TmsJson.decodeFromString(FieldSession.serializer(), it) }.getOrNull() }
    }

    suspend fun current(): FieldSession? =
        db.kv().get(KEY)?.let { runCatching { TmsJson.decodeFromString(FieldSession.serializer(), it) }.getOrNull() }

    suspend fun start(session: FieldSession) = save(session)

    suspend fun update(change: (FieldSession) -> FieldSession) {
        current()?.let { save(change(it)) }
    }

    suspend fun end() = db.kv().remove(KEY)

    /** Length of the measuring stick last used for photo height measurement (default 1 m). */
    suspend fun referenceCm(): Double = db.kv().get(REFERENCE_KEY)?.toDoubleOrNull() ?: 100.0
    suspend fun setReferenceCm(cm: Double) = db.kv().put(KeyValueEntity(REFERENCE_KEY, cm.toString()))

    /** The unit this officer types tree heights in (cm unless they changed it); heights are always stored in cm. */
    suspend fun heightUnit(): String = db.kv().get(HEIGHT_UNIT_KEY) ?: "cm"
    suspend fun setHeightUnit(unit: String) = db.kv().put(KeyValueEntity(HEIGHT_UNIT_KEY, unit))

    private suspend fun save(session: FieldSession) =
        db.kv().put(KeyValueEntity(KEY, TmsJson.encodeToString(FieldSession.serializer(), session)))

    private companion object {
        const val KEY = "field.session"
        const val REFERENCE_KEY = "height.reference_cm"
        const val HEIGHT_UNIT_KEY = "height.unit"
    }
}
