import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { AppError, notFound } from '../common/errors';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { Filter, VisitFilter } from './reports.controller';
import { ReportsService } from './reports.service';
import { addSheet, toCsv } from './workbook';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const CreateLink = z.object({ label: z.string().trim().max(120).nullish(), expires_in_days: z.number().int().min(1).max(3650).nullish() });
/** Reports run as an unrestricted reader, always pinned to the link's project. */
const SHARE_READER: AuthUser = { id: '00000000-0000-0000-0000-000000000000', role: 'ADMIN' };

/**
 * Read-only links for clients and sponsors: one secret link per audience, for one project, with the
 * dashboard and exports and nothing else. Links can expire and be revoked; every use is recorded.
 */
@Controller()
export class ShareController {
  constructor(private readonly db: Db, private readonly reports: ReportsService, private readonly audit: AuditService) {}

  // ---------------------------------------------------------------- administration
  @Roles('ADMIN')
  @Get('projects/:id/share-links')
  async list(@Param('id', ParseUUIDPipe) projectId: string) {
    const { rows } = await this.db.query(
      `SELECT l.id, l.label, l.expires_at, l.revoked_at, l.last_used_at, l.created_at, u.full_name AS created_by_name
         FROM project_share_links l LEFT JOIN users u ON u.id = l.created_by WHERE l.project_id = $1 ORDER BY l.created_at DESC`,
      [projectId],
    );
    return rows;
  }

  /** The token is returned once; only its hash is stored. */
  @Roles('ADMIN')
  @Post('projects/:id/share-links')
  async create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(CreateLink, body ?? {});
    if (!(await this.db.one(this.db, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
    const token = randomBytes(24).toString('base64url');
    const row = await this.db.one(
      this.db,
      `INSERT INTO project_share_links (project_id, token_hash, label, created_by, expires_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END)
       RETURNING id, label, expires_at, created_at`,
      [projectId, sha256(token), b.label ?? null, user.id, b.expires_in_days ?? null],
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
    const [project, years, vendors, areas, summary] = await Promise.all([
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
      this.reports.summary(SHARE_READER, f),
    ]);
    // Clients see results, not staff: field officers' names are left out.
    const { officer_activity: _officers, ...shared } = summary as any;
    return { project, planting_years: years.rows, vendors: vendors.rows, areas: areas.rows, summary: shared };
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
    const rows = items.map(({ recorded_by: _r, ...r }: any) => r);
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
    addSheet(wb, 'Visits', visits.items.map(({ recorded_by: _r, ...r }: any) => r));
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
