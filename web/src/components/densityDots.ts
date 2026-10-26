// Illustrative tree dots for the density map. Trees have no GPS, so each area's trees are scattered inside its
// outline: one dot per tree (or per N trees when capped), placed by a pseudo-random generator seeded by the area id
// so the picture is the same on every load.

export type DotState = 'alive' | 'dead' | 'unknown';
export interface DotCounts { alive: number; dead: number; unknown: number }
/** One area to fill: its outline, outlines inside it to keep clear (e.g. sub-sectors drawn separately) and counts. */
export interface DotArea { id: string; polygon: GeoJSON.Polygon; exclude?: GeoJSON.Polygon[]; counts: DotCounts }

export const MAX_DOTS_PER_AREA = 1500;
export const MAX_DOTS = 20_000;

/** Trees per dot: 1 unless an area or the whole map would exceed the caps. */
export function treesPerDot(areas: DotCounts[]): number {
  const sizes = areas.map((c) => c.alive + c.dead + c.unknown);
  const total = sizes.reduce((a, b) => a + b, 0);
  return Math.max(1, Math.ceil(Math.max(0, ...sizes) / MAX_DOTS_PER_AREA), Math.ceil(total / MAX_DOTS));
}

/** FNV-1a hash of a string, as a 32-bit seed. */
function seedOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: small, fast and good enough for scattering dots; returns numbers in [0, 1). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ray casting on one ring. */
function inRing(x: number, y: number, ring: GeoJSON.Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside the outer ring and outside any hole. */
function inPolygon(x: number, y: number, p: GeoJSON.Polygon) {
  return inRing(x, y, p.coordinates[0]) && !p.coordinates.slice(1).some((hole) => inRing(x, y, hole));
}

/**
 * Dot positions for one area, by rejection sampling in its bounding box. Dots keep a small minimum spacing
 * (checked on a grid) while that is easy; when a dot cannot find room after a few tries it is placed anyway.
 */
function scatter(area: DotArea, n: number, random: () => number): [number, number][] {
  const ring = area.polygon.coordinates[0];
  if (n <= 0 || !ring || ring.length < 4) return [];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  // Longitude degrees are shorter away from the equator; spacing is measured in latitude-sized units.
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  let shoelace = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) shoelace += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  const space = 0.5 * Math.sqrt((Math.abs(shoelace / 2) * kx) / n);
  const grid = new Map<string, [number, number][]>();
  const cell = (x: number, y: number) => [Math.floor((x * kx) / (space || 1)), Math.floor(y / (space || 1))];
  const crowded = (x: number, y: number) => {
    if (!space) return false;
    const [cx, cy] = cell(x, y);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const [px, py] of grid.get(`${cx + i}:${cy + j}`) ?? []) if (((px - x) * kx) ** 2 + (py - y) ** 2 < space * space) return true;
    return false;
  };
  // Excluded outlines are kept clear while there is room; if they cover (almost) everything, dots go anywhere.
  let strict = !!area.exclude?.length;
  const inside = (x: number, y: number) => inPolygon(x, y, area.polygon) && !(strict && area.exclude!.some((p) => inPolygon(x, y, p)));
  const out: [number, number][] = [];
  const budget = n * 60;
  for (let tries = 0, misses = 0; out.length < n && tries < budget * 2; tries++) {
    if (tries === budget) strict = false;
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    if (!inside(x, y)) continue;
    if (misses < 15 && crowded(x, y)) {
      misses++;
      continue;
    }
    misses = 0;
    out.push([x, y]);
    const [cx, cy] = cell(x, y);
    const key = `${cx}:${cy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push([x, y]);
    else grid.set(key, [[x, y]]);
  }
  return out;
}

/** Dot features for all areas, `perDot` trees each; a non-empty count always shows at least one dot. */
export function dotFeatures(areas: DotArea[], perDot: number): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const area of areas) {
    const random = prng(seedOf(area.id));
    const states: DotState[] = [];
    for (const s of ['alive', 'dead', 'unknown'] as const) {
      const c = area.counts[s];
      states.push(...Array<DotState>(c > 0 ? Math.max(1, Math.round(c / perDot)) : 0).fill(s));
    }
    // Shuffled, so colours do not cluster where the spacing was relaxed late in the sampling.
    for (let i = states.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [states[i], states[j]] = [states[j], states[i]];
    }
    scatter(area, states.length, random).forEach((coordinates, i) =>
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { state: states[i] } }),
    );
  }
  return features;
}
