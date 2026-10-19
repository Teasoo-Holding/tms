import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { badRequest, notFound, unprocessable } from '../common/errors';
import { parse } from '../common/validation';
import { Db, isUniqueViolation } from '../database/db.service';
import { Rejection } from '../trees/operation-result';
import { TreesService } from '../trees/trees.service';

const ResolveBody = z.object({
  resolution: z.enum([
    'REJECT_INCOMING', // set the incoming duplicate aside (kept, never deleted)
    'CORRECT_INCOMING_SERIAL', // the incoming label was mis-keyed: give it the correct serial and activate it
    'CORRECT_EXISTING_SERIAL', // the existing record was wrong: correct it, then activate the incoming record
    'KEEP_UNLINKED', // duplicate replacement: keep the incoming tree as an ordinary (non-replacement) tree
    'APPLY_INCOMING_CHANGES', // revision mismatch: apply the incoming edit on top of the current record
    'KEEP_EXISTING', // revision mismatch: discard the incoming edit
  ]),
  serial_input: z.string().max(32).optional(),
  notes: z.string().trim().min(3).max(2000),
});

const ALLOWED: Record<string, string[]> = {
  DUPLICATE_PHYSICAL_ID: ['REJECT_INCOMING', 'CORRECT_INCOMING_SERIAL', 'CORRECT_EXISTING_SERIAL'],
  DUPLICATE_SERIAL: ['REJECT_INCOMING', 'CORRECT_INCOMING_SERIAL', 'CORRECT_EXISTING_SERIAL'],
  DUPLICATE_REPLACEMENT: ['REJECT_INCOMING', 'KEEP_UNLINKED'],
  REVISION_MISMATCH: ['APPLY_INCOMING_CHANGES', 'KEEP_EXISTING'],
};

@Roles('ADMIN')
@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly db: Db, private readonly trees: TreesService, private readonly audit: AuditService) {}

  @Get()
  async list(@Query('status') status = 'OPEN', @Query('project_id') projectId?: string) {
    const { rows } = await this.db.query(
      `SELECT c.*, p.name AS project_name, u.full_name AS submitted_by_name, r.full_name AS resolved_by_name,
              it.physical_tree_id AS incoming_physical_id, it.record_state AS incoming_state,
              et.physical_tree_id AS existing_physical_id
         FROM conflict_records c JOIN projects p ON p.id = c.project_id
         LEFT JOIN users u ON u.id = c.submitted_by LEFT JOIN users r ON r.id = c.resolved_by
         LEFT JOIN trees it ON it.id = c.entity_id LEFT JOIN trees et ON et.id = c.existing_entity_id
        WHERE c.status = $1 AND ($2::uuid IS NULL OR c.project_id = $2)
        ORDER BY c.created_at`,
      [status, projectId ?? null],
    );
    return rows;
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.db.one(this.db, 'SELECT * FROM conflict_records WHERE id = $1', [id]);
    if (!c) throw notFound('Conflict');
    const load = (treeId: string | null) =>
      treeId
        ? this.db.one(
            this.db,
            `SELECT t.*, u.full_name AS created_by_name, (SELECT count(*) FROM tree_media m WHERE m.tree_id = t.id) AS media_count
               FROM trees t JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
            [treeId],
          )
        : null;
    return { ...c, incoming: await load(c.entity_id), existing: await load(c.existing_entity_id) };
  }

  @Post(':id/resolve')
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(ResolveBody, body);
    try {
      return await this.db.tx(async (tx) => {
        const c = await this.db.one(tx, 'SELECT * FROM conflict_records WHERE id = $1 FOR UPDATE', [id]);
        if (!c) throw notFound('Conflict');
        if (c.status !== 'OPEN') throw badRequest('ALREADY_RESOLVED', 'This conflict has already been resolved.');
        if (!ALLOWED[c.conflict_type].includes(b.resolution)) {
          throw badRequest('RESOLUTION_INVALID', `Use one of: ${ALLOWED[c.conflict_type].join(', ')}.`);
        }
        const needsSerial = b.resolution === 'CORRECT_INCOMING_SERIAL' || b.resolution === 'CORRECT_EXISTING_SERIAL';
        if (needsSerial && !b.serial_input) throw badRequest('SERIAL_REQUIRED', 'Enter the corrected serial number.');
        const reason = `Conflict ${id}: ${b.notes}`;

        switch (b.resolution) {
          case 'REJECT_INCOMING':
            await tx.query(`UPDATE trees SET record_state = 'REJECTED', updated_at = now(), updated_by = $2 WHERE id = $1`, [c.entity_id, user.id]);
            break;
          case 'CORRECT_INCOMING_SERIAL':
            await this.trees.correctSerial(tx, user, c.entity_id, b.serial_input!, reason, true);
            break;
          case 'CORRECT_EXISTING_SERIAL': {
            await this.trees.correctSerial(tx, user, c.existing_entity_id, b.serial_input!, reason);
            const incoming = await this.db.one(tx, 'SELECT serial_number FROM trees WHERE id = $1', [c.entity_id]);
            await this.trees.correctSerial(tx, user, c.entity_id, incoming.serial_number, reason, true);
            break;
          }
          case 'KEEP_UNLINKED':
            await tx.query(
              `UPDATE trees SET replaces_tree_id = NULL, record_state = 'ACTIVE', revision = revision + 1, updated_at = now(), updated_by = $2 WHERE id = $1`,
              [c.entity_id, user.id],
            );
            break;
          case 'APPLY_INCOMING_CHANGES': {
            const tree = await this.db.one(tx, 'SELECT * FROM trees WHERE id = $1 FOR UPDATE', [c.entity_id]);
            await this.trees.applyChanges(tx, user, tree, c.details.changes);
            break;
          }
          case 'KEEP_EXISTING':
            break;
        }
        const resolved = await this.db.one(
          tx,
          `UPDATE conflict_records SET status = 'RESOLVED', resolution = $2, resolution_notes = $3, resolved_by = $4, resolved_at = now(), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [id, b.resolution, b.notes, user.id],
        );
        await this.audit.record(
          { actorId: user.id, action: 'conflict.resolve', entityType: 'conflict', entityId: id, projectId: c.project_id, before: c, after: resolved },
          tx,
        );
        return resolved;
      });
    } catch (e) {
      if (e instanceof Rejection) throw unprocessable(e.code, e.message);
      if (isUniqueViolation(e)) throw unprocessable('DUPLICATE', 'This resolution would create a duplicate tree ID. Correct a serial instead.');
      throw e;
    }
  }
}
