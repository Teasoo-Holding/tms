package com.teasoo.tms.domain

/**
 * A local photo may be deleted only when every condition holds (architecture §8.4).
 * Unsynced photos are never purged automatically.
 */
object MediaDeletionPolicy {
    data class Facts(
        val remoteVerifiedAt: String?,
        val associationVerifiedAt: String?,
        val serverChecksum: String?,
        val localChecksum: String,
        val serverByteSize: Long?,
        val localByteSize: Long,
        /** The verification acknowledgement has been committed to the local database. */
        val acknowledgementPersisted: Boolean,
        val pendingOperationsReferencingFile: Int,
    )

    enum class Blocker { NOT_STORED_REMOTELY, CHECKSUM_MISMATCH, SIZE_MISMATCH, ASSOCIATION_NOT_CONFIRMED, ACK_NOT_PERSISTED, PENDING_OPERATIONS }

    fun blockers(f: Facts): List<Blocker> = buildList {
        if (f.remoteVerifiedAt == null) add(Blocker.NOT_STORED_REMOTELY)
        if (f.serverChecksum != f.localChecksum) add(Blocker.CHECKSUM_MISMATCH)
        if (f.serverByteSize != f.localByteSize) add(Blocker.SIZE_MISMATCH)
        if (f.associationVerifiedAt == null) add(Blocker.ASSOCIATION_NOT_CONFIRMED)
        if (!f.acknowledgementPersisted) add(Blocker.ACK_NOT_PERSISTED)
        if (f.pendingOperationsReferencingFile > 0) add(Blocker.PENDING_OPERATIONS)
    }

    fun mayDelete(f: Facts) = blockers(f).isEmpty()
}
