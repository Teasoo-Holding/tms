import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validation';
import { ReportsService } from './reports.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Filter = z.object({
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
const VisitFilter = Filter.extend({
  recorded_by: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly audit: AuditService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.reports.summary(user, parse(Filter, query));
  }

  @Get('visits')
  visits(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(VisitFilter, query);
    return this.reports.visitRows(user, f, f.limit, f.offset);
  }

  @Get('visits.csv')
  async visitsCsv(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(VisitFilter, query);
    const { items } = await this.reports.visitRows(user, f, 100_000, 0);
    await this.audit.record({ actorId: user.id, action: 'export.csv', entityType: 'report', projectId: f.project_id, metadata: { rows: items.length, kind: 'visits' } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`);
    const header = ['observed_at', 'physical_tree_id', 'project', 'planting_year', 'sector', 'sub_sector', 'species', 'status', 'height_cm', 'height_method',
      'remarks', 'custom_fields', 'recorded_by', 'recorded_at', 'synced_at', 'photos', 'is_initial', 'is_amendment', 'superseded', 'amendment_reason', 'id', 'tree_id'];
    res.write('\uFEFF' + header.join(',') + '\n');
    for (const r of items) res.write(header.map((h) => csvCell(h === 'custom_fields' ? JSON.stringify(r[h] ?? {}) : r[h])).join(',') + '\n');
    res.end();
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
