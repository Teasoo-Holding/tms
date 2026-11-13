import { useState } from 'react';
import { groupByYear, sectorLabel, subSectorLabel, yearHeading } from '../areaLabels';
import { Legend, StackedBars } from '../charts/charts';
import { deadShare, ShareArea, ShareLegend, ShareMap } from './ShareMap';
import { fmtNum, SimpleTable } from './ui';

export const SHARE_SERIES = [
  { key: 'alive_trees', label: 'Alive', color: 'var(--status-good)' },
  { key: 'dead_trees', label: 'Dead', color: 'var(--status-critical)' },
  { key: 'unknown_trees', label: 'No status yet', color: 'var(--border-strong)' },
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
  return (
    <section className="card chart">
      <div className="chart-head">
        <div>
          <h2>Tree status by planting year and sector</h2>
          <p className="muted" style={{ margin: 0 }}>Alive, dead and no status yet, from each tree’s latest visit.</p>
        </div>
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
            {groupByYear<any>(sectors).map((g, _i, all) => (
              <div key={g.year ?? 'none'} className="year-block">
                {all.length > 1 && <h3 className="year-heading">{yearHeading(g.year)}</h3>}
                <StackedBars categories={g.rows.map(sectorLabel)} series={SHARE_SERIES} values={(c, k) => g.rows.find((x: any) => sectorLabel(x) === c)?.[k] ?? 0} />
              </div>
            ))}
          </div>
          {asTable || mapFailed || !located ? (
            <div className="table-wrap tall" style={{ maxHeight: 360 }}>
              <SimpleTable
                head={['Planting year', 'Sub-sector', 'Trees', 'Alive', 'Dead', 'No status yet', '% dead']}
                rows={rows.map((r: any) => [
                  r.year_label ?? '—',
                  subSectorLabel(r.sector_code, r.short_code, r.name),
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
