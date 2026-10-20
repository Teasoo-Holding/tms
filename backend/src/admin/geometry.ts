import { Queryable } from '../database/db.service';
import { badRequest } from '../common/errors';

/** Validates a GeoJSON polygon with PostGIS and returns it unchanged as text for insertion. */
export async function validatePolygon(q: Queryable, polygon: unknown, parentGeometrySql?: { table: string; id: string }) {
  if (polygon == null) return null;
  const text = JSON.stringify(polygon);
  const { rows } = await q.query(
    `SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason, ST_SRID(g) AS srid
       FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) s`,
    [text],
  ).catch(() => {
    throw badRequest('GEOMETRY_INVALID', 'The boundary is not a readable GeoJSON polygon.');
  });
  if (!rows[0].valid) throw badRequest('GEOMETRY_INVALID', `The boundary polygon is invalid: ${rows[0].reason}.`);
  if (parentGeometrySql) {
    const parent = await q.query(
      `SELECT boundary_geometry IS NULL AS no_parent,
              -- 15 m allowance: corners walked with a phone GPS are a few metres off.
              ST_CoveredBy(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), ST_Buffer(boundary_geometry::geography, 15)::geometry) AS inside
         FROM ${parentGeometrySql.table} WHERE id = $1`,
      [parentGeometrySql.id, text],
    );
    if (parent.rows[0] && !parent.rows[0].no_parent && !parent.rows[0].inside) {
      throw badRequest('GEOMETRY_OUTSIDE_PARENT', 'The sub-sector boundary must lie within its sector boundary.');
    }
  }
  return text;
}

export const GEOMETRY_SQL = (col = 'boundary_geometry') => `ST_AsGeoJSON(${col})::json`;
