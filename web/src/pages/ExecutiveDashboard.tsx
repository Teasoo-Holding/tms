import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../api/client';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { FreshnessBanner, useFreshness } from '../components/Freshness';
import { FiltersButton, ReportFilters, useReportFilters } from '../components/ReportFilters';
import { ErrorNotice, PageHeader } from '../components/ui';

/**
 * The home page of executive accounts: the same plain-language summary clients see on their link (#140), across
 * the projects the account can see. Rows open the matching tree records.
 */
export function ExecutiveDashboard() {
  const f = useReportFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filter = qs(f.values);
  const summary = useQuery({ queryKey: ['summary', filter], queryFn: () => api.get<any>(`/reports/summary${filter}`) });
  const freshness = useFreshness(f.get('project_id') || undefined);
  const trees = (params: Record<string, string | undefined>) => `/trees${qs({ project_id: f.get('project_id') || undefined, ...params })}`;
  return (
    <div className="stack">
      <PageHeader
        title="Project summary"
        subtitle="How the planting is going, in plain numbers. Open any row to see its trees."
        actions={<FiltersButton count={f.count} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />}
      />
      {filtersOpen && <ReportFilters f={f} onClose={() => setFiltersOpen(false)} />}
      <FreshnessBanner freshness={freshness.data} />
      <ErrorNotice error={summary.error} />
      {summary.isLoading && <div className="card empty">Loading…</div>}
      {summary.data && <ExecutiveSummary s={summary.data} years={[]} trees={trees} />}
    </div>
  );
}
