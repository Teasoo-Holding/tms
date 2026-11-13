import { Fragment, useState } from 'react';
import { groupByYear, sectorLabel, subSectorLabel, yearHeading } from '../areaLabels';
import { Chevron, fmtNum } from './ui';

const ha = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const perHa = (trees: number, area: number | null) => (area ? (trees / area).toFixed(1) : '—');

/**
 * Area coverage, compact (#120): one row per sector under its planting year (hectares, trees, trees per hectare),
 * opening into its sub-sectors. Sectors of different years never mix.
 */
export function AreaCoverage({ rows }: { rows: any[] }) {
  const [open, setOpen] = useState<string | null>(null);
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
  if (!sectors.length) return <div className="empty">No areas yet.</div>;
  const years = groupByYear<any>(sectors);
  return (
    <div className="table-wrap" style={{ maxHeight: 420 }}>
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
          {years.map((g) => (
            <Fragment key={g.year ?? 'none'}>
              <tr className="group-row">
                <th colSpan={5} scope="colgroup">{yearHeading(g.year)}</th>
              </tr>
              {g.rows.map((s: any) => (
                <Fragment key={s.id}>
                  <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                    <td className="expander"><Chevron open={open === s.id} /></td>
                    <td>{sectorLabel(s)} <span className="muted">· {s.subs.length} sub-sectors</span></td>
                    <td className="num">{s.measured ? ha(s.area) : '—'}</td>
                    <td className="num">{fmtNum(s.trees)}</td>
                    <td className="num">{perHa(s.trees, s.measured ? s.area : null)}</td>
                  </tr>
                  {open === s.id &&
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
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
