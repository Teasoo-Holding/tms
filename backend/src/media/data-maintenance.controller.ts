import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { z } from 'zod';
import { verifyPassword } from '../auth/passwords';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { AppError, badRequest } from '../common/errors';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { OBJECT_STORAGE, ObjectStorage } from './storage';

export const CLEAR_CONFIRMATION = 'DELETE ALL DATA';

const ClearBody = z.object({
  /** FIELD_DATA: trees, visits, photos and sync history. EVERYTHING: also projects, areas, formats, species, statuses and vendors. */
  scope: z.enum(['FIELD_DATA', 'EVERYTHING']),
  confirm: z.string(),
  password: z.string().min(1).max(200),
});

/**
 * "Clear all data" for administrators (e.g. after testing in production). User accounts and the
 * audit log are kept. Phones notice the new data generation, save a backup, and start afresh.
 */
@Roles('ADMIN')
@Controller('admin')
export class DataMaintenanceController {
  private readonly log = new Logger('DataMaintenance');

  constructor(private readonly db: Db, private readonly audit: AuditService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Post('clear-data')
  @HttpCode(200)
  async clear(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(ClearBody, body);
    if (b.confirm.trim() !== CLEAR_CONFIRMATION) throw badRequest('CONFIRMATION_REQUIRED', `Type ${CLEAR_CONFIRMATION} to confirm.`);
    const me = await this.db.one(this.db, 'SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!me || !(await verifyPassword(me.password_hash, b.password))) throw new AppError(401, 'PASSWORD_INCORRECT', 'Your password is incorrect.');

    const result = await this.db.tx(async (tx) => {
      const { rows: media } = await tx.query('SELECT object_key, thumb_key FROM tree_media');
      const counts = (
        await tx.query(`SELECT (SELECT count(*) FROM trees)::int AS trees, (SELECT count(*) FROM tree_observations)::int AS visits,
                               (SELECT count(*) FROM tree_media)::int AS photos, (SELECT count(*) FROM projects)::int AS projects`)
      ).rows[0];
      await tx.query(`TRUNCATE tree_media, tree_observations, tree_physical_id_history, conflict_records, sync_operations, sync_batches, trees`);
      if (b.scope === 'EVERYTHING') {
        await tx.query(`TRUNCATE projects, tree_species, vendors, tree_statuses CASCADE`);
        // The working statuses are always present.
        await tx.query(`INSERT INTO tree_statuses (code, name, is_terminal, allows_replacement, requires_photo, sort_order)
                        VALUES ('ALIVE', 'Alive', false, false, true, 10), ('DEAD', 'Dead', true, true, true, 20)`);
      }
      const { rows } = await tx.query(
        `UPDATE system_settings SET value = (value::int + 1)::text, updated_at = now() WHERE key = 'data_generation' RETURNING value`,
      );
      await this.audit.record({ actorId: user.id, action: 'data.clear', entityType: 'system', metadata: { scope: b.scope, ...counts } }, tx);
      return { scope: b.scope, ...counts, data_generation: Number(rows[0].value), keys: media.flatMap((m) => [m.object_key, m.thumb_key].filter(Boolean)) };
    });

    // Stored photos are removed after the database change has committed (best effort, in the background).
    void this.storage.deleteObjects(result.keys).catch((e) => this.log.warn(`Photo clean-up incomplete: ${e?.message ?? e}`));
    const { keys, ...summary } = result;
    return { ...summary, photos_removed_from_storage: keys.length };
  }
}
