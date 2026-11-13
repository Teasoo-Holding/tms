/**
 * A small KML reader for area uploads (#4 of the 13 Nov request): Placemarks with a polygon become sectors or
 * sub-sectors by their names, and Placemarks with a point named like a rally point become rally points.
 * Recognised names: "Sector 3", "S3", "Sector 3 Subsector 2", "S3/SS2", "S3 SS2", "S3-SS2" (an area such as
 * "(10.2 ha)" after the name is ignored).
 */
export type Ring = [number, number][];
export interface KmlArea {
  kind: 'sector' | 'sub_sector';
  sector: number;
  sub?: number;
  name: string;
  ring: Ring;
}
export interface KmlPoint {
  name: string;
  latitude: number;
  longitude: number;
}
export interface KmlReading {
  areas: KmlArea[];
  rallyPoints: KmlPoint[];
  skipped: { name: string; reason: string }[];
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

const SUB = /^\s*(?:sector|s)\s*0*(\d+)\s*(?:[/\-·,:]|\s)*\s*(?:sub[\s-]*sector|subsector|ss|sub)\s*0*(\d+)\b/i;
const SECTOR = /^\s*(?:sector|s)\s*0*(\d+)\b/i;
const RALLY = /rally|start|camp|base|meeting|entrance|gate|road/i;

function coordinates(text: string): [number, number][] {
  return text
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]] as [number, number]);
}

export function readKml(kml: string): KmlReading {
  const out: KmlReading = { areas: [], rallyPoints: [], skipped: [] };
  for (const m of kml.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
    const body = m[1];
    const name = decode(body.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? '');
    const polygon = body.match(/<Polygon\b[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (polygon) {
      const ring = coordinates(polygon[1]);
      if (ring.length < 4) {
        out.skipped.push({ name, reason: 'The outline has fewer than 3 corners.' });
        continue;
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      const sub = name.match(SUB);
      if (sub) {
        out.areas.push({ kind: 'sub_sector', sector: Number(sub[1]), sub: Number(sub[2]), name, ring });
        continue;
      }
      const sector = name.match(SECTOR);
      if (sector) {
        out.areas.push({ kind: 'sector', sector: Number(sector[1]), name, ring });
        continue;
      }
      out.skipped.push({ name: name || '(no name)', reason: 'The name is not "Sector N" or "Sector N Subsector M".' });
      continue;
    }
    const point = body.match(/<Point\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (point) {
      const [c] = coordinates(point[1]);
      if (c && RALLY.test(name)) out.rallyPoints.push({ name, longitude: c[0], latitude: c[1] });
      else out.skipped.push({ name: name || '(no name)', reason: 'Points are read only when named as a rally point (for example "Rally point – camp").' });
      continue;
    }
    if (/<(LineString|MultiGeometry)\b/i.test(body)) out.skipped.push({ name: name || '(no name)', reason: 'Only polygons and points are read.' });
  }
  return out;
}

export const ringWkt = (ring: Ring) => `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(',')}))`;
