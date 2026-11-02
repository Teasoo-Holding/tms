import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiltersButton } from '../components/ReportFilters';
import { api, qs } from '../api/client';
import { sectorLabel, subSectorLabel } from '../areaLabels';
import { Pagination, usePage } from '../components/Pagination';
import { ActiveFilter, EmptyState, ErrorNotice, FilterChips, fmtDate, fmtNum, PageHeader, RecordStatePill, SortOrder, SortTh, StatusBadge } from '../components/ui';

const FILTER_KEYS = ['project_id', 'planting_year_id', 'sector_id', 'sub_sector_id', 'species_id', 'status_id', 'record_state'];
/** Keys cleared when a parent filter changes: each planting year has its own survey, so its sectors differ. */
const DEPENDENTS: Record<string, string[]> = {
  project_id: ['planting_year_id', 'sector_id', 'sub_sector_id'],
  planting_year_id: ['sector_id', 'sub_sector_id'],
  sector_id: ['sub_sector_id'],
};
/** Sortable columns (the API's whitelist); the list is sorted on the server, across every page. */
const SORTS = ['tree_id', 'planting_year', 'area', 'species', 'status', 'last_observed'];

export function TreesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
      (DEPENDENTS[k] ?? []).forEach((d) => next.delete(d));
    }
    if (!('offset' in changes)) next.delete('offset');
    setParams(next, { replace: true });
  };
  const set = (k: string, v: string) => update({ [k]: v });
  const [q, setQ] = useState(get('q'));
  // Keep the search box in step with the URL (back/forward, links).
  useEffect(() => setQ(get('q')), [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filtersOpen, setFiltersOpen] = useState(false);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  // With a single project there is nothing to choose: its years and areas are offered straight away.
  const onlyProject = projects.data?.length === 1 ? projects.data[0].id : '';
  const areaProject = get('project_id') || onlyProject;
  const project = useQuery({ queryKey: ['project', areaProject], queryFn: () => api.get(`/projects/${areaProject}`), enabled: !!areaProject });
  const areas = useQuery({ queryKey: ['areas', areaProject], queryFn: () => api.get<any[]>(`/projects/${areaProject}/areas`), enabled: !!areaProject });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  const page = usePage('', 50);
  const sort = SORTS.includes(get('sort')) ? get('sort') : 'tree_id';
  const order: SortOrder = get('order') === 'desc' ? 'desc' : 'asc';
  const filter = qs({
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])),
    q: get('q'), sort: sort === 'tree_id' ? '' : sort, order: order === 'asc' ? '' : order, limit: page.limit, offset: page.offset,
  });
  const trees = useQuery({ queryKey: ['trees', filter], queryFn: () => api.get(`/trees${filter}`) });

  const yearId = get('planting_year_id');
  const sectorId = get('sector_id');
  const years: any[] = project.data?.planting_years ?? [];
  const yearLabel = new Map(years.map((y) => [y.id as string, y.year_label as string]));
  // A year's survey, plus older areas not tied to a year (which serve every year). Without a year, the year tells
  // apart sectors that share a code.
  const sectors = (areas.data ?? []).filter((s) => !yearId || s.planting_year_id === yearId || s.planting_year_id == null);
  const sector = sectors.find((s) => s.id === sectorId);
  const sectorOption = (s: any) => `${sectorLabel(s)}${!yearId && s.planting_year_id ? ` (${yearLabel.get(s.planting_year_id) ?? 'other year'})` : ''}`;
  const subSectors: any[] = sector?.sub_sectors ?? [];
  const needsProject = !areaProject;

  /** A compact select for the filter bar: the "All …" option names the filter, the aria-label says it in full. */
  const inline = (k: string, label: string, options: [string, string][], all: string, disabled = false, hint?: string) => (
    <select aria-label={label} title={disabled && hint ? hint : label} value={get(k)} onChange={(e) => set(k, e.target.value)} disabled={disabled}>
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const select = (k: string, label: string, options: [string, string][], all: string) => (
    <label className="field">
      {label}
      <select value={get(k)} onChange={(e) => set(k, e.target.value)}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  // Project is chosen first when there are several: years and areas belong to one project.
  const manyProjects = (projects.data?.length ?? 0) > 1;
  const moreKeys = manyProjects ? ['record_state'] : ['project_id', 'record_state'];
  const moreCount = moreKeys.filter((k) => get(k)).length;
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    [...FILTER_KEYS, 'q', 'offset'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };
  const onSort = (column: string, dir: SortOrder) => update({ sort: column === 'tree_id' ? '' : column, order: dir === 'asc' ? '' : dir });
  const th = (column: string, label: string, className?: string, initial?: SortOrder) => (
    <SortTh label={label} column={column} sort={sort} order={order} onSort={onSort} className={className} initial={initial} />
  );

  // Active filters as chips, named the way the selects show them.
  const nameOf = (list: any[] | undefined, id: string, fmt: (x: any) => string) => {
    const x = list?.find((i) => i.id === id);
    return x ? fmt(x) : '…';
  };
  const chip = (key: string, label: string, value: string): ActiveFilter | null => (get(key) ? { key, label, value, onClear: () => set(key, '') } : null);
  const chips = [
    chip('q', 'Tree ID', get('q')),
    chip('project_id', 'Project', nameOf(projects.data, get('project_id'), (p) => p.name)),
    chip('planting_year_id', 'Planting year', yearLabel.get(yearId) ?? '…'),
    chip('sector_id', 'Sector', sector ? sectorLabel(sector) : '…'),
    chip('sub_sector_id', 'Sub-sector', nameOf(subSectors, get('sub_sector_id'), (s) => subSectorLabel(sector?.short_code, s.short_code, s.name))),
    chip('species_id', 'Species', nameOf(species.data, get('species_id'), (s) => s.common_name ?? s.scientific_name)),
    chip('status_id', 'Status', nameOf(statuses.data, get('status_id'), (s) => s.name)),
    chip('record_state', 'Record', get('record_state') === 'CONFLICT' ? 'In conflict' : 'Rejected'),
  ].filter((c): c is ActiveFilter => !!c);
  const total: number = trees.data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Trees" actions={trees.data && <span className="pill">{fmtNum(total)}</span>} />
      <div className="filter-bar">
        <form className="search" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
          <input type="search" aria-label="Search by tree ID" placeholder="Search tree ID" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== get('q') && set('q', q.trim())} />
        </form>
        <div className="inline-filters" role="group" aria-label="Filters">
          {manyProjects && inline('project_id', 'Project', (projects.data ?? []).map((p) => [p.id, p.name]), 'All projects')}
          {inline('status_id', 'Current status', (statuses.data ?? []).map((s) => [s.id, s.active === false ? `${s.name} (old)` : s.name]), 'Any status')}
          {inline('planting_year_id', 'Planting year', years.map((y) => [y.id, y.year_label]), 'All years', needsProject, 'Choose a project first')}
          {inline('sector_id', 'Sector', sectors.map((s) => [s.id, sectorOption(s)]), 'All sectors', needsProject, 'Choose a project first')}
          {inline('sub_sector_id', 'Sub-sector', subSectors.map((s) => [s.id, subSectorLabel(sector?.short_code, s.short_code, s.name)]), 'All sub-sectors', !sector, 'Choose a sector first')}
          {inline('species_id', 'Species', (species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]), 'All species')}
        </div>
        <FiltersButton count={moreCount} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} label="More filters" />
      </div>
      {filtersOpen && (
        <section className="card filter-panel" aria-label="More filters">
          <div className="filters" style={{ marginBottom: 0 }}>
            {!manyProjects && select('project_id', 'Project', (projects.data ?? []).map((p) => [p.id, p.name]), 'All projects')}
            {select('record_state', 'Record', [['CONFLICT', 'In conflict'], ['REJECTED', 'Rejected']], 'Registry (active)')}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Done</button>
          </div>
        </section>
      )}
      <FilterChips filters={chips} onClearAll={clearFilters} />
      <ErrorNotice error={trees.error} />
      <div className={`card table-wrap tall ${trees.isFetching ? 'refetching' : ''}`}>
        {!!trees.data?.items.length && (
          <table>
            <thead>
              <tr>
                {th('tree_id', 'Tree ID')}
                {th('status', 'Status')}
                {th('species', 'Species', 'hide-sm')}
                {th('area', 'Area', 'hide-sm')}
                {th('planting_year', 'Planting year', 'hide-sm', 'desc')}
                {th('last_observed', 'Last visit', 'hide-sm', 'desc')}
              </tr>
            </thead>
            <tbody>
              {trees.data.items.map((t: any) => {
                const area = subSectorLabel(t.sector_code, t.sub_sector_code, t.sub_sector_name);
                return (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/trees/${t.id}`)}>
                    <td className="mono">
                      <Link to={`/trees/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.physical_tree_id}</Link> <RecordStatePill state={t.record_state} />
                      <div className="muted show-sm">{t.species_common_name ?? t.species_name} · {area}</div>
                    </td>
                    <td><StatusBadge code={t.status_code} name={t.status_name} terminal={t.status_terminal} /></td>
                    <td className="hide-sm">{t.species_common_name ?? t.species_name}</td>
                    <td className="hide-sm">{area}</td>
                    <td className="hide-sm nowrap">{t.year_label}</td>
                    <td className="hide-sm nowrap">{t.last_observed_at ? fmtDate(t.last_observed_at) : <span className="muted">Never</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {trees.data?.items.length === 0 && <EmptyState title="No trees found">{chips.length ? 'Clear a filter or check the tree ID.' : undefined}</EmptyState>}
        {trees.isLoading && <div className="empty">Loading…</div>}
      </div>
      <Pagination page={page} total={total} label="trees" />
    </div>
  );
}
