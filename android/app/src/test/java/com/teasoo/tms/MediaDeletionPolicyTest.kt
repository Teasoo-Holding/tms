package com.teasoo.tms

import com.teasoo.tms.domain.MediaDeletionPolicy
import com.teasoo.tms.domain.MediaDeletionPolicy.Blocker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaDeletionPolicyTest {
    private val verified = MediaDeletionPolicy.Facts(
        remoteVerifiedAt = "2026-10-19T10:00:00Z",
        associationVerifiedAt = "2026-10-19T10:00:00Z",
        serverChecksum = "abc",
        localChecksum = "abc",
        serverByteSize = 100,
        localByteSize = 100,
        acknowledgementPersisted = true,
        pendingOperationsReferencingFile = 0,
    )

    @Test fun deletableOnlyWhenEveryConditionHolds() = assertTrue(MediaDeletionPolicy.mayDelete(verified))

    @Test fun notStoredRemotely() = assertEquals(listOf(Blocker.NOT_STORED_REMOTELY), MediaDeletionPolicy.blockers(verified.copy(remoteVerifiedAt = null)))

    @Test fun checksumMismatch() = assertEquals(listOf(Blocker.CHECKSUM_MISMATCH), MediaDeletionPolicy.blockers(verified.copy(serverChecksum = "zzz")))

    @Test fun sizeMismatch() = assertEquals(listOf(Blocker.SIZE_MISMATCH), MediaDeletionPolicy.blockers(verified.copy(serverByteSize = 99)))

    @Test fun associationUnconfirmed() =
        assertEquals(listOf(Blocker.ASSOCIATION_NOT_CONFIRMED), MediaDeletionPolicy.blockers(verified.copy(associationVerifiedAt = null)))

    /** Crash between upload and acknowledgement: re-verify, never delete. */
    @Test fun acknowledgementNotPersisted() =
        assertEquals(listOf(Blocker.ACK_NOT_PERSISTED), MediaDeletionPolicy.blockers(verified.copy(acknowledgementPersisted = false)))

    @Test fun pendingOperations() =
        assertEquals(listOf(Blocker.PENDING_OPERATIONS), MediaDeletionPolicy.blockers(verified.copy(pendingOperationsReferencingFile = 1)))

    @Test fun unsyncedPhotoHasEveryBlocker() {
        val unsynced = MediaDeletionPolicy.Facts(null, null, null, "abc", null, 100, false, 1)
        assertEquals(6, MediaDeletionPolicy.blockers(unsynced).size)
    }
}
