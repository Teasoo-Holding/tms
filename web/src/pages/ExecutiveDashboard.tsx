import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { ChartCard, GroupedColumns, HBarChart, Legend, SERIES, StatTile } from '../charts/charts';
import { FreshnessBanner, useFreshness } from '../components/Freshness';
import { FiltersButton, ReportFilters, useReportFilters } from '../components/ReportFilters';
import { ErrorNotice, fmtNum, PageHeader, SimpleTable } from '../components/ui';
import { fmtShortDate } from '../time';
import { useState } from 'react';

const weekLabel = (w: string) => fmtShortDate(`${w}T12:00:00Z`);

/**
 * The executive dashboard (#129): how much work is done, without tree health. Totals, trees by planting year,
 * vendor and species, and weekly field activity. Each row opens the matching trees.
 */
export function ExecutiveDashboard() {
  const f = useReportFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filter = qs(f.values);
  const summary = useQuery({ queryKey: ['summary', filter], queryFn: () => api.get<any>(`/reports/summary${filter}`) });
  const freshness = useFreshness(f.get('project_id') || undefined);
  const s = summary.data;
  const trees = (params: Record<string, string | undefined>) => `/trees${qs({ project_id: f.get('project_id') || undefined, ...params })}`;
  const years: any[] = (s?.by_planting_year ?? []).map((r: any) => ({ ...r, count: r.original_trees + r.replacement_trees }));
  const vendors: any[] = s?.by_vendor ?? [];
  const species: any[] = s?.by_species ?? [];
  const weeks: any[] = s?.activity_by_week ?? [];
  const weekSeries = [
    { key: 'registrations', label: 'Trees registered', color: SERIES[0] },
    { key: 'observations', label: 'Follow-up visits', color: SERIES[2] },
  ];
  const visitsTotal = weeks.reduce((n, w) => n + w.observations, 0);
  const lastWeek = weeks[weeks.length - 1];
  const list = (rows: any[], name: (r: any) => string, link: (r: any) => string | null, label: string) => (
    <SimpleTable
      head={[label, 'Trees']}
      numeric={[1]}
      rows={rows.map((r) => {
        const to = link(r);
        return [to ? <Link to={to}>{name(r)}</Link> : name(r), fmtNum(r.count)];
      })}
    />
  );
  return (
    <div className="stack">
      <PageHeader
        title="Project overview"
        subtitle="How much field work is done. Open any row to see its tree records."
        actions={<FiltersButton count={f.count} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />}
      />
      {filtersOpen && <ReportFilters f={f} onClose={() => setFiltersOpen(false)} />}
      <FreshnessBanner freshness={freshness.data} />
      <ErrorNotice error={summary.error} />
      {summary.isLoading && <div className="card empty">Loading…</div>}
      {s && (
        <>
          <div className="grid stats">
            <StatTile label="Tree records" value={<Link to={trees({})}>{fmtNum(s.totals.planting_events)}</Link>} foot="Registered and accepted" />
            <StatTile label="Planting years" value={fmtNum(years.length)} />
            <StatTile label="Vendors" value={fmtNum(vendors.filter((v) => v.id).length)} />
            <StatTile
              label="Follow-up visits"
              value={fmtNum(visitsTotal)}
              foot={lastWeek ? `${fmtNum(lastWeek.observations)} in the week of ${weekLabel(lastWeek.week)}` : undefined}
            />
          </div>
          <div className="grid charts">
            <ChartCard title="Trees by planting year" empty={years.length === 0 && 'No trees yet.'} table={list(years, (r) => r.name, (r) => trees({ planting_year_id: r.id }), 'Planting year')}>
              <HBarChart data={years.map((r) => ({ label: r.name, value: r.count }))} />
            </ChartCard>
            <ChartCard title="Trees by vendor" empty={vendors.length === 0 && 'No trees yet.'} table={list(vendors, (r) => (r.short_code ? `${r.name} (${r.short_code})` : r.name), (r) => (r.id ? trees({ vendor_id: r.id }) : null), 'Vendor')}>
              <HBarChart data={vendors.map((r) => ({ label: r.short_code ? `${r.name} (${r.short_code})` : r.name, value: r.count }))} />
            </ChartCard>
          </div>
          <ChartCard title="Trees by species" empty={species.length === 0 && 'No trees yet.'} table={list(species, (r) => r.common_name ?? r.name, (r) => trees({ species_id: r.id }), 'Species')}>
            <HBarChart data={species.map((r) => ({ label: r.common_name ?? r.name, value: r.count }))} />
          </ChartCard>
          <ChartCard
            title="Weekly field activity"
            subtitle="Weeks run Monday to Sunday, West Africa Time (WAT). The last 12 weeks unless a date range is chosen."
            empty={weeks.length === 0 && 'No activity in this period.'}
            legend={<Legend items={weekSeries} />}
            table={<SimpleTable head={['Week of', 'Trees registered', 'Follow-up visits']} numeric={[1, 2]} rows={weeks.map((w) => [weekLabel(w.week), fmtNum(w.registrations), fmtNum(w.observations)])} />}
          >
            <GroupedColumns categories={weeks.map((w) => w.week)} series={weekSeries} values={(c, k) => weeks.find((w) => w.week === c)?.[k] ?? 0} formatCategory={weekLabel} />
          </ChartCard>
        </>
      )}
    </div>
  );
}
