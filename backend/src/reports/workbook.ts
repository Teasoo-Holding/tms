import ExcelJS from 'exceljs';
import { Db } from '../database/db.service';

export function addSheet(wb: ExcelJS.Workbook, name: string, rows: any[]) {
  const sheet = wb.addWorksheet(name);
  const header = rows.length ? Object.keys(rows[0]) : ['(no rows)'];
  sheet.columns = header.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r) => sheet.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v]))));
  return sheet;
}

export function toCsv(rows: any[], header = rows.length ? Object.keys(rows[0]) : []) {
  return '﻿' + [header.join(','), ...rows.map((r) => header.map((h) => csvCell(typeof r[h] === 'object' && r[h] !== null && !(r[h] instanceof Date) ? JSON.stringify(r[h]) : r[h])).join(','))].join('\n') + '\n';
}

/** Configuration of the given projects (null = every project), for full exports. */
export async function configurationSheets(db: Db, projectIds: string[] | null) {
  const q = (sql: string) => db.query(sql, [projectIds]).then((r) => r.rows);
  return {
    Projects: await q(`SELECT name, short_code, status, location, start_date, end_date, description, id FROM projects WHERE ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY name`),
    'Planting years': await q(`SELECT p.short_code AS project, y.year_label, y.start_date, y.end_date, y.active, y.id FROM planting_years y JOIN projects p ON p.id = y.project_id
                                WHERE ($1::uuid[] IS NULL OR y.project_id = ANY($1)) ORDER BY p.short_code, y.year_label`),
    Areas: await q(`SELECT p.short_code AS project, py.year_label AS planting_year, s.short_code AS sector, s.name AS sector_name, ss.short_code AS sub_sector,
                           ss.name AS sub_sector_name, ss.reference_latitude AS latitude, ss.reference_longitude AS longitude,
                           ST_AsText(COALESCE(ss.boundary_geometry, s.boundary_geometry)) AS boundary_wkt
                      FROM sectors s JOIN projects p ON p.id = s.project_id LEFT JOIN planting_years py ON py.id = s.planting_year_id
                      LEFT JOIN sub_sectors ss ON ss.sector_id = s.id
                     WHERE ($1::uuid[] IS NULL OR s.project_id = ANY($1)) ORDER BY p.short_code, py.year_label, s.short_code, ss.short_code`),
    Vendors: await q(`SELECT DISTINCT v.name, v.short_code, v.contact_name, v.contact_phone, v.contact_email, v.location, v.active
                        FROM vendors v WHERE $1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM planting_year_vendors l WHERE l.vendor_id = v.id AND l.project_id = ANY($1)) ORDER BY v.name`),
    Species: await q(`SELECT scientific_name, common_name, code, active FROM tree_species WHERE $1::uuid[] IS NULL OR TRUE ORDER BY scientific_name`),
  };
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
