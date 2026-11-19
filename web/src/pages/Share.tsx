import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, apiUrl, publicGet, qs } from '../api/client';
import { groupByYear, yearHeading, sectorLabel } from '../areaLabels';
import { ChartCard, Donut, HBarChart, Legend, LineChart, SERIES, StackedBars, StatTile } from '../charts/charts';
import { AreaShareView } from '../components/AreaShare';
import { TeasooLink, TeasooLogo } from '../components/Brand';
import { DensityReport, DensityView, hasOutlines } from '../components/DensityMap';
import { ShareArea } from '../components/ShareMap';
import { SpeciesCard } from '../components/SpeciesCard';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { PhotoSource, PhotoSourceProvider } from '../components/Photos';
import { ErrorNotice, fmtDate, fmtDateTime, fmtNum, relativeTime, SimpleTable, statusColor } from '../components/ui';
import { ShareAreas } from './ShareAreas';
import { ShareTree, ShareTrees } from './ShareTrees';
import { fmtShortDate } from '../time';
import { glossary, metricTerms } from '../glossary';
import { GlossaryList } from './Glossary';
import { DAY_NOTE } from '../time';
import { LegalLinks } from './Legal';

const FILTER_KEYS = ['planting_year_id', 'vendor_id', 'sector_id', 'from', 'to'] as const;
/** Changing a filter clears the ones that depend on it. */
const DEPENDENTS: Record<string, string[]> = { planting_year_id: ['vendor_id', 'sector_id'] };

/** The footer of every client page: who prepared it, linking to the company's website. */
function ShareFooter() {
  return (
    <footer className="share-footer">
      <span className="share-footer-brand">
        <TeasooLogo height={28} />
        <span>Prepared by <TeasooLink /></span>
      </span>
      <span>Tree Management System</span>
    </footer>
  );
}

/** What every section of a client link gets: the token, the API path and the project view (unfiltered). */
export interface ShareContext {
  token: string;
  /** API path of the link, e.g. /share/<token>. */
  base: string;
  /** Portal path of the link (the same, for navigation). */
  root: string;
  view?: any;
}

const isMissing = (e: unknown) => (e as ApiError).status === 404;

/**
 * Read-only mini-portal for one project, opened from a secret share link (no sign-in): Overview, Trees and Areas,
 * as a side navigation on wide screens and tabs on top on phones. Nothing here names who collected the data; the
 * share endpoints never return it.
 */
export function SharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const base = `/share/${encodeURIComponent(token)}`;
  const view = useQuery({ queryKey: ['share', token, ''], queryFn: () => publicGet(base), retry: (n, e) => !isMissing(e) && n < 1 });
  // Photos load through the link's own endpoint (only this project's photos).
  const photos = useMemo<PhotoSource>(
    () => ({ key: `share:${token}`, viewUrl: (id, size) => publicGet(`${base}/media/${id}${size === 'thumb' ? '?size=thumb' : ''}`) }),
    [token, base],
  );

  if (view.error) {
    const e = view.error as ApiError;
    return (
      <div className="share-shell">
        <div className="share-error card">
          <TeasooLogo height={36} />
          <h1>{e.code === 'LINK_INVALID' ? 'This link is no longer active' : 'Something went wrong'}</h1>
          <p className="subtle" style={{ margin: 0 }}>{e.code === 'LINK_INVALID' ? 'Ask Teasoo Consulting for a new link.' : e.message}</p>
          {e.code !== 'LINK_INVALID' && <button onClick={() => view.refetch()}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!view.data) {
    return (
      <div className="share-shell">
        <div className="empty">Loading…</div>
      </div>
    );
  }
  const p = view.data.project;
  const dates = [p.start_date && fmtDate(p.start_date), p.end_date && fmtDate(p.end_date)].filter(Boolean).join(' – ');
  const ctx: ShareContext = { token, base, root: base, view: view.data };
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

  return (
    <PhotoSourceProvider value={photos}>
      <div className="share-shell">
        <header className="share-header">
          <TeasooLogo height={38} />
          <span className="spacer" />
          <span className="muted print-only">Printed {fmtDateTime(new Date().toISOString())}</span>
        </header>
        <div className="page-title">
          <h1 style={{ margin: 0 }}>{p.name}</h1>
          {(p.location || dates) && <p className="page-sub">{[p.location, dates].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="share-body">
          <nav className="share-nav no-print" aria-label="Sections">
            <NavLink to={ctx.root} end className={navClass}>Summary</NavLink>
            <NavLink to={`${ctx.root}/trees`} className={navClass}>Tree list</NavLink>
            <NavLink to={`${ctx.root}/areas`} className={navClass}>Areas &amp; map</NavLink>
            <NavLink to={`${ctx.root}/report`} className={navClass}>Full report</NavLink>
          </nav>
          <main className="share-main">
            <Routes>
              <Route index element={<ShareSummary {...ctx} />} />
              <Route path="report" element={<ShareOverview {...ctx} />} />
              {/* The executive overview became the Summary (#140). */}
              <Route path="executive" element={<Navigate to={ctx.root} replace />} />
              <Route path="trees" element={<ShareTrees {...ctx} />} />
              <Route path="trees/:treeId" element={<ShareTree {...ctx} />} />
              <Route path="areas" element={<ShareAreas {...ctx} />} />
              <Route path="*" element={<Navigate to={ctx.root} replace />} />
            </Routes>
          </main>
        </div>
        <ShareFooter />
      </div>
    </PhotoSourceProvider>
  );
}

/** The client link's filters, kept in the address so a filtered view can be shared or reloaded. */
function useShareFilters(keys: readonly string[] = FILTER_KEYS) {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    (DEPENDENTS[k] ?? []).forEach((d) => next.delete(d));
    setParams(next, { replace: true });
  };
  const values = Object.fromEntries(keys.map((k) => [k, get(k)]));
  return {
    get,
    set,
    values,
    filter: qs(values),
    activeCount: keys.filter((k) => get(k)).length,
    clear: () => setParams(new URLSearchParams(), { replace: true }),
  };
}

type ShareFilters = ReturnType<typeof useShareFilters>;

/** Planting year, vendor, sector and dates, for any client page that shows the summary. */
function ShareFilterPanel({ d, f }: { d: any; f: ShareFilters }) {
  const { get, set } = f;
  const yearId = get('planting_year_id');
  const yearAreas = (d.areas ?? []).filter((a: any) => !yearId || a.planting_year_id === yearId || a.planting_year_id == null);
  const vendors: any[] = (d.vendors ?? []).filter((v: any) => !yearId || v.planting_year_id === yearId);
  const vendorOptions = [...new Map(vendors.map((v) => [v.id, v.short_code ? `${v.name} (${v.short_code})` : v.name])).entries()];
  return (
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
            {yearAreas.map((a: any) => <option key={a.id} value={a.id}>{sectorLabel(a)}</option>)}
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
        {f.activeCount > 0 && <button type="button" onClick={f.clear}>Clear</button>}
      </div>
    </section>
  );
}

const SUMMARY_KEYS = ['planting_year_id', 'sector_id', 'species_id'] as const;

/**
 * Summary (#140): the executive view, and the link's landing page. Plain-language health, sectors, map, species,
 * heights, weekly tagging and visits, filtered by planting year, sector and species.
 */
function ShareSummary({ token, base, root, view: unfiltered }: ShareContext) {
  const f = useShareFilters(SUMMARY_KEYS);
  const view = useQuery({ queryKey: ['share', token, f.filter], queryFn: () => publicGet(`${base}${f.filter}`), retry: (n, e) => !isMissing(e) && n < 1 });
  const d = view.data ?? unfiltered;
  if (view.error) return <ErrorNotice error={view.error} />;
  if (!d) return <div className="empty">Loading…</div>;
  const yearId = f.get('planting_year_id');
  const years: any[] = d.planting_years ?? [];
  const yearsWithTrees = years.filter((y) => (unfiltered?.summary?.by_planting_year ?? d.summary.by_planting_year ?? []).some((r: any) => r.id === y.id));
  const sectors: any[] = (d.areas ?? []).filter((a: any) => !yearId || a.planting_year_id === yearId);
  const sectorYear = (a: any) => years.find((y) => y.id === a.planting_year_id)?.year_label;
  const species: any[] = d.species ?? [];
  const trees = (params: Record<string, string | undefined>) =>
    params.vendor_id !== undefined ? null : `${root}/trees${qs({ planting_year_id: yearId || undefined, sector_id: f.get('sector_id') || undefined, species_id: f.get('species_id') || undefined, ...params })}`;
  const asOfAt = d.summary?.last_server_sync_at;
  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-title">
          <h2 style={{ margin: 0 }}>Summary</h2>
          {asOfAt && <p className="page-sub">Field data as of {fmtDateTime(asOfAt)}</p>}
        </div>
        <span className="spacer" />
        <div className="page-actions no-print" role="group" aria-label="Download">
          <a className="btn primary" href={apiUrl(`${base}/report.xlsx${f.filter}`)}>Download Excel</a>
          <button onClick={() => window.print()}>Save as PDF</button>
        </div>
      </div>
      <div className="exec-filters no-print" role="group" aria-label="Filters">
        <div className="segmented" role="radiogroup" aria-label="Planting year">
          {[{ id: '', year_label: 'All years' }, ...yearsWithTrees].map((y) => (
            <button key={y.id || 'all'} type="button" role="radio" aria-checked={yearId === y.id} className={yearId === y.id ? 'active' : undefined} onClick={() => f.set('planting_year_id', y.id)}>
              {y.year_label}
            </button>
          ))}
        </div>
        <label className="exec-filter">
          <span>Sector</span>
          <select value={f.get('sector_id')} onChange={(e) => f.set('sector_id', e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((a) => <option key={a.id} value={a.id}>{sectorLabel(a)}{!yearId && sectorYear(a) ? ` (${sectorYear(a)})` : ''}</option>)}
          </select>
        </label>
        <label className="exec-filter">
          <span>Species</span>
          <select value={f.get('species_id')} onChange={(e) => f.set('species_id', e.target.value)}>
            <option value="">All species</option>
            {species.map((sp) => <option key={sp.id} value={sp.id}>{sp.common_name ?? sp.scientific_name}</option>)}
          </select>
        </label>
        {f.activeCount > 0 && <button type="button" className="link" onClick={f.clear}>Clear filters</button>}
      </div>
      <div className={view.isFetching ? 'refetching' : undefined}>
        <ExecutiveSummary s={d.summary} areas={(d.areas ?? []).filter((a: any) => !yearId || a.planting_year_id === yearId)} years={years} trees={trees} />
      </div>
    </div>
  );
}

/** Overview: the dashboard-style summary with its filters, map and downloads (the original client report). */
function ShareOverview({ token, base }: ShareContext) {
  const sf = useShareFilters();
  const { get, filter } = sf;
  const view = useQuery({ queryKey: ['share', token, filter], queryFn: () => publicGet(`${base}${filter}`), retry: (n, e) => !isMissing(e) && n < 1 });
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

  if (view.error) return <ErrorNotice error={view.error} />;
  if (!d) return <div className="empty">Loading…</div>;

  const s = d.summary;
  const statusRows: any[] = s.by_status ?? [];
  const alive = statusRows.filter((r) => !r.is_terminal && r.code !== 'UNKNOWN').reduce((n, r) => n + r.count, 0);
  const terms = metricTerms();
  const unknown = statusRows.filter((r) => r.code === 'UNKNOWN').reduce((n, r) => n + r.count, 0);
  const donut = statusRows.map((r) => ({ label: r.name, value: r.count, color: statusColor(r.code, r.is_terminal, r.name) }));
  const coverage: ShareArea[] = (s.area_coverage ?? []).filter((r: any) => sectorIds.has(r.sector_id));
  const sectorShare = (s.sector_share ?? []).filter((r: any) => sectorIds.has(r.id));
  const download = (file: string) => apiUrl(`${base}/${file}${filter}`);
  const weeks: { week: string; trees: number; cumulative: number }[] = s.planted_by_week ?? [];
  const fmtWeek = fmtShortDate;
  const byVendor: any[] = (s.by_vendor ?? []).map((r: any) => ({ label: r.short_code && r.id ? `${r.name} (${r.short_code})` : r.name, value: r.count }));
  // Alive / dead / not yet visited per sector, as each sector's share.
  const lifeSeries = [
    { key: 'alive_trees', label: 'Alive', color: 'var(--status-good)' },
    { key: 'dead_trees', label: 'Dead or missing', color: 'var(--status-critical)' },
    { key: 'unknown_trees', label: 'No status yet', color: 'var(--border-strong)' },
  ];
  const lifeSectors = sectorShare.filter((r: any) => r.registered_trees > 0);
  const aliveShare = (r: any) => (r.alive_trees + r.dead_trees ? `${Math.round((r.alive_trees / (r.alive_trees + r.dead_trees)) * 100)}%` : '—');

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-title">
          <h2 style={{ margin: 0 }}>Full report</h2>
        </div>
        <span className="spacer" />
        <div className="page-actions no-print" role="group" aria-label="Download the report">
          {/* One workbook holds the summary, every tree and every visit, so there are no separate CSV downloads. */}
          <a className="btn primary" href={download('report.xlsx')}>Download Excel</a>
          <button onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>

      <ShareFilterPanel d={d} f={sf} />

      <div className={`stack ${view.isFetching ? 'refetching' : ''}`}>
        <div className="grid stats">
          <StatTile label="Trees planted" info={terms.planted} value={fmtNum(s.totals.planting_events)} foot={s.totals.replacement_trees ? `incl. ${fmtNum(s.totals.replacement_trees)} replacements` : undefined} />
          <StatTile label="Alive" info={terms.alive} value={fmtNum(alive)} />
          <StatTile label="Dead or missing" info={terms.dead} value={fmtNum(s.totals.terminal_status_trees)} />
          <StatTile label="No status yet" info={terms.noStatus} value={fmtNum(unknown)} />
        </div>

        <div className="grid charts">
          <ChartCard title="Current status" empty={statusRows.length === 0 && 'No trees yet.'} table={<SimpleTable head={['Status', 'Trees']} rows={statusRows.map((r) => [r.name, fmtNum(r.count)])} />}>
            <Donut data={donut} />
          </ChartCard>
          <SpeciesCard rows={s.by_species ?? []} />
        </div>

        <ChartCard
          title="Trees planted over time"
          subtitle="Running total by week of planting"
          empty={weeks.length === 0 && 'No trees yet.'}
          table={<SimpleTable head={['Week of', 'Planted', 'Total']} rows={weeks.map((w) => [fmtWeek(w.week), fmtNum(w.trees), fmtNum(w.cumulative)])} />}
        >
          <LineChart
            series={[{ key: 'total', label: 'Trees planted', color: SERIES[0], points: weeks.map((w) => ({ x: Date.parse(w.week), y: w.cumulative })) }]}
            unit="trees"
            xFormat={fmtWeek}
            ariaLabel="Trees planted, running total by week"
          />
        </ChartCard>

        <div className="grid charts">
          <ChartCard title="Trees by vendor" empty={byVendor.length === 0 && 'No trees yet.'} table={<SimpleTable head={['Vendor', 'Trees']} rows={byVendor.map((r) => [r.label, fmtNum(r.value)])} />}>
            <HBarChart data={byVendor} />
          </ChartCard>
          <ChartCard
            title="Tree status by planting year and sector"
            subtitle="Share of each sector’s trees that are alive, dead or missing, or have no status yet, from each tree’s latest visit"
            empty={lifeSectors.length === 0 && 'No trees yet.'}
            legend={<Legend items={lifeSeries} />}
            table={
              <SimpleTable
                head={['Planting year', 'Sector', 'Alive', 'Dead or missing', 'No status yet', 'Alive share']}
                rows={groupByYear<any>(lifeSectors).flatMap((g) => g.rows.map((r: any) => [g.year ?? '—', sectorLabel(r), fmtNum(r.alive_trees), fmtNum(r.dead_trees), fmtNum(r.unknown_trees), aliveShare(r)]))}
              />
            }
          >
            {groupByYear<any>(lifeSectors).map((g, _i, all) => (
              <div key={g.year ?? 'none'} className="year-block">
                {all.length > 1 && <h3 className="year-heading">{yearHeading(g.year)}</h3>}
                <StackedBars
                  categories={g.rows.map(sectorLabel)}
                  series={lifeSeries}
                  values={(c, k) => g.rows.find((r: any) => sectorLabel(r) === c)?.[k] ?? 0}
                  normalize
                />
              </div>
            ))}
          </ChartCard>
        </div>

        <AreaShareView rows={coverage} sectors={sectorShare} boundaries={boundaries} />

        {/* Shown only when there is something to draw: areas with GPS outlines. */}
        {density.data && hasOutlines(density.data) && (
          <section className="stack" aria-label="Tree density">
            <h2 style={{ margin: '8px 0 0' }}>Tree density</h2>
            <DensityView report={density.data} />
          </section>
        )}

        <ChartCard
          title="Trees by planting year and sector"
          empty={(s.by_sector ?? []).length === 0 && 'No trees yet.'}
          table={<SimpleTable head={['Planting year', 'Sector', 'Trees']} rows={groupByYear<any>(s.by_sector ?? []).flatMap((g) => g.rows.map((r: any) => [g.year ?? '—', sectorLabel(r), fmtNum(r.count)]))} />}
        >
          {groupByYear<any>(s.by_sector ?? []).map((g, _i, all) => (
            <div key={g.year ?? 'none'} className="year-block">
              {all.length > 1 && <h3 className="year-heading">{yearHeading(g.year)}</h3>}
              <HBarChart data={g.rows.map((r: any) => ({ label: sectorLabel(r), value: r.count }))} />
            </div>
          ))}
        </ChartCard>

        <p className="muted" style={{ margin: 0 }}>
          Updated {relativeTime(s.last_server_sync_at)}
          {s.last_server_sync_at ? ` (${fmtDateTime(s.last_server_sync_at)})` : ''}. Counts are registered trees; “alive” means the latest visit found the tree alive. {DAY_NOTE}
        </p>
        <details className="card">
          <summary>What these numbers mean</summary>
          <GlossaryList terms={glossary().filter((t) => t.term !== 'Open conflicts')} />
        </details>
        <p className="muted no-print" style={{ margin: 0 }}>
          <LegalLinks />
        </p>
      </div>
    </div>
  );
}
