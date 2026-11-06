import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validation';
import { ReportsService } from './reports.service';
import { addSheet, configurationSheets, csvCell } from './workbook';
import { Db } from '../database/db.service';
import { Roles } from '../common/auth.decorators';
import { badRequest } from '../common/errors';
import { TIME_ZONE } from '../domain/time';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const Filter = z.object({
  project_id: z.string().uuid().optional(),
  planting_year_id: z.string().uuid().optional(),
  sector_id: z.string().uuid().optional(),
  sub_sector_id: z.string().uuid().optional(),
  species_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  status_id: z.string().uuid().optional(),
  from: day.optional(),
  to: day.optional(),
  overdue_days: z.coerce.number().int().min(1).max(3650).default(90),
});
export const VisitFilter = Filter.extend({
  recorded_by: z.string().uuid().optional(),
  visit_type: z.enum(['VISIT', 'FIRST_INSTANCE', 'PLANTING', 'MAINTENANCE']).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
/** Visit days: the visits filters plus the time zone days are counted in. */
export const VisitDaysQuery = VisitFilter.extend({
  tz: z.string().trim().max(64).default(TIME_ZONE),
  limit: z.coerce.number().int().min(1).max(500).default(25),
});
/** One visit day of a project; field_session_id narrows it to one session ('none': records without one, with recorded_by). */
const VisitDayQuery = VisitDaysQuery.extend({
  project_id: z.string().uuid(),
  field_session_id: z.union([z.string().uuid(), z.literal('none')]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
/** Visit-day export columns ("Days" sheet). */
const VISIT_DAY_COLUMNS = ['date', 'project_name', 'trees_registered', 'visits', 'corrections', 'photos', 'collector_count', 'collectors', 'sessions',
  'first_at', 'last_at', 'records', 'project_id', 'time_zone'];

/** Density map: one project, optionally one planting year. */
export const DensityFilter = z.object({
  project_id: z.string().uuid(),
  planting_year_id: z.string().uuid().optional(),
});

/** Field activity: dates in the caller's time zone (IANA name, default UTC); the last 7 days unless given. */
export const FieldActivityQuery = z.object({
  project_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  from: day.optional(),
  to: day.optional(),
  tz: z.string().trim().max(64).default(TIME_ZONE),
});

/** Data freshness: one project or everything in the caller's scope. */
const FreshnessQuery = z.object({ project_id: z.string().uuid().optional() });

const MAX_ACTIVITY_DAYS = 366;

/** [d] when it is a real date (YYYY-MM-DD), else 400 DATE_INVALID. */
function realDay(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    throw badRequest('DATE_INVALID', 'Use a real date (YYYY-MM-DD).');
  }
  return d;
}

/** Visit export columns (CSV and Excel). */
const VISIT_COLUMNS = ['observed_at', 'visit_type', 'physical_tree_id', 'project', 'planting_year', 'sector', 'sub_sector', 'species', 'status', 'height_cm', 'height_method',
  'remarks', 'custom_fields', 'recorded_by', 'recorded_at', 'synced_at', 'photos', 'is_initial', 'is_amendment', 'superseded', 'amendment_reason', 'id', 'tree_id'];
/** Field-activity export columns: one row per field session. */
const FIELD_ACTIVITY_COLUMNS = ['date', 'user_name', 'first_at', 'last_at', 'project_name', 'planting_year', 'sectors', 'sub_sectors', 'vendors',
  'trees_registered', 'visits', 'corrections', 'photos', 'field_session_id', 'user_id', 'project_id', 'time_zone'];

async function sendWorkbook(res: Response, wb: ExcelJS.Workbook, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

/** The canonical IANA name of [name]; 400 TIME_ZONE_UNKNOWN when it is not one. */
function timeZone(name: string) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    throw badRequest('TIME_ZONE_UNKNOWN', `Unknown time zone "${name}". Use an IANA name such as Africa/Lagos.`);
  }
}

function fieldActivityFilter(query: unknown) {
  const q = parse(FieldActivityQuery, query);
  const tz = timeZone(q.tz);
  const dayMs = 86_400_000;
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
  // Today in the caller's zone (en-CA formats as YYYY-MM-DD).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const real = (d?: string) => !d || (!Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && shift(d, 0) === d);
  if (!real(q.from) || !real(q.to)) throw badRequest('DATE_INVALID', 'Use real dates (YYYY-MM-DD).');
  const to = q.to ?? (q.from ? shift(q.from, 6) : today);
  const from = q.from ?? shift(to, -6);
  if (from > to) throw badRequest('RANGE_INVALID', 'The start date is after the end date.');
  if ((Date.parse(to) - Date.parse(from)) / dayMs >= MAX_ACTIVITY_DAYS) throw badRequest('RANGE_TOO_LONG', `Choose at most ${MAX_ACTIVITY_DAYS} days.`);
  return { project_id: q.project_id, user_id: q.user_id, from, to, tz };
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly audit: AuditService, private readonly db: Db) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.reports.summary(user, parse(Filter, query));
  }

  /** Trees per hectare by sector and sub-sector, with their outlines, for the density map (web and Android). */
  @Roles('ADMIN', 'EXECUTIVE')
  @Get('density')
  density(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(DensityFilter, query);
    return this.reports.density(user, f.project_id, f.planting_year_id);
  }

  /** When the data was last synced, and what phones last reported still waiting to be sent. */
  @Roles('ADMIN', 'EXECUTIVE')
  @Get('freshness')
  freshness(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.reports.freshness(user, parse(FreshnessQuery, query).project_id);
  }

  /** Per officer and day, with the phone's field sessions: what was done, where and when. */
  @Roles('ADMIN', 'EXECUTIVE')
  @Get('field-activity')
  fieldActivity(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.reports.fieldActivity(user, fieldActivityFilter(query));
  }

  /** One row per field session. */
  @Roles('ADMIN', 'EXECUTIVE')
  @Get('field-activity.csv')
  async fieldActivityCsv(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = fieldActivityFilter(query);
    const rows = await this.fieldActivityRows(user, f);
    await this.audit.record({ actorId: user.id, action: 'export.csv', entityType: 'report', projectId: f.project_id, metadata: { rows: rows.length, kind: 'field-activity' } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="field-activity-${f.from}-to-${f.to}.csv"`);
    res.write('\uFEFF' + FIELD_ACTIVITY_COLUMNS.join(',') + '\n');
    for (const r of rows) res.write(FIELD_ACTIVITY_COLUMNS.map((h) => csvCell(r[h])).join(',') + '\n');
    res.end();
  }

  /** The same rows as the CSV (one per field session), as an Excel sheet. */
  @Roles('ADMIN', 'EXECUTIVE')
  @Get('field-activity.xlsx')
  async fieldActivityXlsx(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = fieldActivityFilter(query);
    const rows = await this.fieldActivityRows(user, f);
    await this.audit.record({ actorId: user.id, action: 'export.xlsx', entityType: 'report', projectId: f.project_id, metadata: { rows: rows.length, kind: 'field-activity' } });
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    addSheet(wb, 'Field activity', rows);
    await sendWorkbook(res, wb, `field-activity-${f.from}-to-${f.to}.xlsx`);
  }

  private async fieldActivityRows(user: AuthUser, f: ReturnType<typeof fieldActivityFilter>) {
    const report = await this.reports.fieldActivity(user, f);
    return report.days.flatMap((d) =>
      d.sessions.map((s: any) => {
        const r: any = { date: d.date, user_name: d.user_name, user_id: d.user_id, ...s, time_zone: f.tz };
        return Object.fromEntries(FIELD_ACTIVITY_COLUMNS.map((k) => [k, Array.isArray(r[k]) ? r[k].join(' ') : r[k]]));
      }),
    );
  }

  @Get('visits')
  visits(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(VisitFilter, query);
    return this.reports.visitRows(user, f, f.limit, f.offset);
  }

  /** The visits page: one row per project and day (in tz), newest first. */
  @Get('visit-days')
  visitDays(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(VisitDaysQuery, query);
    return this.reports.visitDays(user, f, timeZone(f.tz), f.limit, f.offset);
  }

  /** One visit day of one project, grouped by field session and data collector. */
  @Get('visit-days/:date')
  visitDay(@CurrentUser() user: AuthUser, @Param('date') date: string, @Query() query: unknown) {
    const f = parse(VisitDayQuery, query);
    return this.reports.visitDay(user, { ...f, date: realDay(date) }, timeZone(f.tz));
  }

  /** The tree records of one visit day (or one of its sessions), in time order, paginated. */
  @Get('visit-days/:date/records')
  visitDayRecords(@CurrentUser() user: AuthUser, @Param('date') date: string, @Query() query: unknown) {
    const f = parse(VisitDayQuery, query);
    return this.reports.visitDayRecords(user, { ...f, date: realDay(date) }, timeZone(f.tz), f.limit, f.offset);
  }

  @Get('visits.csv')
  async visitsCsv(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(VisitFilter, query);
    const { items } = await this.reports.visitRows(user, f, 100_000, 0);
    await this.audit.record({ actorId: user.id, action: 'export.csv', entityType: 'report', projectId: f.project_id, metadata: { rows: items.length, kind: 'visits' } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('\uFEFF' + VISIT_COLUMNS.join(',') + '\n');
    for (const r of items) res.write(VISIT_COLUMNS.map((h) => csvCell(h === 'custom_fields' ? JSON.stringify(r[h] ?? {}) : r[h])).join(',') + '\n');
    res.end();
  }

  /** The visits table (with its filters) as an Excel sheet: the same columns as the CSV. */
  @Get('visits.xlsx')
  async visitsXlsx(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(VisitDaysQuery, query);
    const tz = timeZone(f.tz);
    const [{ items }, days] = await Promise.all([this.reports.visitRows(user, f, 1_000_000, 0), this.reports.visitDays(user, f, tz, 1_000_000, 0)]);
    await this.audit.record({ actorId: user.id, action: 'export.xlsx', entityType: 'report', projectId: f.project_id, metadata: { rows: items.length, days: days.total, kind: 'visits' } });
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    // "Days" (one row per project and day, as on the visits page) first, then every record.
    addSheet(wb, 'Days', days.items.map((d: any) => {
      const r: any = { ...d, collectors: d.collectors.map((c: any) => c.user_name).join(', '), time_zone: tz };
      return Object.fromEntries(VISIT_DAY_COLUMNS.map((h) => [h, r[h]]));
    }));
    addSheet(wb, 'Visits', items.map((r: any) => Object.fromEntries(VISIT_COLUMNS.map((h) => [h, r[h]]))));
    await sendWorkbook(res, wb, `visits-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get('trees.csv')
  async csv(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(Filter, query);
    const rows = await this.reports.treeRows(user, f);
    await this.audit.record({ actorId: user.id, action: 'export.csv', entityType: 'report', projectId: f.project_id, metadata: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trees-${new Date().toISOString().slice(0, 10)}.csv"`);
    const header = rows.length ? Object.keys(rows[0]) : ['physical_tree_id'];
    res.write('﻿' + header.join(',') + '\n');
    for (const r of rows) res.write(header.map((h) => csvCell(r[h])).join(',') + '\n');
    res.end();
  }

  /**
   * Everything in one workbook (respecting the filters): notes, the summary, trees, visits and configuration. The
   * dashboard's only Excel action for administrators; others get trees.xlsx.
   */
  @Roles('ADMIN')
  @Get('export.xlsx')
  async exportAll(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(VisitFilter, query);
    const [summary, trees, visits, config] = await Promise.all([
      this.reports.summary(user, f),
      this.reports.treeRows(user, f),
      this.reports.visitRows(user, f, 1_000_000, 0),
      configurationSheets(this.db, f.project_id ? [f.project_id] : null),
    ]);
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    // What the trees-only workbook had first: when it was made, the last sync and how to read the counts.
    const info = wb.addWorksheet('About');
    info.addRows([
      ['Tree Management System export'],
      ['Generated at', summary.generated_at],
      ['Last server sync', summary.last_server_sync_at ?? 'never'],
      ...summary.notes.map((n) => ['Note', n]),
    ]);
    info.getColumn(1).width = 18;
    info.getColumn(2).width = 100;
    addSheet(wb, 'Summary', [{ generated_at: summary.generated_at, last_server_sync_at: summary.last_server_sync_at, ...summary.totals,
      maintenance_overdue_trees: summary.maintenance.overdue_trees, maintenance_due_soon_trees: summary.maintenance.due_soon_trees }]);
    addSheet(wb, 'By status', summary.by_status);
    addSheet(wb, 'By sector', summary.sector_share);
    addSheet(wb, 'Trees', trees);
    addSheet(wb, 'Visits', visits.items.map(({ status_terminal: _t, ...r }: any) => r));
    for (const [name, rows] of Object.entries(config)) addSheet(wb, name, rows);
    await this.audit.record({ actorId: user.id, action: 'export.xlsx', entityType: 'report', projectId: f.project_id, metadata: { kind: 'all', trees: trees.length, visits: visits.items.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tms-export-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }

  @Get('trees.xlsx')
  async xlsx(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(Filter, query);
    const [rows, summary] = await Promise.all([this.reports.treeRows(user, f), this.reports.summary(user, f)]);
    await this.audit.record({ actorId: user.id, action: 'export.xlsx', entityType: 'report', projectId: f.project_id, metadata: { rows: rows.length } });
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const info = wb.addWorksheet('About');
    info.addRows([
      ['Tree Management System export'],
      ['Generated at', summary.generated_at],
      ['Last server sync', summary.last_server_sync_at ?? 'never'],
      ...summary.notes.map((n) => ['Note', n]),
    ]);
    const sheet = wb.addWorksheet('Trees');
    const header = rows.length ? Object.keys(rows[0]) : ['physical_tree_id'];
    sheet.columns = header.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((r) => sheet.addRow(r));
    const byStatus = wb.addWorksheet('By status');
    byStatus.addRow(['Status', 'Registered trees']);
    summary.by_status.forEach((s: any) => byStatus.addRow([s.name, s.count]));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="trees-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }
}
