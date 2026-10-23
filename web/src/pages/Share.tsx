import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError, apiUrl, publicGet, qs } from '../api/client';
import { ChartCard, Donut, HBarChart, SERIES, StatTile } from '../charts/charts';
import { AreaShareView } from '../components/AreaShare';
import { DensityReport, DensityView } from '../components/DensityMap';
import { ShareArea } from '../components/ShareMap';
import { fmtDate, fmtDateTime, fmtNum, relativeTime, SimpleTable } from '../components/ui';

const FILTER_KEYS = ['planting_year_id', 'vendor_id', 'sector_id', 'from', 'to'] as const;
/** Changing a filter clears the ones that depend on it. */
const DEPENDENTS: Record<string, string[]> = { planting_year_id: ['vendor_id', 'sector_id'] };

export function BrandMark() {
  return (
    <span className="teasoo-mark">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M16 3 6 17h6l-5 7h7v5h4v-5h7l-5-7h6z" fill="currentColor" />
      </svg>
      Teasoo Consulting
    </span>
  );
}

/** Read-only client view of one project, opened from a secret share link. No sign-in. */
export function SharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    (DEPENDENTS[k] ?? []).forEach((d) => next.delete(d));
    setParams(next, { replace: true });
  };
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)]));
  const activeCount = FILTER_KEYS.filter((k) => get(k)).length;
  const filter = qs(filters);
  const base = `/share/${encodeURIComponent(token)}`;
  const view = useQuery({ queryKey: ['share', token, filter], queryFn: () => publicGet(`${base}${filter}`), retry: (n, e) => (e as ApiError).status !== 404 && n < 1 });
  const d = view.data;
  const yearId = get('planting_year_id');
  const densityFilter = qs({ planting_year_id: yearId });
  const density = useQuery({
    queryKey: ['share-density', token, densityFilter],
    queryFn: () => publicGet<DensityReport>(`${base}/density${densityFilter}`),
    enabled: !!d,
    retry: (n, e) => (e as ApiError).status !== 404 && n < 1,
  });

  const areas: any[] = d?.areas ?? [];
  const yearAreas = areas.filter((a) => !yearId || a.planting_year_id === yearId || a.planting_year_id == null);
  const sectorIds = new Set(yearAreas.filter((a) => !get('sector_id') || a.id === get('sector_id')).map((a) => a.id as string));
  const boundaries = useMemo(() => {
    const m = new Map<string, GeoJSON.Polygon>();
    areas.forEach((a) => a.sub_sectors?.forEach((ss: any) => ss.boundary && m.set(ss.id, ss.boundary)));
    return m;
  }, [areas]);

  if (view.error) {
    const e = view.error as ApiError;
    return (
      <div className="share-shell">
        <div className="share-error card">
          <BrandMark />
          <h1>{e.code === 'LINK_INVALID' ? 'This link is no longer active' : 'Something went wrong'}</h1>
          <p className="subtle" style={{ margin: 0 }}>{e.code === 'LINK_INVALID' ? 'Ask Teasoo Consulting for a new link.' : e.message}</p>
          {e.code !== 'LINK_INVALID' && <button onClick={() => view.refetch()}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="share-shell">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const s = d.summary;
  const p = d.project;
  const statusRows: any[] = s.by_status ?? [];
  const alive = statusRows.filter((r) => !r.is_terminal && r.code !== 'UNKNOWN').reduce((n, r) => n + r.count, 0);
  const unknown = statusRows.filter((r) => r.code === 'UNKNOWN').reduce((n, r) => n + r.count, 0);
  let liveIndex = 0;
  const statusColor = (r: any) =>
    r.code === 'UNKNOWN' ? 'var(--border-strong)' : r.is_terminal ? 'var(--status-critical)' : liveIndex++ === 0 ? 'var(--status-good)' : SERIES[liveIndex % SERIES.length];
  const donut = statusRows.map((r) => ({ label: r.name, value: r.count, color: statusColor(r) }));
  const coverage: ShareArea[] = (s.area_coverage ?? []).filter((r: any) => sectorIds.has(r.sector_id));
  const sectorShare = (s.sector_share ?? []).filter((r: any) => sectorIds.has(r.id));
  const vendors: any[] = (d.vendors ?? []).filter((v: any) => !yearId || v.planting_year_id === yearId);
  const vendorOptions = [...new Map(vendors.map((v) => [v.id, v.short_code ? `${v.name} (${v.short_code})` : v.name])).entries()];
  const download = (file: string) => apiUrl(`${base}/${file}${filter}`);
  const dates = [p.start_date && fmtDate(p.start_date), p.end_date && fmtDate(p.end_date)].filter(Boolean).join(' – ');

  return (
    <div className="share-shell">
      <header className="share-header">
        <BrandMark />
        <span className="spacer" />
        <span className="muted print-only">Printed {fmtDateTime(new Date().toISOString())}</span>
      </header>

      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-title">
          <h1>{p.name}</h1>
          {(p.location || dates) && <p className="page-sub">{[p.location, dates].filter(Boolean).join(' · ')}</p>}
        </div>
        <span className="spacer" />
        <div className="page-actions no-print">
          <a className="btn primary" href={download('report.xlsx')}>Download Excel</a>
          <a className="btn" href={download('trees.csv')}>Trees CSV</a>
          <a className="btn" href={download('visits.csv')}>Visits CSV</a>
          <button onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>

      <section className="card filter-panel no-print" aria-label="Filters">
        <div className="filters" style={{ marginBottom: 0 }}>
          <label className="field">
            Planting year
            <select value={yearId} onChange={(e) => set('planting_year_id', e.target.value)}>
              <option value="">All years</option>
              {(d.planting_years ?? []).map((y: any) => <option key={y.id} value={y.id}>{y.year_label}</option>)}
            </select>
          </label>
          <label className="field">
            Vendor
            <select value={get('vendor_id')} onChange={(e) => set('vendor_id', e.target.value)} disabled={vendorOptions.length === 0}>
              <option value="">All vendors</option>
              {vendorOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            Sector
            <select value={get('sector_id')} onChange={(e) => set('sector_id', e.target.value)} disabled={yearAreas.length === 0}>
              <option value="">All sectors</option>
              {yearAreas.map((a) => <option key={a.id} value={a.id}>{a.short_code} · {a.name}</option>)}
            </select>
          </label>
          <label className="field">
            From
            <input type="date" value={get('from')} max={get('to') || undefined} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="field">
            To
            <input type="date" value={get('to')} min={get('from') || undefined} onChange={(e) => set('to', e.target.value)} />
          </label>
          {activeCount > 0 && (
            <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear</button>
          )}
        </div>
      </section>

      <div className={`stack ${view.isFetching ? 'refetching' : ''}`}>
        <div className="grid stats">
          <StatTile label="Trees planted" value={fmtNum(s.totals.planting_events)} foot={s.totals.replacement_trees ? `incl. ${fmtNum(s.totals.replacement_trees)} replacements` : undefined} />
          <StatTile label="Alive" value={fmtNum(alive)} />
          <StatTile label="Dead or missing" value={fmtNum(s.totals.terminal_status_trees)} />
          <StatTile label="Not yet visited" value={fmtNum(unknown)} />
        </div>

        <div className="grid charts">
          <ChartCard title="Current status" empty={statusRows.length === 0 && 'No trees yet.'} table={<SimpleTable head={['Status', 'Trees']} rows={statusRows.map((r) => [r.name, fmtNum(r.count)])} />}>
            <Donut data={donut} />
          </ChartCard>
          <ChartCard title="Trees by species" empty={(s.by_species ?? []).length === 0 && 'No trees yet.'} table={<SimpleTable head={['Species', 'Trees']} rows={s.by_species.map((r: any) => [r.common_name ?? r.name, fmtNum(r.count)])} />}>
            <HBarChart data={s.by_species.map((r: any) => ({ label: r.common_name ?? r.name, value: r.count }))} />
          </ChartCard>
        </div>

        <AreaShareView rows={coverage} sectors={sectorShare} boundaries={boundaries} />

        {density.data && (
          <section className="stack" aria-label="Tree density">
            <h2 style={{ margin: '8px 0 0' }}>Tree density</h2>
            <DensityView report={density.data} />
          </section>
        )}

        <ChartCard title="Trees by sector" empty={(s.by_sector ?? []).length === 0 && 'No trees yet.'} table={<SimpleTable head={['Sector', 'Trees']} rows={s.by_sector.map((r: any) => [`${r.short_code} · ${r.name}`, fmtNum(r.count)])} />}>
          <HBarChart data={s.by_sector.map((r: any) => ({ label: `${r.short_code} · ${r.name}`, value: r.count }))} />
        </ChartCard>

        <p className="muted" style={{ margin: 0 }}>
          Updated {relativeTime(s.last_server_sync_at)}
          {s.last_server_sync_at ? ` (${fmtDateTime(s.last_server_sync_at)})` : ''}. Counts are registered trees; “alive” means the latest visit found the tree alive.
        </p>
      </div>
    </div>
  );
}
