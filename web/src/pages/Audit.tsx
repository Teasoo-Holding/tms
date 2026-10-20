import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { downloadCsv, EmptyState, ErrorNotice, fmtDateTime, PageHeader } from '../components/ui';

const PAGE = 100;

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
  'export.csv': 'exported trees as CSV',
  'export.xlsx': 'exported trees as Excel',
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

// ------------------------------------------------------------------ page
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const [open, setOpen] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const filter = { actor_id: get('actor'), action: get('action'), project_id: get('project'), from: get('from'), to: get('to') };
  const logs = useInfiniteQuery({
    queryKey: ['audit', filter],
    initialPageParam: undefined as string | number | undefined,
    queryFn: ({ pageParam }) => api.get<any[]>(`/audit-logs${qs({ ...filter, before_id: pageParam, limit: PAGE })}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = logs.data?.pages.flat() ?? [];
  const filtered = Object.values(filter).some(Boolean);
  const actor = users.data?.find((u) => u.id === get('actor'));

  const exportCsv = () =>
    downloadCsv(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Time', 'Person', 'Role', 'Activity', 'Action', 'Entity type', 'Entity', 'Entity ID', 'Tree ID', 'Project', 'Device ID', 'Operation ID', 'Changed fields'],
      rows.map((l) => [
        new Date(l.created_at).toISOString(),
        l.actor_name ?? 'System',
        ROLE_LABEL[l.actor_role] ?? l.actor_role ?? '',
        friendlyAction(l.action),
        l.action,
        l.entity_type,
        l.entity_label ?? '',
        l.entity_id ?? '',
        l.tree_id ?? '',
        l.project_name ?? '',
        l.metadata?.device_id ?? '',
        l.metadata?.operation_id ?? '',
        changes(l).map((c) => c.field).join('; '),
      ]),
    );

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={actor ? <>Everything <strong>{actor.full_name}</strong> did in the system, newest first.</> : 'Who did what and when: field work, setup changes and access. Entries cannot be edited or deleted.'}
        actions={<button onClick={exportCsv} disabled={rows.length === 0}>Export CSV{rows.length ? ` (${rows.length})` : ''}</button>}
      />
      <div className="filters">
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
          Activity
          <select value={get('action')} onChange={(e) => set('action', e.target.value)}>
            <option value="">All activity</option>
            {ACTIVITY_GROUPS.map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          Project
          <select value={get('project')} onChange={(e) => set('project', e.target.value)}>
            <option value="">All projects</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ minWidth: 140 }}>
          From
          <input type="date" value={get('from')} max={get('to') || undefined} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="field" style={{ minWidth: 140 }}>
          To
          <input type="date" value={get('to')} min={get('from') || undefined} onChange={(e) => set('to', e.target.value)} />
        </label>
        {filtered && <button type="button" className="link" style={{ marginBottom: 8 }} onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>}
      </div>
      <ErrorNotice error={logs.error} />
      <div className={`card table-wrap tall ${logs.isFetching && !logs.isFetchingNextPage ? 'refetching' : ''}`}>
        <table>
          <thead>
            <tr><th>Activity</th><th>When</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const key = String(l.id);
              const meta = [l.project_name, l.actor_role && ROLE_LABEL[l.actor_role], friendlyAction(l.action)].filter(Boolean);
              return (
                <Fragment key={key}>
                  <tr>
                    <td>
                      <Sentence l={l} />
                      <div className="muted">{meta.join(' · ')}</div>
                    </td>
                    <td className="nowrap" title={fmtDateTime(l.created_at)}>{fmtWhen(l.created_at)}</td>
                    <td className="nowrap">
                      <button className="link" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                        {open === key ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {open === key && (
                    <tr>
                      <td colSpan={3} className="details-cell">
                        <Details l={l} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !logs.isLoading && (
          <EmptyState title={filtered ? 'No entries match these filters' : 'No entries yet'}>{filtered ? 'Try a wider date range or another activity type.' : undefined}</EmptyState>
        )}
        {logs.isLoading && <div className="empty">Loading…</div>}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        {logs.hasNextPage && (
          <button onClick={() => logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>
            {logs.isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        )}
        {rows.length > 0 && <span className="muted">{rows.length} entries loaded{logs.hasNextPage ? '' : ' (all)'}</span>}
      </div>
    </div>
  );
}
