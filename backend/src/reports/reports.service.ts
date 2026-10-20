import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.decorators';
import { Db } from '../database/db.service';

export interface ReportFilter {
  project_id?: string;
  planting_year_id?: string;
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
    if (f.planting_year_id) {
      params.push(f.planting_year_id);
      where.push(`t.planting_year_id = $${params.length}`);
    }
    const s = this.access.treeFilter(grants, 't', params.length + 1);
    params.push(...s.params);
    where.push(s.sql);
    return { where: where.join(' AND '), params, grants };
  }

  async summary(user: AuthUser, f: ReportFilter) {
    const { where, params } = await this.scope(user, f);
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
      group(`v.id, COALESCE(v.name, 'No vendor') AS name`, 'LEFT JOIN vendors v ON v.id = t.vendor_id', 'v.id, v.name'),
    ]);

    // Effective (non-superseded) observations per month and status for the last 12 months.
    const trend = await q(
      `SELECT to_char(date_trunc('month', o.observed_at), 'YYYY-MM') AS month, st.code, st.name, count(*)::int AS count
         FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN tree_statuses st ON st.id = o.observed_status_id
        WHERE ${where} AND o.observed_at >= date_trunc('month', now()) - interval '11 months'
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
                WHERE ${where} AND o.height_cm IS NOT NULL AND o.observed_at >= date_trunc('month', now()) - interval '23 months'
                  AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)
                ORDER BY o.tree_id, date_trunc('month', o.observed_at), o.observed_at DESC) m
         JOIN tree_species sp ON sp.id = m.species_id
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 3`,
    );

    // Registrations and observations per week for the last 12 weeks (field activity).
    const activity = await q(
      `WITH weeks AS (SELECT generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS week)
       SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
              (SELECT count(*) FROM trees t WHERE ${where} AND date_trunc('week', t.created_at) = w.week)::int AS registrations,
              (SELECT count(*) FROM tree_observations o JOIN trees t ON t.id = o.tree_id
                WHERE ${where} AND NOT o.is_initial AND date_trunc('week', o.observed_at) = w.week)::int AS observations
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
      `SELECT ss.id, ss.name, ss.short_code, s.short_code AS sector_code,
              ROUND((ST_Area(ss.boundary_geometry::geography) / 10000)::numeric, 2) AS area_hectares,
              count(t.id)::int AS registered_trees
         FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id
         LEFT JOIN trees t ON t.sub_sector_id = ss.id AND ${where}
        WHERE ss.project_id IN (SELECT DISTINCT t.project_id FROM trees t WHERE ${where}) OR ss.project_id = $${n + 1}::uuid
        GROUP BY ss.id, ss.name, ss.short_code, s.short_code ORDER BY s.short_code, ss.short_code`,
      [f.project_id ?? null],
    );

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
      observation_trend: trend,
      growth,
      activity_by_week: activity,
      status_by_sector: statusBySector,
      status_by_species: statusBySpecies,
      area_coverage: coverage,
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
}
