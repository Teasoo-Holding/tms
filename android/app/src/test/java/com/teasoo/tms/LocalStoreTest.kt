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
import com.teasoo.tms.data.remote.ChangeDto
import com.teasoo.tms.data.remote.ChangesResponse
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
        engine.retentionDays = 0 // offloading rules are tested directly; retention has its own test
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

    private fun newTree(serial: String, photos: List<CapturedPhoto> = listOf(photo()), replaces: String? = null, a: AreaSelection = area) = NewTree(
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
    fun customFieldsAndHeightAreSavedAndQueuedForSync() = runBlocking {
        val id = trees.register(
            newTree("88").copy(
                treeFields = mapOf("nursery_batch_no" to kotlinx.serialization.json.JsonPrimitive("B-17")),
                observationFields = mapOf("pests" to kotlinx.serialization.json.JsonPrimitive("None")),
                height = HeightReading(42.5, "PHOTO_REFERENCE", """{"reference_cm":100,"points":{}}"""),
            ),
            user,
        )
        assertEquals("""{"nursery_batch_no":"B-17"}""", db.trees().get(id)!!.customFieldsJson)
        val obs = db.observations().forTree(id).first().single()
        assertEquals(42.5, obs.heightCm!!, 0.0)
        val payload = TmsJson.parseToJsonElement(db.outbox().due(Long.MAX_VALUE, 10).single().payloadJson).jsonObject
        assertEquals("B-17", payload["custom_fields"]!!.jsonObject["nursery_batch_no"]!!.jsonPrimitive.content)
        val initial = payload["initial_observation"]!!.jsonObject
        assertEquals("PHOTO_REFERENCE", initial["height_method"]!!.jsonPrimitive.content)
        assertEquals(100, initial["height_measurement"]!!.jsonObject["reference_cm"]!!.jsonPrimitive.int)
        assertEquals("None", initial["custom_fields"]!!.jsonObject["pests"]!!.jsonPrimitive.content)

        trees.addObservation(id, "st-healthy", Instant.parse("2026-03-01T10:00:00Z"), null, listOf(photo()), user, height = HeightReading(80.0, "MANUAL"))
        val op = db.outbox().due(Long.MAX_VALUE, 10).last()
        assertEquals(80.0, TmsJson.parseToJsonElement(op.payloadJson).jsonObject["height_cm"]!!.jsonPrimitive.double, 0.0)
    }

    @Test
    fun heightFromPhotoScalesTheTreeByTheStick() {
        // A 1 m stick spanning 20% of a 1000 px tall photo; the tree spans 50%.
        val m = com.teasoo.tms.ui.components.HeightMeasurement(
            referenceCm = 100.0,
            points = mapOf(
                "ref_top" to androidx.compose.ui.geometry.Offset(0.2f, 0.6f), "ref_bottom" to androidx.compose.ui.geometry.Offset(0.2f, 0.8f),
                "tree_top" to androidx.compose.ui.geometry.Offset(0.5f, 0.3f), "tree_base" to androidx.compose.ui.geometry.Offset(0.5f, 0.8f),
            ),
            mediaId = "m", imageWidth = 750, imageHeight = 1000,
        )
        assertEquals(250.0, m.heightCm()!!, 0.5)
        val round = com.teasoo.tms.ui.components.HeightMeasurement.parse(m.toJson())!!
        assertEquals(250.0, round.heightCm()!!, 0.5)
        assertNull(m.copy(points = m.points - "tree_base").heightCm())
    }

    @Test
    fun verifiedPhotosAreKeptForTheRetentionPeriodUnlessStorageIsLow() = runBlocking {
        val p = photo()
        val id = trees.register(newTree("77", listOf(p)), user)
        val m = db.media().forTree(id).first().single()
        db.media().upsert(
            m.copy(
                state = MediaState.VERIFIED, serverChecksum = m.checksumSha256, serverByteSize = m.byteSize,
                remoteVerifiedAt = "2026-01-01T00:00:00Z", associationVerifiedAt = "2026-01-01T00:00:00Z", ackPersistedAt = "2026-01-01T00:00:00Z",
                capturedAt = Instant.now().toString(),
            ),
        )
        db.outbox().due(Long.MAX_VALUE, 100).forEach { db.outbox().delete(it.operationId) }
        engine.retentionDays = 30
        engine.freeBytes = { Long.MAX_VALUE }
        engine.cleanupMedia()
        assertTrue("kept as a second copy for 30 days", p.file.exists())
        engine.freeBytes = { 0L }
        engine.cleanupMedia()
        assertFalse("offloaded early when the phone runs out of space", p.file.exists())
    }

    @Test
    fun everyVisitNeedsAPhotoExceptCorrections() = runBlocking {
        assertTrue(runCatching { trees.register(newTree("501", photos = emptyList()), user) }.exceptionOrNull() is RegistrationException)
        val id = trees.register(newTree("502"), user)
        assertTrue(runCatching { trees.addObservation(id, "st-healthy", Instant.now(), null, emptyList(), user) }.exceptionOrNull() is RegistrationException)
        val first = db.observations().forTree(id).first().single()
        trees.addObservation(id, "st-healthy", Instant.now(), null, emptyList(), user, amendsObservationId = first.id, amendmentReason = "typo")
        assertEquals(2, db.observations().forTree(id).first().size)
    }

    @Test
    fun myVisitsAreNewestFirstAndOnlyMine() = runBlocking {
        val a = trees.register(newTree("601"), user)
        Thread.sleep(5)
        trees.addObservation(a, "st-healthy", Instant.now(), "second", listOf(photo()), user)
        trees.register(newTree("602"), "someone-else")
        val mine = db.observations().mine(user, "1970-01-01T00:00:00Z").first()
        assertEquals(listOf("second", null), mine.map { it.remarks })
        assertTrue(mine.all { it.photoCount == 1 && it.syncState == SyncState.PENDING })
        assertTrue(mine.last().isInitial)
    }

    @Test
    fun aliveAndDeadShareIsCountedPerSubSector() = runBlocking {
        trees.register(newTree("701"), user)
        val dead = trees.register(newTree("702"), user)
        trees.addObservation(dead, "st-dead", Instant.now(), null, listOf(photo()), user)
        val share = db.trees().shareBySubSector("p1").first().single()
        assertEquals(2, share.total)
        assertEquals(1, share.alive)
        assertEquals(1, share.dead)
        assertEquals(0.5, share.deadShare!!, 0.0)
    }

    @Test
    fun warnsWhenATreeIsVisitedOutsideItsRegisteredSector() = runBlocking {
        db.reference().upsertSectors(listOf(SectorEntity("s2", "p1", "South", "S02", 7.3, 3.9, null, true)))
        val id = trees.register(newTree("801"), user)
        val tree = db.trees().get(id)!!
        val here = FieldSession("p1", "y2024", "s1", "ss1")
        assertNull(com.teasoo.tms.ui.screens.areaMismatch(db, tree, here))
        val elsewhere = here.copy(sectorId = "s2", subSectorId = "ss9")
        assertTrue(com.teasoo.tms.ui.screens.areaMismatch(db, tree, elsewhere)!!.contains("S01"))
        assertNull(com.teasoo.tms.ui.screens.areaMismatch(db, tree, null))
    }

    @Test
    fun backupHoldsUnsentOperationsAndPhotosWithoutChangingAnything() = runBlocking {
        val p = photo()
        trees.register(newTree("901", listOf(p)), user)
        val out = java.io.ByteArrayOutputStream()
        val summary = BackupExporter(db, SessionStore(context)).export(out)
        assertEquals(1, summary.operations)
        assertEquals(1, summary.photos)
        val names = mutableMapOf<String, ByteArray>()
        java.util.zip.ZipInputStream(out.toByteArray().inputStream()).use { zip ->
            while (true) { val e = zip.nextEntry ?: break; names[e.name] = zip.readBytes() }
        }
        assertTrue(names.keys.containsAll(listOf("manifest.json", "operations.json", "trees.json", "observations.json", "photos.json", "photos/${p.mediaId}.jpg")))
        val ops = TmsJson.parseToJsonElement(names["operations.json"]!!.decodeToString()).jsonArray
        assertEquals("tree", ops.single().jsonObject["entity_type"]!!.jsonPrimitive.content)
        assertEquals(1, db.outbox().pendingList().size)
        assertTrue(p.file.exists())
    }

    @Test
    fun theMostSpecificIdFormatAppliesForTheVendorAndYear() = runBlocking {
        val components = """[{"type":"PROJECT_CODE","required":true},{"type":"PLANTING_YEAR","required":true},{"type":"VENDOR_CODE","required":true},""" +
            """{"type":"TEXT","required":true,"value":"TR"},{"type":"SERIAL","required":true}]"""
        db.reference().upsertVendors(listOf(VendorEntity("v1", "Konam", "KNM", true)))
        db.reference().upsertSchemes(listOf(IdSchemeEntity("sch-knm", "p1", 2, components, "-", 5, """["PROJECT","PLANTING_YEAR","VENDOR"]""", true, vendorId = "v1")))
        val knm = area.copy(vendorId = "v1")
        assertEquals("T4L-2024-KNM-TR-", trees.prefix(knm).prefix)
        // Another vendor (or none) falls back to the project's default format.
        assertEquals("T4L-2024-", trees.prefix(area).prefix)
        val active = db.reference().activeSchemes("p1")
        assertEquals("sch-knm", resolveScheme(active, "y2024", "v1")!!.id)
        assertEquals("sch1", resolveScheme(active, "y2024", "v2")!!.id)
    }

    @Test
    fun sectorsAndVendorsFollowThePlantingYear() = runBlocking {
        val r = db.reference()
        r.upsertSectors(listOf(SectorEntity("s25", "p1", "North 2025", "S01", 7.4, 3.9, null, true, plantingYearId = "y2025")))
        r.upsertVendors(listOf(VendorEntity("v1", "Konam", "KNM", true), VendorEntity("v2", "Other", "OTH", true)))
        r.upsertYearVendors(listOf(PlantingYearVendorEntity("l1", "p1", "y2025", "v1", true)))
        assertEquals(listOf("s1", "s25"), r.sectorsForYear("p1", "y2025").first().map { it.id }) // s1 is not tied to a year
        assertEquals(listOf("s1"), r.sectorsForYear("p1", "y2024").first().map { it.id })
        assertEquals(listOf("v1"), r.vendorsForYear("y2025").first().map { it.id })
        assertTrue(r.vendorsForYear("y2024").first().isEmpty())
    }

    @Test
    fun visitTypeIsSavedAndSent() = runBlocking {
        val id = trees.register(newTree("1101").copy(visitType = "FIRST_INSTANCE"), user)
        assertEquals("FIRST_INSTANCE", db.observations().forTree(id).first().single().visitType)
        val initial = TmsJson.parseToJsonElement(db.outbox().due(Long.MAX_VALUE, 10).single().payloadJson).jsonObject["initial_observation"]!!.jsonObject
        assertEquals("FIRST_INSTANCE", initial["visit_type"]!!.jsonPrimitive.content)
        trees.addObservation(id, "st-healthy", Instant.now(), null, listOf(photo()), user)
        val op = db.outbox().due(Long.MAX_VALUE, 10).last()
        assertEquals("VISIT", TmsJson.parseToJsonElement(op.payloadJson).jsonObject["visit_type"]!!.jsonPrimitive.content)
    }

    @Test
    fun aReplantedTreeCanCarryAHandSetId() = runBlocking {
        val original = trees.register(newTree("1201"), user)
        trees.addObservation(original, "st-dead", Instant.now(), null, listOf(photo()), user)
        val replacement = newTree("1", replaces = original).copy(customPhysicalId = "REPL-0001", confirmedPhysicalId = "REPL-0001")
        val id = trees.register(replacement, user)
        assertEquals("REPL-0001", db.trees().get(id)!!.physicalTreeId)
        val payload = TmsJson.parseToJsonElement(db.outbox().due(Long.MAX_VALUE, 10).last().payloadJson).jsonObject
        assertEquals("REPL-0001", payload["custom_physical_id"]!!.jsonPrimitive.content)
        // Not for ordinary registrations, and not twice.
        assertTrue(runCatching { trees.register(newTree("1202").copy(customPhysicalId = "X-1", confirmedPhysicalId = "X-1"), user) }.exceptionOrNull() is RegistrationException)
    }

    @Test
    fun serverDeletionsRemoveConfigurationFromThePhone() = runBlocking {
        val tomb = ChangesResponse(
            changes = listOf(ChangeDto(1, "species", buildJsonObject { put("id", "sp1") }, deleted = true)),
            nextCursor = "1", hasMore = false, assignmentFingerprint = "x",
        )
        ReferenceRepository(db).applyChanges(tomb)
        assertTrue(db.reference().species().first().none { it.id == "sp1" })
    }

    @Test
    fun aClearedServerResetsThePhoneAfterABackup() = runBlocking {
        val generation = java.util.concurrent.atomic.AtomicLong(1)
        val api = Proxy.newProxyInstance(TmsApi::class.java.classLoader, arrayOf(TmsApi::class.java)) { _, m, _ ->
            if (m.name == "changes") ChangesResponse(emptyList(), "0", false, "x", dataGeneration = generation.get()) else error("no network in tests")
        } as TmsApi
        val e = SyncEngine(db, api, SessionStore(context), ReferenceRepository(db), OkHttpClient())
        var backedUp = 0
        e.onReset = { backedUp++ }
        e.checkDataGeneration() // first contact: remembers generation 1
        trees.register(newTree("1301"), user)
        e.checkDataGeneration()
        assertEquals(1, db.trees().count("p1").first())
        generation.set(2) // an administrator cleared all data
        e.checkDataGeneration()
        assertEquals(1, backedUp)
        assertEquals(0, db.trees().count("p1").first())
        assertTrue(db.outbox().pendingList().isEmpty())
        assertEquals("2", db.kv().get(Keys.DATA_GENERATION))
    }

    @Test
    fun freeUpSpaceGivesUpTheSecondCopyButNeverUnsentPhotos() = runBlocking {
        val sent = photo()
        val unsent = photo()
        val id = trees.register(newTree("1401", listOf(sent, unsent)), user)
        val media = db.media().forTree(id).first()
        val verified = media.first { it.localPath == sent.file.absolutePath }
        db.media().upsert(
            verified.copy(state = MediaState.VERIFIED, serverChecksum = verified.checksumSha256, serverByteSize = verified.byteSize,
                remoteVerifiedAt = "2026-01-01T00:00:00Z", associationVerifiedAt = "2026-01-01T00:00:00Z", ackPersistedAt = "2026-01-01T00:00:00Z"),
        )
        db.outbox().pendingList().forEach { db.outbox().delete(it.operationId) }
        engine.retentionDays = 30
        engine.freeBytes = { Long.MAX_VALUE }
        assertTrue(engine.cleanupMedia(now = true) > 0)
        assertFalse(sent.file.exists())
        assertTrue(unsent.file.exists())
    }

    @Test
    fun aBackupFileRestoresQueuedRecords() = runBlocking {
        trees.register(newTree("1501"), user)
        val file = File.createTempFile("backup", ".zip")
        file.outputStream().use { BackupExporter(db, SessionStore(context)).export(it, includePhotos = false) }
        val ops = db.outbox().pendingList()
        ops.forEach { db.outbox().delete(it.operationId) }
        val restored = LocalBackups(context, db, BackupExporter(db, SessionStore(context)), PhotoStore(context)).restore(android.net.Uri.fromFile(file))
        assertEquals(1, restored.operations)
        assertEquals(ops.map { it.operationId }, db.outbox().pendingList().map { it.operationId })
        // Restoring again adds nothing.
        assertEquals(0, LocalBackups(context, db, BackupExporter(db, SessionStore(context)), PhotoStore(context)).restore(android.net.Uri.fromFile(file)).operations)
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
        val obs = trees.addObservation(id, "st-healthy", Instant.parse("2026-03-01T10:00:00Z"), null, listOf(photo()), user)
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
