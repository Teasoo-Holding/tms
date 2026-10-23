import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { StatTile } from '../charts/charts';
import { BLANK_STYLE, STYLE_URL } from './AreaMap';
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
  reference_latitude: number;
  reference_longitude: number;
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

type Level = 'sub_sector' | 'sector';

// Sequential greens (light = few trees per hectare, dark = many). MapLibre paints need literal colours.
const RAMP = ['#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#00441b'];
const NO_TREES = '#c9c8bf';

/** Five equal classes up to a rounded maximum, so the legend reads in whole numbers. */
function classBreaks(max: number): number[] {
  if (max <= 0) return [];
  const raw = max / RAMP.length;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return RAMP.map((_, i) => step * (i + 1));
}
const colorFor = (density: number | null, breaks: number[]) => {
  if (!density) return NO_TREES;
  const i = breaks.findIndex((b) => density <= b);
  return RAMP[i === -1 ? RAMP.length - 1 : i];
};
const fmtRate = (v: number | null) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const fmtHa = (v: number | null) => (v == null ? 'No outline' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const fmtShare = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtBreak = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const areaLabel = (a: DensityArea) => `${a.short_code} · ${a.name}`;

/**
 * Tree density by area: sector or sub-sector outlines shaded by registered trees per hectare, with totals, a
 * legend and the figures in a table. Trees have no GPS positions, so density is per surveyed area.
 */
export function DensityView({ report }: { report: DensityReport }) {
  const [level, setLevel] = useState<Level>('sub_sector');
  const [mapFailed, setMapFailed] = useState(false);
  const shown = useMemo(() => (level === 'sector' ? report.sectors : report.sectors.flatMap((s) => (s.sub_sectors ?? []).map((ss) => ({ ...ss, parent: s })))), [report, level]);
  const breaks = useMemo(() => classBreaks(Math.max(0, ...shown.map((a) => a.trees_per_hectare ?? 0))), [shown]);
  const outlined = shown.filter((a) => a.boundary).length;
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
          <h2>Trees per hectare</h2>
          <span className="spacer" />
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Areas to shade">
            <button type="button" className="chip" aria-pressed={level === 'sub_sector'} onClick={() => setLevel('sub_sector')}>Sub-sectors</button>
            <button type="button" className="chip" aria-pressed={level === 'sector'} onClick={() => setLevel('sector')}>Sectors</button>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="empty">No {level === 'sector' ? 'sectors' : 'sub-sectors'} for this selection.</div>
        ) : (
          <>
            {!mapFailed && outlined > 0 && <DensityMapCanvas areas={shown} outlines={level === 'sub_sector' ? report.sectors : []} breaks={breaks} onUnavailable={() => setMapFailed(true)} />}
            {outlined === 0 && <div className="notice">None of these areas has an outline yet, so there is nothing to draw. Add corner points under Projects → Areas.</div>}
            <DensityLegend breaks={breaks} />
            {outlined > 0 && outlined < shown.length && (
              <p className="muted" style={{ margin: 0 }}>{fmtNum(shown.length - outlined)} of {fmtNum(shown.length)} areas have no outline and are listed in the table only.</p>
            )}
          </>
        )}
      </section>

      <section className="card flush">
        <div className="table-wrap">
          <DensityTable sectors={report.sectors} breaks={level === 'sector' ? breaks : undefined} subBreaks={level === 'sub_sector' ? breaks : undefined} />
        </div>
      </section>
      <p className="muted" style={{ margin: 0 }}>
        Trees are counted by area (they have no individual GPS positions): registered trees in the area divided by the area of its surveyed outline. “Alive” is the share of
        trees whose latest visit found them alive, out of those found alive or dead.
      </p>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <i style={{ background: color }} />;
}

export function DensityLegend({ breaks }: { breaks: number[] }) {
  return (
    <div className="legend" aria-label="Map legend: trees per hectare">
      <span><Swatch color={NO_TREES} />No trees</span>
      {breaks.map((b, i) => (
        <span key={b}><Swatch color={RAMP[i]} />{i === 0 ? `up to ${fmtBreak(b)}` : `${fmtBreak(breaks[i - 1])}–${fmtBreak(b)}`}</span>
      ))}
      <span>trees / ha</span>
    </div>
  );
}

function DensityTable({ sectors, breaks, subBreaks }: { sectors: DensityArea[]; breaks?: number[]; subBreaks?: number[] }) {
  const row = (a: DensityArea, sub: boolean, scale?: number[]) => (
    <tr key={a.id} style={a.active ? undefined : { opacity: 0.65 }}>
      <td style={sub ? { paddingLeft: 28 } : { fontWeight: 600 }}>
        {scale && <span className="legend-dot" style={{ background: colorFor(a.trees_per_hectare, scale) }} aria-hidden />}
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
            {row(s, false, breaks)}
            {(s.sub_sectors ?? []).map((ss) => row(ss, true, subBreaks))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function toGeoJson(areas: DensityArea[], outlines: DensityArea[], breaks: number[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of outlines) {
    if (s.boundary) features.push({ type: 'Feature', geometry: s.boundary, properties: { outline: true, code: s.short_code } });
  }
  for (const a of areas) {
    if (!a.boundary) continue;
    const parent = (a as DensityArea & { parent?: DensityArea }).parent;
    features.push({
      type: 'Feature',
      geometry: a.boundary,
      properties: {
        title: parent ? `${parent.short_code}/${a.short_code} · ${a.name}` : areaLabel(a),
        color: colorFor(a.trees_per_hectare, breaks),
        hectares: fmtHa(a.area_hectares),
        trees: fmtNum(a.registered_trees),
        density: fmtRate(a.trees_per_hectare),
        alive: fmtShare(a.alive_share),
        counts: `${fmtNum(a.alive_trees)} alive · ${fmtNum(a.dead_trees)} dead · ${fmtNum(a.unknown_trees)} not observed`,
      },
    });
  }
  return { type: 'FeatureCollection', features };
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
function DensityMapCanvas({ areas, outlines, breaks, onUnavailable }: { areas: DensityArea[]; outlines: DensityArea[]; breaks: number[]; onUnavailable: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef({ areas, outlines, breaks });
  latest.current = { areas, outlines, breaks };

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
      m.addSource('density', { type: 'geojson', data: toGeoJson([], [], []) });
      const filled: any = ['!', ['has', 'outline']];
      m.addLayer({ id: 'density-fill', type: 'fill', source: 'density', filter: filled, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.75 } });
      m.addLayer({ id: 'density-line', type: 'line', source: 'density', filter: filled, paint: { 'line-color': '#ffffff', 'line-width': 1 } });
      m.addLayer({ id: 'sector-outline', type: 'line', source: 'density', filter: ['has', 'outline'], paint: { 'line-color': '#1f3d2b', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      const pinned = new maplibregl.Popup({ closeButton: true, closeOnClick: true });
      m.on('mousemove', 'density-fill', (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        m.getCanvas().style.cursor = 'pointer';
        if (!pinned.isOpen()) hover.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
      });
      m.on('mouseleave', 'density-fill', () => {
        m.getCanvas().style.cursor = '';
        hover.remove();
      });
      m.on('click', 'density-fill', (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        hover.remove();
        pinned.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
      });
      map.current = m;
      update(m, latest.current.areas, latest.current.outlines, latest.current.breaks);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) update(map.current, areas, outlines, breaks);
  }, [areas, outlines, breaks]);

  return <div ref={el} className="map" aria-label="Map of areas shaded by trees per hectare" role="img" />;
}

function update(m: maplibregl.Map, areas: DensityArea[], outlines: DensityArea[], breaks: number[]) {
  (m.getSource('density') as GeoJSONSource | undefined)?.setData(toGeoJson(areas, outlines, breaks));
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const a of [...areas, ...outlines]) {
    a.boundary?.coordinates[0].forEach((c) => {
      bounds.extend(c as [number, number]);
      any = true;
    });
  }
  if (any) m.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
}
