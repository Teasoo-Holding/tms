import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, publicGet, qs } from '../api/client';
import { sectorLabel, subSectorLabel } from '../areaLabels';
import { AreaSketch, boundaryCorners, LonLat } from '../components/AreaSketch';
import { DensityArea, DensityReport } from '../components/DensityMap';
import { Paged } from '../components/Pagination';
import { copyText } from '../components/ShareLinks';
import { EmptyState, ErrorNotice, fmtNum } from '../components/ui';
import type { ShareContext } from './Share';

const fmtCoord = (lat: number, lon: number) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
const mapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
const fmtHa = (v: number | null) => (v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`);

/** A button that copies [text] and says so for two seconds. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="link"
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Reference point and corners of an area, or "No GPS yet". */
function Gps({ area, name }: { area: DensityArea; name: string }) {
  const corners = boundaryCorners(area.boundary);
  const lat = area.reference_latitude;
  const lon = area.reference_longitude;
  if (lat == null && corners.length === 0) return <span className="muted">No GPS yet</span>;
  const cornerText = corners.map(([x, y]) => fmtCoord(y, x)).join('\n');
  return (
    <div className="gps">
      {lat != null && lon != null && (
        <div className="row" style={{ gap: 8 }}>
          <span className="mono">{fmtCoord(lat, lon)}</span>
          <CopyButton text={fmtCoord(lat, lon)} label={`Copy the reference point of ${name}`} />
          <a href={mapsUrl(lat, lon)} target="_blank" rel="noreferrer">Open in Google Maps</a>
        </div>
      )}
      {corners.length > 0 && (
        <details className="more">
          <summary>{corners.length} corners</summary>
          <ol className="corner-list mono">
            {corners.map(([x, y], i) => (
              <li key={i}>
                {fmtCoord(y, x)} <a href={mapsUrl(y, x)} target="_blank" rel="noreferrer" aria-label={`Corner ${i + 1} in Google Maps`}>Map</a>
              </li>
            ))}
          </ol>
          <CopyButton text={cornerText} label={`Copy the corners of ${name}`} />
        </details>
      )}
    </div>
  );
}

/**
 * Areas: planting years with their tree counts, then each sector and its sub-sectors with GPS (reference point and
 * corners when surveyed), hectares and trees. Outlines are sketched when there are any.
 */
export function ShareAreas({ token, base, view }: ShareContext) {
  const [params, setParams] = useSearchParams();
  const yearId = params.get('planting_year_id') ?? '';
  const query = qs({ planting_year_id: yearId });
  const density = useQuery({
    queryKey: ['share-density', token, query],
    queryFn: () => publicGet<DensityReport>(`${base}/density${query}`),
    retry: (n, e) => (e as ApiError).status !== 404 && n < 1,
  });
  const years: any[] = view?.planting_years ?? [];
  const byYear = new Map<string, number>((view?.summary?.by_planting_year ?? []).map((y: any) => [y.id, y.count]));
  const setYear = (id: string) => setParams(id ? new URLSearchParams({ planting_year_id: id }) : new URLSearchParams(), { replace: true });
  const sectors = density.data?.sectors ?? [];

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Areas</h2>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Planting years</h3>
        <div className="row" role="group" aria-label="Planting year">
          <button type="button" className="chip" aria-pressed={!yearId} onClick={() => setYear('')}>All years</button>
          {years.map((y) => (
            <button key={y.id} type="button" className="chip" aria-pressed={yearId === y.id} onClick={() => setYear(y.id)}>
              {y.year_label} · {fmtNum(byYear.get(y.id) ?? 0)} trees
            </button>
          ))}
        </div>
      </section>

      <ErrorNotice error={density.error} />
      {density.isLoading && <div className="empty">Loading…</div>}
      {density.data && sectors.length === 0 && <EmptyState title="No areas yet" />}
      <Paged items={sectors} label="sectors" size={25}>
        {(page) => (
          <div className="stack">
            {page.map((s) => {
              const name = sectorLabel(s);
              const shape = boundaryCorners(s.boundary);
              const subs = s.sub_sectors ?? [];
              const subShapes = subs.map((ss) => boundaryCorners(ss.boundary)).filter((c) => c.length >= 3) as LonLat[][];
              return (
                <section key={s.id} className="card area-card">
                  <div className="area-card-head">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ margin: 0 }}>Sector {name}</h3>
                      <p className="muted" style={{ margin: '2px 0 8px' }}>
                        {s.year_label ? `Planting year ${s.year_label}` : 'All planting years'} · {fmtHa(s.area_hectares)} · {fmtNum(s.registered_trees)} trees
                        {s.registered_trees > 0 && ` (${fmtNum(s.alive_trees)} alive, ${fmtNum(s.dead_trees)} dead or missing)`}
                      </p>
                      <Gps area={s} name={`sector ${name}`} />
                    </div>
                    {(shape.length >= 3 || subShapes.length > 0) && (
                      <AreaSketch shape={shape.length >= 3 ? shape : []} others={subShapes} label={`Outline of sector ${name} and its sub-sectors`} />
                    )}
                  </div>
                  {subs.length > 0 && (
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <Paged items={subs} label="sub-sectors">
                        {(rows) => (
                          <table>
                            <thead>
                              <tr><th>Sub-sector</th><th className="num">Hectares</th><th className="num">Trees</th><th>GPS</th></tr>
                            </thead>
                            <tbody>
                              {rows.map((ss) => {
                                const label = subSectorLabel(s.short_code, ss.short_code, ss.name);
                                return (
                                  <tr key={ss.id}>
                                    <td className="nowrap">{label}</td>
                                    <td className="num nowrap">{fmtHa(ss.area_hectares)}</td>
                                    <td className="num">{fmtNum(ss.registered_trees)}</td>
                                    <td><Gps area={ss} name={`sub-sector ${label}`} /></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </Paged>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Paged>
      <p className="muted" style={{ margin: 0 }}>Coordinates are latitude, longitude (WGS 84). Hectares come from each area’s surveyed outline.</p>
    </div>
  );
}
