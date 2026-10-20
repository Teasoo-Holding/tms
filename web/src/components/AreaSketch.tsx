/** [longitude, latitude], as in GeoJSON. */
export type LonLat = [number, number];

/** Corners from a GeoJSON Polygon: its outer ring minus the closing point. */
export function boundaryCorners(boundary: GeoJSON.Polygon | null | undefined): LonLat[] {
  const ring = (boundary?.coordinates?.[0] ?? []) as LonLat[];
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) return ring.slice(0, -1);
  return ring;
}

/** Orders corners around their centre, as the server does, so any entry order gives a non-crossing outline. */
export function orderCorners(points: LonLat[]): LonLat[] {
  if (points.length < 3) return points;
  const cx = points.reduce((n, p) => n + p[0], 0) / points.length;
  const cy = points.reduce((n, p) => n + p[1], 0) / points.length;
  return [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

/** Approximate area in hectares (flat-earth approximation, fine for plots of a few km). */
export function areaHectares(points: LonLat[]): number {
  if (points.length < 3) return 0;
  const lat0 = (points.reduce((n, p) => n + p[1], 0) / points.length) * (Math.PI / 180);
  const xy = points.map(([lon, lat]) => [lon * 111_320 * Math.cos(lat0), lat * 110_540]);
  let twice = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2 / 10_000;
}

const W = 340;
const H = 220;
const PAD = 18;

/**
 * Small SVG sketch of an area outline: the shape being edited (with numbered corners), its parent sector
 * (dashed) and neighbouring areas (grey). Not a map — no basemap, just the geometry to sanity-check.
 */
export function AreaSketch({ shape, labels, parent, others = [], label }: {
  shape: LonLat[];
  /** Corner labels in the same order as `shape` (e.g. the corner number as entered). */
  labels?: string[];
  parent?: LonLat[];
  others?: LonLat[][];
  label: string;
}) {
  const all = [...shape, ...(parent ?? []), ...others.flat()];
  if (all.length === 0) return null;
  const midLat = (all.reduce((n, p) => n + p[1], 0) / all.length) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const xs = all.map((p) => p[0] * kx);
  const ys = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, span * 0.02), (H - 2 * PAD) / Math.max(maxY - minY, span * 0.02));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const pt = (p: LonLat): [number, number] => [ox + (p[0] * kx - minX) * scale, H - (oy + (p[1] - minY) * scale)];
  const path = (ring: LonLat[]) => ring.map(pt).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="sketch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {others.map((o, i) => o.length >= 3 && <polygon key={i} className="sibling" points={path(o)} />)}
      {parent && parent.length >= 3 && <polygon className="parent" points={path(parent)} />}
      {shape.length >= 3 && <polygon className="shape" points={path(shape)} />}
      {shape.map((p, i) => {
        const [x, y] = pt(p);
        return (
          <g key={i}>
            <circle className="corner" cx={x} cy={y} r={4} />
            {labels?.[i] && <text x={x + 6} y={y - 6}>{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}
