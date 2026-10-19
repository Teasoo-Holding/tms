import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useMarkTooltip } from './Tooltip';

/** Categorical slots in fixed order (validated palette); colour follows the entity, never its rank. */
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export function ChartCard({ title, subtitle, table, children, legend }: { title: string; subtitle?: string; table: ReactNode; children: ReactNode; legend?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card chart">
      <div className="chart-head">
        <h2>{title}</h2>
        <span className="spacer" />
        <button className="link" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {subtitle && <p className="muted" style={{ margin: '0 0 8px' }}>{subtitle}</p>}
      {asTable ? <div className="table-wrap">{table}</div> : (
        <>
          {legend}
          {children}
        </>
      )}
    </section>
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
  if (data.length === 0) return <div className="empty">No data yet.</div>;
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
  if (categories.length === 0) return <div className="empty">No data yet.</div>;
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
