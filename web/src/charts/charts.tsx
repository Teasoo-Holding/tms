import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useMarkTooltip } from './Tooltip';

/** Categorical slots in fixed order (validated palette); colour follows the entity, never its rank. */
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export function ChartCard({ title, subtitle, table, children, legend, empty }: {
  title: string;
  subtitle?: string;
  table: ReactNode;
  children: ReactNode;
  legend?: ReactNode;
  /** When set, the card shows this message instead of the chart and hides the table toggle. */
  empty?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card chart">
      <div className="chart-head">
        <h2>{title}</h2>
        <span className="spacer" />
        {!empty && (
          <button className="link" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {subtitle && <p className="muted chart-sub">{subtitle}</p>}
      {empty ? <ChartEmpty>{empty}</ChartEmpty> : asTable ? <div className="table-wrap">{table}</div> : (
        <>
          {legend}
          {children}
        </>
      )}
    </section>
  );
}

export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="chart-empty" role="note">
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
        <path d="M4 19h16M7 16V11M12 16V7M17 16v-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function StatTile({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </div>
  );
}

/** Tracks the container's pixel width so text and marks render at true size rather than scaling with a viewBox. */
function useWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Rect with 4px rounding only on the data end (right), anchored square to the baseline. */
function hbarPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return '';
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
function vbarPath(x: number, y: number, w: number, h: number, roundTop: boolean) {
  if (h <= 0) return '';
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Horizontal bars for one measure across categories (single series → one colour, no legend). */
export function HBarChart({ data, unit = 'trees', color = SERIES[0] }: { data: { label: string; value: number }[]; unit?: string; color?: string }) {
  const tip = useMarkTooltip();
  const { ref, width } = useWidth();
  if (data.length === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const labelW = Math.min(160, width * 0.35);
  const rowH = 28;
  const barH = 18;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = width - labelW - 56;
  return (
    <div ref={ref}>
    <svg width={width} height={data.length * rowH} role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const y = i * rowH + (rowH - barH) / 2;
        const w = (d.value / max) * plotW;
        return (
          <g key={d.label}>
            <text className="label" x={labelW - 8} y={y + barH / 2} dy="0.35em" textAnchor="end">
              {d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label}
            </text>
            <rect x={labelW} y={i * rowH} width={plotW + 56} height={rowH} fill="transparent" {...tip({ title: d.label, rows: [{ label: unit, value: d.value.toLocaleString(), color }] })} />
            <path className="mark" d={hbarPath(labelW, y, Math.max(w, d.value > 0 ? 2 : 0), barH)} fill={color} pointerEvents="none" />
            <text className="value-label" x={labelW + w + 6} y={y + barH / 2} dy="0.35em">
              {d.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

/** Stacked columns over ordered categories (e.g. months, planting years). 2px surface gaps between segments. */
export function StackedColumns({ categories, series, values, height = 220 }: {
  categories: string[];
  series: StackSeries[];
  values: (category: string, seriesKey: string) => number;
  height?: number;
}) {
  const tip = useMarkTooltip();
  const { ref, width } = useWidth();
  if (categories.length === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const left = 40;
  const bottom = 24;
  const plotH = height - bottom - 8;
  const totals = categories.map((c) => series.reduce((s, se) => s + values(c, se.key), 0));
  const max = niceMax(Math.max(...totals, 1));
  const band = (width - left) / categories.length;
  const barW = Math.min(48, band * 0.6);
  const ticks = [0, max / 2, max];
  const scale = (v: number) => (v / max) * plotH;
  // Thin out category labels when columns are narrow.
  const labelEvery = Math.ceil(56 / band);
  return (
    <div ref={ref}>
    <svg width={width} height={height} role="img" aria-label="Stacked column chart">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid-line" x1={left} x2={width} y1={8 + plotH - scale(t)} y2={8 + plotH - scale(t)} />
          <text className="axis" x={left - 6} y={8 + plotH - scale(t)} dy="0.35em" textAnchor="end">
            {formatTick(t)}
          </text>
        </g>
      ))}
      {categories.map((c, ci) => {
        const x = left + ci * band + (band - barW) / 2;
        let y = 8 + plotH;
        const present = series.filter((s) => values(c, s.key) > 0);
        const rows = series.map((s) => ({ label: s.label, value: values(c, s.key).toLocaleString(), color: s.color }));
        return (
          <g key={c}>
            <rect x={left + ci * band} y={8} width={band} height={plotH} fill="transparent" {...tip({ title: `${c} · total ${totals[ci].toLocaleString()}`, rows })} />
            {present.map((s, si) => {
              const h = scale(values(c, s.key));
              y -= h;
              const gap = si < present.length - 1 ? 2 : 0;
              return <path key={s.key} className="mark" d={vbarPath(x, y + gap, barW, Math.max(h - gap, 1), si === present.length - 1)} fill={s.color} pointerEvents="none" />;
            })}
            {ci % labelEvery === 0 && (
              <text className="axis" x={x + barW / 2} y={height - 6} textAnchor="middle">
                {c}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
function formatTick(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v));
}

// ------------------------------------------------------------------ line chart

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** x is numeric (e.g. a timestamp); points are sorted by x before drawing. */
  points: { x: number; y: number }[];
}

/** Multi-series line chart over a numeric (usually time) x axis. 2px lines, point markers carry the tooltip. */
export function LineChart({ series, height = 220, unit = '', xFormat = (x) => new Date(x).toLocaleDateString(), ariaLabel = 'Line chart' }: {
  series: LineSeries[];
  height?: number;
  unit?: string;
  xFormat?: (x: number) => string;
  ariaLabel?: string;
}) {
  const tip = useMarkTooltip();
  const { ref, width } = useWidth();
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const left = 44;
  const right = 12;
  const top = 8;
  const bottom = 24;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  let minX = Math.min(...all.map((p) => p.x));
  let maxX = Math.max(...all.map((p) => p.x));
  if (minX === maxX) (minX -= 1), (maxX += 1);
  const max = niceMax(Math.max(...all.map((p) => p.y), 1));
  const sx = (x: number) => left + ((x - minX) / (maxX - minX)) * plotW;
  const sy = (y: number) => top + plotH - (y / max) * plotH;
  const ticks = [0, max / 2, max];
  const xTickCount = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => minX + ((maxX - minX) * i) / (xTickCount - 1));
  const fmt = (y: number) => `${Number.isInteger(y) ? y.toLocaleString() : y.toFixed(1)}${unit ? ' ' + unit : ''}`;
  return (
    <div ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={left} x2={width - right} y1={sy(t)} y2={sy(t)} />
            <text className="axis" x={left - 6} y={sy(t)} dy="0.35em" textAnchor="end">{formatTick(t)}</text>
          </g>
        ))}
        {xTicks.map((x, i) => (
          <text key={i} className="axis" x={sx(x)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {xFormat(x)}
          </text>
        ))}
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle
                  key={i}
                  className="mark"
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={pts.length > 40 ? 2.5 : 4}
                  fill="var(--surface-1)"
                  stroke={s.color}
                  strokeWidth={2}
                  {...tip({ title: xFormat(p.x), rows: [{ label: s.label, value: fmt(p.y), color: s.color }] })}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ donut

/** Part-to-whole ring with the total in the centre and a value legend. 2px surface gaps between segments. */
export function Donut({ data, unit = 'trees', centerLabel = 'total', size = 180 }: {
  data: { label: string; value: number; color: string }[];
  unit?: string;
  centerLabel?: string;
  size?: number;
}) {
  const tip = useMarkTooltip();
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const r = size / 2;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${(r + rad * Math.cos(a)).toFixed(2)},${(r + rad * Math.sin(a)).toFixed(2)}`;
    return `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
  };
  const pct = (v: number) => `${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%`;
  return (
    <div className="donut">
      <svg width={size} height={size} role="img" aria-label={`Donut chart, ${total.toLocaleString()} ${unit} in total`}>
        {items.length === 1 ? (
          <circle className="mark" cx={r} cy={r} r={(r + inner) / 2} fill="none" stroke={items[0].color} strokeWidth={r - inner}
            {...tip({ title: items[0].label, rows: [{ label: unit, value: `${items[0].value.toLocaleString()} (100%)`, color: items[0].color }] })} />
        ) : (
          items.map((d) => {
            const a0 = angle;
            const a1 = angle + (d.value / total) * Math.PI * 2;
            angle = a1;
            return (
              <path key={d.label} className="mark" d={arc(a0, a1)} fill={d.color} stroke="var(--surface-1)" strokeWidth={2}
                {...tip({ title: d.label, rows: [{ label: unit, value: `${d.value.toLocaleString()} (${pct(d.value)})`, color: d.color }] })} />
            );
          })
        )}
        <text x={r} y={r - 4} textAnchor="middle" className="donut-total">{total.toLocaleString()}</text>
        <text x={r} y={r + 16} textAnchor="middle" className="axis">{centerLabel}</text>
      </svg>
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.label}>
            <i style={{ background: d.color }} aria-hidden />
            <span className="name">{d.label}</span>
            <span className="num">{d.value.toLocaleString()}</span>
            <span className="muted num">{pct(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ horizontal stacked bars

/** One horizontal bar per category, split by series. With `normalize`, each bar shows its mix as 100%. */
export function StackedBars({ categories, series, values, normalize = false, unit = 'trees' }: {
  categories: string[];
  series: StackSeries[];
  values: (category: string, seriesKey: string) => number;
  normalize?: boolean;
  unit?: string;
}) {
  const tip = useMarkTooltip();
  const { ref, width } = useWidth();
  if (categories.length === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const labelW = Math.min(160, width * 0.35);
  const rowH = 28;
  const barH = 18;
  const totals = categories.map((c) => series.reduce((s, se) => s + values(c, se.key), 0));
  const max = normalize ? 1 : Math.max(...totals, 1);
  const plotW = width - labelW - (normalize ? 8 : 56);
  return (
    <div ref={ref}>
      <svg width={width} height={categories.length * rowH} role="img" aria-label={`Stacked bar chart${normalize ? ' (share of each row)' : ''}`}>
        {categories.map((c, ci) => {
          const total = totals[ci];
          const y = ci * rowH + (rowH - barH) / 2;
          const present = series.filter((s) => values(c, s.key) > 0);
          let x = labelW;
          const rows = present.map((s) => {
            const v = values(c, s.key);
            return { label: s.label, value: `${v.toLocaleString()}${total ? ` (${Math.round((v / total) * 100)}%)` : ''}`, color: s.color };
          });
          return (
            <g key={c}>
              <text className="label" x={labelW - 8} y={y + barH / 2} dy="0.35em" textAnchor="end">
                {c.length > 22 ? c.slice(0, 21) + '…' : c}
              </text>
              <rect x={labelW} y={ci * rowH} width={width - labelW} height={rowH} fill="transparent" {...tip({ title: `${c} · ${total.toLocaleString()} ${unit}`, rows })} />
              {present.map((s, si) => {
                const v = values(c, s.key);
                const w = ((normalize ? v / (total || 1) : v) / max) * plotW;
                const gap = si < present.length - 1 ? 2 : 0;
                const seg = (
                  <path key={s.key} className="mark" pointerEvents="none" fill={s.color}
                    d={si === present.length - 1 ? hbarPath(x, y, Math.max(w, 1), barH) : `M${x},${y} h${Math.max(w - gap, 1)} v${barH} h${-Math.max(w - gap, 1)} Z`} />
                );
                x += w;
                return seg;
              })}
              {!normalize && (
                <text className="value-label" x={x + 6} y={y + barH / 2} dy="0.35em">{total.toLocaleString()}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ grouped columns

/** Side-by-side columns per category, for comparing a few measures (e.g. registrations vs observations). */
export function GroupedColumns({ categories, series, values, height = 220, formatCategory = (c) => c }: {
  categories: string[];
  series: StackSeries[];
  values: (category: string, seriesKey: string) => number;
  height?: number;
  formatCategory?: (c: string) => string;
}) {
  const tip = useMarkTooltip();
  const { ref, width } = useWidth();
  if (categories.length === 0) return <ChartEmpty>No data yet.</ChartEmpty>;
  const left = 40;
  const bottom = 24;
  const plotH = height - bottom - 8;
  const max = niceMax(Math.max(...categories.flatMap((c) => series.map((s) => values(c, s.key))), 1));
  const band = (width - left) / categories.length;
  const groupW = Math.min(56, band * 0.75);
  const barW = Math.max(2, (groupW - (series.length - 1) * 2) / series.length);
  const scale = (v: number) => (v / max) * plotH;
  const labelEvery = Math.ceil(64 / band);
  return (
    <div ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Grouped column chart">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="grid-line" x1={left} x2={width} y1={8 + plotH - scale(t)} y2={8 + plotH - scale(t)} />
            <text className="axis" x={left - 6} y={8 + plotH - scale(t)} dy="0.35em" textAnchor="end">{formatTick(t)}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const x0 = left + ci * band + (band - groupW) / 2;
          const rows = series.map((s) => ({ label: s.label, value: values(c, s.key).toLocaleString(), color: s.color }));
          return (
            <g key={c}>
              <rect x={left + ci * band} y={8} width={band} height={plotH} fill="transparent" {...tip({ title: formatCategory(c), rows })} />
              {series.map((s, si) => {
                const h = scale(values(c, s.key));
                return <path key={s.key} className="mark" pointerEvents="none" fill={s.color} d={vbarPath(x0 + si * (barW + 2), 8 + plotH - h, barW, h, true)} />;
              })}
              {ci % labelEvery === 0 && (
                <text className="axis" x={x0 + groupW / 2} y={height - 6} textAnchor="middle">{formatCategory(c)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
