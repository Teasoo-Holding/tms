import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../api/client';
import { ChartCard, Donut, GroupedColumns, HBarChart, Legend, LineChart, LineSeries, SERIES, StackedBars, StackedColumns, StatTile } from '../charts/charts';
import { CardHeader, ErrorNotice, fmtDateTime, fmtNum, PageHeader, relativeTime } from '../components/ui';

export function DashboardPage() {
  const [projectId, setProjectId] = useState('');
  const [yearId, setYearId] = useState('');
  const [overdueDays, setOverdueDays] = useState(90);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get(`/projects/${projectId}`), enabled: !!projectId });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const filter = qs({ project_id: projectId, planting_year_id: yearId, overdue_days: overdueDays });
  const summary = useQuery({ queryKey: ['summary', filter], queryFn: () => api.get(`/reports/summary${filter}`) });
  const s = summary.data;

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

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        subtitle="Registered trees, their latest recorded status, growth and field activity across the projects you can see."
        actions={
          <>
            <button onClick={() => api.download(`/reports/trees.csv${filter}`, 'trees.csv')}>Export CSV</button>
            <button onClick={() => api.download(`/reports/trees.xlsx${filter}`, 'trees.xlsx')}>Export Excel</button>
          </>
        }
      />

      <div className="filters" style={{ marginBottom: 0 }}>
        <label className="field">
          Project
          <select value={projectId} onChange={(e) => (setProjectId(e.target.value), setYearId(''))}>
            <option value="">All my projects</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Planting year
          <select value={yearId} onChange={(e) => setYearId(e.target.value)} disabled={!projectId}>
            <option value="">All years</option>
            {project.data?.planting_years.map((y: any) => (
              <option key={y.id} value={y.id}>{y.year_label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Overdue after
          <select value={overdueDays} onChange={(e) => setOverdueDays(Number(e.target.value))}>
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>{d} days without observation</option>
            ))}
          </select>
        </label>
      </div>

      <ErrorNotice error={summary.error} />
      {summary.isLoading && <div className="card empty">Loading the dashboard…</div>}
      {s && (
        <div className={`stack ${summary.isFetching ? 'refetching' : ''}`}>
          <div className="grid stats">
            <StatTile label="Planting events" value={fmtNum(s.totals.planting_events)} foot="Original + replacement trees" />
            <StatTile label="Original trees" value={fmtNum(s.totals.original_trees)} />
            <StatTile label="Replacement trees" value={fmtNum(s.totals.replacement_trees)} foot="Counted separately, never as survivors" />
            <StatTile label="Dead or missing" value={fmtNum(s.totals.terminal_status_trees)} foot="Confirmed by an observation" />
            <StatTile label="Unknown / overdue" value={fmtNum(s.totals.overdue_unknown_trees)} foot={`No observation in ${s.overdue_days} days`} />
            <StatTile label="Open conflicts" value={fmtNum(s.data_completeness.open_conflicts)} foot="Awaiting administrator review" />
          </div>

          <p className="muted" style={{ margin: 0 }}>
            Data as of the latest server sync: <strong>{fmtDateTime(s.last_server_sync_at)}</strong> ({relativeTime(s.last_server_sync_at)}). Records still on field devices are
            not included until they sync.
          </p>

          <div className="grid charts">
            <ChartCard
              title="Current status"
              subtitle="Latest effective observation per tree. Not a survival rate."
              empty={s.by_status.length === 0 && 'No trees registered yet.'}
              table={<SimpleTable head={['Status', 'Trees']} rows={s.by_status.map((r: any) => [r.name, fmtNum(r.count)])} />}
            >
              <Donut data={s.by_status.map((r: any) => ({ label: r.name, value: r.count, color: colorOf(r.code) }))} />
            </ChartCard>
            <ChartCard
              title="Average height over time"
              subtitle="Monthly mean of the latest height measurement per tree; the five most-measured species."
              empty={growthSeries.length === 0 && 'No heights recorded yet. Heights entered or measured on photos during visits appear here.'}
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
            <ChartCard
              title="Weekly field activity"
              subtitle="Trees registered and follow-up observations per week, last 12 weeks."
              empty={activityEmpty && 'No registrations or observations in the last 12 weeks.'}
              legend={<Legend items={activitySeries} />}
              table={<SimpleTable head={['Week of', 'Registered', 'Observations']} rows={activity.map((w) => [fmtWeek(w.week), fmtNum(w.registrations), fmtNum(w.observations)])} />}
            >
              <GroupedColumns categories={activity.map((w) => w.week)} series={activitySeries} values={(c, k) => activity.find((w) => w.week === c)?.[k] ?? 0} formatCategory={fmtWeek} />
            </ChartCard>
            <ChartCard
              title="Planting events by planting year"
              empty={s.by_planting_year.length === 0 && 'No trees registered yet.'}
              table={<SimpleTable head={['Planting year', 'Original', 'Replacement']} rows={s.by_planting_year.map((r: any) => [r.name, fmtNum(r.original_trees), fmtNum(r.replacement_trees)])} />}
              legend={<Legend items={yearSeries} />}
            >
              <StackedColumns
                categories={s.by_planting_year.map((r: any) => r.name)}
                series={yearSeries}
                values={(c, k) => s.by_planting_year.find((r: any) => r.name === c)?.[k] ?? 0}
              />
            </ChartCard>
            <ChartCard
              title="Status mix by sector"
              subtitle="Share of each sector's trees in each current status."
              empty={bySectorMix.categories.length === 0 && 'No trees registered yet.'}
              legend={<Legend items={bySectorMix.series} />}
              table={mixTable(bySectorMix, 'Sector')}
            >
              <StackedBars categories={bySectorMix.categories} series={bySectorMix.series} values={bySectorMix.value} normalize />
            </ChartCard>
            <ChartCard
              title="Status mix by species"
              subtitle="Share of each species' trees in each current status."
              empty={bySpeciesMix.categories.length === 0 && 'No trees registered yet.'}
              legend={<Legend items={bySpeciesMix.series} />}
              table={mixTable(bySpeciesMix, 'Species')}
            >
              <StackedBars categories={bySpeciesMix.categories} series={bySpeciesMix.series} values={bySpeciesMix.value} normalize />
            </ChartCard>
          </div>

          <ChartCard
            title="Observations by month and recorded status"
            subtitle="Effective observations in the last 12 months (corrected entries replace the originals)."
            empty={months.length === 0 && 'No observations in the last 12 months.'}
            legend={<Legend items={trendStatuses.map((st) => ({ label: st.name, color: colorOf(st.code) }))} />}
            table={
              <SimpleTable
                head={['Month', ...trendStatuses.map((st) => st.name)]}
                rows={months.map((m) => [m, ...trendStatuses.map((st) => fmtNum(trendValue(m, st.code)))])}
              />
            }
          >
            <StackedColumns
              categories={months}
              series={trendStatuses.map((st) => ({ key: st.code, label: st.name, color: colorOf(st.code) }))}
              values={trendValue}
            />
          </ChartCard>

          <div className="grid charts">
            <ChartCard title="Registered trees by sector" empty={s.by_sector.length === 0 && 'No trees registered yet.'} table={<SimpleTable head={['Sector', 'Trees']} rows={s.by_sector.map((r: any) => [`${r.short_code} · ${r.name}`, fmtNum(r.count)])} />}>
              <HBarChart data={s.by_sector.map((r: any) => ({ label: `${r.short_code} · ${r.name}`, value: r.count }))} />
            </ChartCard>
            <ChartCard title="Registered trees by species" empty={s.by_species.length === 0 && 'No trees registered yet.'} table={<SimpleTable head={['Species', 'Trees']} rows={s.by_species.map((r: any) => [r.name, fmtNum(r.count)])} />}>
              <HBarChart data={s.by_species.map((r: any) => ({ label: r.common_name ?? r.name, value: r.count }))} />
            </ChartCard>
          </div>

          <div className="grid cols-2">
            <section className="card">
              <CardHeader title="Area coverage" description="From administrator-defined sub-sector boundaries; trees have no individual positions." />
              <SimpleTable
                head={['Sub-sector', 'Area (ha)', 'Trees', 'Trees / ha']}
                numeric={[1, 2, 3]}
                rows={s.area_coverage.map((r: any) => [
                  `${r.sector_code}/${r.short_code} · ${r.name}`,
                  r.area_hectares ?? '—',
                  fmtNum(r.registered_trees),
                  r.area_hectares ? (r.registered_trees / r.area_hectares).toFixed(1) : '—',
                ])}
              />
            </section>
            <section className="card">
              <CardHeader title="Data completeness" description="Gaps worth following up with field teams." />
              <SimpleTable
                head={['Check', 'Count']}
                numeric={[1]}
                rows={[
                  ['Trees never observed', fmtNum(s.data_completeness.never_observed)],
                  ['Trees missing planted date', fmtNum(s.data_completeness.missing_planted_on)],
                  ['Trees with photos not yet verified', fmtNum(s.data_completeness.trees_with_unverified_photos)],
                  ['Open sync conflicts', fmtNum(s.data_completeness.open_conflicts)],
                  ['Devices not synced in 7 days', fmtNum(s.data_completeness.devices_not_synced_7_days)],
                ]}
              />
            </section>
          </div>

          <section className="card">
            <CardHeader title="Field officer activity" description="Last 30 days." />
            <SimpleTable
              head={['Officer', 'Trees registered', 'Observations', 'Last device sync']}
              numeric={[1, 2]}
              rows={s.officer_activity.map((r: any) => [r.full_name, fmtNum(r.trees_registered_30d), fmtNum(r.observations_30d), relativeTime(r.last_sync_at)])}
            />
          </section>

          <ul className="muted" style={{ margin: 0 }}>
            {s.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const monthTime = (m: string) => new Date(`${m}-01T00:00:00`).getTime();
const fmtMonth = (x: number) => new Date(x).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const fmtWeek = (w: string) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function SimpleTable({ head, rows, numeric = [] }: { head: string[]; rows: React.ReactNode[][]; numeric?: number[] }) {
  if (rows.length === 0) return <div className="empty">No data for these filters.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={numeric.includes(i) || (i > 0 && numeric.length === 0) ? 'num' : ''}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={numeric.includes(ci) || (ci > 0 && numeric.length === 0) ? 'num' : ''}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
