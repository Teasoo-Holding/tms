import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.decorators';
import { notFound } from '../common/errors';
import { Db } from '../database/db.service';
import { MAINTENANCE_DUE_SOON_DAYS, MAINTENANCE_JOIN, MAINTENANCE_PROPOSED_SQL, MAINTENANCE_STATUS_SQL } from '../domain/maintenance';

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

export interface VisitQuery extends ReportFilter {
  recorded_by?: string;
  /** Tree ID search (part of the ID; spaces ignored). */
  q?: string;
  visit_type?: string;
}

/** One visit day: the project, the day (YYYY-MM-DD in the request's time zone) and optionally one field session ('none': without one). */
export interface VisitDayQuery extends VisitQuery {
  project_id: string;
  date: string;
  field_session_id?: string;
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
      group(`COALESCE(st.code, 'UNKNOWN') AS code, COALESCE(st.name, 'No status yet') AS name, COALESCE(st.is_terminal, false) AS is_terminal`,
        'LEFT JOIN tree_statuses st ON st.id = t.current_status_id', 'st.code, st.name, st.is_terminal, st.sort_order', 'st.sort_order NULLS LAST'),
      group(`py.id, py.year_label AS name,
             count(*) FILTER (WHERE t.replaces_tree_id IS NULL)::int AS original_trees,
             count(*) FILTER (WHERE t.replaces_tree_id IS NOT NULL)::int AS replacement_trees`,
        'JOIN planting_years py ON py.id = t.planting_year_id', 'py.id, py.year_label', 'py.year_label'),
      // Each sector with its planting year: sectors of different years can share a code (#116).
      group(`s.id, s.name, s.short_code, s.planting_year_id, spy.year_label`, 'JOIN sectors s ON s.id = t.sector_id LEFT JOIN planting_years spy ON spy.id = s.planting_year_id',
        's.id, s.name, s.short_code, s.planting_year_id, spy.year_label', "spy.year_label NULLS FIRST, regexp_replace(s.short_code, '[0-9]+$', ''), NULLIF(substring(s.short_code from '[0-9]+$'), '')::bigint"),
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
      q(`SELECT ${dim}, COALESCE(st.code, 'UNKNOWN') AS code, COALESCE(st.name, 'No status yet') AS status_name, count(*)::int AS count
           FROM trees t ${join} LEFT JOIN tree_statuses st ON st.id = t.current_status_id
          WHERE ${where} GROUP BY ${groupBy}, st.code, st.name, st.sort_order ORDER BY ${groupBy}, st.sort_order NULLS LAST`);
    const [statusBySector, statusBySpecies] = await Promise.all([
      // Per sector (not per code), with its planting year (#115).
      statusBy(`s.id AS group_code, s.short_code AS sector_code, s.name AS group_name, spy.year_label`,
        'JOIN sectors s ON s.id = t.sector_id LEFT JOIN planting_years spy ON spy.id = s.planting_year_id', 's.id, s.short_code, s.name, spy.year_label'),
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
              count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM tree_observations o WHERE o.tree_id = t.id AND NOT o.is_initial))::int AS never_observed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tree_media m WHERE m.tree_id = t.id AND m.upload_state <> 'VERIFIED'))::int AS trees_with_unverified_photos
         FROM trees t WHERE ${where}`,
    );
    // Maintenance due (see domain/maintenance.ts), for the dashboard's notice.
    const [maintenance] = await q(
      `SELECT count(*) FILTER (WHERE ${MAINTENANCE_STATUS_SQL} = 'overdue')::int AS overdue_trees,
              count(*) FILTER (WHERE ${MAINTENANCE_STATUS_SQL} = 'due_soon')::int AS due_soon_trees
         FROM trees t JOIN projects p ON p.id = t.project_id LEFT JOIN tree_statuses st ON st.id = t.current_status_id ${MAINTENANCE_JOIN}
        WHERE ${where}`,
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
      maintenance: { ...maintenance, due_soon_days: MAINTENANCE_DUE_SOON_DAYS },
      data_completeness: { ...completeness, open_conflicts: ops.open_conflicts, devices_not_synced_7_days: ops.devices_not_synced_7_days },
      officer_activity: officers,
      notes: [
        'Counts are registered trees, not survival rates.',
        'Replacement trees are counted separately from original trees; planting events = original + replacement.',
        `Trees without an observation in the last ${f.overdue_days} days are "unknown/overdue", not dead or missing.`,
        'Days run from midnight to midnight West Africa Time (WAT, Africa/Lagos); times are shown in WAT.',
        'Area coverage uses administrator-defined sub-sector boundaries; trees have no individual GPS positions.',
      ],
    };
  }

  /**
   * How fresh the data is: the latest sync from the phones of people working on the project(s) in scope, and what
   * those phones last reported still waiting to be sent (POST /sync/status). Phones are those of officers assigned to
   * the projects or who recorded in them in the last 90 days; without a project filter, every phone in the caller's
   * scope. Revoked phones and phones silent for 60 days without pending records are left out. When no phone has
   * synced (older apps, imported data), last_sync_at falls back to the latest record received.
   */
  async freshness(user: AuthUser, projectId?: string) {
    if (projectId) await this.access.assertProject(user, projectId);
    const projectIds = projectId ? [projectId] : await this.access.projectIds(user);
    const { rows: devices } = await this.db.query(
      `SELECT d.id AS device_id, d.user_id, u.full_name AS user_name, d.name AS device_name, d.last_sync_at,
              d.pending_operations, d.pending_photos, d.oldest_pending_at, d.status_reported_at, d.app_version
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.revoked_at IS NULL AND u.active AND u.role IN ('FIELD_OFFICER', 'ADMIN')
          AND (COALESCE(d.pending_operations, 0) + COALESCE(d.pending_photos, 0) > 0
               OR GREATEST(d.last_sync_at, d.last_seen_at, d.status_reported_at, d.created_at) >= now() - interval '60 days')
          AND ($1::uuid[] IS NULL
               OR EXISTS (SELECT 1 FROM user_project_assignments a WHERE a.user_id = d.user_id AND a.active AND a.project_id = ANY($1))
               OR EXISTS (SELECT 1 FROM tree_observations o JOIN trees t ON t.id = o.tree_id
                           WHERE o.observed_at >= now() - interval '90 days' AND o.recorded_by = d.user_id AND t.project_id = ANY($1)))
        ORDER BY COALESCE(d.pending_operations, 0) + COALESCE(d.pending_photos, 0) > 0 DESC, d.last_sync_at ASC NULLS FIRST, u.full_name`,
      [projectIds],
    );
    const iso = (v: Date | null) => (v ? new Date(v).toISOString() : null);
    const items = devices.map((d) => ({
      device_id: d.device_id,
      user_id: d.user_id,
      user_name: d.user_name,
      device_name: d.device_name,
      last_sync_at: iso(d.last_sync_at),
      pending_operations: d.pending_operations,
      pending_photos: d.pending_photos,
      oldest_pending_at: iso(d.oldest_pending_at),
      status_reported_at: iso(d.status_reported_at),
      app_version: d.app_version,
    }));
    let lastSync = items.map((d) => d.last_sync_at).filter(Boolean).sort().pop() ?? null;
    if (!lastSync) {
      const [r] = (
        await this.db.query(
          `SELECT max(o.synced_at) AS at FROM tree_observations o JOIN trees t ON t.id = o.tree_id WHERE ($1::uuid[] IS NULL OR t.project_id = ANY($1))`,
          [projectIds],
        )
      ).rows;
      lastSync = iso(r.at);
    }
    const pending = items.filter((d) => (d.pending_operations ?? 0) + (d.pending_photos ?? 0) > 0);
    return {
      generated_at: new Date().toISOString(),
      last_sync_at: lastSync,
      devices: items,
      devices_with_pending: pending.length,
      pending_operations: pending.reduce((n, d) => n + (d.pending_operations ?? 0), 0),
      pending_photos: pending.reduce((n, d) => n + (d.pending_photos ?? 0), 0),
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
   * WHERE clause and parameters for visits (observations) in scope: tree filters apply to the tree, the date range to
   * the visit date. With [tz] the dates are days in that time zone (and $tz is the zone's parameter), else UTC days.
   */
  private async visitScope(user: AuthUser, f: VisitQuery, tz?: string) {
    const { baseWhere, inRange, params } = await this.scope(user, tz ? { ...f, from: undefined, to: undefined } : f);
    const p = [...params];
    // With a time zone the scope's own (UTC) range is empty, but its parameters still need a typed reference.
    const extra: string[] = [inRange('o.observed_at')];
    let tzParam = '';
    if (tz) {
      p.push(tz, f.from ?? null, f.to ?? null);
      tzParam = `$${p.length - 2}`;
      const from = `$${p.length - 1}::date`;
      const to = `$${p.length}::date`;
      extra.push(`(${from} IS NULL OR o.observed_at >= ${from}::timestamp AT TIME ZONE ${tzParam})`);
      extra.push(`(${to} IS NULL OR o.observed_at < (${to} + 1)::timestamp AT TIME ZONE ${tzParam})`);
    }
    const eq = (sql: string, v?: string | null) => {
      if (v == null) return;
      p.push(v);
      extra.push(sql.replace('?', `$${p.length}`));
    };
    eq('o.visit_type = ?', f.visit_type);
    eq('o.recorded_by = ?', f.recorded_by);
    if (f.q) eq(`t.physical_tree_id_normalized LIKE '%' || ? || '%'`, f.q.replace(/\s+/g, '').toUpperCase());
    return { whereSql: `${baseWhere} AND ${extra.join(' AND ')}`, p, tzParam };
  }

  /**
   * Every visit (observation) in scope, newest first, for the visits table and its CSV export.
   * Tree filters apply to the tree; the date range applies to the visit date.
   */
  async visitRows(user: AuthUser, f: VisitQuery, limit: number, offset: number) {
    const { whereSql, p } = await this.visitScope(user, f);
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id, o.observed_at, o.recorded_at, o.synced_at, o.tree_id, t.physical_tree_id, p.short_code AS project,
                py.year_label AS planting_year, s.short_code AS sector, ss.short_code AS sub_sector,
                COALESCE(sp.common_name, sp.scientific_name) AS species, st.code AS status_code, st.name AS status, st.is_terminal AS status_terminal,
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

  /**
   * Visit days: one row per project and day (in [tz]) with field work matching the filters, newest first. Counts are
   * of the matching records: trees registered (first visits), follow-up visits, corrections and photos, with the data
   * collectors and their field sessions (records without a session count as one session per collector and day).
   */
  async visitDays(user: AuthUser, f: VisitQuery, tz: string, limit: number, offset: number) {
    const { whereSql, p, tzParam } = await this.visitScope(user, f, tz);
    const days = `
      SELECT o.recorded_by, o.observed_at, o.is_initial, o.is_amendment, t.project_id,
             COALESCE(o.field_session_id::text, 'user:' || o.recorded_by::text) AS session_key,
             (o.observed_at AT TIME ZONE ${tzParam})::date AS day,
             (SELECT count(*) FROM tree_media m WHERE m.observation_id = o.id)::int AS photos
        FROM tree_observations o JOIN trees t ON t.id = o.tree_id WHERE ${whereSql}`;
    const [rows, count] = await Promise.all([
      this.db.query(
        `WITH o AS (${days})
         SELECT to_char(o.day, 'YYYY-MM-DD') AS date, o.project_id, p.name AS project_name, p.short_code AS project_code,
                count(*)::int AS records,
                count(*) FILTER (WHERE o.is_initial)::int AS trees_registered,
                count(*) FILTER (WHERE NOT o.is_initial AND NOT o.is_amendment)::int AS visits,
                count(*) FILTER (WHERE o.is_amendment)::int AS corrections,
                sum(o.photos)::int AS photos, min(o.observed_at) AS first_at, max(o.observed_at) AS last_at,
                count(DISTINCT (o.session_key, o.recorded_by))::int AS sessions,
                json_agg(DISTINCT jsonb_build_object('user_id', u.id, 'user_name', u.full_name)) AS collectors
           FROM o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.recorded_by
          GROUP BY o.day, o.project_id, p.name, p.short_code
          ORDER BY o.day DESC, p.name, o.project_id LIMIT ${limit} OFFSET ${offset}`,
        p,
      ),
      this.db.query(`WITH o AS (${days}) SELECT count(*)::int AS total FROM (SELECT DISTINCT o.day, o.project_id FROM o) d`, p),
    ]);
    const items = rows.rows.map((r) => {
      const collectors = [...r.collectors].sort((a: any, b: any) => a.user_name.localeCompare(b.user_name));
      return { ...r, first_at: new Date(r.first_at).toISOString(), last_at: new Date(r.last_at).toISOString(), collectors, collector_count: collectors.length };
    });
    return { items, total: count.rows[0].total, limit, offset, tz };
  }

  /** WHERE for one visit day of one project (the day in [tz]), optionally one field session of one collector. */
  private async visitDayScope(user: AuthUser, f: VisitDayQuery, tz: string) {
    await this.access.assertProject(user, f.project_id);
    const s = await this.visitScope(user, f, tz);
    const p = [...s.p, f.project_id, f.date];
    const extra = [`t.project_id = $${p.length - 1}`, `(o.observed_at AT TIME ZONE ${s.tzParam})::date = $${p.length}::date`];
    if (f.field_session_id === 'none') extra.push('o.field_session_id IS NULL');
    else if (f.field_session_id) {
      p.push(f.field_session_id);
      extra.push(`o.field_session_id = $${p.length}`);
    }
    return { whereSql: `${s.whereSql} AND ${extra.join(' AND ')}`, p };
  }

  /**
   * One visit day of one project, grouped by field session and data collector (records without a field session form
   * one group per collector), in the order the work started.
   */
  async visitDay(user: AuthUser, f: VisitDayQuery, tz: string) {
    const { whereSql, p } = await this.visitDayScope(user, f, tz);
    const project = await this.db.one(this.db, 'SELECT id, name, short_code FROM projects WHERE id = $1', [f.project_id]);
    if (!project) throw notFound('Project');
    const { rows } = await this.db.query(
      `SELECT o.field_session_id, o.recorded_by AS user_id, u.full_name AS user_name,
              min(o.observed_at) AS first_at, max(o.observed_at) AS last_at, count(*)::int AS records,
              array_agg(DISTINCT py.year_label ORDER BY py.year_label) AS planting_years,
              array_agg(DISTINCT s.short_code ORDER BY s.short_code) AS sectors,
              array_agg(DISTINCT s.short_code || '/' || ss.short_code ORDER BY s.short_code || '/' || ss.short_code) AS sub_sectors,
              array_remove(array_agg(DISTINCT COALESCE(v.short_code, v.name) ORDER BY COALESCE(v.short_code, v.name)), NULL) AS vendors,
              count(*) FILTER (WHERE o.is_initial)::int AS trees_registered,
              count(*) FILTER (WHERE NOT o.is_initial AND NOT o.is_amendment)::int AS visits,
              count(*) FILTER (WHERE o.is_amendment)::int AS corrections,
              COALESCE(sum((SELECT count(*) FROM tree_media m WHERE m.observation_id = o.id)), 0)::int AS photos
         FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN users u ON u.id = o.recorded_by
         JOIN planting_years py ON py.id = t.planting_year_id JOIN sectors s ON s.id = t.sector_id
         JOIN sub_sectors ss ON ss.id = t.sub_sector_id LEFT JOIN vendors v ON v.id = t.vendor_id
        WHERE ${whereSql}
        GROUP BY o.field_session_id, o.recorded_by, u.full_name ORDER BY min(o.observed_at), u.full_name`,
      p,
    );
    const iso = (d: Date | string) => new Date(d).toISOString();
    return {
      date: f.date, tz, project,
      sessions: rows.map((r) => ({ ...r, first_at: iso(r.first_at), last_at: iso(r.last_at) })),
    };
  }

  /** The tree records of one visit day (optionally one session of one collector), in time order, with each record's photos. */
  async visitDayRecords(user: AuthUser, f: VisitDayQuery, tz: string, limit: number, offset: number) {
    const { whereSql, p } = await this.visitDayScope(user, f, tz);
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id, o.observed_at, o.tree_id, t.physical_tree_id, o.field_session_id, o.recorded_by AS user_id, u.full_name AS recorded_by,
                py.year_label AS planting_year, s.short_code AS sector, s.name AS sector_name, ss.short_code AS sub_sector, ss.name AS sub_sector_name,
                COALESCE(sp.common_name, sp.scientific_name) AS species, st.code AS status_code, st.name AS status, st.is_terminal AS status_terminal,
                COALESCE(v.short_code, v.name) AS vendor, o.visit_type, o.is_initial, o.is_amendment, o.amendment_reason,
                o.height_cm::float8 AS height_cm, o.remarks,
                EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id) AS superseded,
                COALESCE((SELECT json_agg(json_build_object('id', m.id, 'observation_id', m.observation_id, 'upload_state', m.upload_state,
                                                            'captured_at', m.captured_at) ORDER BY m.captured_at)
                            FROM tree_media m WHERE m.observation_id = o.id), '[]') AS media
           FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN users u ON u.id = o.recorded_by
           JOIN planting_years py ON py.id = t.planting_year_id JOIN sectors s ON s.id = t.sector_id
           JOIN sub_sectors ss ON ss.id = t.sub_sector_id JOIN tree_species sp ON sp.id = t.species_id
           JOIN tree_statuses st ON st.id = o.observed_status_id LEFT JOIN vendors v ON v.id = t.vendor_id
          WHERE ${whereSql} ORDER BY o.observed_at, o.recorded_at, o.id LIMIT ${limit} OFFSET ${offset}`,
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
              u.full_name AS registered_by, t.created_at AS registered_at, t.synced_at, t.notes,
              mt.last_at AS last_maintenance_at, ${MAINTENANCE_PROPOSED_SQL} AS next_maintenance_on, ${MAINTENANCE_STATUS_SQL} AS maintenance_status
         FROM trees t JOIN projects p ON p.id = t.project_id JOIN planting_years py ON py.id = t.planting_year_id
         JOIN sectors s ON s.id = t.sector_id JOIN sub_sectors ss ON ss.id = t.sub_sector_id
         JOIN tree_species sp ON sp.id = t.species_id LEFT JOIN tree_statuses st ON st.id = t.current_status_id
         LEFT JOIN vendors v ON v.id = t.vendor_id LEFT JOIN trees rt ON rt.id = t.replaces_tree_id
         JOIN users u ON u.id = t.created_by ${MAINTENANCE_JOIN}
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
