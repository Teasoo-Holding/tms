import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AccessService, AreaGrant } from '../common/access.service';
import { AuthUser } from '../common/auth.decorators';
import { SPECIES_IMAGE_COLUMNS } from '../admin/species-images.controller';
import { Db, Queryable } from '../database/db.service';
import { readSettings } from '../domain/settings';

/** Row shapes sent to devices. Bootstrap and the change feed use the same loaders. */
const LOADERS: Record<string, string> = {
  project: `SELECT id, name, short_code, description, location, start_date, end_date, status, physical_id_uniqueness, updated_at
              FROM projects WHERE id = ANY($1)`,
  planting_year: `SELECT id, project_id, year_label, start_date, end_date, active, updated_at FROM planting_years WHERE id = ANY($1)`,
  tree_id_scheme: `SELECT id, project_id, vendor_id, planting_year_id, version, component_definition, separator, serial_width, serial_uniqueness_scope,
                          active_from, active, updated_at
                     FROM tree_id_schemes WHERE id = ANY($1)`,
  sector: `SELECT id, project_id, planting_year_id, name, short_code, description, reference_latitude, reference_longitude,
                  ST_AsGeoJSON(boundary_geometry)::json AS boundary, active, updated_at FROM sectors WHERE id = ANY($1)`,
  sub_sector: `SELECT id, sector_id, project_id, name, short_code, description, reference_latitude, reference_longitude,
                      ST_AsGeoJSON(boundary_geometry)::json AS boundary, active, updated_at FROM sub_sectors WHERE id = ANY($1)`,
  species: `SELECT id, scientific_name, common_name, code, active, updated_at FROM tree_species WHERE id = ANY($1)`,
  species_image: `SELECT ${SPECIES_IMAGE_COLUMNS} FROM species_images WHERE id = ANY($1)`,
  status: `SELECT id, code, name, description, is_terminal, allows_replacement, requires_photo, sort_order, active, updated_at
             FROM tree_statuses WHERE id = ANY($1)`,
  vendor: `SELECT id, name, short_code, active, updated_at FROM vendors WHERE id = ANY($1)`,
  assignment: `SELECT id, user_id, project_id, sector_id, sub_sector_id, active, updated_at FROM user_project_assignments WHERE id = ANY($1)`,
  serial_allocation: `SELECT id, project_id, scope_key, user_id, range_start, range_end, active, updated_at FROM serial_allocations WHERE id = ANY($1)`,
  tree: `SELECT t.id, t.physical_tree_id, t.physical_tree_id_normalized, t.serial_number, t.id_scheme_id, t.id_scheme_version,
                t.id_components_snapshot, t.project_id, t.planting_year_id, t.sector_id, t.sub_sector_id, t.species_id, t.current_status_id,
                t.last_observed_at, t.vendor_id, t.replaces_tree_id, t.planted_on, t.notes, t.custom_fields, t.created_by,
                u.full_name AS created_by_name, t.created_at, t.updated_at, t.synced_at, t.revision, t.record_state
           FROM trees t JOIN users u ON u.id = t.created_by WHERE t.id = ANY($1)`,
  observation: `SELECT o.id, o.tree_id, o.observed_status_id, o.observed_at, o.recorded_at, o.synced_at, o.recorded_by, o.remarks,
                       o.revision, o.is_initial, o.is_amendment, o.amends_observation_id, o.amendment_reason,
                       o.custom_fields, o.visit_type, o.height_cm::float8 AS height_cm, o.height_method, o.height_measurement, o.field_session_id,
                       u.full_name AS recorded_by_name, t.project_id, t.sector_id, t.sub_sector_id
                  FROM tree_observations o JOIN trees t ON t.id = o.tree_id JOIN users u ON u.id = o.recorded_by WHERE o.id = ANY($1)`,
  planting_year_vendor: `SELECT id, project_id, planting_year_id, vendor_id, active, updated_at FROM planting_year_vendors WHERE id = ANY($1)`,
  custom_field: `SELECT id, project_id, applies_to, key, label, field_type, options, required, sticky, help_text, sort_order, active, updated_at
                   FROM custom_field_definitions WHERE id = ANY($1)`,
  media: `SELECT m.id, m.tree_id, m.observation_id, m.checksum_sha256, m.byte_size, m.mime_type, m.upload_state,
                 m.remote_verified_at, m.association_verified_at, m.captured_at, t.project_id, t.sector_id, t.sub_sector_id
            FROM tree_media m JOIN trees t ON t.id = m.tree_id WHERE m.id = ANY($1)`,
};

const AREA_SCOPED = new Set(['tree', 'observation', 'media']);
/** Global reference data every signed-in user receives: entity type → [table, bootstrap key]. */
const REFERENCE_TYPES: Record<string, [string, string]> = {
  species: ['tree_species', 'species'],
  status: ['tree_statuses', 'statuses'],
  vendor: ['vendors', 'vendors'],
  species_image: ['species_images', 'species_images'],
};

@Injectable()
export class SyncDataService {
  constructor(private readonly db: Db, private readonly access: AccessService) {}

  async load(q: Queryable, type: string, ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    return (await q.query(LOADERS[type], [ids])).rows;
  }

  /** Filters rows to what this user may see; returns ids that were filtered out. */
  visible(user: AuthUser, grants: AreaGrant[] | 'ALL', type: string, row: any): boolean {
    if (type === 'assignment') return row.user_id === user.id;
    if (type === 'serial_allocation') return row.user_id === null || row.user_id === user.id || user.role === 'ADMIN';
    if (AREA_SCOPED.has(type)) return this.access.canAccessArea(grants, row.project_id, row.sector_id, row.sub_sector_id);
    if (type === 'sector') return grants === 'ALL' || grants.some((g) => g.projectId === row.project_id && (!g.sectorId || g.sectorId === row.id));
    if (type === 'sub_sector') {
      return (
        grants === 'ALL' ||
        grants.some((g) => g.projectId === row.project_id && (!g.sectorId || g.sectorId === row.sector_id) && (!g.subSectorId || g.subSectorId === row.id))
      );
    }
    return true;
  }

  async assignmentFingerprint(q: Queryable, userId: string) {
    const { rows } = await q.query(
      `SELECT id, project_id, sector_id, sub_sector_id FROM user_project_assignments WHERE user_id = $1 AND active ORDER BY id`,
      [userId],
    );
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  }

  /** Configuration and reference data for the user's projects plus a consistent change cursor. */
  async bootstrap(user: AuthUser) {
    return this.db.tx(async (tx) => {
      const { rows: c } = await tx.query('SELECT COALESCE(max(seq), 0) AS cursor FROM change_log');
      const grants = await this.access.grants(user, tx);
      const projectIds = grants === 'ALL' ? null : [...new Set(grants.map((g) => g.projectId))];
      const idsOf = async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows.map((r) => r.id);

      const projectFilter = `($1::uuid[] IS NULL OR project_id = ANY($1))`;
      const projects = await idsOf(`SELECT id FROM projects WHERE status <> 'ARCHIVED' AND ($1::uuid[] IS NULL OR id = ANY($1))`, [projectIds]);
      const data: Record<string, any[]> = {
        projects: await this.load(tx, 'project', projects),
        planting_years: await this.load(tx, 'planting_year', await idsOf(`SELECT id FROM planting_years WHERE project_id = ANY($1)`, [projects])),
        tree_id_schemes: await this.load(tx, 'tree_id_scheme', await idsOf(`SELECT id FROM tree_id_schemes WHERE project_id = ANY($1)`, [projects])),
        planting_year_vendors: await this.load(tx, 'planting_year_vendor', await idsOf(`SELECT id FROM planting_year_vendors WHERE project_id = ANY($1)`, [projects])),
        custom_fields: await this.load(tx, 'custom_field', await idsOf(`SELECT id FROM custom_field_definitions WHERE project_id = ANY($1)`, [projects])),
        sectors: (await this.load(tx, 'sector', await idsOf(`SELECT id FROM sectors WHERE project_id = ANY($1)`, [projects]))).filter((r) =>
          this.visible(user, grants, 'sector', r),
        ),
        sub_sectors: (await this.load(tx, 'sub_sector', await idsOf(`SELECT id FROM sub_sectors WHERE project_id = ANY($1)`, [projects]))).filter((r) =>
          this.visible(user, grants, 'sub_sector', r),
        ),
        assignments: await this.load(tx, 'assignment', await idsOf(`SELECT id FROM user_project_assignments WHERE user_id = $1 AND active`, [user.id])),
        serial_allocations: (
          await this.load(tx, 'serial_allocation', await idsOf(`SELECT id FROM serial_allocations WHERE active AND ${projectFilter}`, [projectIds]))
        ).filter((r) => this.visible(user, grants, 'serial_allocation', r)),
      };
      for (const [t, [table, key]] of Object.entries(REFERENCE_TYPES)) data[key] = await this.load(tx, t, await idsOf(`SELECT id FROM ${table}`));
      return {
        cursor: String(c[0].cursor),
        server_time: new Date().toISOString(),
        assignment_fingerprint: await this.assignmentFingerprint(tx, user.id),
        data_generation: await this.dataGeneration(tx),
        settings: await readSettings(tx),
        ...data,
      };
    }, 'REPEATABLE READ', true);
  }

  /** Pages of trees (with observations) in the user's scope, keyset-paginated by id. */
  async trees(user: AuthUser, projectId: string, afterId: string | null, limit: number) {
    const grants = await this.access.grants(user);
    const scope = this.access.treeFilter(grants, 't', 4);
    const { rows } = await this.db.query(
      `SELECT t.id FROM trees t WHERE t.project_id = $1 AND ($2::uuid IS NULL OR t.id > $2)
          AND (t.record_state = 'ACTIVE' OR t.created_by = $3) AND ${scope.sql}
        ORDER BY t.id LIMIT ${limit}`,
      [projectId, afterId, user.id, ...scope.params],
    );
    const ids = rows.map((r) => r.id);
    const trees = await this.load(this.db, 'tree', ids);
    const obsIds = ids.length ? (await this.db.query('SELECT id FROM tree_observations WHERE tree_id = ANY($1)', [ids])).rows.map((r) => r.id) : [];
    const observations = await this.load(this.db, 'observation', obsIds);
    // Photo records let the phone show (and fetch on demand) pictures taken on other devices.
    const mediaIds = ids.length
      ? (await this.db.query(`SELECT id FROM tree_media WHERE tree_id = ANY($1) AND upload_state = 'VERIFIED'`, [ids])).rows.map((r) => r.id)
      : [];
    const media = await this.load(this.db, 'media', mediaIds);
    return { trees, observations, media, next_after_id: ids.length === limit ? ids[ids.length - 1] : null };
  }

  /** Incremental changes after a server-issued cursor, filtered to the user's authorised scope. */
  async changes(user: AuthUser, cursor: number, limit: number) {
    const grants = await this.access.grants(user);
    const projectIds = grants === 'ALL' ? null : [...new Set(grants.map((g) => g.projectId))];
    const { rows } = await this.db.query(
      `SELECT seq, entity_type, entity_id, deleted FROM change_log
        WHERE seq > $1 AND (project_id IS NULL OR $2::uuid[] IS NULL OR project_id = ANY($2))
        ORDER BY seq LIMIT $3`,
      [cursor, projectIds, limit],
    );
    // Keep only the latest change per entity; the loader returns current state anyway.
    const latest = new Map<string, { seq: number; type: string; id: string; deleted: boolean }>();
    for (const r of rows) latest.set(`${r.entity_type}:${r.entity_id}`, { seq: Number(r.seq), type: r.entity_type, id: r.entity_id, deleted: r.deleted });
    const byType = new Map<string, string[]>();
    const changes: any[] = [];
    for (const v of latest.values()) {
      // Deleted rows travel as tombstones so phones remove them too.
      if (v.deleted) changes.push({ seq: v.seq, entity_type: v.type, deleted: true, data: { id: v.id } });
      else byType.set(v.type, [...(byType.get(v.type) ?? []), v.id]);
    }

    for (const [type, ids] of byType) {
      for (const row of await this.load(this.db, type, ids)) {
        if (this.visible(user, grants, type, row)) changes.push({ seq: latest.get(`${type}:${row.id}`)!.seq, entity_type: type, data: row });
      }
    }
    changes.sort((a, b) => a.seq - b.seq);
    const nextCursor = rows.length ? Number(rows[rows.length - 1].seq) : cursor;
    return {
      changes,
      next_cursor: String(nextCursor),
      has_more: rows.length === limit,
      assignment_fingerprint: await this.assignmentFingerprint(this.db, user.id),
      data_generation: await this.dataGeneration(this.db),
      // Organisation-wide settings travel on every page, so phones pick up changes without a full refresh.
      settings: await readSettings(this.db),
      server_time: new Date().toISOString(),
    };
  }

  /** Changes when an administrator clears all data; phones then back up, reset and download afresh. */
  async dataGeneration(q: Queryable): Promise<number> {
    const { rows } = await q.query(`SELECT value FROM system_settings WHERE key = 'data_generation'`);
    return Number(rows[0]?.value ?? 1);
  }
}
