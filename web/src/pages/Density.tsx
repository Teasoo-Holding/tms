import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { DensityReport, DensityView } from '../components/DensityMap';
import { EmptyState, ErrorNotice, fmtDateTime, PageHeader } from '../components/ui';

/** "All years" in the year filter; surveys of different years can overlap, so a year is chosen by default. */
const ALL_YEARS = 'all';

/** Tree density map for administrators and executives: one project, one planting year's survey at a time. */
export function DensityPage() {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const projectId = params.get('project_id') || projects.data?.[0]?.id || '';
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get(`/projects/${projectId}`), enabled: !!projectId });
  const years: any[] = project.data?.planting_years ?? [];
  // The latest open year, else the latest year: the survey most likely being planted.
  const defaultYear = [...years].reverse().find((y) => y.active) ?? years[years.length - 1];
  const yearParam = params.get('planting_year_id');
  const yearId = yearParam === ALL_YEARS ? '' : years.some((y) => y.id === yearParam) ? yearParam! : defaultYear?.id ?? '';
  const ready = !!projectId && !!project.data;
  const filter = qs({ project_id: projectId, planting_year_id: yearId });
  const report = useQuery({ queryKey: ['density', filter], queryFn: () => api.get<DensityReport>(`/reports/density${filter}`), enabled: ready });

  return (
    <div className="stack">
      <PageHeader title="Density map" subtitle={report.data ? `Updated ${fmtDateTime(report.data.generated_at)}` : undefined} />
      <section className="card filter-panel" aria-label="Filters">
        <div className="filters" style={{ marginBottom: 0 }}>
          <label className="field">
            Project
            <select value={projectId} onChange={(e) => set({ project_id: e.target.value, planting_year_id: '' })} disabled={!projects.data?.length}>
              {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            Planting year
            <select value={yearId || ALL_YEARS} onChange={(e) => set({ planting_year_id: e.target.value })} disabled={years.length === 0}>
              {years.map((y) => <option key={y.id} value={y.id}>{y.year_label}{y.active ? '' : ' (closed)'}</option>)}
              <option value={ALL_YEARS}>All years</option>
            </select>
          </label>
        </div>
      </section>
      <ErrorNotice error={projects.error ?? project.error ?? report.error} />
      {projects.data?.length === 0 && <EmptyState title="No projects yet" />}
      {report.isLoading && <div className="card empty">Loading…</div>}
      {report.data && (
        <div className={report.isFetching ? 'refetching' : undefined}>
          <DensityView report={report.data} />
        </div>
      )}
    </div>
  );
}
