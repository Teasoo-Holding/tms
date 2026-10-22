import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiltersButton } from '../components/ReportFilters';
import { api, qs } from '../api/client';
import { EmptyState, ErrorNotice, fmtNum, PageHeader, RecordStatePill, StatusPill } from '../components/ui';

const PAGE = 50;

export function TreesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'offset') next.delete('offset');
    if (k === 'project_id') ['planting_year_id', 'sector_id', 'sub_sector_id'].forEach((x) => next.delete(x));
    if (k === 'sector_id') next.delete('sub_sector_id');
    setParams(next, { replace: true });
  };
  const [q, setQ] = useState(get('q'));
  // Keep the search box in step with the URL (back/forward, links).
  useEffect(() => setQ(get('q')), [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filtersOpen, setFiltersOpen] = useState(false);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const projectId = get('project_id');
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get(`/projects/${projectId}`), enabled: !!projectId });
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`), enabled: !!projectId });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  const filter = qs({
    project_id: projectId, planting_year_id: get('planting_year_id'), sector_id: get('sector_id'), sub_sector_id: get('sub_sector_id'),
    species_id: get('species_id'), status_id: get('status_id'), record_state: get('record_state'), q: get('q'), limit: PAGE, offset: get('offset') || 0,
  });
  const trees = useQuery({ queryKey: ['trees', filter], queryFn: () => api.get(`/trees${filter}`) });
  const offset = Number(get('offset') || 0);
  const subSectors = areas.data?.find((s) => s.id === get('sector_id'))?.sub_sectors ?? [];

  const select = (k: string, label: string, options: [string, string][], all: string, disabled = false) => (
    <label className="field">
      {label}
      <select value={get(k)} onChange={(e) => set(k, e.target.value)} disabled={disabled}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  const filterKeys = ['project_id', 'planting_year_id', 'sector_id', 'sub_sector_id', 'species_id', 'status_id', 'record_state'];
  const filterCount = filterKeys.filter((k) => get(k)).length;
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    [...filterKeys, 'offset'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Trees" actions={trees.data && <span className="pill">{fmtNum(trees.data.total)}</span>} />
      <div className="toolbar">
        <form className="search" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
          <input type="search" aria-label="Search by tree ID" placeholder="Search tree ID" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== get('q') && set('q', q.trim())} />
        </form>
        <FiltersButton count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />
      </div>
      {filtersOpen && (
        <section className="card filter-panel">
          <div className="filters" style={{ marginBottom: 0 }}>
            {select('project_id', 'Project', (projects.data ?? []).map((p) => [p.id, p.name]), 'All projects')}
            {select('planting_year_id', 'Planting year', (project.data?.planting_years ?? []).map((y: any) => [y.id, y.year_label]), 'All years', !projectId)}
            {select('sector_id', 'Sector', (areas.data ?? []).map((s) => [s.id, `${s.short_code} · ${s.name}`]), 'All sectors', !projectId)}
            {select('sub_sector_id', 'Sub-sector', subSectors.map((s: any) => [s.id, `${s.short_code} · ${s.name}`]), 'All sub-sectors', !get('sector_id'))}
            {select('species_id', 'Species', (species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]), 'All species')}
            {select('status_id', 'Current status', (statuses.data ?? []).map((s) => [s.id, s.name]), 'Any status')}
            {select('record_state', 'Record', [['CONFLICT', 'In conflict'], ['REJECTED', 'Rejected']], 'Registry (active)')}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={clearFilters} disabled={!filterCount}>Clear all</button>
            <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Done</button>
          </div>
        </section>
      )}
      <ErrorNotice error={trees.error} />
      <div className={`card table-wrap tall ${trees.isFetching ? 'refetching' : ''}`}>
        {!!trees.data?.items.length && (
          <table>
            <thead>
              <tr><th>Tree ID</th><th>Status</th><th className="hide-sm">Species</th><th className="hide-sm">Area</th></tr>
            </thead>
            <tbody>
              {trees.data.items.map((t: any) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/trees/${t.id}`)}>
                  <td className="mono">
                    <Link to={`/trees/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.physical_tree_id}</Link> <RecordStatePill state={t.record_state} />
                    <div className="muted show-sm">{t.species_common_name ?? t.species_name} · {t.sector_code}/{t.sub_sector_code}</div>
                  </td>
                  <td><StatusPill code={t.status_code} name={t.status_name} /></td>
                  <td className="hide-sm">{t.species_common_name ?? t.species_name}</td>
                  <td className="hide-sm nowrap">{t.sector_code} / {t.sub_sector_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {trees.data?.items.length === 0 && <EmptyState title="No trees found">{filterCount || get('q') ? 'Clear a filter or check the tree ID.' : undefined}</EmptyState>}
        {trees.isLoading && <div className="empty">Loading…</div>}
      </div>
      {trees.data && trees.data.total > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => set('offset', String(Math.max(0, offset - PAGE)))}>Previous</button>
          <span className="muted">{offset + 1}–{Math.min(offset + PAGE, trees.data.total)} of {fmtNum(trees.data.total)}</span>
          <button disabled={offset + PAGE >= trees.data.total} onClick={() => set('offset', String(offset + PAGE))}>Next</button>
        </div>
      )}
    </div>
  );
}
