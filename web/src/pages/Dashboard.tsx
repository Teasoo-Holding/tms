import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { ChartCard, Donut, GroupedColumns, HBarChart, Legend, LineChart, LineSeries, SERIES, StackedBars, StackedColumns, StatTile } from '../charts/charts';
import { AreaShareView } from '../components/AreaShare';
import { FiltersButton, ReportFilters, useReportFilters } from '../components/ReportFilters';
import { ShareArea } from '../components/ShareMap';
import { CardHeader, ErrorNotice, fmtDateTime, fmtNum, PageHeader, relativeTime, RowMenu, SimpleTable, todayStamp } from '../components/ui';
import { SHOW_HEIGHT } from '../features';

export { SimpleTable };
export const DATE_NOTE = 'Tree counts use the registration date; visit charts use the visit date.';

export function DashboardPage() {
  const f = useReportFilters();
  const isAdmin = useIsAdmin();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const projectName = projects.data?.find((p) => p.id === f.get('project_id'))?.name;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const projectId = f.get('project_id');
  const yearId = f.get('planting_year_id');
  // With a planting year chosen, areas show only that year's survey (plus older areas not tied to a year).
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`), enabled: !!projectId && !!yearId });
  const yearSectorIds = useMemo(
    () => (projectId && yearId && areas.data ? new Set(areas.data.filter((a) => a.planting_year_id === yearId || a.planting_year_id == null).map((a) => a.id as string)) : null),
    [projectId, yearId, areas.data],
  );
  const inYear = (sectorId: string) => !yearSectorIds || yearSectorIds.has(sectorId);
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const filter = qs({ ...f.values, overdue_days: f.get('overdue_days') || 90 });
  const summary = useQuery({ queryKey: ['summary', filter], queryFn: () => api.get(`/reports/summary${filter}`) });
  const s = summary.data;
  const exportFilter = qs(f.values);
  const download = async (path: string, name: string) => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download(path, name);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };
  const hasRange = !!(f.get('from') || f.get('to'));

  // Colour follows the status entity (its configured order), not its rank in this result.
  const statusColor = new Map<string, string>((statuses.data ?? []).map((st, i) => [st.code, SERIES[i % SERIES.length]]));
  statusColor.set('UNKNOWN', 'var(--border-strong)');
  const colorOf = (code: string) => statusColor.get(code) ?? 'var(--border-strong)';
  const months = [...new Set<string>((s?.observation_trend ?? []).map((r: any) => r.month))];
  const trendStatuses = (statuses.data ?? []).filter((st) => s?.observation_trend.some((r: any) => r.code === st.code));
  const trendValue = (month: string, code: string) => s?.observation_trend.find((r: any) => r.month === month && r.code === code)?.count ?? 0;
  const yearSeries = [
    { key: 'original_trees', label: 'Original trees', color: SERIES[0] },
    { key: 'replacement_trees', label: 'Replacement trees', color: SERIES[1] },
  ];

  // Growth: one line per species, the five with the most measurements. Colour follows the species' reference order.
  const growth: any[] = s?.growth ?? [];
  const speciesColor = new Map<string, string>((species.data ?? []).map((sp, i) => [sp.id, SERIES[i % SERIES.length]]));
  const measuredBySpecies = new Map<string, number>();
  growth.forEach((g) => measuredBySpecies.set(g.species_id, (measuredBySpecies.get(g.species_id) ?? 0) + g.measured_trees));
  const topSpecies = [...measuredBySpecies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const growthSeries: LineSeries[] = topSpecies.map((id, i) => {
    const rows = growth.filter((g) => g.species_id === id);
    return {
      key: id,
      label: rows[0]?.species_common_name ?? rows[0]?.species_name ?? 'Species',
      color: speciesColor.get(id) ?? SERIES[i % SERIES.length],
      points: rows.map((g) => ({ x: monthTime(g.month), y: g.avg_height_cm })),
    };
  });
  const growthMonths = [...new Set(growth.filter((g) => topSpecies.includes(g.species_id)).map((g) => g.month as string))].sort();

  // Weekly activity: registrations vs follow-up observations.
  const activity: any[] = s?.activity_by_week ?? [];
  const activitySeries = [
    { key: 'registrations', label: 'Trees registered', color: SERIES[0] },
    { key: 'observations', label: 'Follow-up observations', color: SERIES[2] },
  ];
  const activityEmpty = activity.every((w) => !w.registrations && !w.observations);

  const statusMix = (rows: any[] = []) => {
    const groups = [...new Map(rows.map((r) => [r.group_code, r.group_name as string])).entries()];
    const codes = new Set(rows.map((r) => r.code as string));
    const ordered = [...(statuses.data ?? []).map((st) => st.code as string), 'UNKNOWN'].filter((c) => codes.has(c));
    codes.forEach((c) => !ordered.includes(c) && ordered.push(c));
    const series = ordered.map((code) => ({ key: code, label: rows.find((r) => r.code === code)?.status_name ?? code, color: colorOf(code) }));
    const value = (group: string, code: string) => rows.find((r) => r.group_name === group && r.code === code)?.count ?? 0;
    return { categories: groups.map(([, name]) => name), series, value };
  };
  const bySectorMix = statusMix(s?.status_by_sector);
  const bySpeciesMix = statusMix(s?.status_by_species);
  const mixTable = (mix: ReturnType<typeof statusMix>, label: string) => (
    <SimpleTable head={[label, ...mix.series.map((x) => x.label)]} rows={mix.categories.map((c) => [c, ...mix.series.map((x) => fmtNum(mix.value(c, x.key)))])} />
  );

  const coverage: ShareArea[] = s ? s.area_coverage.filter((r: any) => inYear(r.sector_id)) : [];

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <FiltersButton count={f.count} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />
            <button className="primary no-print" disabled={exporting} onClick={() => download(`/reports/export.xlsx${exportFilter}`, `tms-export-${todayStamp()}.xlsx`)}>
              {exporting ? 'Preparing…' : 'Export all (Excel)'}
            </button>
            <button className="no-print" onClick={() => window.print()}>Print report</button>
            <RowMenu
              label="More exports"
              items={[
                { label: 'Trees (CSV)', onClick: () => download(`/reports/trees.csv${filter}`, 'trees.csv') },
                { label: 'Trees (Excel)', onClick: () => download(`/reports/trees.xlsx${filter}`, 'trees.xlsx') },
              ]}
            />
          </>
        }
      />

      <p className="print-only muted" style={{ margin: 0 }}>
        {[projectName ?? 'All projects', f.get('from') || f.get('to') ? `${f.get('from') || '…'} to ${f.get('to') || 'today'}` : null, `printed ${fmtDateTime(new Date().toISOString())}`]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {filtersOpen && <ReportFilters f={f} showOverdue dateNote={DATE_NOTE} onClose={() => setFiltersOpen(false)} />}

      <ErrorNotice error={summary.error ?? exportError} />
      {summary.isLoading && <div className="card empty">Loading…</div>}
      {s && (
        <div className={`stack ${summary.isFetching ? 'refetching' : ''}`}>
          <div className="grid stats">
            <StatTile label="Trees planted" value={fmtNum(s.totals.planting_events)} foot={s.totals.replacement_trees ? `incl. ${fmtNum(s.totals.replacement_trees)} replacements` : undefined} />
            <StatTile label="Dead or missing" value={fmtNum(s.totals.terminal_status_trees)} />
            <StatTile label="Overdue" value={fmtNum(s.totals.overdue_unknown_trees)} foot={`No visit in ${s.overdue_days} days`} />
            {isAdmin && <StatTile label="Open conflicts" value={fmtNum(s.data_completeness.open_conflicts)} />}
          </div>

          <div className="grid charts">
            <ChartCard
              title="Current status"
              empty={s.by_status.length === 0 && 'No trees yet.'}
              table={<SimpleTable head={['Status', 'Trees']} rows={s.by_status.map((r: any) => [r.name, fmtNum(r.count)])} />}
            >
              <Donut data={s.by_status.map((r: any) => ({ label: r.name, value: r.count, color: colorOf(r.code) }))} />
            </ChartCard>
            <ChartCard
              title="Status by sector"
              empty={bySectorMix.categories.length === 0 && 'No trees yet.'}
              legend={<Legend items={bySectorMix.series} />}
              table={mixTable(bySectorMix, 'Sector')}
            >
              <StackedBars categories={bySectorMix.categories} series={bySectorMix.series} values={bySectorMix.value} normalize />
            </ChartCard>
          </div>

          {projectId && <AreaShareCard projectId={projectId} rows={coverage} sectors={(s.sector_share ?? []).filter((r: any) => inYear(r.id))} />}

          <ChartCard title="Trees by species" empty={s.by_species.length === 0 && 'No trees yet.'} table={<SimpleTable head={['Species', 'Trees']} rows={s.by_species.map((r: any) => [r.name, fmtNum(r.count)])} />}>
            <HBarChart data={s.by_species.map((r: any) => ({ label: r.common_name ?? r.name, value: r.count }))} />
          </ChartCard>

          <p className="muted" style={{ margin: 0 }} title={fmtDateTime(s.last_server_sync_at)}>
            Last sync {relativeTime(s.last_server_sync_at)}. Records still on phones appear after they sync.
          </p>

          <div className="more-toggle no-print">
            <button onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? 'Fewer charts' : 'More charts'}
            </button>
          </div>

          {more && (
            <div className="stack">
              <div className="grid charts">
                {SHOW_HEIGHT && (
                  <ChartCard
                    title="Average height"
                    empty={growthSeries.length === 0 && 'No heights recorded yet.'}
                    legend={<Legend items={growthSeries.map((g) => ({ label: g.label, color: g.color }))} />}
                    table={
                      <SimpleTable
                        head={['Month', ...growthSeries.map((g) => `${g.label} (cm)`)]}
                        rows={growthMonths.map((m) => [
                          m,
                          ...growthSeries.map((g) => {
                            const r = growth.find((x) => x.month === m && x.species_id === g.key);
                            return r ? `${r.avg_height_cm} (n=${r.measured_trees})` : '—';
                          }),
                        ])}
                      />
                    }
                  >
                    <LineChart series={growthSeries} unit="cm" xFormat={fmtMonth} ariaLabel="Average tree height by month and species" />
                  </ChartCard>
                )}
                <ChartCard
                  title="Weekly field activity"
                  subtitle={hasRange ? undefined : 'Last 12 weeks'}
                  empty={activityEmpty && 'No activity in this period.'}
                  legend={<Legend items={activitySeries} />}
                  table={<SimpleTable head={['Week of', 'Registered', 'Observations']} rows={activity.map((w) => [fmtWeek(w.week), fmtNum(w.registrations), fmtNum(w.observations)])} />}
                >
                  <GroupedColumns categories={activity.map((w) => w.week)} series={activitySeries} values={(c, k) => activity.find((w) => w.week === c)?.[k] ?? 0} formatCategory={fmtWeek} />
                </ChartCard>
                <ChartCard
                  title="By planting year"
                  empty={s.by_planting_year.length === 0 && 'No trees yet.'}
                  table={<SimpleTable head={['Planting year', 'Original', 'Replacement']} rows={s.by_planting_year.map((r: any) => [r.name, fmtNum(r.original_trees), fmtNum(r.replacement_trees)])} />}
                  legend={<Legend items={yearSeries} />}
                >
                  <StackedColumns categories={s.by_planting_year.map((r: any) => r.name)} series={yearSeries} values={(c, k) => s.by_planting_year.find((r: any) => r.name === c)?.[k] ?? 0} />
                </ChartCard>
                <ChartCard
                  title="Status by species"
                  empty={bySpeciesMix.categories.length === 0 && 'No trees yet.'}
                  legend={<Legend items={bySpeciesMix.series} />}
                  table={mixTable(bySpeciesMix, 'Species')}
                >
                  <StackedBars categories={bySpeciesMix.categories} series={bySpeciesMix.series} values={bySpeciesMix.value} normalize />
                </ChartCard>
                <ChartCard title="Trees by sector" empty={s.by_sector.length === 0 && 'No trees yet.'} table={<SimpleTable head={['Sector', 'Trees']} rows={s.by_sector.map((r: any) => [`${r.short_code} · ${r.name}`, fmtNum(r.count)])} />}>
                  <HBarChart data={s.by_sector.map((r: any) => ({ label: `${r.short_code} · ${r.name}`, value: r.count }))} />
                </ChartCard>
              </div>

              <ChartCard
                title="Visits by month and status"
                subtitle={f.get('from') ? undefined : 'Last 12 months'}
                empty={months.length === 0 && 'No visits in this period.'}
                legend={<Legend items={trendStatuses.map((st) => ({ label: st.name, color: colorOf(st.code) }))} />}
                table={<SimpleTable head={['Month', ...trendStatuses.map((st) => st.name)]} rows={months.map((m) => [m, ...trendStatuses.map((st) => fmtNum(trendValue(m, st.code)))])} />}
              >
                <StackedColumns categories={months} series={trendStatuses.map((st) => ({ key: st.code, label: st.name, color: colorOf(st.code) }))} values={trendValue} />
              </ChartCard>

              <div className="grid cols-2">
                <section className="card">
                  <CardHeader title="Data gaps" />
                  <SimpleTable
                    head={['Check', 'Count']}
                    numeric={[1]}
                    rows={[
                      ['Never visited', fmtNum(s.data_completeness.never_observed)],
                      ['No planted date', fmtNum(s.data_completeness.missing_planted_on)],
                      ['Photos not yet uploaded', fmtNum(s.data_completeness.trees_with_unverified_photos)],
                      ['Open conflicts', fmtNum(s.data_completeness.open_conflicts)],
                      ['Phones not synced in 7 days', fmtNum(s.data_completeness.devices_not_synced_7_days)],
                    ]}
                  />
                </section>
                <section className="card">
                  <CardHeader title="Area coverage" />
                  <SimpleTable
                    head={['Sub-sector', 'Hectares', 'Trees', 'Trees / ha']}
                    numeric={[1, 2, 3]}
                    rows={coverage.map((r: any) => [
                      `${r.sector_code}/${r.short_code} · ${r.name}`,
                      r.area_hectares ?? '—',
                      fmtNum(r.registered_trees),
                      r.area_hectares ? (r.registered_trees / r.area_hectares).toFixed(1) : '—',
                    ])}
                  />
                </section>
              </div>

              {s.officer_activity && (
                <section className="card">
                  <CardHeader title="Field officers, last 30 days" />
                  <SimpleTable
                    head={['Officer', 'Registered', 'Visits', 'Last sync']}
                    numeric={[1, 2]}
                    rows={s.officer_activity.map((r: any) => [r.full_name, fmtNum(r.trees_registered_30d), fmtNum(r.observations_30d), relativeTime(r.last_sync_at)])}
                  />
                </section>
              )}

              <ul className="muted" style={{ margin: 0 }}>
                {s.notes.map((n: string) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Alive/dead by area for one project: loads the project's boundaries for the map. */
function AreaShareCard({ projectId, rows, sectors }: { projectId: string; rows: ShareArea[]; sectors: any[] }) {
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const boundaries = useMemo(() => {
    const m = new Map<string, GeoJSON.Polygon>();
    (areas.data ?? []).forEach((s) => s.sub_sectors?.forEach((ss: any) => ss.boundary && m.set(ss.id, ss.boundary)));
    return m;
  }, [areas.data]);
  return <AreaShareView rows={rows} sectors={sectors} boundaries={boundaries} />;
}

const monthTime = (m: string) => new Date(`${m}-01T00:00:00`).getTime();
const fmtMonth = (x: number) => new Date(x).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const fmtWeek = (w: string) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

