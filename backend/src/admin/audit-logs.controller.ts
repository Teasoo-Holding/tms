import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { addSheet } from '../reports/workbook';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const AuditFilter = z.object({
  /** Free text across the person, action, entity and the recorded details (before/after/metadata). */
  q: z.string().trim().max(200).optional(),
  actor_id: z.string().uuid().optional(),
  /** Alias of actor_id. */
  user_id: z.string().uuid().optional(),
  /** Matched as a prefix, so "tree." covers every tree action. */
  action: z.string().trim().max(100).optional(),
  entity_type: z.string().trim().max(60).optional(),
  /** Alias of entity_type. */
  entity: z.string().trim().max(60).optional(),
  entity_id: z.string().trim().max(100).optional(),
  project_id: z.string().uuid().optional(),
  from: day.optional(),
  to: day.optional(),
});
type AuditFilter = z.infer<typeof AuditFilter>;

/** Sortable columns. The id breaks ties so paging is stable. */
const SORTS = {
  time: 'l.created_at',
  user: 'l.actor_name',
  action: 'l.action',
  entity: 'l.entity_type',
} as const;
const Sorted = {
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).default('time'),
  /** Defaults to newest first for time and A–Z for the other columns. */
  order: z.enum(['asc', 'desc']).optional(),
};
const SearchQuery = AuditFilter.extend({
  ...Sorted,
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const ExportQuery = AuditFilter.extend(Sorted);
/** The original list (still used by the Android app): newest first, paged with before_id. */
const ListQuery = AuditFilter.extend({
  limit: z.coerce.number().int().min(1).catch(100).transform((n) => Math.min(n, 500)).default(100),
  before_id: z.coerce.number().int().positive().optional(),
});

// entity_label names the record in words (tree ID, project, user) so the log reads without lookups.
const ENTRIES_SQL = `
  SELECT l.*, u.full_name AS actor_name, u.role AS actor_role, p.name AS project_name,
         COALESCE(t.physical_tree_id, ot.physical_tree_id, pe.name, ue.full_name, l.after ->> 'name', l.after ->> 'label',
                  l.after ->> 'year_label', l.before ->> 'name') AS entity_label,
         COALESCE(t.id, ot.id) AS tree_id
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.actor_id
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN trees t ON l.entity_type = 'tree' AND t.id::text = l.entity_id
    LEFT JOIN tree_observations o ON l.entity_type = 'observation' AND o.id::text = l.entity_id
    LEFT JOIN trees ot ON ot.id = o.tree_id
    LEFT JOIN projects pe ON l.entity_type = 'project' AND pe.id::text = l.entity_id
    LEFT JOIN users ue ON l.entity_type = 'user' AND ue.id::text = l.entity_id`;

/** WHERE clause over the entries (aliased `l`) and its parameters. */
function whereOf(f: AuditFilter, params: unknown[] = []) {
  const where: string[] = ['TRUE'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace(/\?/g, `$${params.length}`));
  };
  const actor = f.actor_id ?? f.user_id;
  const entityType = f.entity_type ?? f.entity;
  if (actor) add('l.actor_id = ?', actor);
  if (f.action) add(`l.action LIKE ? || '%'`, f.action.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (entityType) add('l.entity_type = ?', entityType);
  if (f.entity_id) add('l.entity_id = ?', f.entity_id);
  if (f.project_id) add('l.project_id = ?', f.project_id);
  if (f.from) add('l.created_at >= ?::date', f.from);
  if (f.to) add('l.created_at < ?::date + 1', f.to);
  if (f.q) {
    // Actions also match as words ("tree create"), so a search reads like the activity names.
    add(
      `(l.actor_name ILIKE ? OR l.action ILIKE ? OR replace(replace(l.action, '.', ' '), '_', ' ') ILIKE ? OR l.entity_type ILIKE ?
        OR l.entity_label ILIKE ? OR l.entity_id ILIKE ? OR l.project_name ILIKE ?
        OR l.before::text ILIKE ? OR l.after::text ILIKE ? OR l.metadata::text ILIKE ?)`,
      `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    );
  }
  return { sql: where.join(' AND '), params };
}

function orderOf(sort: keyof typeof SORTS, order?: 'asc' | 'desc') {
  const dir = (order ?? (sort === 'time' ? 'desc' : 'asc')).toUpperCase();
  const col = SORTS[sort];
  // Entries without a person ("System") and entity labels sort after named ones either way.
  const extra = sort === 'entity' ? `, l.entity_label ${dir} NULLS LAST` : '';
  return `${col} ${dir} NULLS LAST${extra}, l.id ${sort === 'time' ? dir : 'DESC'}`;
}

/** The audit trail, read-only: who did what, to which record, when. Administrators only. */
@Roles('ADMIN')
@Controller()
export class AuditLogsController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  @Get('audit-logs')
  async list(@Query() query: unknown) {
    const f = parse(ListQuery, query);
    const w = whereOf(f);
    if (f.before_id) {
      w.params.push(f.before_id);
      w.sql += ` AND l.id < $${w.params.length}`;
    }
    const { rows } = await this.db.query(`SELECT * FROM (${ENTRIES_SQL}) l WHERE ${w.sql} ORDER BY l.id DESC LIMIT ${f.limit}`, w.params);
    return rows;
  }

  /** Search, filters and sorting with offset paging: `{ items, total, limit, offset }`. */
  @Get('audit-logs/search')
  async search(@Query() query: unknown) {
    const f = parse(SearchQuery, query);
    const w = whereOf(f);
    const { rows } = await this.db.query(
      `SELECT l.*, count(*) OVER () AS total FROM (${ENTRIES_SQL}) l WHERE ${w.sql}
        ORDER BY ${orderOf(f.sort, f.order)} LIMIT ${f.limit} OFFSET ${f.offset}`,
      w.params,
    );
    const total = rows.length ? Number(rows[0].total) : f.offset ? Number((await this.db.query(`SELECT count(*) AS n FROM (${ENTRIES_SQL}) l WHERE ${w.sql}`, w.params)).rows[0].n) : 0;
    return { items: rows.map(({ total: _t, ...r }) => r), total, limit: f.limit, offset: f.offset };
  }

  /** The entity types and actions that occur in the log, for the filter lists. */
  @Get('audit-logs/facets')
  async facets() {
    const [entities, actions] = await Promise.all([
      this.db.query('SELECT DISTINCT entity_type FROM audit_logs ORDER BY 1'),
      this.db.query('SELECT DISTINCT action FROM audit_logs ORDER BY 1'),
    ]);
    return { entity_types: entities.rows.map((r) => r.entity_type), actions: actions.rows.map((r) => r.action) };
  }

  /** The filtered, sorted log as one Excel sheet. */
  @Get('audit-logs.xlsx')
  async xlsx(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(ExportQuery, query);
    const w = whereOf(f);
    const { rows } = await this.db.query(
      `SELECT l.created_at AS time, COALESCE(l.actor_name, 'System') AS person, l.actor_role AS role, l.action, l.entity_type,
              l.entity_label AS entity, l.entity_id, l.project_name AS project, l.before, l.after, l.metadata, l.id
         FROM (${ENTRIES_SQL}) l WHERE ${w.sql} ORDER BY ${orderOf(f.sort, f.order)} LIMIT 100000`,
      w.params,
    );
    await this.audit.record({ actorId: user.id, action: 'export.xlsx', entityType: 'report', metadata: { kind: 'audit-log', rows: rows.length } });
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    addSheet(wb, 'Audit log', rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }
}
