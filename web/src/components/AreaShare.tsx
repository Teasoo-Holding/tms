import { useState } from 'react';
import { Legend, StackedBars } from '../charts/charts';
import { deadShare, ShareArea, ShareLegend, ShareMap } from './ShareMap';
import { fmtNum, SimpleTable } from './ui';

export const SHARE_SERIES = [
  { key: 'alive_trees', label: 'Alive', color: 'var(--status-good)' },
  { key: 'dead_trees', label: 'Dead', color: 'var(--status-critical)' },
  { key: 'unknown_trees', label: 'Not yet observed', color: 'var(--border-strong)' },
];

const pctDead = (r: { alive_trees: number; dead_trees: number }) => {
  const share = deadShare(r);
  return share == null ? '—' : `${Math.round(share * 100)}%`;
};

/** Alive/dead share per sector (bars) and per sub-sector (map, with a table on demand). Presentational: data comes in. */
export function AreaShareView({ rows, sectors, boundaries }: { rows: ShareArea[]; sectors: any[]; boundaries: Map<string, GeoJSON.Polygon> }) {
  const [mapFailed, setMapFailed] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const isLocated = (r: ShareArea) => (r.latitude != null && r.longitude != null) || boundaries.has(r.id);
  const located = rows.some(isLocated);
  const unlocated = rows.filter((r) => !isLocated(r)).length;
  const sectorLabel = (r: any) => `${r.short_code} · ${r.name}`;
  return (
    <section className="card chart">
      <div className="chart-head">
        <h2>Alive and dead by area</h2>
        <span className="spacer" />
        {rows.length > 0 && (
          <button className="link no-print" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Show map' : 'Show table'}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="empty">No areas yet.</div>
      ) : (
        <div className="stack">
          <div>
            <Legend items={SHARE_SERIES} />
            <StackedBars categories={sectors.map(sectorLabel)} series={SHARE_SERIES} values={(c, k) => sectors.find((x) => sectorLabel(x) === c)?.[k] ?? 0} />
          </div>
          {asTable || mapFailed || !located ? (
            <div className="table-wrap tall" style={{ maxHeight: 360 }}>
              <SimpleTable
                head={['Sub-sector', 'Trees', 'Alive', 'Dead', 'Not observed', '% dead']}
                rows={rows.map((r) => [
                  `${r.sector_code}/${r.short_code} · ${r.name}`,
                  fmtNum(r.registered_trees),
                  fmtNum(r.alive_trees),
                  fmtNum(r.dead_trees),
                  fmtNum(r.unknown_trees),
                  pctDead(r),
                ])}
              />
            </div>
          ) : (
            <div className="print-avoid">
              <ShareMap areas={rows} boundaries={boundaries} onUnavailable={() => setMapFailed(true)} />
              <ShareLegend />
              {unlocated > 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  {fmtNum(unlocated)} sub-sector{unlocated === 1 ? ' has' : 's have'} no GPS yet and {unlocated === 1 ? 'is' : 'are'} not on the map; “Show table” lists every area.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
