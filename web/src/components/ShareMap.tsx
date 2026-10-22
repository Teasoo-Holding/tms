import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { BLANK_STYLE, STYLE_URL } from './AreaMap';

/** One sub-sector row from the summary's area_coverage. */
export interface ShareArea {
  id: string;
  name: string;
  short_code: string;
  sector_code: string;
  sector_name: string;
  latitude: number | null;
  longitude: number | null;
  registered_trees: number;
  alive_trees: number;
  dead_trees: number;
  unknown_trees: number;
}

// MapLibre paints need literal colours (no CSS variables); these match the --status-* tokens.
export const SHARE_COLORS = { alive: '#0ca30c', mid: '#fab219', dead: '#d03b3b', none: '#9a998f' };

/** Dead share of the trees with a recorded status; null when none has one yet. */
export const deadShare = (a: { alive_trees: number; dead_trees: number }) => {
  const observed = a.alive_trees + a.dead_trees;
  return observed ? a.dead_trees / observed : null;
};

function toGeoJson(areas: ShareArea[], boundaries: Map<string, GeoJSON.Polygon>): GeoJSON.FeatureCollection {
  const max = Math.max(1, ...areas.map((a) => a.registered_trees));
  const features: GeoJSON.Feature[] = [];
  for (const a of areas) {
    const share = deadShare(a);
    const props = {
      id: a.id,
      name: a.name,
      code: a.short_code,
      sector: `${a.sector_code} · ${a.sector_name}`,
      trees: a.registered_trees,
      alive: a.alive_trees,
      dead: a.dead_trees,
      unknown: a.unknown_trees,
      // -1 marks "no observed trees" (grey); expressions cannot test for null reliably across versions.
      share: share ?? -1,
      radius: a.registered_trees ? 6 + 20 * Math.sqrt(a.registered_trees / max) : 5,
    };
    const boundary = boundaries.get(a.id);
    if (boundary) features.push({ type: 'Feature', geometry: boundary, properties: props });
    if (a.latitude != null && a.longitude != null) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] }, properties: { ...props, point: true } });
    }
  }
  return { type: 'FeatureCollection', features };
}

const COLOR_EXPR: any = [
  'case',
  ['<', ['get', 'share'], 0],
  SHARE_COLORS.none,
  ['interpolate', ['linear'], ['get', 'share'], 0, SHARE_COLORS.alive, 0.5, SHARE_COLORS.mid, 1, SHARE_COLORS.dead],
];

function popupNode(p: any) {
  const node = document.createElement('div');
  node.style.fontSize = '12px';
  node.style.lineHeight = '1.5';
  node.style.color = '#0b0b0b';
  const title = document.createElement('strong');
  title.textContent = `${p.code} · ${p.name}`;
  node.appendChild(title);
  const share = Number(p.share);
  const lines = [
    `Sector ${p.sector}`,
    `Trees: ${Number(p.trees).toLocaleString()}`,
    `Alive: ${Number(p.alive).toLocaleString()}`,
    `Dead: ${Number(p.dead).toLocaleString()}`,
    `Not yet observed: ${Number(p.unknown).toLocaleString()}`,
    `% dead: ${share < 0 ? '—' : `${Math.round(share * 100)}% of observed trees`}`,
  ];
  for (const l of lines) {
    const div = document.createElement('div');
    div.textContent = l;
    node.appendChild(div);
  }
  return node;
}

/**
 * Sub-sectors drawn at their reference points (and boundaries, when set), sized by registered trees
 * and coloured by the dead share of observed trees. Calls `onUnavailable` if the map cannot start
 * (e.g. no WebGL), so the caller can fall back to its table.
 */
export function ShareMap({ areas, boundaries, onUnavailable }: {
  areas: ShareArea[];
  boundaries: Map<string, GeoJSON.Polygon>;
  onUnavailable?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef({ areas, boundaries });
  latest.current = { areas, boundaries };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      // preserveDrawingBuffer keeps the canvas content so the map appears when the page is printed.
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
      setFailed(true);
      onUnavailable?.();
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('share', { type: 'geojson', data: toGeoJson([], new Map()) });
      const polygon: any = ['!', ['has', 'point']];
      m.addLayer({ id: 'share-fill', type: 'fill', source: 'share', filter: polygon, paint: { 'fill-color': COLOR_EXPR, 'fill-opacity': 0.18 } });
      m.addLayer({ id: 'share-line', type: 'line', source: 'share', filter: polygon, paint: { 'line-color': COLOR_EXPR, 'line-width': 1.5 } });
      m.addLayer({
        id: 'share-points',
        type: 'circle',
        source: 'share',
        filter: ['has', 'point'],
        paint: { 'circle-radius': ['get', 'radius'], 'circle-color': COLOR_EXPR, 'circle-opacity': 0.8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
      });
      const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      const pinned = new maplibregl.Popup({ closeButton: true, closeOnClick: true });
      for (const layer of ['share-points', 'share-fill']) {
        m.on('mousemove', layer, (e) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          m.getCanvas().style.cursor = 'pointer';
          if (!pinned.isOpen()) hover.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
        });
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = '';
          hover.remove();
        });
        m.on('click', layer, (e) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          hover.remove();
          pinned.setLngLat(e.lngLat).setDOMContent(popupNode(p)).addTo(m);
        });
      }
      map.current = m;
      update(m, latest.current.areas, latest.current.boundaries);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) update(map.current, areas, boundaries);
  }, [areas, boundaries]);

  if (failed) return null;
  return <div ref={el} className="map" aria-label="Map of sub-sectors coloured by the share of dead trees" role="img" />;
}

function update(m: maplibregl.Map, areas: ShareArea[], boundaries: Map<string, GeoJSON.Polygon>) {
  (m.getSource('share') as GeoJSONSource | undefined)?.setData(toGeoJson(areas, boundaries));
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const a of areas) {
    if (a.latitude != null && a.longitude != null) {
      bounds.extend([a.longitude, a.latitude]);
      any = true;
    }
    boundaries.get(a.id)?.coordinates[0].forEach((c) => {
      bounds.extend(c as [number, number]);
      any = true;
    });
  }
  if (any) m.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
}

/** Colour and size key for the share map. */
export function ShareLegend() {
  const swatch = (color: string) => <i style={{ background: color, borderRadius: '50%' }} />;
  return (
    <div className="legend" aria-label="Map legend">
      <span>{swatch(SHARE_COLORS.alive)}Mostly alive</span>
      <span>{swatch(SHARE_COLORS.mid)}About half dead</span>
      <span>{swatch(SHARE_COLORS.dead)}Mostly dead</span>
      <span>{swatch(SHARE_COLORS.none)}Not yet observed</span>
      <span>Size = trees</span>
    </div>
  );
}
