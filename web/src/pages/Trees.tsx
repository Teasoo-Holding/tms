import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { ErrorNotice, fmtDate, fmtNum, RecordStatePill, StatusPill } from '../components/ui';

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

  return (
    <div>
      <div className="page-header">
        <h1>Trees</h1>
        <span className="muted">{trees.data ? `${fmtNum(trees.data.total)} matching` : ''}</span>
      </div>
      <form className="filters" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
        <label className="field">
          Tree ID
          <input type="search" placeholder="e.g. T4L-2024-000123" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => set('q', q.trim())} />
        </label>
        {select('project_id', 'Project', (projects.data ?? []).map((p) => [p.id, p.name]), 'All projects')}
        {select('planting_year_id', 'Planting year', (project.data?.planting_years ?? []).map((y: any) => [y.id, y.year_label]), 'All years', !projectId)}
        {select('sector_id', 'Sector', (areas.data ?? []).map((s) => [s.id, `${s.short_code} · ${s.name}`]), 'All sectors', !projectId)}
        {select('sub_sector_id', 'Sub-sector', subSectors.map((s: any) => [s.id, `${s.short_code} · ${s.name}`]), 'All sub-sectors', !get('sector_id'))}
        {select('species_id', 'Species', (species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]), 'All species')}
        {select('status_id', 'Current status', (statuses.data ?? []).map((s) => [s.id, s.name]), 'Any status')}
        {select('record_state', 'Record', [['CONFLICT', 'In conflict'], ['REJECTED', 'Rejected']], 'Registry (active)')}
      </form>
      <ErrorNotice error={trees.error} />
      <div className={`card table-wrap ${trees.isFetching ? 'refetching' : ''}`}>
        <table>
          <thead>
            <tr><th>Tree ID</th><th>Planting year</th><th>Area</th><th>Species</th><th>Status</th><th>Last observed</th><th>Replaces</th></tr>
          </thead>
          <tbody>
            {trees.data?.items.map((t: any) => (
              <tr key={t.id} className="clickable" onClick={() => navigate(`/trees/${t.id}`)}>
                <td className="mono">{t.physical_tree_id} <RecordStatePill state={t.record_state} /></td>
                <td>{t.year_label}</td>
                <td>{t.sector_code} / {t.sub_sector_code}</td>
                <td>{t.species_common_name ?? t.species_name}</td>
                <td><StatusPill code={t.status_code} name={t.status_name} /></td>
                <td>{fmtDate(t.last_observed_at)}</td>
                <td className="mono">{t.replaces_physical_id ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {trees.data?.items.length === 0 && <div className="empty">No trees match these filters.</div>}
      </div>
      {trees.data && trees.data.total > PAGE && (
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={offset === 0} onClick={() => set('offset', String(Math.max(0, offset - PAGE)))}>Previous</button>
          <span className="muted">{offset + 1}–{Math.min(offset + PAGE, trees.data.total)} of {fmtNum(trees.data.total)}</span>
          <button disabled={offset + PAGE >= trees.data.total} onClick={() => set('offset', String(offset + PAGE))}>Next</button>
        </div>
      )}
    </div>
  );
}
