import { Controller, Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { conflict, notFound } from '../common/errors';
import { Db, Queryable } from '../database/db.service';

/**
 * Deleting configuration. Anything that trees already depend on is refused with the count, so
 * registered records never lose their meaning; an administrator deactivates (or clears data) instead.
 */
@Roles('ADMIN')
@Controller()
export class DeletionController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private async refuseIfTrees(q: Queryable, where: string, id: string, what: string) {
    const { rows } = await q.query(`SELECT count(*)::int AS n FROM trees WHERE ${where}`, [id]);
    if (rows[0].n > 0) {
      throw conflict('HAS_TREES', `${what} has ${rows[0].n} registered tree${rows[0].n === 1 ? '' : 's'}. Deactivate it instead, or clear the data first.`, { count: rows[0].n });
    }
  }

  private async log(q: Queryable, user: AuthUser, entityType: string, before: any, projectId: string | null) {
    await this.audit.record({ actorId: user.id, action: `${entityType}.delete`, entityType, entityId: before.id, projectId, before }, q);
  }

  @Delete('projects/:id')
  async project(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM projects WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Project');
      await this.refuseIfTrees(tx, 'project_id = $1', id, 'This project');
      for (const sql of [
        'DELETE FROM project_share_links WHERE project_id = $1',
        'DELETE FROM custom_field_definitions WHERE project_id = $1',
        'DELETE FROM user_project_assignments WHERE project_id = $1',
        'DELETE FROM serial_allocations WHERE project_id = $1',
        'DELETE FROM planting_year_vendors WHERE project_id = $1',
        'DELETE FROM conflict_records WHERE project_id = $1',
        'DELETE FROM tree_id_schemes WHERE project_id = $1',
        'DELETE FROM sub_sectors WHERE project_id = $1',
        'DELETE FROM sectors WHERE project_id = $1',
        'DELETE FROM planting_years WHERE project_id = $1',
        'DELETE FROM projects WHERE id = $1',
      ]) await tx.query(sql, [id]);
      await this.log(tx, user, 'project', before, null);
      return { deleted: true };
    });
  }

  /** A planting year with its survey (sectors, sub-sectors), vendor links and year formats. */
  @Delete('planting-years/:id')
  async year(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM planting_years WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Planting year');
      await this.refuseIfTrees(tx, 'planting_year_id = $1', id, `Planting year ${before.year_label}`);
      for (const sql of [
        `DELETE FROM user_project_assignments WHERE sector_id IN (SELECT id FROM sectors WHERE planting_year_id = $1)`,
        `DELETE FROM sub_sectors WHERE sector_id IN (SELECT id FROM sectors WHERE planting_year_id = $1)`,
        'DELETE FROM sectors WHERE planting_year_id = $1',
        'DELETE FROM planting_year_vendors WHERE planting_year_id = $1',
        'DELETE FROM tree_id_schemes WHERE planting_year_id = $1',
        'DELETE FROM planting_years WHERE id = $1',
      ]) await tx.query(sql, [id]);
      await this.log(tx, user, 'planting_year', before, before.project_id);
      return { deleted: true };
    });
  }

  @Delete('sectors/:id')
  async sector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT id, project_id, name, short_code FROM sectors WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Sector');
      await this.refuseIfTrees(tx, 'sector_id = $1', id, `Sector ${before.short_code}`);
      await tx.query('DELETE FROM user_project_assignments WHERE sector_id = $1', [id]);
      await tx.query('DELETE FROM sub_sectors WHERE sector_id = $1', [id]);
      await tx.query('DELETE FROM sectors WHERE id = $1', [id]);
      await this.log(tx, user, 'sector', before, before.project_id);
      return { deleted: true };
    });
  }

  @Delete('sub-sectors/:id')
  async subSector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT id, project_id, name, short_code FROM sub_sectors WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Sub-sector');
      await this.refuseIfTrees(tx, 'sub_sector_id = $1', id, `Sub-sector ${before.short_code}`);
      await tx.query('DELETE FROM user_project_assignments WHERE sub_sector_id = $1', [id]);
      await tx.query('DELETE FROM sub_sectors WHERE id = $1', [id]);
      await this.log(tx, user, 'sub_sector', before, before.project_id);
      return { deleted: true };
    });
  }

  @Delete('tree-id-schemes/:id')
  async scheme(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM tree_id_schemes WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('ID format');
      await this.refuseIfTrees(tx, 'id_scheme_id = $1', id, 'This ID format');
      await tx.query('DELETE FROM tree_id_schemes WHERE id = $1', [id]);
      await this.log(tx, user, 'tree_id_scheme', before, before.project_id);
      return { deleted: true };
    });
  }

  /** Values already recorded for the field stay on their records; it just stops being asked. */
  @Delete('custom-fields/:id')
  async customField(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM custom_field_definitions WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Field');
      const table = before.applies_to === 'TREE' ? 'trees' : 'tree_observations';
      const { rows } = await tx.query(`SELECT count(*)::int AS n FROM ${table} WHERE custom_fields ? $1`, [before.key]);
      if (rows[0].n > 0) throw conflict('IN_USE', `${rows[0].n} record${rows[0].n === 1 ? ' has' : 's have'} a value for this field. Deactivate it instead.`, { count: rows[0].n });
      await tx.query('DELETE FROM custom_field_definitions WHERE id = $1', [id]);
      await this.log(tx, user, 'custom_field', before, before.project_id);
      return { deleted: true };
    });
  }

  @Delete('planting-year-vendors/:id')
  async yearVendor(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM planting_year_vendors WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Vendor link');
      await tx.query('DELETE FROM planting_year_vendors WHERE id = $1', [id]);
      await this.log(tx, user, 'planting_year_vendor', before, before.project_id);
      return { deleted: true };
    });
  }
}
