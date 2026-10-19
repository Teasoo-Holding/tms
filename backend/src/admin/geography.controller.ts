import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { geoJsonPolygon, latitude, longitude, parse, shortCode } from '../common/validation';
import { Db, isUniqueViolation, Queryable } from '../database/db.service';
import { GEOMETRY_SQL, validatePolygon } from './geometry';

const AreaBody = z.object({
  name: z.string().trim().min(1).max(200),
  short_code: shortCode,
  description: z.string().max(4000).nullish(),
  reference_latitude: latitude,
  reference_longitude: longitude,
  boundary: geoJsonPolygon.nullish(),
  active: z.boolean().default(true),
});
const AreaPatch = AreaBody.partial();

const ImportBody = z.object({
  type: z.literal('FeatureCollection'),
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

const SECTOR_COLUMNS = `id, project_id, name, short_code, description, reference_latitude, reference_longitude,
  ${GEOMETRY_SQL()} AS boundary, active, created_at, updated_at`;
const SUB_SECTOR_COLUMNS = `id, sector_id, project_id, name, short_code, description, reference_latitude, reference_longitude,
  ${GEOMETRY_SQL()} AS boundary, active, created_at, updated_at`;

@Controller()
export class GeographyController {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService) {}

  @Get('projects/:id/areas')
  async areas(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string) {
    await this.access.assertProject(user, projectId);
    const sectors = await this.db.query(`SELECT ${SECTOR_COLUMNS} FROM sectors WHERE project_id = $1 ORDER BY short_code`, [projectId]);
    const subs = await this.db.query(`SELECT ${SUB_SECTOR_COLUMNS} FROM sub_sectors WHERE project_id = $1 ORDER BY short_code`, [projectId]);
    return sectors.rows.map((s) => ({ ...s, sub_sectors: subs.rows.filter((ss) => ss.sector_id === s.id) }));
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
      geometry: a.boundary ?? { type: 'Point', coordinates: [a.reference_longitude, a.reference_latitude] },
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
    const b = parse(AreaBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      return this.insertSector(tx, user, projectId, b);
    });
  }

  private async insertSector(tx: Queryable, user: AuthUser, projectId: string, b: z.infer<typeof AreaBody>) {
    const geom = await validatePolygon(tx, b.boundary);
    const row = await this.db
      .one(
        tx,
        `INSERT INTO sectors (project_id, name, short_code, description, reference_latitude, reference_longitude, boundary_geometry, active)
         VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $8) RETURNING ${SECTOR_COLUMNS}`,
        [projectId, b.name, b.short_code, b.description ?? null, b.reference_latitude, b.reference_longitude, geom, b.active],
      )
      .catch(rethrowCode('A sector with this short code already exists in the project.'));
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
      const n = { ...before, ...b, boundary: b.boundary !== undefined ? b.boundary : before.boundary };
      const geom = await validatePolygon(tx, n.boundary);
      const after = await this.db
        .one(
          tx,
          `UPDATE sectors SET name = $2, short_code = $3, description = $4, reference_latitude = $5, reference_longitude = $6,
                  boundary_geometry = ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), active = $8, updated_at = now()
            WHERE id = $1 RETURNING ${SECTOR_COLUMNS}`,
          [id, n.name, n.short_code, n.description, n.reference_latitude, n.reference_longitude, geom, n.active],
        )
        .catch(rethrowCode('A sector with this short code already exists in the project.'));
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

  private async insertSubSector(tx: Queryable, user: AuthUser, sectorId: string, b: z.infer<typeof AreaBody>) {
    const sector = await this.db.one(tx, 'SELECT id, project_id FROM sectors WHERE id = $1', [sectorId]);
    if (!sector) throw notFound('Sector');
    const geom = await validatePolygon(tx, b.boundary, { table: 'sectors', id: sectorId });
    const row = await this.db
      .one(
        tx,
        `INSERT INTO sub_sectors (sector_id, project_id, name, short_code, description, reference_latitude, reference_longitude, boundary_geometry, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326), $9) RETURNING ${SUB_SECTOR_COLUMNS}`,
        [sectorId, sector.project_id, b.name, b.short_code, b.description ?? null, b.reference_latitude, b.reference_longitude, geom, b.active],
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
      const n = { ...before, ...b, boundary: b.boundary !== undefined ? b.boundary : before.boundary };
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
   * Areas without a reference point use the polygon's interior point.
   */
  @Roles('ADMIN')
  @Post('projects/:id/areas/import')
  async importGeoJson(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(ImportBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      const sectorIds = new Map<string, string>();
      const existing = await tx.query('SELECT id, short_code FROM sectors WHERE project_id = $1', [projectId]);
      existing.rows.forEach((r) => sectorIds.set(r.short_code, r.id));
      let created = 0;
      const ordered = [...b.features].sort((a, c) => (a.properties.kind === c.properties.kind ? 0 : a.properties.kind === 'sector' ? -1 : 1));
      for (const [index, f] of ordered.entries()) {
        const p = f.properties;
        const ref = await this.referencePoint(tx, f.geometry, p.reference_latitude, p.reference_longitude, index);
        const area = { name: p.name, short_code: p.short_code, description: p.description, boundary: f.geometry, active: true, ...ref };
        if (p.kind === 'sector') {
          const row = await this.insertSector(tx, user, projectId, area);
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

  private async referencePoint(tx: Queryable, geometry: unknown, lat?: number, lon?: number, index = 0) {
    if (lat !== undefined && lon !== undefined) return { reference_latitude: lat, reference_longitude: lon };
    if (!geometry) throw badRequest('IMPORT_REFERENCE_MISSING', `Feature ${index + 1} needs a polygon or a reference point.`);
    const { rows } = await tx.query(
      `SELECT ST_Y(p) AS lat, ST_X(p) AS lon FROM (SELECT ST_PointOnSurface(ST_GeomFromGeoJSON($1)) AS p) s`,
      [JSON.stringify(geometry)],
    );
    return { reference_latitude: Number(rows[0].lat.toFixed(6)), reference_longitude: Number(rows[0].lon.toFixed(6)) };
  }
}

function rethrowCode(message: string) {
  return (e: any): never => {
    if (isUniqueViolation(e)) throw badRequest('SHORT_CODE_TAKEN', message);
    throw e;
  };
}
