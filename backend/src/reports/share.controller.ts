import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { AppError, notFound } from '../common/errors';
import { pagination, parse } from '../common/validation';
import { config } from '../config';
import { Db } from '../database/db.service';
import { MediaService } from '../media/media.service';
import { TREE_SORTS, TreeQuery } from '../trees/trees.controller';
import { DensityFilter, Filter, VisitFilter } from './reports.controller';
import { ReportsService } from './reports.service';
import { addSheet, toCsv } from './workbook';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Tokens are looked up by hash; an encrypted copy (AES-256-GCM, key derived from the server secret) lets administrators
 * copy a link again later. A link whose copy cannot be read (older links, or a changed secret) can still be revoked.
 */
const tokenKey = () => createHash('sha256').update(`share-link-token:${config.jwtAccessSecret}`).digest();
function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}
function decryptToken(stored: string | null): string | null {
  if (!stored?.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(stored.slice(3), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
const LINK_COLUMNS = `l.id, l.project_id, p.name AS project_name, p.short_code AS project_code, l.label, l.expires_at, l.revoked_at, l.last_used_at,
  l.created_at, u.full_name AS created_by_name, l.token_encrypted,
  CASE WHEN l.revoked_at IS NOT NULL THEN 'REVOKED' WHEN l.expires_at IS NOT NULL AND l.expires_at <= now() THEN 'EXPIRED' ELSE 'ACTIVE' END AS status`;
/** The link's path (/share/<token>) while it works and its token can be read, else null. */
const withPath = ({ token_encrypted, ...l }: any) => {
  const token = l.status === 'ACTIVE' ? decryptToken(token_encrypted) : null;
  return { ...l, path: token ? `/share/${token}` : null };
};
const CreateLink = z.object({ label: z.string().trim().max(120).nullish(), expires_in_days: z.number().int().min(1).max(3650).nullish() });
/** The client's tree list: filters, tree ID search and the sorts of the portal's tree list. */
const ShareTreeQuery = pagination.extend({
  planting_year_id: z.string().uuid().optional(),
  sector_id: z.string().uuid().optional(),
  sub_sector_id: z.string().uuid().optional(),
  species_id: z.string().uuid().optional(),
  status_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  sort: TreeQuery.shape.sort,
  order: TreeQuery.shape.order,
});

/**
 * Tree columns a client may see. Only these are selected: never who registered, visited or photographed a tree
 * (no user ids, names, emails or devices), so nothing about data collectors can leak through a share link.
 */
const SHARE_TREE_SQL = `
  SELECT t.id, t.physical_tree_id, t.planting_year_id, py.year_label, t.sector_id, s.short_code AS sector_code, s.name AS sector_name,
         t.sub_sector_id, ss.short_code AS sub_sector_code, ss.name AS sub_sector_name,
         t.species_id, sp.scientific_name AS species_name, sp.common_name AS species_common_name,
         st.code AS status_code, st.name AS status_name, st.is_terminal AS status_terminal, t.planted_on, t.last_observed_at,
         v.name AS vendor_name, v.short_code AS vendor_short_code,
         (SELECT count(*) FROM tree_media m WHERE m.tree_id = t.id AND m.upload_state = 'VERIFIED')::int AS photos
    FROM trees t
    JOIN planting_years py ON py.id = t.planting_year_id
    JOIN sectors s ON s.id = t.sector_id
    JOIN sub_sectors ss ON ss.id = t.sub_sector_id
    JOIN tree_species sp ON sp.id = t.species_id
    LEFT JOIN tree_statuses st ON st.id = t.current_status_id
    LEFT JOIN vendors v ON v.id = t.vendor_id`;

/** Reports run as an unrestricted reader, always pinned to the link's project. */
const SHARE_READER: AuthUser = { id: '00000000-0000-0000-0000-000000000000', role: 'ADMIN' };

/**
 * Read-only links for clients and sponsors: one secret link per audience, for one project, with the
 * dashboard and exports and nothing else. Links can expire and be revoked; every use is recorded.
 */
@Controller()
export class ShareController {
  constructor(private readonly db: Db, private readonly reports: ReportsService, private readonly audit: AuditService, private readonly media: MediaService) {}

  // ---------------------------------------------------------------- administration
  @Roles('ADMIN')
  @Get('projects/:id/share-links')
  async list(@Param('id', ParseUUIDPipe) projectId: string) {
    const { rows } = await this.db.query(
      `SELECT ${LINK_COLUMNS} FROM project_share_links l JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.created_by
        WHERE l.project_id = $1 ORDER BY l.created_at DESC`,
      [projectId],
    );
    return rows.map(withPath);
  }

  /** Every client link across projects, newest first (the "Client links" page). */
  @Roles('ADMIN')
  @Get('share-links')
  async listAll() {
    const { rows } = await this.db.query(
      `SELECT ${LINK_COLUMNS} FROM project_share_links l JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.created_by
        ORDER BY l.created_at DESC`,
    );
    return rows.map(withPath);
  }

  /** The token is returned here and, while the link works, in the lists (stored as a hash plus an encrypted copy). */
  @Roles('ADMIN')
  @Post('projects/:id/share-links')
  async create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(CreateLink, body ?? {});
    if (!(await this.db.one(this.db, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
    const token = randomBytes(24).toString('base64url');
    const row = await this.db.one(
      this.db,
      `INSERT INTO project_share_links (project_id, token_hash, token_encrypted, label, created_by, expires_at)
       VALUES ($1, $2, $6, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END)
       RETURNING id, project_id, label, expires_at, created_at`,
      [projectId, sha256(token), b.label ?? null, user.id, b.expires_in_days ?? null, encryptToken(token)],
    );
    await this.audit.record({ actorId: user.id, action: 'share_link.create', entityType: 'share_link', entityId: row!.id, projectId, after: row });
    return { ...row, token, path: `/share/${token}` };
  }

  @Roles('ADMIN')
  @Post('share-links/:id/revoke')
  @HttpCode(200)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.db.one(this.db, 'UPDATE project_share_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, project_id', [id]);
    if (!row) throw notFound('Share link');
    await this.audit.record({ actorId: user.id, action: 'share_link.revoke', entityType: 'share_link', entityId: id, projectId: row.project_id });
    return { revoked: true };
  }

  // ---------------------------------------------------------------- public (no account)
  private async resolve(token: string) {
    const link = await this.db.one(
      this.db,
      `UPDATE project_share_links SET last_used_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) RETURNING project_id`,
      [sha256(token ?? '')],
    );
    if (!link) throw new AppError(404, 'LINK_INVALID', 'This link is not valid any more. Ask Teasoo Consulting for a new one.');
    return link.project_id as string;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('share/:token')
  async view(@Param('token') token: string, @Query() query: unknown) {
    const projectId = await this.resolve(token);
    const f = { ...parse(Filter, query), project_id: projectId };
    const [project, years, vendors, areas, statuses, species, summary] = await Promise.all([
      this.db.one(this.db, 'SELECT id, name, short_code, location, status, start_date, end_date, description FROM projects WHERE id = $1', [projectId]),
      this.db.query('SELECT id, year_label, active FROM planting_years WHERE project_id = $1 ORDER BY year_label', [projectId]),
      this.db.query(
        `SELECT l.planting_year_id, v.id, v.name, v.short_code FROM planting_year_vendors l JOIN vendors v ON v.id = l.vendor_id
          WHERE l.project_id = $1 AND l.active ORDER BY v.name`,
        [projectId],
      ),
      this.db.query(
        `SELECT s.id, s.planting_year_id, s.name, s.short_code, ST_AsGeoJSON(s.boundary_geometry)::json AS boundary,
                s.reference_latitude::float8 AS reference_latitude, s.reference_longitude::float8 AS reference_longitude,
                COALESCE(json_agg(json_build_object('id', ss.id, 'name', ss.name, 'short_code', ss.short_code,
                  'reference_latitude', ss.reference_latitude::float8, 'reference_longitude', ss.reference_longitude::float8,
                  'boundary', ST_AsGeoJSON(ss.boundary_geometry)::json) ORDER BY ss.short_code) FILTER (WHERE ss.id IS NOT NULL), '[]') AS sub_sectors
           FROM sectors s LEFT JOIN sub_sectors ss ON ss.sector_id = s.id AND ss.active
          WHERE s.project_id = $1 AND s.active GROUP BY s.id ORDER BY s.short_code`,
        [projectId],
      ),
      // Filter options for the tree list: statuses in use (or active) and the project's species.
      this.db.query(
        `SELECT id, code, name, is_terminal FROM tree_statuses
          WHERE active OR id IN (SELECT current_status_id FROM trees WHERE project_id = $1) ORDER BY sort_order, name`,
        [projectId],
      ),
      this.db.query(
        `SELECT sp.id, sp.scientific_name, sp.common_name FROM tree_species sp
          WHERE sp.id IN (SELECT species_id FROM trees WHERE project_id = $1 AND record_state = 'ACTIVE')
          ORDER BY COALESCE(sp.common_name, sp.scientific_name)`,
        [projectId],
      ),
      this.reports.summary(SHARE_READER, f),
    ]);
    // Clients see results, not staff: field officers' names are left out.
    const { officer_activity: _officers, ...shared } = summary as any;
    return { project, planting_years: years.rows, vendors: vendors.rows, areas: areas.rows, statuses: statuses.rows, species: species.rows, summary: shared };
  }

  /** The tree-density map for the link's project (planting_year_id optional). */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('share/:token/density')
  async density(@Param('token') token: string, @Query() query: unknown) {
    const projectId = await this.resolve(token);
    const f = parse(DensityFilter.omit({ project_id: true }), query);
    return this.reports.density(SHARE_READER, projectId, f.planting_year_id);
  }

  /** The project's trees (registry records only), filtered, searched, sorted and paginated like the portal's tree list. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('share/:token/trees')
  async trees(@Param('token') token: string, @Query() query: unknown) {
    const projectId = await this.resolve(token);
    const f = parse(ShareTreeQuery, query);
    const params: unknown[] = [projectId];
    const where = [`t.project_id = $1`, `t.record_state = 'ACTIVE'`];
    const eq = (sql: string, v?: string) => {
      if (!v) return;
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    eq('t.planting_year_id = ?', f.planting_year_id);
    eq('t.sector_id = ?', f.sector_id);
    eq('t.sub_sector_id = ?', f.sub_sector_id);
    eq('t.species_id = ?', f.species_id);
    eq('t.current_status_id = ?', f.status_id);
    eq('t.vendor_id = ?', f.vendor_id);
    if (f.q) eq(`t.physical_tree_id_normalized LIKE '%' || ? || '%'`, f.q.replace(/\s+/g, '').toUpperCase());
    const whereSql = where.join(' AND ');
    const dir = f.order === 'desc' ? 'DESC' : 'ASC';
    const orderBy = [...TREE_SORTS[f.sort].map((c) => `${c} ${dir} NULLS LAST`), `t.physical_tree_id ${f.sort === 'tree_id' ? dir : 'ASC'}`, 't.id'].join(', ');
    const [rows, count] = await Promise.all([
      this.db.query(`${SHARE_TREE_SQL} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${f.limit} OFFSET ${f.offset}`, params),
      this.db.query(`SELECT count(*)::int AS total FROM trees t WHERE ${whereSql}`, params),
    ]);
    return { items: rows.rows, total: count.rows[0].total, limit: f.limit, offset: f.offset };
  }

  /**
   * One tree with its visit history (corrected records replace the ones they correct) and photos. Visits carry the
   * date, status, height and remarks only: never who recorded them.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('share/:token/trees/:id')
  async tree(@Param('token') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const projectId = await this.resolve(token);
    const tree = await this.db.one(this.db, `${SHARE_TREE_SQL} WHERE t.id = $1 AND t.project_id = $2 AND t.record_state = 'ACTIVE'`, [id, projectId]);
    if (!tree) throw notFound('Tree');
    const [observations, media] = await Promise.all([
      this.db.query(
        `SELECT o.id, o.observed_at, o.visit_type, o.is_initial, o.is_amendment, o.height_cm::float8 AS height_cm, o.remarks,
                st.code AS status_code, st.name AS status_name, st.is_terminal AS status_terminal
           FROM tree_observations o JOIN tree_statuses st ON st.id = o.observed_status_id
          WHERE o.tree_id = $1 AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)
          ORDER BY o.observed_at DESC, o.recorded_at DESC`,
        [id],
      ),
      // A photo of a corrected visit belongs to the correction that replaced it.
      this.db.query(
        `SELECT m.id, COALESCE((SELECT a.id FROM tree_observations a WHERE a.amends_observation_id = m.observation_id ORDER BY a.recorded_at DESC LIMIT 1),
                               m.observation_id) AS observation_id, m.upload_state, m.captured_at
           FROM tree_media m WHERE m.tree_id = $1 AND m.upload_state = 'VERIFIED' ORDER BY m.captured_at DESC`,
        [id],
      ),
    ]);
    return { ...tree, observations: observations.rows, media: media.rows };
  }

  /** A signed URL (5 minutes) for one photo of the link's project: size=thumb (≈320 px) for lists, else the full photo. */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('share/:token/media/:id')
  async photo(@Param('token') token: string, @Param('id', ParseUUIDPipe) id: string, @Query('size') size?: string) {
    const projectId = await this.resolve(token);
    return this.media.projectViewUrl(projectId, id, size === 'thumb' ? 'thumb' : 'full');
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('share/:token/trees.csv')
  async treesCsv(@Param('token') token: string, @Query() query: unknown, @Res() res: Response) {
    const projectId = await this.resolve(token);
    const rows = (await this.reports.treeRows(SHARE_READER, { ...parse(Filter, query), project_id: projectId })).map(({ registered_by: _r, ...r }: any) => r);
    await this.audit.record({ actorId: null, action: 'share_link.export', entityType: 'report', projectId, metadata: { kind: 'trees.csv', rows: rows.length } });
    this.send(res, 'text/csv; charset=utf-8', 'trees.csv', toCsv(rows));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('share/:token/visits.csv')
  async visitsCsv(@Param('token') token: string, @Query() query: unknown, @Res() res: Response) {
    const projectId = await this.resolve(token);
    const f = { ...parse(VisitFilter, query), project_id: projectId };
    const { items } = await this.reports.visitRows(SHARE_READER, f, 100_000, 0);
    const rows = items.map(({ recorded_by: _r, status_terminal: _t, ...r }: any) => r);
    await this.audit.record({ actorId: null, action: 'share_link.export', entityType: 'report', projectId, metadata: { kind: 'visits.csv', rows: rows.length } });
    this.send(res, 'text/csv; charset=utf-8', 'visits.csv', toCsv(rows));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('share/:token/report.xlsx')
  async xlsx(@Param('token') token: string, @Query() query: unknown, @Res() res: Response) {
    const projectId = await this.resolve(token);
    const f = { ...parse(VisitFilter, query), project_id: projectId };
    const [summary, trees, visits] = await Promise.all([
      this.reports.summary(SHARE_READER, f),
      this.reports.treeRows(SHARE_READER, f),
      this.reports.visitRows(SHARE_READER, f, 100_000, 0),
    ]);
    const wb = new ExcelJS.Workbook();
    addSheet(wb, 'Summary', [{ generated_at: summary.generated_at, last_server_sync_at: summary.last_server_sync_at, ...summary.totals }]);
    addSheet(wb, 'By status', summary.by_status);
    addSheet(wb, 'By sector', summary.sector_share);
    addSheet(wb, 'Trees', trees.map(({ registered_by: _r, ...r }: any) => r));
    addSheet(wb, 'Visits', visits.items.map(({ recorded_by: _r, status_terminal: _t, ...r }: any) => r));
    await this.audit.record({ actorId: null, action: 'share_link.export', entityType: 'report', projectId, metadata: { kind: 'report.xlsx' } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }

  private send(res: Response, type: string, name: string, body: string) {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace('.', `-${new Date().toISOString().slice(0, 10)}.`)}"`);
    res.send(body);
  }
}
