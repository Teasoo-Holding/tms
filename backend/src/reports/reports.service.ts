import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.decorators';
import { notFound } from '../common/errors';
import { Db } from '../database/db.service';

export interface FieldActivityFilter {
  project_id?: string;
  user_id?: string;
  /** Inclusive dates (YYYY-MM-DD) in [tz]. */
  from: string;
  to: string;
  /** IANA time zone the days are counted in. */
  tz: string;
}

/** Weekly counts with the missing weeks filled in as zero, plus the running total. */
function fillWeeks(rows: { week: string; trees: number }[]) {
  if (!rows.length) return [];
  const byWeek = new Map(rows.map((r) => [r.week, r.trees]));
  const out: { week: string; trees: number; cumulative: number }[] = [];
  let total = 0;
  const week = 7 * 86_400_000;
  const last = new Date(`${rows[rows.length - 1].week}T00:00:00Z`).getTime();
  // At most ten years of weeks (a mistyped planting date should not produce thousands of empty weeks).
  const first = Math.max(new Date(`${rows[0].week}T00:00:00Z`).getTime(), last - 520 * week);
  total = rows.filter((r) => new Date(`${r.week}T00:00:00Z`).getTime() < first).reduce((n, r) => n + r.trees, 0);
  for (let t = first; t <= last; t += week) {
    const label = new Date(t).toISOString().slice(0, 10);
    const trees = byWeek.get(label) ?? 0;
    total += trees;
    out.push({ week: label, trees, cumulative: total });
  }
  return out;
}

export interface ReportFilter {
  project_id?: string;
  planting_year_id?: string;
  sector_id?: string;
  sub_sector_id?: string;
  species_id?: string;
  vendor_id?: string;
  /** Current status (from each tree's latest visit). */
  status_id?: string;
  /** Date range (YYYY-MM-DD, inclusive): trees registered and visits recorded in the period. */
  from?: string;
  to?: string;
  overdue_days: number;
}

/**
 * Dashboard metrics. Counts are of *registered* trees and recorded observations; they are not
 * survival rates. Trees without a recent observation are reported as unknown/overdue, separately
 * from trees confirmed dead or missing.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: Db, private readonly access: AccessService) {}

  private async scope(user: AuthUser, f: ReportFilter) {
    const grants = await this.access.grants(user);
    const params: unknown[] = [];
    const where = [`t.record_state = 'ACTIVE'`];
    if (f.project_id) {
      params.push(f.project_id);
      where.push(`t.project_id = $${params.length}`);
    }
    const eq = (col: string, v?: string) => {
      if (!v) return;
      params.push(v);
      where.push(`${col} = $${params.length}`);
    };
    eq('t.planting_year_id', f.planting_year_id);
    eq('t.sector_id', f.sector_id);
    eq('t.sub_sector_id', f.sub_sector_id);
    eq('t.species_id', f.species_id);
    eq('t.vendor_id', f.vendor_id);
    eq('t.current_status_id', f.status_id);
    const s = this.access.treeFilter(grants, 't', params.length + 1);
    params.push(...s.params);
    where.push(s.sql);
    params.push(f.from ?? null, f.to ?? null);
    const from = `$${params.length - 1}::date`;
    const to = `$${params.length}::date`;
    const inRange = (col: string) => `(${from} IS NULL OR ${col} >= ${from}) AND (${to} IS NULL OR ${col} < ${to} + 1)`;
    // Tree counts: trees registered in the period. Visit metrics use [visitWhere] (any tree, visit in the period).
    const treeWhere = [...where, inRange('t.created_at')].join(' AND ');
    return { where: treeWhere, baseWhere: where.join(' AND '), inRange, from, to, params, grants };
  }

  async summary(user: AuthUser, f: ReportFilter) {
    const { where, baseWhere, inRange, from, to, params } = await this.scope(user, f);
    const q = (sql: string, extra: unknown[] = []) => this.db.query(sql, [...params, ...extra]).then((r) => r.rows);
    const n = params.length;
    const overdueParam = `$${n + 1}`;

    const [totals] = await q(
      `SELECT count(*) AS planting_events,
              count(*) FILTER (WHERE t.replaces_tree_id IS NULL) AS original_trees,
              count(*) FILTER (WHERE t.replaces_tree_id IS NOT NULL) AS replacement_trees,
              count(*) FILTER (WHERE st.is_terminal) AS terminal_status_trees,
              count(*) FILTER (WHERE NOT COALESCE(st.is_terminal, false)
                                 AND (t.last_observed_at IS NULL OR t.last_observed_at < now() - make_interval(days => ${overdueParam}::int))) AS overdue_unknown_trees
         FROM trees t LEFT JOIN tree_statuses st ON st.id = t.current_status_id WHERE ${where}`,
      [f.overdue_days],
    );
    const group = (select: string, join: string, groupBy: string, order = 'count DESC') =>
      q(`SELECT ${select}, count(*)::int AS count FROM trees t ${join} WHERE ${where} GROUP BY ${groupBy} ORDER BY ${order}`);

    const [byStatus, byYear, bySector, bySpecies, byVendor] = await Promise.all([
      group(`COALESCE(st.code, 'UNKNOWN') AS code, COALESCE(st.name, 'Not observed') AS name, COALESCE(st.is_terminal, false) AS is_terminal`,
        'LEFT JOIN tree_statuses st ON st.id = t.current_status_id', 'st.code, st.name, st.is_terminal, st.sort_order', 'st.sort_order NULLS LAST'),
      group(`py.id, py.year_label AS name,
             count(*) FILTER (WHERE t.replaces_tree_id IS NULL)::int AS original_trees,
             count(*) FILTER (WHERE t.replaces_tree_id IS NOT NULL)::int AS replacement_trees`,
        'JOIN planting_years py ON py.id = t.planting_year_id', 'py.id, py.year_label', 'py.year_label'),
      group(`s.id, s.name, s.short_code`, 'JOIN sectors s ON s.id = t.sector_id', 's.id, s.name, s.short_code', 's.short_code'),
      group(`sp.id, sp.scientific_name AS name, sp.common_name`, 'JOIN tree_species sp ON sp.id = t.species_id', 'sp.id, sp.scientific_name, sp.common_name'),
      group(`v.id, COALESCE(v.name, 'No vendor') AS name, v.short_code`, 'LEFT JOIN vendors v ON v.id = t.vendor_id', 'v.id, v.name, v.short_code'),
    ]);

    // Trees planted per week (planting date, else registration date), with the running total, for "planted over time".
    const plantedWeeks = await q(
      `SELECT to_char(date_trunc('week', COALESCE(t.planted_on::timestamp, t.created_at)), 'YYYY-MM-DD') AS week, count(*)::int AS trees
         FROM trees t WHERE ${where} GROUP BY 1 ORDER BY 1`,
    );

    // Effective (non-superseded) observations per month and status for the last 12 months.
    const trend = await q(
      `SELECT to_char(date_trunc('month', o.observed_at), 'YYYY-MM') AS month, st.code, st.name, count(*)::int AS count
         FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN tree_statuses st ON st.id = o.observed_status_id
        WHERE ${baseWhere} AND ${inRange('o.observed_at')}
          AND o.observed_at >= COALESCE(${from}, date_trunc('month', now()) - interval '11 months')
          AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)
        GROUP BY 1, 2, 3, st.sort_order ORDER BY 1, st.sort_order`,
    );

    // Average height of measured trees per month (latest effective measurement per tree in that month).
    const growth = await q(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, m.species_id, sp.scientific_name AS species_name, sp.common_name AS species_common_name,
              ROUND(avg(m.height_cm)::numeric, 1)::float8 AS avg_height_cm, count(*)::int AS measured_trees
         FROM (SELECT DISTINCT ON (o.tree_id, date_trunc('month', o.observed_at))
                      date_trunc('month', o.observed_at) AS month, o.tree_id, t.species_id, o.height_cm
                 FROM tree_observations o JOIN trees t ON t.id = o.tree_id
                WHERE ${baseWhere} AND o.height_cm IS NOT NULL AND ${inRange('o.observed_at')}
                  AND o.observed_at >= COALESCE(${from}, date_trunc('month', now()) - interval '23 months')
                  AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)
                ORDER BY o.tree_id, date_trunc('month', o.observed_at), o.observed_at DESC) m
         JOIN tree_species sp ON sp.id = m.species_id
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 3`,
    );

    // Registrations and observations per week for the last 12 weeks (field activity).
    const activity = await q(
      // At most 52 weeks: the last 12 by default, or the weeks of the chosen period.
      `WITH bounds AS (SELECT date_trunc('week', COALESCE(${to}::timestamptz, now())) AS last_week),
            weeks AS (SELECT generate_series(GREATEST(date_trunc('week', COALESCE(${from}::timestamptz, b.last_week - interval '11 weeks')), b.last_week - interval '51 weeks'),
                                             b.last_week, interval '1 week') AS week FROM bounds b)
       SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
              (SELECT count(*) FROM trees t WHERE ${baseWhere} AND date_trunc('week', t.created_at) = w.week)::int AS registrations,
              (SELECT count(*) FROM tree_observations o JOIN trees t ON t.id = o.tree_id
                WHERE ${baseWhere} AND NOT o.is_initial AND date_trunc('week', o.observed_at) = w.week)::int AS observations
         FROM weeks w ORDER BY w.week`,
    );

    const statusBy = (dim: string, join: string, groupBy: string) =>
      q(`SELECT ${dim}, COALESCE(st.code, 'UNKNOWN') AS code, COALESCE(st.name, 'Not observed') AS status_name, count(*)::int AS count
           FROM trees t ${join} LEFT JOIN tree_statuses st ON st.id = t.current_status_id
          WHERE ${where} GROUP BY ${groupBy}, st.code, st.name, st.sort_order ORDER BY ${groupBy}, st.sort_order NULLS LAST`);
    const [statusBySector, statusBySpecies] = await Promise.all([
      statusBy(`s.short_code AS group_code, s.name AS group_name`, 'JOIN sectors s ON s.id = t.sector_id', 's.short_code, s.name'),
      statusBy(`sp.scientific_name AS group_code, COALESCE(sp.common_name, sp.scientific_name) AS group_name`, 'JOIN tree_species sp ON sp.id = t.species_id', 'sp.scientific_name, sp.common_name'),
    ]);

    const coverage = await q(
      `SELECT ss.id, ss.name, ss.short_code, s.id AS sector_id, s.short_code AS sector_code, s.name AS sector_name,
              ss.reference_latitude::float8 AS latitude, ss.reference_longitude::float8 AS longitude,
              ROUND((ST_Area(ss.boundary_geometry::geography) / 10000)::numeric, 2) AS area_hectares,
              count(t.id)::int AS registered_trees,
              count(t.id) FILTER (WHERE st.id IS NOT NULL AND NOT st.is_terminal)::int AS alive_trees,
              count(t.id) FILTER (WHERE st.is_terminal)::int AS dead_trees,
              count(t.id) FILTER (WHERE st.id IS NULL)::int AS unknown_trees
         FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id
         LEFT JOIN trees t ON t.sub_sector_id = ss.id AND ${where}
         LEFT JOIN tree_statuses st ON st.id = t.current_status_id
        WHERE ss.project_id IN (SELECT DISTINCT t.project_id FROM trees t WHERE ${where}) OR ss.project_id = $${n + 1}::uuid
        GROUP BY ss.id, ss.name, ss.short_code, s.id, s.short_code, s.name ORDER BY s.short_code, ss.short_code`,
      [f.project_id ?? null],
    );
    // Alive/dead share per sector, for the map.
    const sectorShare = [...coverage.reduce((m: Map<string, any>, r: any) => {
      const x = m.get(r.sector_id) ?? { id: r.sector_id, short_code: r.sector_code, name: r.sector_name, registered_trees: 0, alive_trees: 0, dead_trees: 0, unknown_trees: 0 };
      for (const k of ['registered_trees', 'alive_trees', 'dead_trees', 'unknown_trees']) x[k] += r[k];
      return m.set(r.sector_id, x);
    }, new Map()).values()];

    const [completeness] = await q(
      `SELECT count(*) FILTER (WHERE t.planted_on IS NULL)::int AS missing_planted_on,
              count(*) FILTER (WHERE t.last_observed_at IS NULL)::int AS never_observed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tree_media m WHERE m.tree_id = t.id AND m.upload_state <> 'VERIFIED'))::int AS trees_with_unverified_photos
         FROM trees t WHERE ${where}`,
    );
    const projectIds = await this.access.projectIds(user);
    const [ops] = (
      await this.db.query(
        `SELECT (SELECT count(*) FROM conflict_records c WHERE c.status = 'OPEN' AND ($1::uuid IS NULL OR c.project_id = $1)
                   AND ($2::uuid[] IS NULL OR c.project_id = ANY($2)))::int AS open_conflicts,
                (SELECT max(t.synced_at) FROM trees t WHERE ($1::uuid IS NULL OR t.project_id = $1) AND ($2::uuid[] IS NULL OR t.project_id = ANY($2))) AS last_tree_sync_at,
                (SELECT max(o.synced_at) FROM tree_observations o JOIN trees t ON t.id = o.tree_id
                  WHERE ($1::uuid IS NULL OR t.project_id = $1) AND ($2::uuid[] IS NULL OR t.project_id = ANY($2))) AS last_observation_sync_at,
                (SELECT max(received_at) FROM sync_batches) AS last_sync_batch_at,
                (SELECT count(*) FROM devices WHERE revoked_at IS NULL AND (last_sync_at IS NULL OR last_sync_at < now() - interval '7 days'))::int AS devices_not_synced_7_days`,
        [f.project_id ?? null, projectIds],
      )
    ).rows;

    const officers = await q(
      `SELECT u.id, u.full_name,
              count(DISTINCT t.id) FILTER (WHERE t.created_at >= now() - interval '30 days')::int AS trees_registered_30d,
              (SELECT count(*) FROM tree_observations o JOIN trees t2 ON t2.id = o.tree_id
                WHERE o.recorded_by = u.id AND o.recorded_at >= now() - interval '30 days')::int AS observations_30d,
              (SELECT max(d.last_sync_at) FROM devices d WHERE d.user_id = u.id) AS last_sync_at
         FROM users u JOIN trees t ON t.created_by = u.id WHERE ${where}
        GROUP BY u.id, u.full_name ORDER BY trees_registered_30d DESC, u.full_name`,
    );

    const lastServerSync = [ops.last_tree_sync_at, ops.last_observation_sync_at].filter(Boolean).sort().pop() ?? null;
    return {
      generated_at: new Date().toISOString(),
      last_server_sync_at: lastServerSync,
      overdue_days: f.overdue_days,
      totals,
      by_status: byStatus,
      by_planting_year: byYear,
      by_sector: bySector,
      by_species: bySpecies,
      by_vendor: byVendor,
      planted_by_week: fillWeeks(plantedWeeks),
      observation_trend: trend,
      growth,
      activity_by_week: activity,
      status_by_sector: statusBySector,
      status_by_species: statusBySpecies,
      area_coverage: coverage,
      sector_share: sectorShare,
      filters: { ...f },
      data_completeness: { ...completeness, open_conflicts: ops.open_conflicts, devices_not_synced_7_days: ops.devices_not_synced_7_days },
      officer_activity: officers,
      notes: [
        'Counts are registered trees, not survival rates.',
        'Replacement trees are counted separately from original trees; planting events = original + replacement.',
        `Trees without an observation in the last ${f.overdue_days} days are "unknown/overdue", not dead or missing.`,
        'Area coverage uses administrator-defined sub-sector boundaries; trees have no individual GPS positions.',
      ],
    };
  }

  /**
   * Field activity per officer and day, split into the phone's field sessions: trees registered (first visits), later
   * visits, corrections (amendments, counted apart from visits) and photos. A day is the date of observed_at in the
   * caller's time zone. Records of rejected trees are left out. Observations without a field session (older apps)
   * form one session per officer and day.
   */
  async fieldActivity(user: AuthUser, f: FieldActivityFilter) {
    if (f.project_id) await this.access.assertProject(user, f.project_id);
    const grants = await this.access.grants(user);
    const params: unknown[] = [f.from, f.to, f.tz, f.project_id ?? null, f.user_id ?? null];
    const g = this.access.treeFilter(grants, 't', params.length + 1);
    params.push(...g.params);
    const { rows } = await this.db.query(
      `WITH o AS (
         SELECT o.id, o.recorded_by, o.observed_at, o.field_session_id, o.is_initial, o.is_amendment,
                (o.observed_at AT TIME ZONE $3)::date AS day, t.project_id, t.planting_year_id, t.sector_id, t.sub_sector_id, t.vendor_id,
                (SELECT count(*) FROM tree_media m WHERE m.observation_id = o.id)::int AS photos
           FROM tree_observations o JOIN trees t ON t.id = o.tree_id
          WHERE o.observed_at >= ($1::date)::timestamp AT TIME ZONE $3 AND o.observed_at < ($2::date + 1)::timestamp AT TIME ZONE $3
            AND t.record_state <> 'REJECTED' AND ($4::uuid IS NULL OR t.project_id = $4) AND ($5::uuid IS NULL OR o.recorded_by = $5)
            AND ${g.sql})
       SELECT to_char(o.day, 'YYYY-MM-DD') AS date, o.recorded_by AS user_id, u.full_name AS user_name, u.role,
              o.field_session_id, o.project_id, p.name AS project_name, py.year_label AS planting_year,
              min(o.observed_at) AS first_at, max(o.observed_at) AS last_at,
              array_agg(DISTINCT s.short_code ORDER BY s.short_code) AS sectors,
              array_agg(DISTINCT s.short_code || '/' || ss.short_code ORDER BY s.short_code || '/' || ss.short_code) AS sub_sectors,
              array_remove(array_agg(DISTINCT COALESCE(v.short_code, v.name) ORDER BY COALESCE(v.short_code, v.name)), NULL) AS vendors,
              count(*) FILTER (WHERE o.is_initial)::int AS trees_registered,
              count(*) FILTER (WHERE NOT o.is_initial AND NOT o.is_amendment)::int AS visits,
              count(*) FILTER (WHERE o.is_amendment)::int AS corrections,
              sum(o.photos)::int AS photos
         FROM o JOIN users u ON u.id = o.recorded_by JOIN projects p ON p.id = o.project_id
         JOIN planting_years py ON py.id = o.planting_year_id JOIN sectors s ON s.id = o.sector_id
         JOIN sub_sectors ss ON ss.id = o.sub_sector_id LEFT JOIN vendors v ON v.id = o.vendor_id
        GROUP BY o.day, o.recorded_by, u.full_name, u.role, o.field_session_id, o.project_id, p.name, py.year_label
        ORDER BY o.day DESC, u.full_name, min(o.observed_at)`,
      params,
    );
    const iso = (d: Date | string) => new Date(d).toISOString();
    const counts = (xs: any[]) => ({
      trees_registered: xs.reduce((n, x) => n + x.trees_registered, 0),
      visits: xs.reduce((n, x) => n + x.visits, 0),
      corrections: xs.reduce((n, x) => n + x.corrections, 0),
      photos: xs.reduce((n, x) => n + x.photos, 0),
    });
    // One entry per officer and day, holding that day's sessions (rows arrive ordered by day, name, start).
    const days = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.date}|${r.user_id}`;
      if (!days.has(key)) days.set(key, { date: r.date, user_id: r.user_id, user_name: r.user_name, role: r.role, sessions: [] as any[] });
      days.get(key).sessions.push({
        field_session_id: r.field_session_id, first_at: iso(r.first_at), last_at: iso(r.last_at),
        project_id: r.project_id, project_name: r.project_name, planting_year: r.planting_year,
        sectors: r.sectors, sub_sectors: r.sub_sectors, vendors: r.vendors,
        trees_registered: r.trees_registered, visits: r.visits, corrections: r.corrections, photos: r.photos,
      });
    }
    const dayRows = [...days.values()].map(({ role: _role, sessions, ...d }) => ({
      ...d,
      ...counts(sessions),
      first_at: sessions.map((x: any) => x.first_at).sort()[0],
      last_at: sessions.map((x: any) => x.last_at).sort().pop(),
      sessions,
    }));
    const officers = new Map<string, any>();
    for (const d of days.values()) {
      const o = officers.get(d.user_id) ?? { user_id: d.user_id, user_name: d.user_name, role: d.role, days: [] as any[] };
      officers.set(d.user_id, o);
      o.days.push(d);
    }
    const officerRows = [...officers.values()]
      .map(({ days: ds, ...o }) => {
        const sessions = ds.flatMap((d: any) => d.sessions);
        // A field session that ran past midnight shows on both days but is one session.
        const ids = new Set(ds.flatMap((d: any) => d.sessions.map((x: any) => x.field_session_id ?? `day:${d.date}`)));
        return { ...o, ...counts(sessions), days_active: ds.length, sessions: ids.size };
      })
      .sort((a, b) => b.trees_registered - a.trees_registered || a.user_name.localeCompare(b.user_name));
    return { from: f.from, to: f.to, tz: f.tz, officers: officerRows, days: dayRows };
  }

  /**
   * Every visit (observation) in scope, newest first, for the visits table and its CSV export.
   * Tree filters apply to the tree; the date range applies to the visit date.
   */
  async visitRows(user: AuthUser, f: ReportFilter & { recorded_by?: string; q?: string; visit_type?: string }, limit: number, offset: number) {
    const { baseWhere, inRange, params } = await this.scope(user, f);
    const p = [...params];
    const extra: string[] = [inRange('o.observed_at')];
    if (f.visit_type) {
      p.push(f.visit_type);
      extra.push(`o.visit_type = $${p.length}`);
    }
    if (f.recorded_by) {
      p.push(f.recorded_by);
      extra.push(`o.recorded_by = $${p.length}`);
    }
    if (f.q) {
      p.push(f.q.replace(/\s+/g, '').toUpperCase());
      extra.push(`t.physical_tree_id_normalized LIKE '%' || $${p.length} || '%'`);
    }
    const whereSql = `${baseWhere} AND ${extra.join(' AND ')}`;
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id, o.observed_at, o.recorded_at, o.synced_at, o.tree_id, t.physical_tree_id, p.short_code AS project,
                py.year_label AS planting_year, s.short_code AS sector, ss.short_code AS sub_sector,
                COALESCE(sp.common_name, sp.scientific_name) AS species, st.code AS status_code, st.name AS status,
                o.height_cm::float8 AS height_cm, o.height_method, o.remarks, o.custom_fields, o.visit_type, u.full_name AS recorded_by,
                o.is_initial, o.is_amendment, o.amendment_reason,
                EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id) AS superseded,
                (SELECT count(*) FROM tree_media m WHERE m.observation_id = o.id)::int AS photos
           FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN projects p ON p.id = t.project_id
           JOIN planting_years py ON py.id = t.planting_year_id JOIN sectors s ON s.id = t.sector_id
           JOIN sub_sectors ss ON ss.id = t.sub_sector_id JOIN tree_species sp ON sp.id = t.species_id
           JOIN tree_statuses st ON st.id = o.observed_status_id JOIN users u ON u.id = o.recorded_by
          WHERE ${whereSql} ORDER BY o.observed_at DESC, o.recorded_at DESC LIMIT ${limit} OFFSET ${offset}`,
        p,
      ),
      this.db.query(`SELECT count(*)::int AS total FROM tree_observations o JOIN trees t ON t.id = o.tree_id WHERE ${whereSql}`, p),
    ]);
    return { items: rows.rows, total: count.rows[0].total, limit, offset };
  }

  /** Rows for CSV/Excel export, scoped to the user's grants. */
  async treeRows(user: AuthUser, f: ReportFilter) {
    const { where, params } = await this.scope(user, f);
    const { rows } = await this.db.query(
      `SELECT t.physical_tree_id, t.id AS internal_id, p.short_code AS project, py.year_label AS planting_year,
              s.short_code AS sector, ss.short_code AS sub_sector, ss.reference_latitude AS sub_sector_ref_lat,
              ss.reference_longitude AS sub_sector_ref_lon, sp.scientific_name AS species, st.name AS current_status,
              t.last_observed_at, v.name AS vendor, rt.physical_tree_id AS replaces, t.planted_on, t.id_scheme_version,
              u.full_name AS registered_by, t.created_at AS registered_at, t.synced_at, t.notes
         FROM trees t JOIN projects p ON p.id = t.project_id JOIN planting_years py ON py.id = t.planting_year_id
         JOIN sectors s ON s.id = t.sector_id JOIN sub_sectors ss ON ss.id = t.sub_sector_id
         JOIN tree_species sp ON sp.id = t.species_id LEFT JOIN tree_statuses st ON st.id = t.current_status_id
         LEFT JOIN vendors v ON v.id = t.vendor_id LEFT JOIN trees rt ON rt.id = t.replaces_tree_id
         JOIN users u ON u.id = t.created_by
        WHERE ${where} ORDER BY t.physical_tree_id`,
      params,
    );
    return rows;
  }

  /**
   * Tree density per sector and sub-sector of one project (optionally one planting year's survey, plus older
   * areas not tied to a year). Trees have no GPS, so density is registered trees over the area's surveyed
   * outline. Counts are active registry records, scoped to the user's grants; "alive" and "dead" follow each
   * tree's current status, and alive_share is alive / (alive + dead), leaving out trees not yet observed.
   */
  async density(user: AuthUser, projectId: string, plantingYearId?: string) {
    await this.access.assertProject(user, projectId);
    const project = await this.db.one(this.db, 'SELECT id, name, short_code FROM projects WHERE id = $1', [projectId]);
    if (!project) throw notFound('Project');
    const year = plantingYearId
      ? await this.db.one(this.db, 'SELECT id, year_label FROM planting_years WHERE id = $1 AND project_id = $2', [plantingYearId, projectId])
      : null;
    if (plantingYearId && !year) throw notFound('Planting year');

    const grants = await this.access.grants(user);
    const params: unknown[] = [projectId, plantingYearId ?? null];
    const g = this.access.treeFilter(grants, 't', params.length + 1);
    params.push(...g.params);
    const counts = `
      SELECT t.sector_id, t.sub_sector_id, count(*)::int AS registered_trees,
             count(*) FILTER (WHERE st.id IS NOT NULL AND NOT st.is_terminal)::int AS alive_trees,
             count(*) FILTER (WHERE st.is_terminal)::int AS dead_trees,
             count(*) FILTER (WHERE st.id IS NULL)::int AS unknown_trees
        FROM trees t LEFT JOIN tree_statuses st ON st.id = t.current_status_id
       WHERE t.record_state = 'ACTIVE' AND t.project_id = $1 AND ($2::uuid IS NULL OR t.planting_year_id = $2) AND ${g.sql}
       GROUP BY t.sector_id, t.sub_sector_id`;
    // Shared column list: area and outline of [geom], plus tree counts summed from [c].
    const stats = (alias: string) => `
      ${alias}.short_code, ${alias}.name, ${alias}.active,
      ${alias}.reference_latitude::float8 AS reference_latitude, ${alias}.reference_longitude::float8 AS reference_longitude,
      ST_AsGeoJSON(${alias}.boundary_geometry, 7)::json AS boundary,
      ROUND((ST_Area(${alias}.boundary_geometry::geography) / 10000)::numeric, 4)::float8 AS area_hectares,
      COALESCE(sum(c.registered_trees), 0)::int AS registered_trees, COALESCE(sum(c.alive_trees), 0)::int AS alive_trees,
      COALESCE(sum(c.dead_trees), 0)::int AS dead_trees, COALESCE(sum(c.unknown_trees), 0)::int AS unknown_trees`;
    const inYear = `($2::uuid IS NULL OR s.planting_year_id = $2 OR s.planting_year_id IS NULL)`;
    const [sectors, subSectors] = await Promise.all([
      this.db.query(
        `WITH c AS (${counts})
         SELECT s.id, s.planting_year_id, py.year_label, ${stats('s')}
           FROM sectors s LEFT JOIN planting_years py ON py.id = s.planting_year_id LEFT JOIN c ON c.sector_id = s.id
          WHERE s.project_id = $1 AND ${inYear}
          GROUP BY s.id, py.year_label
         HAVING s.active OR COALESCE(sum(c.registered_trees), 0) > 0
          ORDER BY s.short_code, py.year_label`,
        params,
      ),
      this.db.query(
        `WITH c AS (${counts})
         SELECT ss.id, ss.sector_id, ${stats('ss')}
           FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id LEFT JOIN c ON c.sub_sector_id = ss.id
          WHERE ss.project_id = $1 AND ${inYear}
          GROUP BY ss.id, s.id
         HAVING (ss.active AND s.active) OR COALESCE(sum(c.registered_trees), 0) > 0
          ORDER BY ss.short_code`,
        params,
      ),
    ]);

    const withRates = <T extends { area_hectares: number | null; registered_trees: number; alive_trees: number; dead_trees: number }>(r: T) => ({
      ...r,
      trees_per_hectare: r.area_hectares ? Math.round((r.registered_trees / r.area_hectares) * 10) / 10 : null,
      alive_share: r.alive_trees + r.dead_trees ? Math.round((r.alive_trees / (r.alive_trees + r.dead_trees)) * 1000) / 1000 : null,
    });
    const areas = sectors.rows.map((s) => ({
      kind: 'sector' as const,
      ...withRates(s),
      sub_sectors: subSectors.rows.filter((ss) => ss.sector_id === s.id).map((ss) => ({ kind: 'sub_sector' as const, ...withRates(ss) })),
    }));
    const sum = (k: 'registered_trees' | 'alive_trees' | 'dead_trees' | 'unknown_trees') => areas.reduce((n, a) => n + a[k], 0);
    const hectares = areas.reduce((n, a) => n + (a.area_hectares ?? 0), 0);
    const totals = withRates({
      registered_trees: sum('registered_trees'),
      alive_trees: sum('alive_trees'),
      dead_trees: sum('dead_trees'),
      unknown_trees: sum('unknown_trees'),
      area_hectares: Math.round(hectares * 10000) / 10000,
    });
    return {
      generated_at: new Date().toISOString(),
      project,
      planting_year: year,
      totals,
      sectors: areas,
    };
  }
}
