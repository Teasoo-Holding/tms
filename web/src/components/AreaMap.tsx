import maplibregl, { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

export interface MapArea {
  id: string;
  kind: 'sector' | 'sub_sector';
  name: string;
  short_code: string;
  /** Null until the area has a location (both or neither). */
  reference_latitude: number | null;
  reference_longitude: number | null;
  boundary: GeoJSON.Polygon | null;
}

/** Whether the area has any location (an outline or a reference point) to draw. */
export const hasLocation = (a: { boundary?: unknown; reference_latitude?: number | null; reference_longitude?: number | null }) =>
  !!a.boundary || (a.reference_latitude != null && a.reference_longitude != null);

// A licensed basemap is configured per deployment; without one the map shows boundaries only.
export const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': getComputedStyle(document.documentElement).getPropertyValue('--map-bg').trim() || '#e9ede6' } }],
};

function toGeoJson(areas: MapArea[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of areas) {
    const props = { id: a.id, kind: a.kind, name: a.name, code: a.short_code };
    if (a.boundary) features.push({ type: 'Feature', geometry: a.boundary, properties: props });
    if (a.reference_latitude != null && a.reference_longitude != null) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.reference_longitude, a.reference_latitude] }, properties: { ...props, point: true } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Area map: sector and sub-sector boundaries plus administrator-entered reference points. Areas without a location are skipped.
 * It never draws individual tree positions — trees have none in Phase 1.
 */
export function AreaMap({ areas, highlightId }: { areas: MapArea[]; highlightId?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE_URL || BLANK_STYLE, center: [0, 0], zoom: 1, attributionControl: STYLE_URL ? undefined : false });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('areas', { type: 'geojson', data: toGeoJson([]) });
      m.addLayer({ id: 'sub-fill', type: 'fill', source: 'areas', filter: ['all', ['==', ['get', 'kind'], 'sub_sector'], ['!', ['has', 'point']]], paint: { 'fill-color': '#1baf7a', 'fill-opacity': ['case', ['==', ['get', 'id'], highlightId ?? ''], 0.45, 0.18] } });
      m.addLayer({ id: 'sub-line', type: 'line', source: 'areas', filter: ['all', ['==', ['get', 'kind'], 'sub_sector'], ['!', ['has', 'point']]], paint: { 'line-color': '#199e70', 'line-width': 1.5 } });
      m.addLayer({ id: 'sector-line', type: 'line', source: 'areas', filter: ['all', ['==', ['get', 'kind'], 'sector'], ['!', ['has', 'point']]], paint: { 'line-color': '#2a78d6', 'line-width': 2, 'line-dasharray': [3, 2] } });
      m.addLayer({ id: 'ref-points', type: 'circle', source: 'areas', filter: ['has', 'point'], paint: { 'circle-radius': 5, 'circle-color': ['case', ['==', ['get', 'kind'], 'sector'], '#2a78d6', '#199e70'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      for (const layer of ['ref-points', 'sub-fill']) {
        m.on('mousemove', layer, (e) => {
          const p = e.features?.[0]?.properties as any;
          if (!p) return;
          m.getCanvas().style.cursor = 'pointer';
          const node = document.createElement('div');
          node.textContent = `${p.kind === 'sector' ? 'Sector' : 'Sub-sector'} ${p.code} — ${p.name}${p.point ? ' (reference point)' : ''}`;
          popup.setLngLat(e.lngLat).setDOMContent(node).addTo(m);
        });
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = '';
          popup.remove();
        });
      }
      map.current = m;
      update(m, areas);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) update(map.current, areas);
  }, [areas]);

  return <div ref={el} className="map" aria-label="Map of sector and sub-sector boundaries" role="img" />;
}

function update(m: maplibregl.Map, areas: MapArea[]) {
  (m.getSource('areas') as GeoJSONSource | undefined)?.setData(toGeoJson(areas));
  const located = areas.filter(hasLocation);
  if (located.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const a of located) {
    if (a.reference_latitude != null && a.reference_longitude != null) bounds.extend([a.reference_longitude, a.reference_latitude]);
    a.boundary?.coordinates[0].forEach((c) => bounds.extend(c as [number, number]));
  }
  m.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
}
