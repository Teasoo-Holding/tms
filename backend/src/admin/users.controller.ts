import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { AppError, badRequest, notFound } from '../common/errors';
import { parse } from '../common/validation';
import { Db, isUniqueViolation, Queryable } from '../database/db.service';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../auth/passwords';
import { AuthService } from '../auth/auth.service';
import { normalizePhone, USERNAME_RE } from '../domain/login-id';

const DeleteUserBody = z.object({ confirm: z.string().max(20), password: z.string().min(1).max(200) });

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const UserFields = {
  /** Any of username, email or phone can be used to sign in; at least one is required. */
  username: z.preprocess(blankToNull, z.string().trim().regex(USERNAME_RE, 'Use 3–40 letters, digits, dots, dashes or underscores, including a letter').nullable()),
  email: z.preprocess(blankToNull, z.string().trim().email().nullable()),
  phone: z.preprocess(blankToNull, z.string().nullable().transform((v, ctx) => {
    if (v === null) return null;
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a phone number of 7–16 digits, optionally starting with +' });
    return p;
  })),
  full_name: z.string().trim().min(1).max(200),
  role: z.enum(['ADMIN', 'FIELD_OFFICER', 'EXECUTIVE']),
  password: z.string().max(200),
  active: z.boolean().default(true),
  /** Executives only: see every project (Teasoo management) rather than assigned ones (clients, sponsors). */
  all_projects: z.boolean().default(false),
};
const UserBody = z
  .object({ ...UserFields, username: UserFields.username.optional(), email: UserFields.email.optional(), phone: UserFields.phone.optional() })
  .refine((b) => !!(b.username || b.email || b.phone), { message: 'Give the user a username, email or phone number to sign in with', path: ['username'] });
const UserPatch = z.object({ ...UserFields, all_projects: z.boolean() }).partial();

/** Which sign-in identifier collided, from the unique index name. */
function takenMessage(e: any) {
  const c = String(e?.constraint ?? '');
  if (c.includes('username')) return badRequest('USERNAME_TAKEN', 'Another user already has this username.');
  if (c.includes('phone')) return badRequest('PHONE_TAKEN', 'Another user already has this phone number.');
  return badRequest('EMAIL_TAKEN', 'A user with this email already exists.');
}

const AssignmentBody = z.object({
  user_id: z.string().uuid(),
  project_id: z.string().uuid(),
  sector_id: z.string().uuid().nullish(),
  sub_sector_id: z.string().uuid().nullish(),
});

const AllocationBody = z.object({
  project_id: z.string().uuid(),
  scope_key: z.string().min(1).max(500),
  user_id: z.string().uuid().nullish(),
  range_start: z.number().int().positive(),
  range_end: z.number().int().positive(),
  notes: z.string().max(1000).nullish(),
});

const USER_COLUMNS = 'id, email, username, phone, full_name, role, active, all_projects, created_at, updated_at';

@Roles('ADMIN')
@Controller()
export class UsersController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly auth: AuthService) {}

  @Get('users')
  async list() {
    // Activity per account: what each person entered and when their phone last synced.
    return (
      await this.db.query(
        `SELECT ${USER_COLUMNS},
                (SELECT count(*) FROM trees t WHERE t.created_by = users.id)::int AS trees_registered,
                (SELECT count(*) FROM tree_observations o WHERE o.recorded_by = users.id AND NOT o.is_initial)::int AS observations_recorded,
                (SELECT max(d.last_sync_at) FROM devices d WHERE d.user_id = users.id) AS last_sync_at
           FROM users WHERE deleted_at IS NULL ORDER BY full_name`,
      )
    ).rows;
  }

  @Post('users')
  async create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const b = parse(UserBody, body);
    const policy = assertPasswordPolicy(b.password);
    if (policy) throw badRequest('PASSWORD_WEAK', policy);
    const hash = await hashPassword(b.password);
    return this.db.tx(async (tx) => {
      const user = await this.db
        .one(
          tx,
          `INSERT INTO users (email, username, phone, full_name, role, password_hash, active, all_projects)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${USER_COLUMNS}`,
          [b.email?.toLowerCase() ?? null, b.username ?? null, b.phone ?? null, b.full_name, b.role, hash, b.active, b.role === 'EXECUTIVE' && b.all_projects],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw takenMessage(e);
          throw e;
        });
      await this.audit.record({ actorId: actor.id, action: 'user.create', entityType: 'user', entityId: user!.id, after: user }, tx);
      return user;
    });
  }

  @Patch('users/:id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(UserPatch, body);
    if (b.password !== undefined) {
      const policy = assertPasswordPolicy(b.password);
      if (policy) throw badRequest('PASSWORD_WEAK', policy);
    }
    if (id === actor.id && (b.active === false || (b.role && b.role !== 'ADMIN'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot deactivate or demote your own account.');
    }
    const hash = b.password !== undefined ? await hashPassword(b.password) : null;
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound('User');
      const n = { ...before, ...b };
      const after = await this.db
        .one(
          tx,
          `UPDATE users SET email = $2, full_name = $3, role = $4, active = $5, password_hash = COALESCE($6, password_hash),
                  username = $7, phone = $8, all_projects = $9, updated_at = now(),
                  -- A new email unlinks Google: the next Google sign-in must match the new address.
                  google_sub = CASE WHEN lower(email) IS DISTINCT FROM $2 THEN NULL ELSE google_sub END
            WHERE id = $1 RETURNING ${USER_COLUMNS}`,
          [id, n.email?.toLowerCase() ?? null, n.full_name, n.role, n.active, hash, n.username ?? null, n.phone ?? null, n.role === 'EXECUTIVE' && !!n.all_projects],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw takenMessage(e);
          throw e;
        });
      // Deactivation, role or password changes end existing sessions; offline devices lock on next revalidation.
      if (b.active === false || b.role !== undefined || hash) await this.auth.revokeAllForUser(tx, id);
      await this.audit.record(
        { actorId: actor.id, action: 'user.update', entityType: 'user', entityId: id, before, after, metadata: { password_changed: !!hash } },
        tx,
      );
      return after;
    });
  }

  /**
   * Permanently deletes a user (#111). Needs the admin's own password and DELETE typed. Users with no records are
   * removed completely. For users who collected data, the trees and visits stay (shown as "Deleted user") and every
   * personal detail is erased. Either way the person can no longer sign in, and their sessions end.
   */
  @Post('users/:id/delete')
  @HttpCode(200)
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(DeleteUserBody, body);
    if (b.confirm.trim() !== 'DELETE') throw badRequest('CONFIRMATION_REQUIRED', 'Type DELETE to confirm.');
    if (id === actor.id) throw badRequest('SELF_DELETE', 'You cannot delete your own account.');
    const me = await this.db.one(this.db, 'SELECT password_hash FROM users WHERE id = $1', [actor.id]);
    if (!me || !(await verifyPassword(me.password_hash, b.password))) throw new AppError(401, 'PASSWORD_INCORRECT', 'Your password is incorrect.');
    return this.db.tx(async (tx) => {
      const user = await this.db.one(tx, `SELECT id, role, deleted_at FROM users WHERE id = $1 FOR UPDATE`, [id]);
      if (!user || user.deleted_at) throw notFound('User');
      await this.auth.revokeAllForUser(tx, id);
      // The person's own settings: access, serial ranges, sessions.
      await tx.query('DELETE FROM user_project_assignments WHERE user_id = $1', [id]);
      await tx.query('DELETE FROM serial_allocations WHERE user_id = $1', [id]);
      await tx.query('DELETE FROM refresh_sessions WHERE user_id = $1', [id]);
      // Audit entries about the account held its email and phone: they keep the action, not the details.
      await tx.query(`UPDATE audit_logs SET before = NULL, after = NULL WHERE entity_type = 'user' AND entity_id = $1`, [id]);
      let mode: 'removed' | 'erased' = 'removed';
      await tx.query('SAVEPOINT delete_user');
      try {
        await tx.query('UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1', [id]);
        await tx.query('DELETE FROM devices WHERE user_id = $1', [id]);
        await tx.query('DELETE FROM users WHERE id = $1', [id]);
        await tx.query('RELEASE SAVEPOINT delete_user');
      } catch (e: any) {
        // 23503: their trees, visits or photos still refer to them, so the row stays without personal details.
        if (e?.code !== '23503') throw e;
        await tx.query('ROLLBACK TO SAVEPOINT delete_user');
        mode = 'erased';
        await tx.query(
          `UPDATE users SET full_name = 'Deleted user', email = NULL, phone = NULL, username = $2, google_sub = NULL,
                  password_hash = $3, active = false, all_projects = false, deleted_at = now(), updated_at = now()
            WHERE id = $1`,
          [id, `deleted-${id.slice(0, 8)}`, `!deleted:${randomBytes(24).toString('hex')}`],
        );
        // Phones stay registered: tablets are shared, and other officers keep using them.
      }
      await this.audit.record({ actorId: actor.id, action: 'user.delete', entityType: 'user', entityId: id, metadata: { mode } }, tx);
      return { id, mode };
    });
  }

  @Get('assignments')
  async assignments(@Query('user_id') userId?: string, @Query('project_id') projectId?: string) {
    const { rows } = await this.db.query(
      `SELECT a.*, u.full_name AS user_name, u.role AS user_role, p.name AS project_name, s.name AS sector_name, s.short_code AS sector_code,
              ss.name AS sub_sector_name, ss.short_code AS sub_sector_code
         FROM user_project_assignments a
         JOIN users u ON u.id = a.user_id JOIN projects p ON p.id = a.project_id
         LEFT JOIN sectors s ON s.id = a.sector_id LEFT JOIN sub_sectors ss ON ss.id = a.sub_sector_id
        WHERE a.active AND ($1::uuid IS NULL OR a.user_id = $1) AND ($2::uuid IS NULL OR a.project_id = $2)
        ORDER BY p.name, u.full_name`,
      [userId ?? null, projectId ?? null],
    );
    return rows;
  }

  @Post('assignments')
  async assign(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const b = parse(AssignmentBody, body);
    return this.db.tx(async (tx) => {
      await this.validateAreaScope(tx, b.project_id, b.sector_id ?? null, b.sub_sector_id ?? null);
      let sectorId = b.sector_id ?? null;
      if (b.sub_sector_id && !sectorId) {
        sectorId = (await this.db.one(tx, 'SELECT sector_id FROM sub_sectors WHERE id = $1', [b.sub_sector_id]))!.sector_id;
      }
      const row = await this.db.one(
        tx,
        'INSERT INTO user_project_assignments (user_id, project_id, sector_id, sub_sector_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [b.user_id, b.project_id, sectorId, b.sub_sector_id ?? null],
      );
      await this.audit.record({ actorId: actor.id, action: 'assignment.create', entityType: 'assignment', entityId: row!.id, projectId: b.project_id, after: row }, tx);
      return row;
    });
  }

  @Post('assignments/:id/revoke')
  async revoke(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const row = await this.db.one(tx, 'UPDATE user_project_assignments SET active = false, updated_at = now() WHERE id = $1 RETURNING *', [id]);
      if (!row) throw notFound('Assignment');
      await this.audit.record({ actorId: actor.id, action: 'assignment.revoke', entityType: 'assignment', entityId: id, projectId: row.project_id, after: row }, tx);
      return row;
    });
  }

  private async validateAreaScope(q: Queryable, projectId: string, sectorId: string | null, subSectorId: string | null) {
    if (!(await this.db.one(q, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
    if (sectorId && !(await this.db.one(q, 'SELECT id FROM sectors WHERE id = $1 AND project_id = $2', [sectorId, projectId]))) {
      throw badRequest('SCOPE_INVALID', 'The sector does not belong to the project.');
    }
    if (subSectorId) {
      const ss = await this.db.one(q, 'SELECT sector_id FROM sub_sectors WHERE id = $1 AND project_id = $2', [subSectorId, projectId]);
      if (!ss || (sectorId && ss.sector_id !== sectorId)) throw badRequest('SCOPE_INVALID', 'The sub-sector does not belong to the project or sector.');
    }
  }

  @Get('serial-allocations')
  async allocations(@Query('project_id') projectId?: string) {
    const { rows } = await this.db.query(
      `SELECT a.*, u.full_name AS user_name FROM serial_allocations a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.active AND ($1::uuid IS NULL OR a.project_id = $1) ORDER BY a.scope_key, a.range_start`,
      [projectId ?? null],
    );
    return rows;
  }

  @Post('serial-allocations')
  async allocate(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const b = parse(AllocationBody, body);
    if (b.range_end < b.range_start) throw badRequest('RANGE_INVALID', 'The range end must not be before the start.');
    return this.db.tx(async (tx) => {
      // Serialise allocation per scope so two admins cannot create overlapping ranges concurrently.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [b.scope_key]);
      const overlap = await this.db.one(
        tx,
        'SELECT id FROM serial_allocations WHERE active AND scope_key = $1 AND range_start <= $3 AND range_end >= $2',
        [b.scope_key, b.range_start, b.range_end],
      );
      if (overlap) throw badRequest('RANGE_OVERLAP', 'This range overlaps an existing allocation in the same scope.');
      const row = await this.db.one(
        tx,
        `INSERT INTO serial_allocations (project_id, scope_key, user_id, range_start, range_end, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [b.project_id, b.scope_key, b.user_id ?? null, b.range_start, b.range_end, b.notes ?? null],
      );
      await this.audit.record({ actorId: actor.id, action: 'serial_allocation.create', entityType: 'serial_allocation', entityId: row!.id, projectId: b.project_id, after: row }, tx);
      return row;
    });
  }

  @Post('serial-allocations/:id/revoke')
  async revokeAllocation(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const row = await this.db.one(tx, 'UPDATE serial_allocations SET active = false, updated_at = now() WHERE id = $1 RETURNING *', [id]);
      if (!row) throw notFound('Allocation');
      await this.audit.record({ actorId: actor.id, action: 'serial_allocation.revoke', entityType: 'serial_allocation', entityId: id, projectId: row.project_id, after: row }, tx);
      return row;
    });
  }

  @Get('devices')
  async devices() {
    const { rows } = await this.db.query(
      `SELECT d.*, u.full_name AS user_name,
              (SELECT count(*) FROM tree_media m WHERE m.device_id = d.id AND m.upload_state <> 'VERIFIED') AS unverified_media
         FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.last_seen_at DESC NULLS LAST`,
    );
    return rows;
  }

  @Post('devices/:id/revoke')
  async revokeDevice(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const row = await this.db.one(tx, 'UPDATE devices SET revoked_at = now() WHERE id = $1 RETURNING *', [id]);
      if (!row) throw notFound('Device');
      await tx.query('UPDATE refresh_sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [id]);
      await this.audit.record({ actorId: actor.id, action: 'device.revoke', entityType: 'device', entityId: id, after: row }, tx);
      return row;
    });
  }
}
