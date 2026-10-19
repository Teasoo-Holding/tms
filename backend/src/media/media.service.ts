import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.decorators';
import { AppError, badRequest, notFound } from '../common/errors';
import { config } from '../config';
import { Db } from '../database/db.service';
import { OBJECT_STORAGE, ObjectStorage } from './storage';

export const UploadSessionBody = z.object({
  media_id: z.string().uuid(),
  tree_id: z.string().uuid(),
  observation_id: z.string().uuid().nullish(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byte_size: z.number().int().positive(),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  captured_at: z.string().datetime({ offset: true }),
  local_filename: z.string().max(255).nullish(),
});

@Injectable()
export class MediaService {
  constructor(private readonly db: Db, private readonly access: AccessService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  /**
   * Registers media metadata (idempotent by media UUID) and returns a short-lived upload URL.
   * The tree and observation must already be synced so the association can be verified.
   */
  async createUploadSession(user: AuthUser, b: z.infer<typeof UploadSessionBody>) {
    if (b.byte_size > config.mediaMaxBytes) {
      throw badRequest('MEDIA_TOO_LARGE', `Photos must be smaller than ${Math.round(config.mediaMaxBytes / 1048576)} MB.`);
    }
    return this.db.tx(async (tx) => {
      const tree = await this.db.one(tx, 'SELECT id, project_id, sector_id, sub_sector_id FROM trees WHERE id = $1', [b.tree_id]);
      if (!tree) throw new AppError(409, 'TREE_NOT_SYNCED', 'Sync the tree record before uploading its photos.');
      await this.access.assertArea(user, tree.project_id, tree.sector_id, tree.sub_sector_id, tx);
      if (b.observation_id) {
        const obs = await this.db.one(tx, 'SELECT tree_id FROM tree_observations WHERE id = $1', [b.observation_id]);
        if (!obs) throw new AppError(409, 'OBSERVATION_NOT_SYNCED', 'Sync the observation before uploading its photos.');
        if (obs.tree_id !== b.tree_id) throw badRequest('ASSOCIATION_INVALID', 'The observation belongs to a different tree.');
      }

      let media = await this.db.one(tx, 'SELECT * FROM tree_media WHERE id = $1 FOR UPDATE', [b.media_id]);
      if (media) {
        if (media.tree_id !== b.tree_id || media.checksum_sha256 !== b.checksum_sha256 || Number(media.byte_size) !== b.byte_size) {
          throw badRequest('MEDIA_ID_REUSED', 'This photo ID is already registered with different content.');
        }
        if (media.upload_state === 'VERIFIED') return { media, already_verified: true };
      } else {
        const objectKey = `projects/${tree.project_id}/trees/${tree.id}/${b.media_id}`;
        media = await this.db.one(
          tx,
          `INSERT INTO tree_media (id, tree_id, observation_id, local_filename, object_key, checksum_sha256, byte_size, mime_type,
                                   uploaded_by, device_id, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [b.media_id, b.tree_id, b.observation_id ?? null, b.local_filename ?? null, objectKey, b.checksum_sha256, b.byte_size, b.mime_type, user.id, user.deviceId ?? null, b.captured_at],
        );
      }
      const upload = await this.storage.createUploadUrl(media.object_key, b.mime_type, b.byte_size, b.checksum_sha256);
      return { media, already_verified: false, upload_url: upload.url, upload_headers: upload.headers, expires_in: config.uploadUrlTtlSeconds };
    });
  }

  /**
   * Verifies durable storage (object exists, size and SHA-256 match the declared values) and the
   * tree/observation association. Only a positive result here permits the device to delete its copy.
   */
  async complete(user: AuthUser, mediaId: string) {
    const media = await this.db.one(this.db, 'SELECT * FROM tree_media WHERE id = $1', [mediaId]);
    if (!media) throw notFound('Photo');
    const tree = await this.db.one(this.db, 'SELECT id, project_id, sector_id, sub_sector_id FROM trees WHERE id = $1', [media.tree_id]);
    await this.access.assertArea(user, tree.project_id, tree.sector_id, tree.sub_sector_id);
    if (media.upload_state === 'VERIFIED') return this.verificationResult(media);

    const info = await this.storage.inspect(media.object_key);
    const failure = !info.exists
      ? 'OBJECT_MISSING'
      : info.byteSize !== Number(media.byte_size)
        ? 'SIZE_MISMATCH'
        : info.sha256 !== media.checksum_sha256
          ? 'CHECKSUM_MISMATCH'
          : null;
    if (failure) {
      const failed = await this.db.one(
        this.db,
        `UPDATE tree_media SET upload_state = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [mediaId, failure],
      );
      return this.verificationResult(failed);
    }
    const verified = await this.db.one(
      this.db,
      `UPDATE tree_media m SET upload_state = 'VERIFIED', failure_reason = NULL, remote_verified_at = now(),
              association_verified_at = CASE
                WHEN EXISTS (SELECT 1 FROM trees t WHERE t.id = m.tree_id)
                 AND (m.observation_id IS NULL OR EXISTS (SELECT 1 FROM tree_observations o WHERE o.id = m.observation_id AND o.tree_id = m.tree_id))
                THEN now() END,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [mediaId],
    );
    return this.verificationResult(verified);
  }

  private verificationResult(m: any) {
    const safeToDelete = m.upload_state === 'VERIFIED' && !!m.remote_verified_at && !!m.association_verified_at;
    return {
      media_id: m.id,
      tree_id: m.tree_id,
      observation_id: m.observation_id,
      upload_state: m.upload_state,
      failure_reason: m.failure_reason,
      checksum_sha256: m.checksum_sha256,
      byte_size: Number(m.byte_size),
      remote_verified_at: m.remote_verified_at,
      association_verified_at: m.association_verified_at,
      safe_to_delete_local_copy: safeToDelete,
    };
  }

  async viewUrl(user: AuthUser, mediaId: string) {
    const media = await this.db.one(
      this.db,
      `SELECT m.*, t.project_id, t.sector_id, t.sub_sector_id FROM tree_media m JOIN trees t ON t.id = m.tree_id WHERE m.id = $1`,
      [mediaId],
    );
    if (!media) throw notFound('Photo');
    await this.access.assertArea(user, media.project_id, media.sector_id, media.sub_sector_id);
    if (media.upload_state !== 'VERIFIED') throw new AppError(409, 'MEDIA_NOT_AVAILABLE', 'This photo has not finished uploading.');
    return { url: await this.storage.createDownloadUrl(media.object_key), expires_in: 300 };
  }
}
