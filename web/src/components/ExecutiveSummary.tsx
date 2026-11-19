import { Link } from 'react-router-dom';
import { fmtNum } from './ui';

/**
 * The executive summary (#140): what a sponsor or executive needs at a glance, in plain words. How many trees are
 * tagged and living, where they are, which species, how tall, how fast tagging is going and whether trees are being
 * revisited. No staff names, devices, conflicts or data-quality checks.
 *
 * Health uses each tree's status at its last visit: terminal statuses are dead, "Alive" is healthy, any other
 * non-terminal status (e.g. "Transplant shock") is living but stressed. Trees with no status yet are left out of
 * the percentages and counted separately.
 */

export type TreesLink = (params: Record<string, string | undefined>) => string | null;

interface Area {
  id: string;
  planting_year_id?: string | null;
  short_code: string;
  name: string;
  boundary?: GeoJSON.Polygon | null;
  sub_sectors?: { id: string; short_code: string; name: string; boundary?: GeoJSON.Polygon | null }[];
}

type Health = { healthy: number; stressed: number; dead: number; unknown: number };
const emptyHealth = (): Health => ({ healthy: 0, stressed: 0, dead: 0, unknown: 0 });
const kindOf = (r: { code: string; is_terminal?: boolean }): keyof Health =>
  r.code === 'UNKNOWN' ? 'unknown' : r.is_terminal ? 'dead' : r.code === 'ALIVE' ? 'healthy' : 'stressed';
const living = (h: Health) => h.healthy + h.stressed;
const checked = (h: Health) => h.healthy + h.stressed + h.dead;
const pct0 = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const pct1 = (n: number, d: number) => (d <= 0 ? '—' : n === d ? '100%' : `${((n / d) * 100).toFixed(1)}%`);
const sectorName = (code?: string | null, name?: string | null) => {
  const n = (code ?? '').match(/(\d+)$/)?.[1];
  return n ? `Sector ${Number(n)}` : name || code || 'Sector';
};

export function ExecutiveSummary({ s, areas, years, trees }: { s: any; areas?: Area[]; years: { id: string; year_label: string }[]; trees: TreesLink }) {
  const total: number = s.totals?.planting_events ?? 0;
  const h = emptyHealth();
  (s.by_status ?? []).forEach((r: any) => (h[kindOf(r)] += r.count));
  const stressedNames: string[] = [...new Set<string>((s.by_status ?? []).filter((r: any) => kindOf(r) === "stressed" && r.count > 0).map((r: any) => r.name as string))];
  const stressedLabel = stressedNames.length === 1 ? stressedNames[0] : 'Stressed';

  if (total === 0) return <div className="card empty">No trees have been tagged yet.</div>;

  return (
    <div className="exec stack">
      <HealthCard h={h} total={total} stressedLabel={stressedLabel} s={s} trees={trees} />
      <div className="exec-two">
        <SectorCard s={s} areas={areas} trees={trees} />
        {areas && areas.some((a) => a.boundary || a.sub_sectors?.some((ss) => ss.boundary)) && <MapCard s={s} areas={areas} years={years} />}
      </div>
      <div className="exec-two">
        <SpeciesMix s={s} total={total} trees={trees} />
        <Heights s={s} />
      </div>
      <div className="exec-two exec-two--wide">
        <WeeklyTagging s={s} />
        <Monitoring s={s} />
      </div>
      <HowToRead stressedLabel={stressedLabel} overdueDays={s.overdue_days ?? 90} />
    </div>
  );
}

function Bar({ h, height = 10 }: { h: Health; height?: number }) {
  const t = checked(h);
  if (!t) return <div className="exec-bar" style={{ height }} />;
  return (
    <div className="exec-bar" style={{ height }} role="img" aria-label={`${pct1(living(h), t)} living`}>
      <span className="good" style={{ width: `${(h.healthy / t) * 100}%` }} />
      <span className="warn" style={{ width: `${(h.stressed / t) * 100}%` }} />
      <span className="bad" style={{ width: `${(h.dead / t) * 100}%` }} />
    </div>
  );
}

function HealthCard({ h, total, stressedLabel, s, trees }: { h: Health; total: number; stressedLabel: string; s: any; trees: TreesLink }) {
  const t = checked(h);
  const byYear: any[] = (s.by_planting_year ?? []).filter((r: any) => r.original_trees + r.replacement_trees > 0);
  // Where the dead trees are: the two sectors with the most.
  const deadBy = new Map<string, { label: string; count: number; year?: string }>();
  (s.status_by_sector ?? []).filter((r: any) => r.is_terminal).forEach((r: any) => {
    const x = deadBy.get(r.group_code) ?? { label: sectorName(r.sector_code, r.group_name), count: 0, year: r.year_label };
    x.count += r.count;
    deadBy.set(r.group_code, x);
  });
  const deadTop = [...deadBy.values()].sort((a, b) => b.count - a.count);
  const deadYears = new Set(deadTop.map((d) => d.year));
  const deadText = deadTop.slice(0, 2).map((d) => `${fmtNum(d.count)} in ${d.label}${deadYears.size > 1 && d.year ? ` (${d.year})` : ''}`).join(' · ');
  return (
    <section className="card exec-health" aria-labelledby="exec-health-title">
      <p className="exec-kicker" id="exec-health-title">Tree health at last visit</p>
      <p className="exec-hero">
        <span className="exec-hero-num">{pct1(living(h), t)}</span> <span>of tagged trees are living</span>
      </p>
      <p className="muted exec-hero-sub">
        {fmtNum(living(h))} of {fmtNum(t)} trees were alive when last checked
        {h.stressed > 0 && `, including ${fmtNum(h.stressed)} recovering from ${stressedLabel.toLowerCase()}`}.
        {h.unknown > 0 && ` ${fmtNum(h.unknown)} more have not been checked yet.`}
      </p>
      <Bar h={h} height={12} />
      <div className="exec-tiles">
        <div className="exec-tile">
          <span className="exec-tile-label"><i className="dot ink" />Trees tagged</span>
          <span className="exec-tile-num">{trees({}) ? <Link to={trees({})!}>{fmtNum(total)}</Link> : fmtNum(total)}</span>
          {byYear.length > 1 && <span className="exec-tile-foot">{byYear.map((r) => `${fmtNum(r.original_trees + r.replacement_trees)} planted ${r.name}`).join(' · ')}</span>}
        </div>
        <div className="exec-tile good">
          <span className="exec-tile-label"><i className="dot good" />Alive</span>
          <span className="exec-tile-num">{fmtNum(h.healthy)} <small>{pct1(h.healthy, t)}</small></span>
          <span className="exec-tile-foot">Healthy at last visit</span>
        </div>
        {h.stressed > 0 && (
          <div className="exec-tile warn">
            <span className="exec-tile-label"><i className="dot warn" />{stressedLabel}</span>
            <span className="exec-tile-num">{fmtNum(h.stressed)} <small>{pct1(h.stressed, t)}</small></span>
            <span className="exec-tile-foot">Alive but stressed · checked again next visit</span>
          </div>
        )}
        <div className="exec-tile bad">
          <span className="exec-tile-label"><i className="dot bad" />Dead</span>
          <span className="exec-tile-num">{fmtNum(h.dead)} <small>{pct1(h.dead, t)}</small></span>
          <span className="exec-tile-foot">{h.dead ? deadText : 'None so far'}</span>
        </div>
      </div>
    </section>
  );
}

function SectorCard({ s, areas, trees }: { s: any; areas?: Area[]; trees: TreesLink }) {
  const rows = new Map<string, { id: string; label: string; year: string | null; h: Health; trees: number }>();
  (s.status_by_sector ?? []).forEach((r: any) => {
    const x = rows.get(r.group_code) ?? { id: r.group_code, label: sectorName(r.sector_code, r.group_name), year: r.year_label ?? null, h: emptyHealth(), trees: 0 };
    x.h[kindOf(r)] += r.count;
    x.trees += r.count;
    rows.set(r.group_code, x);
  });
  const list = [...rows.values()];
  const years = [...new Set(list.map((r) => r.year))].sort((a, b) => (a ?? '9999').localeCompare(b ?? '9999'));
  const all = emptyHealth();
  list.forEach((r) => (Object.keys(all) as (keyof Health)[]).forEach((k) => (all[k] += r.h[k])));
  const planned = areas?.length;
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Trees by sector</h2>
      {planned ? <p className="muted exec-sub">{fmtNum(list.length)} of the {fmtNum(planned)} planned sectors hold tagged trees so far.</p> : null}
      <table className="exec-table">
        <thead>
          <tr><th>Sector</th><th className="num">Trees</th><th className="exec-col-bar">Health</th><th className="num">Living</th></tr>
        </thead>
        {years.map((y) => (
          <tbody key={y ?? 'none'}>
            <tr className="exec-group"><th colSpan={4} scope="colgroup">{y ? `Planted ${y}` : 'No planting year'}</th></tr>
            {list.filter((r) => r.year === y).sort((a, b) => b.trees - a.trees).map((r) => {
              const to = trees({ sector_id: r.id });
              return (
                <tr key={r.id}>
                  <td>{to ? <Link to={to}>{r.label}</Link> : r.label}</td>
                  <td className="num">{fmtNum(r.trees)}</td>
                  <td className="exec-col-bar"><Bar h={r.h} /></td>
                  <td className="num">{pct1(living(r.h), checked(r.h))}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
        <tfoot>
          <tr><th>Total</th><th className="num">{fmtNum(all.healthy + all.stressed + all.dead + all.unknown)}</th><th className="exec-col-bar" /><th className="num">{pct1(living(all), checked(all))}</th></tr>
        </tfoot>
      </table>
      <p className="muted exec-note">Living = alive, including trees recovering from planting stress. Open a sector to see its trees.</p>
    </section>
  );
}

/** A plain outline map: every sector and sub-sector, the ones holding trees filled in. */
function MapCard({ s, areas: allAreas, years }: { s: any; areas: Area[]; years: { id: string; year_label: string }[] }) {
  const treesBySub = new Map<string, number>();
  (s.area_coverage ?? []).forEach((r: any) => treesBySub.set(r.id, r.registered_trees));
  // Frame the map on the sectors that hold trees and their neighbours, so a stray or test area elsewhere
  // doesn't shrink the planted areas to a dot.
  const ringsOf = (a: Area) => [a.boundary?.coordinates[0], ...(a.sub_sectors ?? []).map((ss) => ss.boundary?.coordinates[0])].filter(Boolean) as number[][][];
  const planted = allAreas.filter((a) => a.sub_sectors?.some((ss) => (treesBySub.get(ss.id) ?? 0) > 0) && ringsOf(a).length);
  const focus = (planted.length ? planted : allAreas).flatMap((a) => ringsOf(a).flat());
  const fx = focus.map((p) => p[0]);
  const fy = focus.map((p) => p[1]);
  const mx = Math.max((Math.max(...fx) - Math.min(...fx)) * 0.5, 0.003);
  const my = Math.max((Math.max(...fy) - Math.min(...fy)) * 0.5, 0.003);
  const inBox = (p: number[]) => p[0] >= Math.min(...fx) - mx && p[0] <= Math.max(...fx) + mx && p[1] >= Math.min(...fy) - my && p[1] <= Math.max(...fy) + my;
  const areas = focus.length ? allAreas.filter((a) => ringsOf(a).flat().some(inBox)) : allAreas;
  const subs = areas.flatMap((a) => (a.sub_sectors ?? []).map((ss) => ({ ...ss, sector: a })));
  const withTrees = subs.filter((ss) => (treesBySub.get(ss.id) ?? 0) > 0);
  const rings: number[][][] = [];
  areas.forEach((a) => {
    if (a.boundary) rings.push(a.boundary.coordinates[0]);
    a.sub_sectors?.forEach((ss) => ss.boundary && rings.push(ss.boundary.coordinates[0]));
  });
  if (!rings.length) return null;
  const pts = rings.flat();
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const W = 520;
  const spanX = Math.max((maxLon - minLon) * k, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const pad = 12;
  const scale = (W - pad * 2) / spanX;
  const H = Math.min(Math.max(spanY * scale + pad * 2, 200), 520);
  const sc = Math.min(scale, (H - pad * 2) / spanY);
  const ox = (W - spanX * sc) / 2;
  const oy = (H - spanY * sc) / 2;
  const xy = (p: number[]) => [ox + (p[0] - minLon) * k * sc, oy + (maxLat - p[1]) * sc];
  const path = (ring: number[][]) => ring.map((p, i) => `${i ? 'L' : 'M'}${xy(p).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z';
  const yearOf = (id?: string | null) => years.find((y) => y.id === id)?.year_label ?? null;
  const yearList = [...new Set(areas.map((a) => yearOf(a.planting_year_id)))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const dash = (y: string | null) => (yearList.indexOf(y) % 2 === 1 ? '4 3' : undefined);
  const max = Math.max(...withTrees.map((ss) => treesBySub.get(ss.id) ?? 0), 1);
  // One label per sector with trees, at the middle of its planted sub-sectors.
  const labels = [...new Map(withTrees.map((ss) => [ss.sector.id, ss.sector])).values()].map((sec) => {
    const own = withTrees.filter((ss) => ss.sector.id === sec.id && ss.boundary).flatMap((ss) => ss.boundary!.coordinates[0].map(xy));
    const src = own.length ? own : (sec.boundary?.coordinates[0] ?? []).map(xy);
    if (!src.length) return null;
    const cx = src.reduce((n, p) => n + p[0], 0) / src.length;
    const cy = Math.min(...src.map((p) => p[1]));
    const y = yearOf(sec.planting_year_id);
    return { id: sec.id, x: cx, y: cy - 4, text: `${sec.short_code}${y ? ` · ${y}` : ''}` };
  }).filter(Boolean) as { id: string; x: number; y: number; text: string }[];
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Where the trees are</h2>
      <p className="muted exec-sub">{fmtNum(withTrees.length)} of {fmtNum(subs.length)} sub-sectors have tagged trees.</p>
      <div className="exec-map">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of the planting areas; ${withTrees.length} sub-sectors have trees`}>
          {areas.map((a) => a.sub_sectors?.map((ss) => ss.boundary && (
            <path key={ss.id} d={path(ss.boundary.coordinates[0])} className="exec-map-sub"
              style={(treesBySub.get(ss.id) ?? 0) > 0 ? { fill: 'var(--brand)', fillOpacity: 0.35 + 0.65 * ((treesBySub.get(ss.id) ?? 0) / max) } : undefined}>
              <title>{`${a.short_code}/${ss.short_code}: ${fmtNum(treesBySub.get(ss.id) ?? 0)} trees`}</title>
            </path>
          )))}
          {areas.map((a) => a.boundary && <path key={a.id} d={path(a.boundary.coordinates[0])} className="exec-map-sector" strokeDasharray={dash(yearOf(a.planting_year_id))} />)}
          {labels.map((l) => (
            <text key={l.id} x={l.x} y={l.y} className="exec-map-label" textAnchor="middle">{l.text}</text>
          ))}
        </svg>
      </div>
      <ul className="exec-legend">
        <li><i className="swatch fill" />Sub-sector with trees</li>
        {yearList.map((y) => (
          <li key={y ?? 'none'}><i className={`swatch ${dash(y) ? 'dashed' : 'line'}`} />{y ? `${y} sector` : 'Sector'}</li>
        ))}
      </ul>
    </section>
  );
}

function SpeciesMix({ s, total, trees }: { s: any; total: number; trees: TreesLink }) {
  const healthBy = new Map<string, Health>();
  (s.status_by_species ?? []).forEach((r: any) => {
    const h = healthBy.get(r.group_code) ?? emptyHealth();
    h[kindOf(r)] += r.count;
    healthBy.set(r.group_code, h);
  });
  const rows: any[] = [...(s.by_species ?? [])].sort((a, b) => b.count - a.count);
  const top = rows[0];
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Species mix</h2>
      {top && <p className="muted exec-sub">{top.common_name ?? top.name} makes up {pct0(top.count, total)} of tagged trees.</p>}
      <ul className="exec-species">
        {rows.map((r) => {
          const h = healthBy.get(r.name) ?? emptyHealth();
          const to = r.id ? trees({ species_id: r.id }) : null;
          const label = r.common_name ?? r.name;
          return (
            <li key={r.id ?? r.name}>
              <div className="exec-species-line">
                <span>
                  <strong>{to ? <Link to={to}>{label}</Link> : label}</strong>
                  {r.common_name && <em className="muted"> {r.name}</em>}
                </span>
                <span><strong>{fmtNum(r.count)}</strong> <span className="muted">· {pct1(living(h), checked(h))} living</span></span>
              </div>
              <div className="exec-meter" role="img" aria-label={`${pct1(r.count, total)} of tagged trees`}>
                <span style={{ width: `${Math.max((r.count / total) * 100, 1)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

function Heights({ s }: { s: any }) {
  const growth: any[] = s.growth ?? [];
  const months = [...new Set(growth.map((g) => g.month as string))].sort().slice(-2);
  const species: any[] = [...(s.by_species ?? [])].sort((a, b) => b.count - a.count);
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Average height of measured trees</h2>
      <p className="muted exec-sub">Each month measures a different sample of trees, so read this as a snapshot, not the growth of the same trees.</p>
      {months.length === 0 ? (
        <p className="muted">No trees have been measured yet.</p>
      ) : (
        <table className="exec-table exec-heights">
          <thead>
            <tr><th>Species</th>{months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}</tr>
          </thead>
          <tbody>
            {species.map((sp) => (
              <tr key={sp.id ?? sp.name}>
                <td>{sp.common_name ?? sp.name}</td>
                {months.map((m, i) => {
                  const g = growth.find((x) => x.month === m && x.species_id === sp.id);
                  return (
                    <td key={m} className="num">
                      {g ? (
                        <>
                          <strong>{g.avg_height_cm.toLocaleString(undefined, { maximumFractionDigits: 1 })} cm</strong>
                          <span className="muted exec-cell-foot">{fmtNum(g.measured_trees)} {g.measured_trees === 1 ? 'tree' : 'trees'}</span>
                        </>
                      ) : (
                        <span className="muted">{i === months.length - 1 ? 'Not yet measured' : '—'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function WeeklyTagging({ s }: { s: any }) {
  const all: { week: string; trees: number }[] = s.planted_by_week ?? [];
  const first = all.findIndex((w) => w.trees > 0);
  const weeks = first < 0 ? [] : all.slice(Math.max(first, all.length - 12));
  const max = Math.max(...weeks.map((w) => w.trees), 1);
  const thisWeek = (() => {
    const d = new Date(Date.now() + 3600e3); // West Africa Time
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  })();
  const label = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Trees tagged each week</h2>
      <p className="muted exec-sub">
        Weeks run Monday to Sunday.{first >= 0 && ` Tagging began the week of ${label(all[first].week)}.`}
        {first >= 0 && first < all.length - 12 && ' Showing the last 12 weeks.'}
      </p>
      {weeks.length === 0 ? (
        <p className="muted">No trees tagged yet.</p>
      ) : (
        <div className="exec-weeks" role="img" aria-label={weeks.map((w) => `${label(w.week)}: ${w.trees}`).join(', ')}>
          {weeks.map((w) => (
            <div key={w.week} className={`exec-week${w.week === thisWeek ? ' current' : ''}`}>
              <span className="exec-week-num">{fmtNum(w.trees)}</span>
              <span className="exec-week-bar" style={{ height: Math.max(Math.round((w.trees / max) * 160), w.trees ? 4 : 2) }} />
              <span className="exec-week-label">{label(w.week)}{w.week === thisWeek && ' (so far)'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Monitoring({ s }: { s: any }) {
  const m = s.maintenance ?? {};
  const v = s.visits ?? {};
  return (
    <section className="card exec-card">
      <h2 className="exec-title">Monitoring visits</h2>
      <dl className="exec-list">
        <div><dt>Follow-up visits since tagging</dt><dd>{fmtNum(v.follow_up_visits ?? 0)}</dd></div>
        <div><dt>Trees overdue for a visit</dt><dd className={m.overdue_trees ? 'bad' : undefined}>{fmtNum(m.overdue_trees ?? 0)}</dd></div>
        <div><dt>Visits due in the next {m.due_soon_days ?? 14} days</dt><dd>{fmtNum(m.due_soon_trees ?? 0)}</dd></div>
      </dl>
      <p className="muted exec-note">Every tree is visited again on a regular cycle. Until its first follow-up visit, a tree's health comes from its tagging visit.</p>
    </section>
  );
}

function HowToRead({ stressedLabel, overdueDays }: { stressedLabel: string; overdueDays: number }) {
  return (
    <details className="card exec-how">
      <summary>How to read these numbers</summary>
      <ul>
        <li><strong>Trees tagged</strong>: trees planted and given an ID tag, recorded by field officers on the day.</li>
        <li><strong>Living</strong>: trees alive at their most recent visit, including trees that are {stressedLabel.toLowerCase() === 'stressed' ? 'stressed' : `in ${stressedLabel.toLowerCase()}`} but expected to recover.</li>
        <li><strong>Dead</strong>: trees found dead at their most recent visit. Dead trees may be replaced.</li>
        <li><strong>Health</strong> always comes from each tree's latest visit. It changes as trees are revisited.</li>
        <li><strong>Overdue</strong>: trees not visited for longer than planned (about every {overdueDays} days).</li>
        <li>Dates and weeks use West Africa Time (WAT). Filters at the top apply to every number on this page.</li>
      </ul>
    </details>
  );
}
