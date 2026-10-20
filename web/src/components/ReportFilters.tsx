import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

/** Filter keys shared by the dashboard summary, its exports and the visits table. */
export const REPORT_FILTER_KEYS = ['project_id', 'planting_year_id', 'sector_id', 'sub_sector_id', 'species_id', 'status_id', 'from', 'to', 'overdue_days'] as const;
export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number];

/** Keys cleared when a parent filter changes. */
const DEPENDENTS: Record<string, string[]> = {
  project_id: ['planting_year_id', 'sector_id', 'sub_sector_id'],
  sector_id: ['sub_sector_id'],
};

/**
 * Report filters kept in the URL search params, so a filtered view is a shareable link.
 * `extraKeys` are page-specific filters (e.g. recorded_by, q) that reset along with the rest.
 */
export function useReportFilters(extraKeys: string[] = []) {
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
  const allKeys = [...REPORT_FILTER_KEYS, ...extraKeys];
  const reset = () => {
    const next = new URLSearchParams(params);
    [...allKeys, 'offset'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };
  const values = Object.fromEntries(allKeys.map((k) => [k, get(k)])) as Record<string, string>;
  const active = allKeys.some((k) => !!get(k));
  return { get, set, update, reset, values, active };
}
export type ReportFiltersState = ReturnType<typeof useReportFilters>;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function presetRange(preset: string): { from: string; to: string } {
  const today = new Date();
  if (preset === 'year') return { from: `${today.getFullYear()}-01-01`, to: isoDay(today) };
  if (preset === 'all') return { from: '', to: '' };
  const days = Number(preset);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: isoDay(start), to: isoDay(today) };
}
const PRESETS: [string, string][] = [['7', 'Last 7 days'], ['30', '30 days'], ['90', '90 days'], ['year', 'This year'], ['all', 'All time']];

export function ReportFilters({ f, showOverdue = false, dateNote, children }: {
  f: ReportFiltersState;
  /** Show the "overdue after" selector (dashboard only). */
  showOverdue?: boolean;
  /** One-line explanation of what the date range filters. */
  dateNote: ReactNode;
  /** Page-specific filters, appended to the bar. */
  children?: ReactNode;
}) {
  const projectId = f.get('project_id');
  const sectorId = f.get('sector_id');
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get(`/projects/${projectId}`), enabled: !!projectId });
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`), enabled: !!projectId });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  const subSectors: any[] = areas.data?.find((s) => s.id === sectorId)?.sub_sectors ?? [];
  const from = f.get('from');
  const to = f.get('to');
  const activePreset = PRESETS.find(([k]) => {
    const r = presetRange(k);
    return r.from === from && r.to === to;
  })?.[0];

  const select = (k: string, label: string, options: [string, string][], all: string, disabled = false) => (
    <label className="field">
      {label}
      <select value={f.get(k)} onChange={(e) => f.set(k, e.target.value)} disabled={disabled}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="filters" style={{ marginBottom: 0 }}>
        {select('project_id', 'Project', (projects.data ?? []).map((p) => [p.id, p.name]), 'All my projects')}
        {select('planting_year_id', 'Planting year', (project.data?.planting_years ?? []).map((y: any) => [y.id, y.year_label]), 'All years', !projectId)}
        {select('sector_id', 'Sector', (areas.data ?? []).map((s) => [s.id, `${s.short_code} · ${s.name}`]), 'All sectors', !projectId)}
        {select('sub_sector_id', 'Sub-sector', subSectors.map((s) => [s.id, `${s.short_code} · ${s.name}`]), 'All sub-sectors', !sectorId)}
        {select('species_id', 'Species', (species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]), 'All species')}
        {select(
          'status_id',
          'Current status',
          (statuses.data ?? []).map((s) => [s.id, s.active === false ? `${s.name} (old)` : s.name]),
          'Any status',
        )}
        <label className="field" style={{ minWidth: 0 }}>
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => f.set('from', e.target.value)} />
        </label>
        <label className="field" style={{ minWidth: 0 }}>
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => f.set('to', e.target.value)} />
        </label>
        {showOverdue && (
          <label className="field">
            Overdue after
            <select value={f.get('overdue_days') || '90'} onChange={(e) => f.set('overdue_days', e.target.value === '90' ? '' : e.target.value)}>
              {[30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d} days without observation</option>
              ))}
            </select>
          </label>
        )}
        {children}
        <button type="button" onClick={f.reset} disabled={!f.active}>Reset filters</button>
      </div>
      <div className="row" role="group" aria-label="Date range presets">
        <span className="muted">Period:</span>
        {PRESETS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={activePreset === k ? 'primary' : ''}
            aria-pressed={activePreset === k}
            style={{ padding: '3px 10px', fontSize: 13 }}
            onClick={() => f.update(presetRange(k))}
          >
            {label}
          </button>
        ))}
        <span className="muted">{dateNote}</span>
      </div>
    </div>
  );
}
