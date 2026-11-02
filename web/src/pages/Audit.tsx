import { useQuery } from '@tanstack/react-query';
import { Fragment, ReactNode, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { Pagination, usePage } from '../components/Pagination';
import { FiltersButton } from '../components/ReportFilters';
import { Chevron, EmptyState, ErrorNotice, fmtDateTime, fmtNum, PageHeader, SortOrder, SortTh, todayStamp } from '../components/ui';


/** Activity filter options: [action prefix, friendly name]. The API matches actions by prefix. */
const ACTIVITY_GROUPS: [string, [string, string][]][] = [
  ['Field work', [
    ['tree.create', 'Tree registered'],
    ['observation.create', 'Observation recorded'],
    ['observation.amend', 'Observation corrected'],
    ['tree.update', 'Tree edited'],
    ['tree.id_correction', 'Tree ID corrected'],
    ['tree.replacement', 'Replacement'],
    ['conflict.', 'Conflicts'],
  ]],
  ['Project setup', [
    ['project.', 'Project changes'],
    ['planting_year.', 'Planting year changes'],
    ['sector.', 'Area changes: sectors'],
    ['sub_sector.', 'Area changes: sub-sectors'],
    ['areas.import', 'Area imports'],
    ['tree_id_scheme.', 'ID format changes'],
    ['custom_field.', 'Custom field changes'],
    ['serial_allocation.', 'Serial range changes'],
  ]],
  ['People & access', [
    ['user.', 'User changes'],
    ['assignment.', 'Assignment changes'],
    ['device.', 'Device changes'],
    ['auth.', 'Sign-ins'],
  ]],
  ['Reports', [['export.', 'Exports']]],
];

/** Verb phrase per action; `{x}` is replaced by the entity label (a link for trees and projects). */
const VERBS: Record<string, string> = {
  'tree.create': 'registered tree {x}',
  'tree.update': 'edited tree {x}',
  'tree.id_correction': 'corrected the ID of tree {x}',
  'tree.replacement': 'registered replacement tree {x}',
  'observation.create': 'recorded an observation on tree {x}',
  'observation.amend': 'corrected an observation on tree {x}',
  'project.create': 'created project {x}',
  'project.update': 'updated project {x}',
  'planting_year.create': 'added planting year {x}',
  'planting_year.update': 'updated planting year {x}',
  'tree_id_scheme.create': 'published a new tree ID format',
  'sector.create': 'added sector {x}',
  'sector.update': 'updated sector {x}',
  'sub_sector.create': 'added sub-sector {x}',
  'sub_sector.update': 'updated sub-sector {x}',
  'areas.import': 'imported sectors and sub-sectors',
  'custom_field.create': 'added custom field {x}',
  'custom_field.update': 'changed custom field {x}',
  'user.create': 'added user {x}',
  'user.update': 'updated user {x}',
  'assignment.create': 'assigned a user to a project scope',
  'assignment.revoke': 'revoked a project assignment',
  'serial_allocation.create': 'allocated a serial range',
  'serial_allocation.revoke': 'revoked a serial range',
  'conflict.create': 'raised a sync conflict on {x}',
  'conflict.resolve': 'resolved a sync conflict on {x}',
  'device.revoke': 'revoked a device',
  'export.csv': 'exported a CSV file',
  'export.xlsx': 'exported an Excel file',
  'auth.login': 'signed in',
};

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administrator', FIELD_OFFICER: 'Field officer', EXECUTIVE: 'Executive' };

function friendlyAction(action: string) {
  for (const [, opts] of ACTIVITY_GROUPS) {
    const exact = opts.find(([k]) => k === action);
    if (exact) return exact[1];
  }
  return action.replace(/[._]/g, ' ');
}

function sentenceParts(l: any): { verb: string; hasLabel: boolean } {
  const template = VERBS[l.action] ?? `${l.action.split('.').pop()?.replace(/_/g, ' ')} ${l.entity_type?.replace(/_/g, ' ') ?? ''} {x}`;
  const label = l.entity_label;
  if (template.includes('{x}') && !label) return { verb: template.replace(/\s*\{x\}/, '').replace(/ on$/, ''), hasLabel: false };
  return { verb: template, hasLabel: template.includes('{x}') };
}

function EntityLabel({ l }: { l: any }) {
  const label = String(l.entity_label);
  if (l.tree_id) return <Link className="mono" to={`/trees/${l.tree_id}`}>{label}</Link>;
  if (l.entity_type === 'project' && l.entity_id) return <Link to={`/projects/${l.entity_id}`}>{label}</Link>;
  return <strong>{label}</strong>;
}

function Sentence({ l }: { l: any }) {
  const { verb, hasLabel } = sentenceParts(l);
  const [pre, post] = hasLabel ? verb.split('{x}') : [verb, ''];
  return (
    <span className="audit-sentence">
      <span className="actor">{l.actor_name ?? 'System'}</span> {pre}
      {hasLabel && <EntityLabel l={l} />}
      {post}
    </span>
  );
}

const fmtWhen = (v: string) =>
  new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', year: new Date(v).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ before/after diff
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Flattens one level of nested objects (e.g. custom_fields.batch) so changes read field by field. */
function flatten(o: unknown): Record<string, unknown> {
  if (!isPlainObject(o)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (isPlainObject(v) && Object.keys(v).length > 0 && Object.keys(v).length <= 30 && k !== 'boundary') {
      for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = v2;
    } else out[k] = v;
  }
  return out;
}
function fmtValue(v: unknown): string {
  if (v === undefined) return '';
  if (v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 199) + '…' : v;
  const s = JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 199) + '…' : s;
}
function changes(l: any): { field: string; before: unknown; after: unknown }[] {
  const b = flatten(l.before);
  const a = flatten(l.after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: k, before: b[k], after: a[k] }));
}

function Details({ l }: { l: any }) {
  const rows = changes(l);
  const meta = isPlainObject(l.metadata) ? l.metadata : {};
  const metaRows: [string, ReactNode][] = [];
  if (meta.device_id) metaRows.push(['Device', <span className="mono">{String(meta.device_id)}</span>]);
  if (meta.operation_id) metaRows.push(['Sync operation', <span className="mono">{String(meta.operation_id)}</span>]);
  Object.entries(meta)
    .filter(([k]) => k !== 'device_id' && k !== 'operation_id')
    .forEach(([k, v]) => metaRows.push([k.replace(/_/g, ' '), fmtValue(v)]));
  metaRows.push(['Record', <span className="mono">{l.entity_type} {l.entity_id}</span>]);
  metaRows.push(['Logged at', fmtDateTime(l.created_at)]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="diff">
            <thead>
              <tr><th>Field</th><th>Before</th><th aria-hidden /><th>After</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field}>
                  <td className="mono">{r.field}</td>
                  <td className={r.before !== undefined ? 'before' : 'muted'}>{r.before === undefined ? '(not set)' : fmtValue(r.before)}</td>
                  <td aria-hidden className="muted">→</td>
                  <td className={r.after !== undefined ? 'after' : 'muted'}>{r.after === undefined ? '(removed)' : fmtValue(r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>No field values were recorded for this entry.</p>
      )}
      <dl className="kv">
        {metaRows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------ entries
const entityTypeLabel = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '');

function EntryTable({ rows, open, onToggle, th }: { rows: any[]; open: string | null; onToggle: (key: string) => void; th: (column: string, label: string, className?: string) => ReactNode }) {
  return (
    <table>
      <thead>
        <tr>
          <th className="expander" />
          {th('time', 'Time')}
          {th('user', 'Person')}
          {th('action', 'Action')}
          {th('entity', 'Entity', 'hide-sm')}
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const key = String(l.id);
          const isOpen = open === key;
          return (
            <Fragment key={key}>
              <tr className="clickable" onClick={() => onToggle(key)}>
                <td className="expander">
                  <button type="button" className="link" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={(e) => (e.stopPropagation(), onToggle(key))}>
                    <Chevron open={isOpen} />
                  </button>
                </td>
                <td className="nowrap" title={fmtDateTime(l.created_at)}>{fmtWhen(l.created_at)}</td>
                <td>
                  {l.actor_name ?? 'System'}
                  {l.actor_role && <div className="muted">{ROLE_LABEL[l.actor_role] ?? l.actor_role}</div>}
                </td>
                <td>
                  {friendlyAction(l.action)}
                  <div className="muted show-sm">{entityTypeLabel(l.entity_type)}{l.entity_label ? ` · ${l.entity_label}` : ''}</div>
                </td>
                <td className="hide-sm">
                  {l.entity_label ? <span onClick={(e) => e.stopPropagation()}><EntityLabel l={l} /></span> : <span className="muted">—</span>}
                  <div className="muted">{entityTypeLabel(l.entity_type)}{l.project_name ? ` · ${l.project_name}` : ''}</div>
                </td>
              </tr>
              {isOpen && (
                <tr className="details-row">
                  <td />
                  <td colSpan={4}>
                    <p style={{ margin: '0 0 10px' }}><Sentence l={l} /></p>
                    <Details l={l} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ page
const FILTER_KEYS = ['actor', 'action', 'entity', 'project', 'from', 'to'];
const SORTS = ['time', 'user', 'action', 'entity'];

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    // Any change other than paging starts again from the first page.
    if (!('offset' in changes)) next.delete('offset');
    next.delete('full'); // older links opened the full log with ?full=1
    setParams(next, { replace: true });
  };
  const set = (k: string, v: string) => update({ [k]: v });
  const [q, setQ] = useState(get('q'));
  // Keep the search box in step with the URL (back/forward, "Clear all").
  useEffect(() => setQ(get('q')), [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  const sort = SORTS.includes(get('sort')) ? get('sort') : 'time';
  const order: SortOrder = get('order') === 'asc' || get('order') === 'desc' ? (get('order') as SortOrder) : sort === 'time' ? 'desc' : 'asc';
  const page = usePage('', 50);
  const filter = {
    q: get('q'), actor_id: get('actor'), action: get('action'), entity_type: get('entity'), project_id: get('project'), from: get('from'), to: get('to'),
    sort, order,
  };
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const facets = useQuery({ queryKey: ['audit-facets'], queryFn: () => api.get<{ entity_types: string[]; actions: string[] }>('/audit-logs/facets') });
  const logs = useQuery({ queryKey: ['audit', filter, page.offset, page.limit], queryFn: () => api.get(`/audit-logs/search${qs({ ...filter, limit: page.limit, offset: page.offset })}`) });
  const rows: any[] = logs.data?.items ?? [];
  const total: number = logs.data?.total ?? 0;
  const actor = users.data?.find((u) => u.id === get('actor'));
  const filterCount = FILTER_KEYS.filter((k) => get(k)).length;
  const searching = filterCount > 0 || !!get('q');
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  // Actions the activity groups do not cover (e.g. new ones), so every action in the log can be chosen.
  const grouped = ACTIVITY_GROUPS.flatMap(([, opts]) => opts.map(([k]) => k));
  const otherActions = (facets.data?.actions ?? []).filter((a) => !grouped.some((k) => a.startsWith(k)));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportXlsx = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download(`/audit-logs.xlsx${qs(filter)}`, `audit-log-${todayStamp()}.xlsx`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };
  const onSort = (column: string, dir: SortOrder) => update({ sort: column === 'time' ? '' : column, order: dir });
  const th = (column: string, label: string, className?: string) => (
    <SortTh key={column} label={label} column={column} sort={sort} order={order} onSort={onSort} className={className} initial={column === 'time' ? 'desc' : 'asc'} />
  );

  return (
    <div>
      <PageHeader
        title={actor ? actor.full_name : 'Audit log'}
        crumbs={actor ? <button className="link" onClick={() => set('actor', '')}>← Everyone</button> : undefined}
        actions={
          <>
            {logs.data && <span className="pill">{fmtNum(total)}</span>}
            <button onClick={exportXlsx} disabled={exporting || total === 0}>{exporting ? 'Exporting…' : 'Export to Excel'}</button>
          </>
        }
      />
      <div className="toolbar">
        <form className="search" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
          <input
            type="search"
            aria-label="Search the audit log"
            placeholder="Search person, action, entity or details"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => q.trim() !== get('q') && set('q', q.trim())}
          />
        </form>
        <FiltersButton count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />
      </div>
      {filtersOpen && (
        <section className="card filter-panel" aria-label="Filters">
          <div className="filters" style={{ marginBottom: 0 }}>
            <label className="field">
              Person
              <select value={get('actor')} onChange={(e) => set('actor', e.target.value)}>
                <option value="">Everyone</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}{u.active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Action
              <select value={get('action')} onChange={(e) => set('action', e.target.value)}>
                <option value="">All activity</option>
                {ACTIVITY_GROUPS.map(([group, opts]) => (
                  <optgroup key={group} label={group}>
                    {opts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </optgroup>
                ))}
                {otherActions.length > 0 && (
                  <optgroup label="Other">
                    {otherActions.map((a) => <option key={a} value={a}>{friendlyAction(a)}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="field">
              Entity
              <select value={get('entity')} onChange={(e) => set('entity', e.target.value)}>
                <option value="">All entities</option>
                {(facets.data?.entity_types ?? []).map((t) => <option key={t} value={t}>{entityTypeLabel(t)}</option>)}
              </select>
            </label>
            <label className="field">
              Project
              <select value={get('project')} onChange={(e) => set('project', e.target.value)}>
                <option value="">All projects</option>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={clearAll} disabled={!searching}>Clear all</button>
            <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Done</button>
          </div>
        </section>
      )}
      <ErrorNotice error={logs.error ?? exportError} />
      <div className={`card table-wrap tall ${logs.isFetching && logs.data ? 'refetching' : ''}`}>
        {rows.length > 0 && <EntryTable rows={rows} open={open} onToggle={toggle} th={th} />}
        {logs.data && rows.length === 0 && (
          <EmptyState title={searching ? 'No entries match' : 'No entries yet'}>{searching ? 'Try other words, a wider date range or fewer filters.' : undefined}</EmptyState>
        )}
        {logs.isLoading && <div className="empty">Loading…</div>}
      </div>
      <Pagination page={page} total={total} label="audit entries" />
    </div>
  );
}
