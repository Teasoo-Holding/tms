import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { geoJsonPolygon, latitude, longitude, parse, shortCode } from '../common/validation';
import { Db, isUniqueViolation, Queryable } from '../database/db.service';
import { GEOMETRY_SQL, validatePolygon } from './geometry';

/** A corner measured on the ground (usually 4, walked with a GPS phone). */
const Corner = z.object({ latitude, longitude });
const AreaFields = {
  name: z.string().trim().min(1).max(200),
  short_code: shortCode,
  description: z.string().max(4000).nullish(),
  /**
   * Location is optional: an area can be created with just a name and short code, and located later.
   * Without a reference point, a point inside the boundary is used (when there is one). Null clears it.
   */
  reference_latitude: latitude.nullish(),
  reference_longitude: longitude.nullish(),
  /** Corner points; the boundary is built from them. Takes precedence over `boundary` (null clears the boundary). */
  corners: z.array(Corner).min(3).max(12).optional(),
  boundary: geoJsonPolygon.nullish(),
  active: z.boolean().default(true),
};
const AreaBody = z.object(AreaFields);
/** Sectors are surveyed for one planting year. */
const SectorBody = z.object({ ...AreaFields, planting_year_id: z.string().uuid() });
const AreaPatch = AreaBody.partial();
type AreaInput = z.infer<typeof AreaBody>;

/** Orders corners around their centre so any entry order gives a simple (non-crossing) polygon. */
export function cornersToPolygon(corners: { latitude: number; longitude: number }[]) {
  const cx = corners.reduce((n, c) => n + c.longitude, 0) / corners.length;
  const cy = corners.reduce((n, c) => n + c.latitude, 0) / corners.length;
  const ring = [...corners]
    .sort((a, b) => Math.atan2(a.latitude - cy, a.longitude - cx) - Math.atan2(b.latitude - cy, b.longitude - cx))
    .map((c) => [c.longitude, c.latitude]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

const ImportBody = z.object({
  type: z.literal('FeatureCollection'),
  /** The planting year whose survey this is. */
  planting_year_id: z.string().uuid().optional(),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        geometry: geoJsonPolygon.nullable(),
        properties: z.object({
          kind: z.enum(['sector', 'sub_sector']),
          short_code: shortCode,
          name: z.string().min(1),
          sector_code: shortCode.optional(),
          reference_latitude: latitude.optional(),
          reference_longitude: longitude.optional(),
          description: z.string().optional(),
        }),
      }),
    )
    .max(2000),
});

const SECTOR_COLUMNS = `id, project_id, planting_year_id, name, short_code, description, reference_latitude, reference_longitude,
  ${GEOMETRY_SQL()} AS boundary, active, created_at, updated_at`;
const SUB_SECTOR_COLUMNS = `id, sector_id, project_id, name, short_code, description, reference_latitude, reference_longitude,
  ${GEOMETRY_SQL()} AS boundary, active, created_at, updated_at`;

@Controller()
export class GeographyController {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService) {}

  /** Sectors with their sub-sectors; `planting_year_id` limits to one year's survey (plus areas not tied to a year). */
  @Get('projects/:id/areas')
  async areas(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Query('planting_year_id') yearId?: string) {
    await this.access.assertProject(user, projectId);
    const year = yearId && /^[0-9a-f-]{36}$/i.test(yearId) ? yearId : null;
    const sectors = await this.db.query(
      `SELECT ${SECTOR_COLUMNS} FROM sectors WHERE project_id = $1 AND ($2::uuid IS NULL OR planting_year_id = $2 OR planting_year_id IS NULL)
        ORDER BY short_code`,
      [projectId, year],
    );
    const subs = await this.db.query(`SELECT ${SUB_SECTOR_COLUMNS} FROM sub_sectors WHERE project_id = $1 ORDER BY short_code`, [projectId]);
    return sectors.rows.map((s) => ({ ...s, sub_sectors: subs.rows.filter((ss) => ss.sector_id === s.id) }));
  }

  /**
   * Where the area is; every part is optional (an area may have no location yet).
   * Corners win over a boundary. Fields left out keep their value; a new outline without a reference point gets a
   * point inside it, and an area with a boundary always has a reference point.
   */
  private async shape(tx: Queryable, b: Partial<AreaInput>, before?: any) {
    const reshaped = b.corners !== undefined || b.boundary !== undefined;
    const boundary = b.corners ? cornersToPolygon(b.corners) : b.boundary !== undefined ? b.boundary : before?.boundary ?? null;
    let lat: number | null = null;
    let lon: number | null = null;
    if (b.reference_latitude !== undefined || b.reference_longitude !== undefined) {
      lat = b.reference_latitude !== undefined ? b.reference_latitude : before?.reference_latitude ?? null;
      lon = b.reference_longitude !== undefined ? b.reference_longitude : before?.reference_longitude ?? null;
      if ((lat === null) !== (lon === null)) {
        throw badRequest('REFERENCE_POINT_INCOMPLETE', 'Enter both the latitude and the longitude of the reference point.');
      }
    } else if (before && !reshaped) {
      lat = before.reference_latitude ?? null;
      lon = before.reference_longitude ?? null;
    }
    if (lat === null && boundary) {
      const { rows } = await tx.query(`SELECT ST_Y(p) AS lat, ST_X(p) AS lon FROM (SELECT ST_PointOnSurface(ST_GeomFromGeoJSON($1)) AS p) s`, [
        JSON.stringify(boundary),
      ]).catch(() => {
        throw badRequest('GEOMETRY_INVALID', 'The corner points do not form an area.');
      });
      lat = Number(Number(rows[0].lat).toFixed(6));
      lon = Number(Number(rows[0].lon).toFixed(6));
    }
    return { boundary, reference_latitude: lat, reference_longitude: lon };
  }

  /** GeoJSON export of area reference points and boundaries (never individual trees). */
  @Get('projects/:id/areas.geojson')
  async exportGeoJson(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string) {
    const sectors = await this.areas(user, projectId);
    const features: any[] = [];
    for (const s of sectors) {
      features.push(this.feature('sector', s, null));
      for (const ss of s.sub_sectors) features.push(this.feature('sub_sector', ss, s.short_code));
    }
    return { type: 'FeatureCollection', features };
  }

  private feature(kind: string, a: any, sectorCode: string | null) {
    return {
      type: 'Feature',
      // Areas not located yet have no geometry (allowed by GeoJSON).
      geometry: a.boundary ?? (a.reference_latitude != null ? { type: 'Point', coordinates: [a.reference_longitude, a.reference_latitude] } : null),
      properties: {
        kind,
        id: a.id,
        short_code: a.short_code,
        name: a.name,
        sector_code: sectorCode ?? undefined,
        reference_latitude: a.reference_latitude,
        reference_longitude: a.reference_longitude,
        description: a.description,
        active: a.active,
      },
    };
  }

  @Roles('ADMIN')
  @Post('projects/:id/sectors')
  async createSector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(SectorBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      return this.insertSector(tx, user, projectId, b, b.planting_year_id);
    });
  }

  private async insertSector(tx: Queryable, user: AuthUser, projectId: string, b: AreaInput, yearId: string | null) {
    if (yearId && !(await this.db.one(tx, 'SELECT id FROM planting_years WHERE id = $1 AND project_id = $2', [yearId, projectId]))) {
      throw badRequest('PLANTING_YEAR_INVALID', 'The planting year does not belong to this project.');
    }
    const shape = await this.shape(tx, b);
    const geom = await validatePolygon(tx, shape.boundary);
    const row = await this.db
      .one(
        tx,
        `INSERT INTO sectors (project_id, planting_year_id, name, short_code, description, reference_latitude, reference_longitude, boundary_geometry, active)
         VALUES ($1, $9, $2, $3, $4, $5, $6, ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $8) RETURNING ${SECTOR_COLUMNS}`,
        [projectId, b.name, b.short_code, b.description ?? null, shape.reference_latitude, shape.reference_longitude, geom, b.active, yearId],
      )
      .catch(rethrowCode('A sector with this short code already exists in this planting year.'));
    await this.audit.record({ actorId: user.id, action: 'sector.create', entityType: 'sector', entityId: row!.id, projectId, after: row }, tx);
    return row;
  }

  @Roles('ADMIN')
  @Patch('sectors/:id')
  async updateSector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(AreaPatch, body);
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, `SELECT ${SECTOR_COLUMNS} FROM sectors WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound('Sector');
      const n = { ...before, ...b, ...(await this.shape(tx, b, before)) };
      const geom = await validatePolygon(tx, n.boundary);
      const after = await this.db
        .one(
          tx,
          `UPDATE sectors SET name = $2, short_code = $3, description = $4, reference_latitude = $5, reference_longitude = $6,
                  boundary_geometry = ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), active = $8, updated_at = now()
            WHERE id = $1 RETURNING ${SECTOR_COLUMNS}`,
          [id, n.name, n.short_code, n.description, n.reference_latitude, n.reference_longitude, geom, n.active],
        )
        .catch(rethrowCode('A sector with this short code already exists in this planting year.'));
      await this.audit.record({ actorId: user.id, action: 'sector.update', entityType: 'sector', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }

  @Roles('ADMIN')
  @Post('sectors/:id/sub-sectors')
  async createSubSector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) sectorId: string, @Body() body: unknown) {
    const b = parse(AreaBody, body);
    return this.db.tx((tx) => this.insertSubSector(tx, user, sectorId, b));
  }

  private async insertSubSector(tx: Queryable, user: AuthUser, sectorId: string, b: AreaInput) {
    const sector = await this.db.one(tx, 'SELECT id, project_id FROM sectors WHERE id = $1', [sectorId]);
    if (!sector) throw notFound('Sector');
    const shape = await this.shape(tx, b);
    const geom = await validatePolygon(tx, shape.boundary, { table: 'sectors', id: sectorId });
    const row = await this.db
      .one(
        tx,
        `INSERT INTO sub_sectors (sector_id, project_id, name, short_code, description, reference_latitude, reference_longitude, boundary_geometry, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326), $9) RETURNING ${SUB_SECTOR_COLUMNS}`,
        [sectorId, sector.project_id, b.name, b.short_code, b.description ?? null, shape.reference_latitude, shape.reference_longitude, geom, b.active],
      )
      .catch(rethrowCode('A sub-sector with this short code already exists in the sector.'));
    await this.audit.record({ actorId: user.id, action: 'sub_sector.create', entityType: 'sub_sector', entityId: row!.id, projectId: sector.project_id, after: row }, tx);
    return row;
  }

  @Roles('ADMIN')
  @Patch('sub-sectors/:id')
  async updateSubSector(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(AreaPatch, body);
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, `SELECT ${SUB_SECTOR_COLUMNS} FROM sub_sectors WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound('Sub-sector');
      const n = { ...before, ...b, ...(await this.shape(tx, b, before)) };
      const geom = await validatePolygon(tx, n.boundary, { table: 'sectors', id: before.sector_id });
      const after = await this.db
        .one(
          tx,
          `UPDATE sub_sectors SET name = $2, short_code = $3, description = $4, reference_latitude = $5, reference_longitude = $6,
                  boundary_geometry = ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), active = $8, updated_at = now()
            WHERE id = $1 RETURNING ${SUB_SECTOR_COLUMNS}`,
          [id, n.name, n.short_code, n.description, n.reference_latitude, n.reference_longitude, geom, n.active],
        )
        .catch(rethrowCode('A sub-sector with this short code already exists in the sector.'));
      await this.audit.record({ actorId: user.id, action: 'sub_sector.update', entityType: 'sub_sector', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }

  /**
   * Imports sectors and sub-sectors from GeoJSON. All-or-nothing: any invalid feature aborts the import.
   * Areas without a reference point use the polygon's interior point; features with neither are imported without a location.
   */
  @Roles('ADMIN')
  @Post('projects/:id/areas/import')
  async importGeoJson(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(ImportBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      const sectorIds = new Map<string, string>();
      const existing = await tx.query('SELECT id, short_code FROM sectors WHERE project_id = $1 AND planting_year_id IS NOT DISTINCT FROM $2', [
        projectId, b.planting_year_id ?? null,
      ]);
      existing.rows.forEach((r) => sectorIds.set(r.short_code, r.id));
      let created = 0;
      const ordered = [...b.features].sort((a, c) => (a.properties.kind === c.properties.kind ? 0 : a.properties.kind === 'sector' ? -1 : 1));
      for (const f of ordered) {
        const p = f.properties;
        const area = {
          name: p.name, short_code: p.short_code, description: p.description, boundary: f.geometry, active: true,
          reference_latitude: p.reference_latitude, reference_longitude: p.reference_longitude,
        };
        if (p.kind === 'sector') {
          const row = await this.insertSector(tx, user, projectId, area, b.planting_year_id ?? null);
          sectorIds.set(row!.short_code, row!.id);
        } else {
          const sectorId = p.sector_code && sectorIds.get(p.sector_code);
          if (!sectorId) throw badRequest('IMPORT_SECTOR_UNKNOWN', `Feature ${p.short_code} references an unknown sector_code.`);
          await this.insertSubSector(tx, user, sectorId, area);
        }
        created++;
      }
      await this.audit.record({ actorId: user.id, action: 'areas.import', entityType: 'project', entityId: projectId, projectId, metadata: { created } }, tx);
      return { created };
    });
  }
}

function rethrowCode(message: string) {
  return (e: any): never => {
    if (isUniqueViolation(e)) throw badRequest('SHORT_CODE_TAKEN', message);
    throw e;
  };
}
