import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { StatTile } from '../charts/charts';
import { BLANK_STYLE, STYLE_URL } from './AreaMap';
import { DotArea, DotCounts, dotFeatures, DotState, treesPerDot } from './densityDots';
import { fmtNum } from './ui';

/** Counts and rates of one area, as returned by GET /reports/density (and /share/:token/density). */
export interface DensityStats {
  registered_trees: number;
  alive_trees: number;
  dead_trees: number;
  unknown_trees: number;
  area_hectares: number | null;
  trees_per_hectare: number | null;
  /** alive / (alive + dead), 0..1; null when no tree has been found alive or dead yet. */
  alive_share: number | null;
}
export interface DensityArea extends DensityStats {
  kind: 'sector' | 'sub_sector';
  id: string;
  short_code: string;
  name: string;
  active: boolean;
  /** Null for areas not located yet. */
  reference_latitude: number | null;
  reference_longitude: number | null;
  boundary: GeoJSON.Polygon | null;
  year_label?: string | null;
  sub_sectors?: DensityArea[];
}
export interface DensityReport {
  generated_at: string;
  project: { id: string; name: string; short_code: string };
  planting_year: { id: string; year_label: string } | null;
  totals: DensityStats;
  sectors: DensityArea[];
}

// Dot colours by the tree's latest observation. MapLibre paints need literal colours.
const DOT_COLORS: Record<DotState, string> = { alive: '#1a9641', dead: '#d03b3b', unknown: '#8f8f87' };
const DOT_LABELS: Record<DotState, string> = { alive: 'Alive', dead: 'Dead', unknown: 'Not yet observed' };
const OUTLINE = '#1f3d2b';

const fmtRate = (v: number | null) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const fmtHa = (v: number | null) => (v == null ? 'No outline' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const fmtShare = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const areaLabel = (a: DensityArea) => `${a.short_code} · ${a.name}`;
const countsOf = (a: DensityStats): DotCounts => ({ alive: a.alive_trees, dead: a.dead_trees, unknown: a.unknown_trees });

/** What the map draws: area outlines, tree dots, how many trees a dot stands for and how many trees could not be drawn. */
interface DotMap {
  areas: GeoJSON.FeatureCollection;
  dots: GeoJSON.FeatureCollection;
  perDot: number;
  outlined: number;
  /** Sectors and sub-sectors without an outline (no GPS corners yet). */
  unoutlined: number;
  undrawn: number;
}

/**
 * Trees of an outlined sub-sector go inside it. The rest of a sector's trees (all of them when its sub-sectors
 * have no outlines) go inside the sector outline, clear of the outlined sub-sectors. Trees with no outline
 * around them at all are only counted.
 */
function buildDotMap(sectors: DensityArea[]): DotMap {
  const areas: GeoJSON.Feature[] = [];
  const fill: DotArea[] = [];
  let outlined = 0;
  let unoutlined = 0;
  let undrawn = 0;
  for (const s of sectors) {
    const subs = (s.sub_sectors ?? []).filter((ss) => ss.boundary);
    if (s.boundary) areas.push({ type: 'Feature', geometry: s.boundary, properties: { kind: 'sector', ...popupProps(s) } });
    for (const ss of subs) {
      areas.push({ type: 'Feature', geometry: ss.boundary!, properties: { kind: 'sub_sector', ...popupProps(ss, s) } });
      fill.push({ id: ss.id, polygon: ss.boundary!, counts: countsOf(ss) });
    }
    outlined += (s.boundary ? 1 : 0) + subs.length;
    unoutlined += (s.boundary ? 0 : 1) + (s.sub_sectors ?? []).length - subs.length;
    const rest = countsOf(s);
    for (const ss of subs) for (const k of ['alive', 'dead', 'unknown'] as const) rest[k] = Math.max(0, rest[k] - countsOf(ss)[k]);
    if (s.boundary) fill.push({ id: s.id, polygon: s.boundary, exclude: subs.map((ss) => ss.boundary!), counts: rest });
    else undrawn += rest.alive + rest.dead + rest.unknown;
  }
  const perDot = treesPerDot(fill.map((a) => a.counts));
  return { areas: { type: 'FeatureCollection', features: areas }, dots: { type: 'FeatureCollection', features: dotFeatures(fill, perDot) }, perDot, outlined, unoutlined, undrawn };
}

/**
 * Trees by area as a dot map: sector and sub-sector outlines with one dot per registered tree (or per N trees on
 * large projects), coloured by its latest observation, plus totals, a legend and the figures in a table.
 * Trees have no GPS positions, so the dots are scattered inside their area and their positions are illustrative.
 */
export function DensityView({ report }: { report: DensityReport }) {
  const [mapFailed, setMapFailed] = useState(false);
  const dotMap = useMemo(() => buildDotMap(report.sectors), [report]);
  const t = report.totals;

  return (
    <div className="stack">
      <div className="grid stats">
        <StatTile label="Trees registered" value={fmtNum(t.registered_trees)} foot={t.unknown_trees ? `${fmtNum(t.unknown_trees)} not yet observed` : undefined} />
        <StatTile label="Area" value={`${fmtHa(t.area_hectares)} ha`} foot="Sum of sector outlines" />
        <StatTile label="Trees per hectare" value={fmtRate(t.trees_per_hectare)} />
        <StatTile label="Alive" value={fmtShare(t.alive_share)} foot={t.alive_trees + t.dead_trees ? `${fmtNum(t.alive_trees)} alive, ${fmtNum(t.dead_trees)} dead` : 'No visits yet'} />
      </div>

      <section className="card">
        <div className="chart-head">
          <h2>Trees by area</h2>
        </div>
        {report.sectors.length === 0 ? (
          <div className="empty">No sectors for this selection.</div>
        ) : (
          <>
            {!mapFailed && dotMap.outlined > 0 && <DensityMapCanvas dotMap={dotMap} onUnavailable={() => setMapFailed(true)} />}
            {dotMap.outlined === 0 && <div className="notice">None of these areas has an outline yet, so there is nothing to draw. Add corner points under Projects → Areas.</div>}
            <DensityLegend perDot={dotMap.perDot} />
            {dotMap.outlined > 0 && dotMap.undrawn > 0 && (
              <p className="muted" style={{ margin: 0 }}>{fmtNum(dotMap.undrawn)} trees are in areas without an outline: they are not drawn and are counted in the table only.</p>
            )}
            {dotMap.outlined > 0 && dotMap.unoutlined > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {fmtNum(dotMap.unoutlined)} {dotMap.unoutlined === 1 ? 'area has' : 'areas have'} no GPS corners yet, so {dotMap.unoutlined === 1 ? 'it is' : 'they are'} not on the map. {dotMap.unoutlined === 1 ? 'It is' : 'They are'} listed in the table.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card flush">
        <div className="table-wrap">
          <DensityTable sectors={report.sectors} />
        </div>
      </section>
      <p className="muted" style={{ margin: 0 }}>
        Trees per hectare: registered trees in the area divided by the area of its surveyed outline. “Alive” is the share of trees whose latest visit found them alive, out of
        those found alive or dead.
      </p>
    </div>
  );
}

export function DensityLegend({ perDot }: { perDot: number }) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="legend" aria-label="Map legend">
        {(Object.keys(DOT_COLORS) as DotState[]).map((k) => (
          <span key={k}><i style={{ background: DOT_COLORS[k], borderRadius: '50%' }} />{DOT_LABELS[k]}</span>
        ))}
        <span>1 dot = {perDot === 1 ? '1 tree' : `${fmtNum(perDot)} trees`}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Dots show how many trees are in each area; their positions inside the area are illustrative (trees have no GPS).</p>
    </div>
  );
}

function DensityTable({ sectors }: { sectors: DensityArea[] }) {
  const row = (a: DensityArea, sub: boolean) => (
    <tr key={a.id} style={a.active ? undefined : { opacity: 0.65 }}>
      <td style={sub ? { paddingLeft: 28 } : { fontWeight: 600 }}>
        {areaLabel(a)}
        {!a.active && <span className="pill" style={{ marginLeft: 6 }}>Inactive</span>}
        {!sub && a.year_label === null && <span className="muted"> (older setup)</span>}
      </td>
      <td className="num">{fmtHa(a.area_hectares)}</td>
      <td className="num">{fmtNum(a.registered_trees)}</td>
      <td className="num hide-sm">{fmtNum(a.alive_trees)}</td>
      <td className="num hide-sm">{fmtNum(a.dead_trees)}</td>
      <td className="num hide-sm">{fmtNum(a.unknown_trees)}</td>
      <td className="num">{fmtRate(a.trees_per_hectare)}</td>
      <td className="num">{fmtShare(a.alive_share)}</td>
    </tr>
  );
  if (sectors.length === 0) return <div className="empty">No areas for this selection.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Area</th><th className="num">Hectares</th><th className="num">Trees</th><th className="num hide-sm">Alive</th><th className="num hide-sm">Dead</th>
          <th className="num hide-sm">Not observed</th><th className="num">Trees / ha</th><th className="num">Alive %</th>
        </tr>
      </thead>
      <tbody>
        {sectors.map((s) => (
          <Fragment key={s.id}>
            {row(s, false)}
            {(s.sub_sectors ?? []).map((ss) => row(ss, true))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** Popup text of an area, kept as feature properties. */
function popupProps(a: DensityArea, parent?: DensityArea) {
  return {
    title: parent ? `${parent.short_code}/${a.short_code} · ${a.name}` : areaLabel(a),
    hectares: fmtHa(a.area_hectares),
    trees: fmtNum(a.registered_trees),
    density: fmtRate(a.trees_per_hectare),
    alive: fmtShare(a.alive_share),
    counts: `${fmtNum(a.alive_trees)} alive · ${fmtNum(a.dead_trees)} dead · ${fmtNum(a.unknown_trees)} not observed`,
  };
}

function popupNode(p: any) {
  const node = document.createElement('div');
  node.style.fontSize = '12px';
  node.style.lineHeight = '1.5';
  node.style.color = '#0b0b0b';
  const title = document.createElement('strong');
  title.textContent = p.title;
  node.appendChild(title);
  for (const line of [`${p.density} trees / ha`, `${p.trees} trees on ${p.hectares} ha`, `Alive: ${p.alive}`, p.counts]) {
    const div = document.createElement('div');
    div.textContent = line;
    node.appendChild(div);
  }
  return node;
}

/** The map itself; calls `onUnavailable` if MapLibre cannot start (e.g. no WebGL) so the table carries on alone. */
function DensityMapCanvas({ dotMap, onUnavailable }: { dotMap: DotMap; onUnavailable: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef(dotMap);
  latest.current = dotMap;

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: STYLE_URL || BLANK_STYLE,
        center: [0, 0],
        zoom: 1,
        attributionControl: STYLE_URL ? undefined : false,
        preserveDrawingBuffer: true,
        cooperativeGestures: true,
      });
    } catch {
      onUnavailable();
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      m.addSource('density-areas', { type: 'geojson', data: empty });
      m.addSource('density-dots', { type: 'geojson', data: empty });
      const isSector: any = ['==', ['get', 'kind'], 'sector'];
      m.addLayer({ id: 'area-fill', type: 'fill', source: 'density-areas', paint: { 'fill-color': OUTLINE, 'fill-opacity': 0.05 } });
      m.addLayer({ id: 'sub-sector-line', type: 'line', source: 'density-areas', filter: ['!', isSector], paint: { 'line-color': OUTLINE, 'line-width': 0.8, 'line-opacity': 0.7 } });
      m.addLayer({ id: 'sector-line', type: 'line', source: 'density-areas', filter: isSector, paint: { 'line-color': OUTLINE, 'line-width': 2.5 } });
      m.addLayer({
        id: 'tree-dots',
        type: 'circle',
        source: 'density-dots',
        paint: {
          'circle-color': ['match', ['get', 'state'], 'alive', DOT_COLORS.alive, 'dead', DOT_COLORS.dead, DOT_COLORS.unknown],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.2, 18, 4, 20, 6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 0, 17, 0.5],
        },
      });
      const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      const pinned = new maplibregl.Popup({ closeButton: true, closeOnClick: true });
      // The innermost area under the pointer: a sub-sector if there is one, else its sector.
      const areaAt = (point: maplibregl.Point) => {
        const hits = m.queryRenderedFeatures(point, { layers: ['area-fill'] });
        return (hits.find((f) => f.properties?.kind === 'sub_sector') ?? hits[0])?.properties;
      };
      m.on('mousemove', (e) => {
        const p = areaAt(e.point);
        m.getCanvas().style.cursor = p ? 'pointer' : '';
        if (!p) hover.remove();
        else if (!pinned.isOpen()) hover.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
      });
      m.on('mouseout', () => hover.remove());
      m.on('click', (e) => {
        const p = areaAt(e.point);
        if (!p) return;
        hover.remove();
        pinned.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
      });
      map.current = m;
      update(m, latest.current);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) update(map.current, dotMap);
  }, [dotMap]);

  return <div ref={el} className="map" aria-label="Map of areas with one dot per tree, coloured alive, dead or not yet observed; positions are illustrative" role="img" />;
}

function update(m: maplibregl.Map, dotMap: DotMap) {
  (m.getSource('density-areas') as GeoJSONSource | undefined)?.setData(dotMap.areas);
  (m.getSource('density-dots') as GeoJSONSource | undefined)?.setData(dotMap.dots);
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const f of dotMap.areas.features) {
    (f.geometry as GeoJSON.Polygon).coordinates[0].forEach((c) => {
      bounds.extend(c as [number, number]);
      any = true;
    });
  }
  if (any) m.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
}
