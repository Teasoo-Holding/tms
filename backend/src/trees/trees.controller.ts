import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { notFound } from '../common/errors';
import { pagination, parse } from '../common/validation';
import { Db } from '../database/db.service';
import { OperationResult } from './operation-result';
import { runOperation } from './operation-runner';
import { CreateTreePayload, ObservationPayload, TreesService, UpdateTreePayload } from './trees.service';

const TreeQuery = pagination.extend({
  project_id: z.string().uuid().optional(),
  planting_year_id: z.string().uuid().optional(),
  sector_id: z.string().uuid().optional(),
  sub_sector_id: z.string().uuid().optional(),
  species_id: z.string().uuid().optional(),
  status_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  record_state: z.enum(['ACTIVE', 'CONFLICT', 'REJECTED']).optional(),
  q: z.string().max(100).optional(),
});

const CorrectionBody = z.object({ serial_input: z.string().max(32), reason: z.string().trim().min(5).max(1000) });

const HTTP_STATUS: Record<OperationResult['status'], number> = {
  ACCEPTED: HttpStatus.CREATED,
  ALREADY_PROCESSED: HttpStatus.OK,
  CONFLICT: HttpStatus.CONFLICT,
  REJECTED: HttpStatus.UNPROCESSABLE_ENTITY,
};

export const TREE_LIST_SQL = `
  SELECT t.id, t.physical_tree_id, t.serial_number, t.id_scheme_version, t.project_id, p.name AS project_name,
         t.planting_year_id, py.year_label, t.sector_id, s.name AS sector_name, s.short_code AS sector_code,
         t.sub_sector_id, ss.name AS sub_sector_name, ss.short_code AS sub_sector_code,
         t.species_id, sp.scientific_name AS species_name, sp.common_name AS species_common_name,
         t.current_status_id, st.code AS status_code, st.name AS status_name, t.last_observed_at,
         t.vendor_id, v.name AS vendor_name, t.replaces_tree_id, rt.physical_tree_id AS replaces_physical_id,
         t.planted_on, t.notes, t.record_state, t.revision, t.created_at, t.updated_at, t.synced_at,
         t.created_by, u.full_name AS created_by_name
    FROM trees t
    JOIN projects p ON p.id = t.project_id
    JOIN planting_years py ON py.id = t.planting_year_id
    JOIN sectors s ON s.id = t.sector_id
    JOIN sub_sectors ss ON ss.id = t.sub_sector_id
    JOIN tree_species sp ON sp.id = t.species_id
    LEFT JOIN tree_statuses st ON st.id = t.current_status_id
    LEFT JOIN vendors v ON v.id = t.vendor_id
    LEFT JOIN trees rt ON rt.id = t.replaces_tree_id
    JOIN users u ON u.id = t.created_by`;

@Controller('trees')
export class TreesController {
  constructor(private readonly db: Db, private readonly trees: TreesService, private readonly access: AccessService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(TreeQuery, query);
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (f.project_id) add('t.project_id = ?', f.project_id);
    if (f.planting_year_id) add('t.planting_year_id = ?', f.planting_year_id);
    if (f.sector_id) add('t.sector_id = ?', f.sector_id);
    if (f.sub_sector_id) add('t.sub_sector_id = ?', f.sub_sector_id);
    if (f.species_id) add('t.species_id = ?', f.species_id);
    if (f.status_id) add('t.current_status_id = ?', f.status_id);
    if (f.vendor_id) add('t.vendor_id = ?', f.vendor_id);
    add('t.record_state = ?', f.record_state ?? 'ACTIVE');
    if (f.q) add(`t.physical_tree_id_normalized LIKE '%' || ? || '%'`, f.q.replace(/\s+/g, '').toUpperCase());
    const scope = this.access.treeFilter(await this.access.grants(user), 't', params.length + 1);
    params.push(...scope.params);
    where.push(scope.sql);
    const whereSql = where.join(' AND ');
    const [rows, count] = await Promise.all([
      this.db.query(`${TREE_LIST_SQL} WHERE ${whereSql} ORDER BY t.physical_tree_id LIMIT ${f.limit} OFFSET ${f.offset}`, params),
      this.db.query(`SELECT count(*) AS total FROM trees t WHERE ${whereSql}`, params),
    ]);
    return { items: rows.rows, total: count.rows[0].total, limit: f.limit, offset: f.offset };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const tree = await this.db.one(this.db, `${TREE_LIST_SQL} WHERE t.id = $1`, [id]);
    if (!tree) throw notFound('Tree');
    await this.access.assertArea(user, tree.project_id, tree.sector_id, tree.sub_sector_id);
    const [observations, media, lineage, idHistory, snapshot] = await Promise.all([
      this.db.query(
        `SELECT o.*, s.code AS status_code, s.name AS status_name, u.full_name AS recorded_by_name,
                EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id) AS superseded
           FROM tree_observations o JOIN tree_statuses s ON s.id = o.observed_status_id JOIN users u ON u.id = o.recorded_by
          WHERE o.tree_id = $1 ORDER BY o.observed_at DESC, o.recorded_at DESC`,
        [id],
      ),
      this.db.query(
        `SELECT id, observation_id, mime_type, byte_size, upload_state, captured_at, remote_verified_at, association_verified_at
           FROM tree_media WHERE tree_id = $1 ORDER BY captured_at`,
        [id],
      ),
      this.lineage(id),
      this.db.query(
        `SELECT h.*, u.full_name AS changed_by_name FROM tree_physical_id_history h JOIN users u ON u.id = h.changed_by
          WHERE h.tree_id = $1 ORDER BY h.changed_at DESC`,
        [id],
      ),
      this.db.one(this.db, 'SELECT id_components_snapshot FROM trees WHERE id = $1', [id]),
    ]);
    return {
      ...tree,
      id_components_snapshot: snapshot!.id_components_snapshot,
      observations: observations.rows,
      media: media.rows,
      lineage,
      physical_id_history: idHistory.rows,
    };
  }

  /** Full replacement chain: every ancestor this tree replaced and every later replacement. */
  private async lineage(id: string) {
    const { rows } = await this.db.query(
      `WITH RECURSIVE up AS (
         SELECT id, replaces_tree_id, 0 AS depth FROM trees WHERE id = $1
         UNION ALL SELECT t.id, t.replaces_tree_id, up.depth - 1 FROM trees t JOIN up ON t.id = up.replaces_tree_id
       ), down AS (
         SELECT id, 0 AS depth FROM trees WHERE id = $1
         UNION ALL SELECT t.id, down.depth + 1 FROM trees t JOIN down ON t.replaces_tree_id = down.id WHERE t.record_state = 'ACTIVE'
       ), chain AS (SELECT id, depth FROM up UNION SELECT id, depth FROM down)
       SELECT c.depth AS generation, t.id, t.physical_tree_id, t.record_state, py.year_label, st.name AS status_name, t.created_at
         FROM chain c JOIN trees t ON t.id = c.id JOIN planting_years py ON py.id = t.planting_year_id
         LEFT JOIN tree_statuses st ON st.id = t.current_status_id
        ORDER BY c.depth`,
      [id],
    );
    return rows;
  }

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const p = parse(CreateTreePayload, body);
    return this.respond(res, (tx) => this.trees.createTree(tx, user, p, { deviceId: user.deviceId ?? null, operationId: null }));
  }

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Post(':id/replacements')
  replace(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const p = parse(CreateTreePayload.omit({ replaces_tree_id: true }), body);
    return this.respond(res, (tx) =>
      this.trees.createTree(tx, user, { ...p, replaces_tree_id: id }, { deviceId: user.deviceId ?? null, operationId: null }),
    );
  }

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const p = parse(UpdateTreePayload, { ...(body as object), id });
    return this.respond(res, (tx) => this.trees.updateTree(tx, user, p, { deviceId: user.deviceId ?? null, operationId: null }), HttpStatus.OK);
  }

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Post(':id/observations')
  observe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const p = parse(ObservationPayload, { ...(body as object), tree_id: id });
    return this.respond(res, (tx) => this.trees.addObservation(tx, user, p, { deviceId: user.deviceId ?? null, operationId: null }));
  }

  @Roles('ADMIN')
  @Post(':id/physical-id-corrections')
  correct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(CorrectionBody, body);
    return this.respond(
      res,
      async (tx) => ({ status: 'ACCEPTED', entity: await this.trees.correctSerial(tx, user, id, b.serial_input, b.reason) }),
      HttpStatus.OK,
    );
  }

  /** Commits conflicts (the incoming record must be preserved) and reports them with HTTP status codes. */
  private async respond(res: Response, fn: (tx: any) => Promise<OperationResult>, okStatus: number = HttpStatus.CREATED) {
    const result = await this.db.tx((tx) => runOperation(tx, () => fn(tx)));
    res.status(result.status === 'ACCEPTED' ? okStatus : HTTP_STATUS[result.status]);
    return result;
  }
}
