import { Fragment, useId, useState } from 'react';
import { groupByYear, sectorLabel, subSectorLabel, yearHeading } from '../areaLabels';
import { Chevron, fmtNum } from './ui';

const ha = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const perHa = (trees: number, area: number | null) => (area ? (trees / area).toFixed(1) : '—');
const yearKey = (y: string | null) => y ?? 'none';

/**
 * Area coverage (#120, #131): one collapsible section per planting year, newest first and open; the others start
 * closed so a long year doesn't push the next one out of sight. Each section shows its totals in the header and,
 * when open, one row per sector (hectares, trees, trees per hectare) that opens into its sub-sectors.
 */
export function AreaCoverage({ rows }: { rows: any[] }) {
  const sectors = [...rows.reduce((m: Map<string, any>, r: any) => {
    const x = m.get(r.sector_id) ?? { id: r.sector_id, short_code: r.sector_code, name: r.sector_name, year_label: r.year_label, area: 0, measured: false, trees: 0, subs: [] as any[] };
    x.trees += r.registered_trees;
    if (r.area_hectares != null) {
      x.area += Number(r.area_hectares);
      x.measured = true;
    }
    x.subs.push(r);
    return m.set(r.sector_id, x);
  }, new Map()).values()];
  const years = groupByYear<any>(sectors);
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set(years.length ? [yearKey(years[0].year)] : []));
  const [openSector, setOpenSector] = useState<string | null>(null);
  const baseId = useId();
  if (!sectors.length) return <div className="empty">No areas yet.</div>;

  const toggleYear = (k: string) =>
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const allOpen = years.every((g) => openYears.has(yearKey(g.year)));

  return (
    <div className="coverage-years">
      {years.length > 1 && (
        <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="link" onClick={() => setOpenYears(allOpen ? new Set() : new Set(years.map((g) => yearKey(g.year))))}>
            {allOpen ? 'Collapse all years' : 'Expand all years'}
          </button>
        </div>
      )}
      {years.map((g) => {
        const k = yearKey(g.year);
        const open = openYears.has(k);
        const panelId = `${baseId}-${k}`;
        const trees = g.rows.reduce((n: number, s: any) => n + s.trees, 0);
        const measured = g.rows.filter((s: any) => s.measured);
        const area = measured.reduce((n: number, s: any) => n + s.area, 0);
        return (
          <section key={k} className={`coverage-year${open ? ' open' : ''}`}>
            <h3 className="coverage-year-heading">
              <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => toggleYear(k)}>
                <Chevron open={open} />
                <span className="coverage-year-title">{yearHeading(g.year)}</span>
                <span className="coverage-year-sum muted">
                  {g.rows.length} {g.rows.length === 1 ? 'sector' : 'sectors'} · {measured.length ? `${ha(area)} ha` : 'no GPS area'} · {fmtNum(trees)} {trees === 1 ? 'tree' : 'trees'}
                </span>
              </button>
            </h3>
            <div id={panelId} hidden={!open} className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th className="expander" />
                    <th>Sector</th>
                    <th className="num">Hectares</th>
                    <th className="num">Trees</th>
                    <th className="num">Trees / ha</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((s: any) => {
                    const sectorOpen = openSector === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr className="clickable" onClick={() => setOpenSector(sectorOpen ? null : s.id)}>
                          <td className="expander">
                            <button
                              type="button"
                              className="icon-button"
                              aria-expanded={sectorOpen}
                              aria-label={`${sectorOpen ? 'Hide' : 'Show'} sub-sectors of ${sectorLabel(s)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenSector(sectorOpen ? null : s.id);
                              }}
                            >
                              <Chevron open={sectorOpen} />
                            </button>
                          </td>
                          <td>{sectorLabel(s)} <span className="muted">· {s.subs.length} sub-sectors</span></td>
                          <td className="num">{s.measured ? ha(s.area) : '—'}</td>
                          <td className="num">{fmtNum(s.trees)}</td>
                          <td className="num">{perHa(s.trees, s.measured ? s.area : null)}</td>
                        </tr>
                        {sectorOpen &&
                          s.subs.map((r: any) => (
                            <tr key={r.id} className="sub-row">
                              <td />
                              <td>{subSectorLabel(r.sector_code, r.short_code, r.name)}</td>
                              <td className="num">{ha(r.area_hectares)}</td>
                              <td className="num">{fmtNum(r.registered_trees)}</td>
                              <td className="num">{perHa(r.registered_trees, r.area_hectares)}</td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
