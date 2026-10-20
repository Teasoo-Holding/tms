package com.teasoo.tms

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.teasoo.tms.data.local.*
import com.teasoo.tms.data.remote.OperationResultDto
import com.teasoo.tms.data.remote.TmsApi
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.repo.*
import com.teasoo.tms.data.session.SessionStore
import com.teasoo.tms.sync.SyncEngine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.lang.reflect.Proxy
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
class LocalStoreTest {
    private lateinit var context: Context
    private lateinit var db: TmsDatabase
    private lateinit var trees: TreeRepository
    private lateinit var engine: SyncEngine
    private val user = "u-1"
    private val area = AreaSelection("p1", "y2024", "s1", "ss1", null)

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, TmsDatabase::class.java).allowMainThreadQueries().build()
        trees = TreeRepository(db)
        // The engine's network collaborators are not exercised by these tests.
        val api = Proxy.newProxyInstance(TmsApi::class.java.classLoader, arrayOf(TmsApi::class.java)) { _, _, _ -> error("no network in tests") } as TmsApi
        engine = SyncEngine(db, api, SessionStore(context), ReferenceRepository(db), OkHttpClient())
        val r = db.reference()
        r.upsertProjects(listOf(ProjectEntity("p1", "Trees for Life", "T4L", "ACTIVE", "PROJECT", null)))
        r.upsertYears(listOf(PlantingYearEntity("y2024", "p1", "2024", true), PlantingYearEntity("y2025", "p1", "2025", true)))
        r.upsertSchemes(
            listOf(
                IdSchemeEntity("sch1", "p1", 1, """[{"type":"PROJECT_CODE","required":true},{"type":"PLANTING_YEAR","required":true},{"type":"SERIAL","required":true}]""",
                    "-", 6, """["PROJECT","PLANTING_YEAR"]""", true),
            ),
        )
        r.upsertSectors(listOf(SectorEntity("s1", "p1", "North", "S01", 7.4, 3.9, null, true)))
        r.upsertSubSectors(listOf(SubSectorEntity("ss1", "s1", "p1", "East", "SS01", 7.4, 3.9, null, true)))
        r.upsertSpecies(listOf(SpeciesEntity("sp1", "Khaya senegalensis", "Mahogany", true)))
        r.upsertStatuses(
            listOf(
                StatusEntity("st-planted", "PLANTED", "Planted", false, false, false, 10, true),
                StatusEntity("st-healthy", "HEALTHY", "Healthy", false, false, false, 20, true),
                StatusEntity("st-dead", "DEAD", "Dead", true, true, true, 50, true),
            ),
        )
    }

    @After fun tearDown() = db.close()

    private fun newTree(serial: String, photos: List<CapturedPhoto> = emptyList(), replaces: String? = null, a: AreaSelection = area) = NewTree(
        area = a, speciesId = "sp1", serialInput = serial,
        confirmedPhysicalId = "T4L-${if (a.plantingYearId == "y2025") "2025" else "2024"}-${serial.padStart(6, '0')}",
        statusId = "st-planted", observedAt = Instant.parse("2026-01-01T10:00:00Z"), plantedOn = "2026-01-01", notes = null, remarks = null,
        photos = photos, replacesTreeId = replaces,
    )

    private fun photo(): CapturedPhoto {
        val f = File.createTempFile("photo", ".jpg").apply { writeBytes(ByteArray(10) { it.toByte() }) }
        return CapturedPhoto("m-${f.name}", f, "a".repeat(64), f.length())
    }

    @Test
    fun registrationWritesTreeObservationPhotoAndOutboxTogether() = runBlocking {
        val id = trees.register(newTree("1", listOf(photo())), user)
        val tree = db.trees().get(id)!!
        assertEquals("T4L-2024-000001", tree.physicalTreeId)
        assertEquals(SyncState.PENDING, tree.syncState)
        assertEquals(1, db.observations().forTree(id).first().size)
        assertEquals(1, db.media().forTree(id).first().size)
        val ops = db.outbox().due(Long.MAX_VALUE, 10)
        assertEquals(1, ops.size)
        val payload = TmsJson.parseToJsonElement(ops[0].payloadJson).jsonObject
        assertEquals("T4L-2024-000001", payload["physical_tree_id"]!!.jsonPrimitive.content)
        assertNull("no tree GPS is captured", payload["latitude"])
    }

    @Test
    fun detectsLocalDuplicatesAndBadSerials() = runBlocking {
        trees.register(newTree("7"), user)
        val info = trees.prefix(area)
        assertEquals("T4L-2024-", info.prefix)
        assertTrue(trees.checkSerial(area, info, "0007", user) is SerialCheck.LocalDuplicate)
        assertTrue(trees.checkSerial(area, info, "12a", user) is SerialCheck.Invalid)
        assertTrue(trees.checkSerial(area, info, "8", user) is SerialCheck.Ok)
        val e = runCatching { trees.register(newTree("7"), user) }.exceptionOrNull()
        assertTrue(e is RegistrationException)
    }

    @Test
    fun suggestsNextSerialInScopeAndAllocation() = runBlocking {
        assertEquals(1L, trees.suggestNextSerial(area, user))
        trees.register(newTree("41"), user)
        trees.register(newTree("7"), user)
        // Numeric, not text, maximum: "41" > "7".
        assertEquals(42L, trees.suggestNextSerial(area, user))
        // Another planting year is a separate serial scope.
        assertEquals(1L, trees.suggestNextSerial(area.copy(plantingYearId = "y2025"), user))
        // With an allocation, the suggestion jumps into the officer's range.
        db.reference().upsertAllocations(listOf(SerialAllocationEntity("a1", "p1", "PLANTING_YEAR=y2024|PROJECT=p1", user, 100, 199, true)))
        assertEquals(100L, trees.suggestNextSerial(area, user))
    }

    @Test
    fun visitListFindsSerialsIgnoringLeadingZeros() = runBlocking {
        trees.register(newTree("5"), user)
        trees.register(newTree("6"), user)
        val all = db.trees().visitList("p1", "y2024", "s1", "ss1", "").first()
        assertEquals(2, all.size)
        val hit = db.trees().visitList("p1", "y2024", "s1", null, "0005").first()
        assertEquals(listOf("T4L-2024-000005"), hit.map { it.physicalTreeId })
        assertTrue(db.trees().visitList("p1", "y2025", "s1", null, "").first().isEmpty())
    }

    @Test
    fun enforcesAllocatedSerialRanges() = runBlocking {
        db.reference().upsertAllocations(listOf(SerialAllocationEntity("a1", "p1", "PLANTING_YEAR=y2024|PROJECT=p1", user, 100, 199, true)))
        val info = trees.prefix(area)
        assertTrue(trees.checkSerial(area, info, "99", user) is SerialCheck.NotAllocated)
        assertTrue(trees.checkSerial(area, info, "150", user) is SerialCheck.Ok)
    }

    @Test
    fun replacementRequiresReplaceableStatusAndHappensOnce() = runBlocking {
        val original = trees.register(newTree("20"), user)
        val y25 = area.copy(plantingYearId = "y2025")
        assertTrue(runCatching { trees.register(newTree("1", replaces = original, a = y25), user) }.exceptionOrNull() is RegistrationException)
        trees.addObservation(original, "st-dead", Instant.parse("2026-02-01T10:00:00Z"), null, listOf(photo()), user)
        assertEquals("st-dead", db.trees().get(original)!!.currentStatusId)
        val replacement = trees.register(newTree("1", replaces = original, a = y25), user)
        assertEquals(original, db.trees().get(replacement)!!.replacesTreeId)
        assertEquals("T4L-2024-000020", db.trees().get(original)!!.physicalTreeId)
        assertTrue(runCatching { trees.register(newTree("2", replaces = original, a = y25), user) }.exceptionOrNull() is RegistrationException)
    }

    @Test
    fun amendmentSupersedesWithoutDeleting() = runBlocking {
        val id = trees.register(newTree("30"), user)
        val obs = trees.addObservation(id, "st-healthy", Instant.parse("2026-03-01T10:00:00Z"), null, emptyList(), user)
        trees.addObservation(id, "st-planted", Instant.parse("2026-03-01T10:00:00Z"), null, emptyList(), user, amendsObservationId = obs, amendmentReason = "Wrong status")
        assertEquals(3, db.observations().forTree(id).first().size)
        assertEquals("st-planted", db.trees().get(id)!!.currentStatusId)
    }

    @Test
    fun unsentEditsAreCoalescedIntoOneOperation() = runBlocking {
        val id = trees.register(newTree("40"), user)
        trees.updateTree(id, null, "2026-01-02", "first")
        trees.updateTree(id, null, "2026-01-03", "second")
        val updates = db.outbox().due(Long.MAX_VALUE, 10).filter { it.operationType == "update" }
        assertEquals(1, updates.size)
        assertEquals(1, updates[0].baseRevision)
        val changes = TmsJson.parseToJsonElement(updates[0].payloadJson).jsonObject["changes"]!!.jsonObject
        assertEquals("second", changes["notes"]!!.jsonPrimitive.content)
    }

    @Test
    fun syncResultsUpdateLocalStateItemByItem() = runBlocking {
        val accepted = trees.register(newTree("50"), user)
        val conflicted = trees.register(newTree("51"), user)
        val rejected = trees.register(newTree("52"), user)
        val ops = db.outbox().due(Long.MAX_VALUE, 10).associateBy { it.entityId }
        engine.applyResult(ops[accepted]!!, OperationResultDto(ops[accepted]!!.operationId, "ACCEPTED", entity = buildJsonObject { put("revision", 1); put("record_state", "ACTIVE") }))
        engine.applyResult(ops[conflicted]!!, OperationResultDto(ops[conflicted]!!.operationId, "CONFLICT", "DUPLICATE_PHYSICAL_ID", "Already registered", buildJsonObject { put("revision", 1) }))
        engine.applyResult(ops[rejected]!!, OperationResultDto(ops[rejected]!!.operationId, "REJECTED", "AREA_NOT_ASSIGNED", "Not assigned"))

        assertEquals(SyncState.SYNCED, db.trees().get(accepted)!!.syncState)
        assertEquals(1, db.trees().get(accepted)!!.serverRevision)
        assertEquals(SyncState.SYNCED, db.observations().forTree(accepted).first().single().syncState)
        assertEquals("CONFLICT", db.trees().get(conflicted)!!.recordState)
        assertEquals(SyncState.REJECTED, db.trees().get(rejected)!!.syncState)
        val remaining = db.outbox().all().first()
        assertEquals(setOf(OutboxState.CONFLICT, OutboxState.REJECTED), remaining.map { it.state }.toSet())
        assertTrue("conflicted and rejected records are kept", db.trees().get(conflicted) != null && db.trees().get(rejected) != null)
    }

    @Test
    fun replayedOperationUsesItsOriginalOutcome() = runBlocking {
        val id = trees.register(newTree("60"), user)
        val op = db.outbox().due(Long.MAX_VALUE, 10).single()
        engine.applyResult(op, OperationResultDto(op.operationId, "ALREADY_PROCESSED", "DUPLICATE_PHYSICAL_ID", "dup", originalStatus = "CONFLICT"))
        assertEquals(SyncState.CONFLICT, db.trees().get(id)!!.syncState)
    }

    @Test
    fun photosAreOffloadedOnlyAfterVerifiedAcknowledgement() = runBlocking {
        val p = photo()
        val id = trees.register(newTree("70", listOf(p)), user)
        val media = db.media().forTree(id).first().single()

        // Unsynced: never purged.
        engine.cleanupMedia()
        assertTrue(p.file.exists())

        // Verified but the tree operation is still pending: kept.
        db.media().upsert(media.copy(state = MediaState.VERIFIED, serverChecksum = media.checksumSha256, serverByteSize = media.byteSize,
            remoteVerifiedAt = "t", associationVerifiedAt = "t", ackPersistedAt = "t"))
        engine.cleanupMedia()
        assertTrue(p.file.exists())

        // Operation accepted: now every condition holds.
        val op = db.outbox().due(Long.MAX_VALUE, 10).single()
        engine.applyResult(op, OperationResultDto(op.operationId, "ACCEPTED", entity = buildJsonObject { put("revision", 1) }))
        engine.cleanupMedia()
        assertFalse(p.file.exists())
        assertNull(db.media().get(media.id)!!.localPath)
    }

    @Test
    fun verificationWithoutPersistedAckIsNotDeleted() = runBlocking {
        val p = photo()
        val id = trees.register(newTree("80", listOf(p)), user)
        val op = db.outbox().due(Long.MAX_VALUE, 10).single()
        engine.applyResult(op, OperationResultDto(op.operationId, "ACCEPTED", entity = buildJsonObject { put("revision", 1) }))
        val media = db.media().forTree(id).first().single()
        db.media().upsert(media.copy(state = MediaState.VERIFIED, serverChecksum = media.checksumSha256, serverByteSize = media.byteSize,
            remoteVerifiedAt = "t", associationVerifiedAt = "t", ackPersistedAt = null))
        engine.cleanupMedia()
        assertTrue(p.file.exists())
    }
}
