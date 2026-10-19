package com.teasoo.tms

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.teasoo.tms.data.local.Keys
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.*
import com.teasoo.tms.data.repo.ReferenceRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Decodes responses captured from the real backend (src/test/resources/contract) and applies them
 * to the local database, so DTO drift between the API and the app fails here rather than in the field.
 * Regenerate the fixtures when the API contract changes.
 */
@RunWith(RobolectricTestRunner::class)
class ApiContractTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource("contract/$name")!!.readText()

    @Test
    fun decodesAuthAndSyncResponses() {
        val login = TmsJson.decodeFromString(TokenResponse.serializer(), fixture("login.json"))
        assertEquals("FIELD_OFFICER", login.user.role)
        assertTrue(login.offlineValidUntil.isNotBlank())

        val batch = TmsJson.decodeFromString(SyncBatchResponse.serializer(), fixture("sync-batch.json"))
        assertEquals(listOf("ACCEPTED", "CONFLICT", "REJECTED"), batch.results.map { it.status })
        assertEquals("DUPLICATE_PHYSICAL_ID", batch.results[1].code)
        assertEquals("ID_MISMATCH", batch.results[2].code)

        val session = TmsJson.decodeFromString(UploadSessionResponse.serializer(), fixture("upload-session.json"))
        assertFalse(session.alreadyVerified)
        assertNotNull(session.uploadUrl)
        val complete = TmsJson.decodeFromString(MediaVerificationDto.serializer(), fixture("complete.json"))
        assertEquals("OBJECT_MISSING", complete.failureReason)
        assertFalse(complete.safeToDelete)
    }

    @Test
    fun appliesBootstrapTreesAndChangesToTheLocalDatabase() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, TmsDatabase::class.java).allowMainThreadQueries().build()
        val repo = ReferenceRepository(db)

        val boot = TmsJson.decodeFromString(BootstrapResponse.serializer(), fixture("bootstrap.json"))
        repo.applyBootstrap(boot)
        val projectId = boot.projects.first().id
        assertEquals(boot.projects.size, db.reference().projects().first().size)
        assertNotNull(db.reference().activeScheme(projectId))
        assertTrue("boundaries are stored for offline maps", db.reference().subSectors(projectId).first().all { it.boundaryJson != null })

        val trees = TmsJson.decodeFromString(MobileTreesResponse.serializer(), fixture("trees.json"))
        repo.applyTreesPage(trees)
        assertEquals(trees.trees.size, db.trees().count(projectId).first())

        val changes = TmsJson.decodeFromString(ChangesResponse.serializer(), fixture("changes.json"))
        repo.applyChanges(changes)
        assertEquals(changes.nextCursor, db.kv().get(Keys.CURSOR))
        db.close()
    }
}
