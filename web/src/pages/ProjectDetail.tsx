import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { AreaMap, MapArea } from '../components/AreaMap';
import { ActivePill, clean, ErrorNotice, Field, fmtDate, fmtDateTime, Modal, Tabs, useForm } from '../components/ui';
import { COMPONENTS, previewId, SCOPES, scopeLabel } from '../idscheme';
import { ProjectForm } from './Projects';

type Tab = 'areas' | 'years' | 'schemes' | 'assignments' | 'serials';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<Tab>('areas');
  const [editing, setEditing] = useState(false);
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`) });
  const p = project.data;
  if (project.error) return <ErrorNotice error={project.error} />;
  if (!p) return null;
  const tabs: [Tab, string][] = [
    ['areas', 'Sectors & sub-sectors'],
    ['years', 'Planting years'],
    ['schemes', 'Tree ID format'],
  ];
  if (isAdmin) tabs.push(['assignments', 'Assignments'], ['serials', 'Serial ranges']);
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{p.name}</h1>
          <div className="subtle">
            <span className="mono">{p.short_code}</span> · {p.status.toLowerCase()} · {p.location ?? 'no location'} · IDs unique{' '}
            {p.physical_id_uniqueness === 'GLOBAL' ? 'across all projects' : 'within project'}
          </div>
        </div>
        <span className="spacer" />
        {isAdmin && <button onClick={() => setEditing(true)}>Edit project</button>}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'areas' && <AreasTab projectId={p.id} />}
      {tab === 'years' && <YearsTab project={p} />}
      {tab === 'schemes' && <SchemesTab project={p} />}
      {tab === 'assignments' && <AssignmentsTab projectId={p.id} />}
      {tab === 'serials' && <SerialsTab project={p} />}
      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ areas
function AreasTab({ projectId }: { projectId: string }) {
  const isAdmin = useIsAdmin();
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const [form, setForm] = useState<{ kind: 'sector' | 'sub_sector'; area?: any; sectorId?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [highlight, setHighlight] = useState<string>();
  const mapAreas: MapArea[] = useMemo(
    () => (areas.data ?? []).flatMap((s) => [{ ...s, kind: 'sector' as const }, ...s.sub_sectors.map((ss: any) => ({ ...ss, kind: 'sub_sector' as const }))]),
    [areas.data],
  );
  const exportGeoJson = async () => {
    const data = await api.get(`/projects/${projectId}/areas.geojson`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'areas.geojson' }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <div className="notice">
        Reference points and boundaries describe <strong>areas</strong>. Trees are assigned to a sub-sector and have no individual GPS position.
      </div>
      <AreaMap areas={mapAreas} highlightId={highlight} />
      <div className="row">
        {isAdmin && <button className="primary" onClick={() => setForm({ kind: 'sector' })}>Add sector</button>}
        {isAdmin && <button onClick={() => setImporting(true)}>Import GeoJSON</button>}
        <button onClick={exportGeoJson}>Export GeoJSON</button>
      </div>
      <ErrorNotice error={areas.error} />
      {areas.data?.map((s) => (
        <section className="card" key={s.id}>
          <div className="page-header" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>
              <span className="mono">{s.short_code}</span> · {s.name}
            </h2>
            <ActivePill active={s.active} />
            <span className="muted">
              ref. {s.reference_latitude}, {s.reference_longitude} · {s.boundary ? 'boundary set' : 'no boundary'}
            </span>
            <span className="spacer" />
            {isAdmin && <button onClick={() => setForm({ kind: 'sector', area: s })}>Edit</button>}
            {isAdmin && <button onClick={() => setForm({ kind: 'sub_sector', sectorId: s.id })}>Add sub-sector</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Sub-sector</th><th>Reference point</th><th>Boundary</th><th>State</th><th /></tr>
              </thead>
              <tbody>
                {s.sub_sectors.map((ss: any) => (
                  <tr key={ss.id} onMouseEnter={() => setHighlight(ss.id)} onMouseLeave={() => setHighlight(undefined)}>
                    <td><span className="mono">{ss.short_code}</span> · {ss.name}</td>
                    <td className="mono">{ss.reference_latitude}, {ss.reference_longitude}</td>
                    <td>{ss.boundary ? 'Polygon' : '—'}</td>
                    <td><ActivePill active={ss.active} /></td>
                    <td>{isAdmin && <button className="link" onClick={() => setForm({ kind: 'sub_sector', area: ss, sectorId: s.id })}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.sub_sectors.length === 0 && <div className="empty">No sub-sectors yet.</div>}
          </div>
        </section>
      ))}
      {areas.data?.length === 0 && <div className="card empty">No sectors yet. Add one or import a GeoJSON file.</div>}
      {form && <AreaForm projectId={projectId} {...form} onClose={() => setForm(null)} />}
      {importing && <ImportForm projectId={projectId} onClose={() => setImporting(false)} />}
    </div>
  );
}

function AreaForm({ projectId, kind, area, sectorId, onClose }: { projectId: string; kind: 'sector' | 'sub_sector'; area?: any; sectorId?: string; onClose: () => void }) {
  const f = useForm({
    name: area?.name ?? '',
    short_code: area?.short_code ?? '',
    description: area?.description ?? '',
    reference_latitude: area?.reference_latitude?.toString() ?? '',
    reference_longitude: area?.reference_longitude?.toString() ?? '',
    boundary: area?.boundary ? JSON.stringify(area.boundary) : '',
    active: area?.active ?? true,
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      let boundary = null;
      if (f.values.boundary.trim()) {
        try {
          const parsed = JSON.parse(f.values.boundary);
          boundary = parsed.type === 'Feature' ? parsed.geometry : parsed;
        } catch {
          setParseError('The boundary is not valid JSON. Paste a GeoJSON Polygon.');
          throw new Error('invalid');
        }
      }
      setParseError(null);
      const body = {
        ...clean({ name: f.values.name, short_code: f.values.short_code, description: f.values.description }),
        reference_latitude: Number(f.values.reference_latitude),
        reference_longitude: Number(f.values.reference_longitude),
        boundary,
        active: f.values.active,
      };
      if (area) return api.patch(`/${kind === 'sector' ? 'sectors' : 'sub-sectors'}/${area.id}`, body);
      return kind === 'sector' ? api.post(`/projects/${projectId}/sectors`, body) : api.post(`/sectors/${sectorId}/sub-sectors`, body);
    },
    onSuccess: onClose,
  });
  const label = kind === 'sector' ? 'sector' : 'sub-sector';
  return (
    <Modal title={`${area ? 'Edit' : 'New'} ${label}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        {parseError ? <div className="notice error">{parseError}</div> : <ErrorNotice error={save.error} />}
        <div className="form-grid">
          <Field label="Name"><input required {...f.bind('name')} /></Field>
          <Field label="Short code" hint="may appear in tree IDs"><input required maxLength={16} {...f.bind('short_code')} /></Field>
          <Field label="Reference latitude" hint="WGS 84"><input required type="number" step="0.000001" min={-90} max={90} {...f.bind('reference_latitude')} /></Field>
          <Field label="Reference longitude" hint="WGS 84"><input required type="number" step="0.000001" min={-180} max={180} {...f.bind('reference_longitude')} /></Field>
        </div>
        <Field label="Description"><input {...f.bind('description')} /></Field>
        <Field label="Boundary" hint="optional GeoJSON Polygon, lon/lat">
          <textarea className="mono" placeholder='{"type":"Polygon","coordinates":[[[3.90,7.40],[3.91,7.40],[3.91,7.41],[3.90,7.41],[3.90,7.40]]]}' {...f.bind('boundary')} />
        </Field>
        {kind === 'sub_sector' && <p className="muted" style={{ margin: 0 }}>A sub-sector boundary must lie within its sector’s boundary.</p>}
        <label className="check"><input type="checkbox" {...f.bindCheck('active')} /> Active (selectable for new registrations)</label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (body: unknown) => api.post(`/projects/${projectId}/areas/import`, body), onSuccess: onClose });
  const submit = () => {
    try {
      setError(null);
      save.mutate(JSON.parse(text));
    } catch {
      setError('The file is not valid JSON.');
    }
  };
  return (
    <Modal title="Import sectors and sub-sectors" onClose={onClose} wide>
      <div className="stack">
        <p className="subtle" style={{ margin: 0 }}>
          A GeoJSON FeatureCollection of Polygon features. Each feature needs <code>properties.kind</code> (<code>sector</code> or <code>sub_sector</code>),{' '}
          <code>short_code</code> and <code>name</code>; sub-sectors also need <code>sector_code</code>. The reference point defaults to a point inside the polygon. The import is
          all-or-nothing.
        </p>
        <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={async (e) => setText((await e.target.files?.[0]?.text()) ?? '')} />
        <textarea className="mono" style={{ minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste GeoJSON here" />
        {error ? <div className="notice error">{error}</div> : <ErrorNotice error={save.error} />}
        {save.data && <div className="notice">Imported {save.data.created} areas.</div>}
        <div className="form-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!text || save.isPending}>Import</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ planting years
function YearsTab({ project }: { project: any }) {
  const isAdmin = useIsAdmin();
  const f = useForm({ year_label: '', start_date: '', end_date: '' });
  const create = useMutation({ mutationFn: () => api.post(`/projects/${project.id}/planting-years`, clean(f.values)), onSuccess: () => f.setValues({ year_label: '', start_date: '', end_date: '' }) });
  const toggle = useMutation({ mutationFn: (y: any) => api.patch(`/planting-years/${y.id}`, { active: !y.active }) });
  return (
    <div className="stack">
      <p className="subtle" style={{ margin: 0 }}>
        Officers pick the planting year explicitly; it is never inferred from the registration date. Inactive years stay visible and can be used by administrators for back-entry.
      </p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Year / cohort</th><th>Start</th><th>End</th><th>State</th><th /></tr></thead>
          <tbody>
            {project.planting_years.map((y: any) => (
              <tr key={y.id}>
                <td className="mono">{y.year_label}</td>
                <td>{fmtDate(y.start_date)}</td>
                <td>{fmtDate(y.end_date)}</td>
                <td><ActivePill active={y.active} /></td>
                <td>{isAdmin && <button className="link" onClick={() => toggle.mutate(y)}>{y.active ? 'Close for new registrations' : 'Reopen'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <h3>Add planting year or cohort</h3>
          <ErrorNotice error={create.error ?? toggle.error} />
          <div className="form-grid">
            <Field label="Label" hint="e.g. 2026 or WET26"><input required maxLength={16} {...f.bind('year_label')} /></Field>
            <Field label="Start date"><input type="date" {...f.bind('start_date')} /></Field>
            <Field label="End date"><input type="date" {...f.bind('end_date')} /></Field>
          </div>
          <div className="form-actions"><button className="primary" disabled={create.isPending}>Add</button></div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ID schemes
function SchemesTab({ project }: { project: any }) {
  const isAdmin = useIsAdmin();
  const [building, setBuilding] = useState(false);
  return (
    <div className="stack">
      {project.tree_id_schemes.length === 0 && <div className="notice warning">No ID format yet. Field officers cannot register trees until one exists.</div>}
      {project.tree_id_schemes.map((s: any) => {
        const preview = previewId(s.component_definition, s.separator, s.serial_width, { PROJECT_CODE: project.short_code, PLANTING_YEAR: project.planting_years[0]?.year_label });
        return (
          <section className="card" key={s.id}>
            <div className="page-header" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Version {s.version}</h2>
              {s.active ? <span className="pill good">Current for new registrations</span> : <span className="pill">Superseded</span>}
              <span className="muted">since {fmtDateTime(s.active_from)}</span>
            </div>
            <div className="id-preview">
              {preview.prefix}
              <span className="serial">{preview.serial}</span>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Components</dt>
              <dd>{s.component_definition.map((c: any) => `${COMPONENTS.find(([k]) => k === c.type)?.[1]}${c.required ? '' : ' (optional)'}`).join(' → ')}</dd>
              <dt>Serial</dt>
              <dd>{s.serial_width} digits, unique within {scopeLabel(s.serial_uniqueness_scope)}</dd>
            </dl>
          </section>
        );
      })}
      {isAdmin && !building && <div><button className="primary" onClick={() => setBuilding(true)}>Create new format version</button></div>}
      {building && <SchemeBuilder project={project} onClose={() => setBuilding(false)} />}
    </div>
  );
}

function SchemeBuilder({ project, onClose }: { project: any; onClose: () => void }) {
  const current = project.tree_id_schemes.find((s: any) => s.active);
  const [components, setComponents] = useState<{ type: string; required: boolean }[]>(
    current?.component_definition ?? [{ type: 'PROJECT_CODE', required: true }, { type: 'PLANTING_YEAR', required: true }, { type: 'SERIAL', required: true }],
  );
  const [separator, setSeparator] = useState(current?.separator ?? '-');
  const [width, setWidth] = useState(current?.serial_width ?? 6);
  const [scope, setScope] = useState<string[]>(current?.serial_uniqueness_scope ?? ['PROJECT', 'PLANTING_YEAR']);
  const save = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/tree-id-schemes`, { components, separator, serial_width: width, serial_uniqueness_scope: scope }),
    onSuccess: onClose,
  });
  const body = components.filter((c) => c.type !== 'SERIAL');
  const unused = COMPONENTS.filter(([k]) => k !== 'SERIAL' && !components.some((c) => c.type === k));
  const setBody = (next: typeof body) => setComponents([...next, { type: 'SERIAL', required: true }]);
  const move = (i: number, d: number) => {
    const next = [...body];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setBody(next);
  };
  const sample = previewId(components, separator, width, { PROJECT_CODE: project.short_code, PLANTING_YEAR: project.planting_years[0]?.year_label ?? '2026', VENDOR_CODE: 'V03', SECTOR_CODE: 'S02', SUB_SECTOR_CODE: 'SS04' });
  return (
    <section className="card stack">
      <h2>New ID format version</h2>
      <div className="notice">The new version applies to registrations made after devices sync it. Existing trees keep the IDs they were registered with.</div>
      <ErrorNotice error={save.error} />
      <div>
        <h3>Prefix components (in order)</h3>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {body.map((c, i) => (
            <li key={c.type} style={{ marginBottom: 6 }}>
              <div className="row">
                <strong style={{ minWidth: 140 }}>{COMPONENTS.find(([k]) => k === c.type)?.[1]}</strong>
                <label className="check">
                  <input type="checkbox" checked={c.required} onChange={(e) => setBody(body.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> Required
                </label>
                <button type="button" className="link" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
                <button type="button" className="link" disabled={i === body.length - 1} onClick={() => move(i, 1)}>Move down</button>
                <button type="button" className="link" onClick={() => setBody(body.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </li>
          ))}
          <li style={{ listStyle: 'none', marginLeft: -20 }} className="muted">Serial number (entered by the officer) is always last.</li>
        </ol>
        {unused.length > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            {unused.map(([k, label]) => (
              <button type="button" key={k} onClick={() => setBody([...body, { type: k, required: true }])}>+ {label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="form-grid">
        <Field label="Separator">
          <select value={separator} onChange={(e) => setSeparator(e.target.value)}>
            {[['-', 'Hyphen  -'], ['_', 'Underscore  _'], ['/', 'Slash  /'], ['.', 'Dot  .'], ['', 'None']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Serial digits" hint="zero-padded">
          <input type="number" min={1} max={12} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </Field>
      </div>
      <div>
        <h3>Serial numbers must be unique within</h3>
        <div className="row">
          {SCOPES.map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={scope.includes(k)} onChange={(e) => setScope(e.target.checked ? [...scope, k] : scope.filter((s) => s !== k))} /> {label}
            </label>
          ))}
        </div>
        <p className="muted">{scope.length ? `Unique per ${scopeLabel(scope)}.` : 'No boxes ticked: serials are unique globally.'} The full ID is always unique.</p>
      </div>
      <div>
        <h3>Preview</h3>
        <div className="id-preview">{sample.prefix}<span className="serial">{sample.serial}</span></div>
        <p className="muted">Officers see the prefix read-only and type only the highlighted serial.</p>
      </div>
      <div className="form-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => save.mutate()} disabled={save.isPending}>Publish version {(project.tree_id_schemes[0]?.version ?? 0) + 1}</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ assignments
function AssignmentsTab({ projectId }: { projectId: string }) {
  const assignments = useQuery({ queryKey: ['assignments', projectId], queryFn: () => api.get<any[]>(`/assignments${qs({ project_id: projectId })}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const f = useForm({ user_id: '', sector_id: '', sub_sector_id: '' });
  const create = useMutation({ mutationFn: () => api.post('/assignments', { project_id: projectId, ...clean(f.values) }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/assignments/${id}/revoke`) });
  const subSectors = areas.data?.find((s) => s.id === f.values.sector_id)?.sub_sectors ?? [];
  return (
    <div className="stack">
      <div className="card table-wrap">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Scope</th><th /></tr></thead>
          <tbody>
            {assignments.data?.map((a) => (
              <tr key={a.id}>
                <td>{a.user_name}</td>
                <td>{a.user_role.replace('_', ' ').toLowerCase()}</td>
                <td>{a.sub_sector_name ? `${a.sector_name} / ${a.sub_sector_name}` : a.sector_name ?? 'Whole project'}</td>
                <td><button className="link danger" onClick={() => confirm(`Remove ${a.user_name}'s access to this scope?`) && revoke.mutate(a.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.data?.length === 0 && <div className="empty">Nobody is assigned yet. Unassigned users cannot see this project.</div>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Assign a user</h3>
        <ErrorNotice error={create.error ?? revoke.error} />
        <div className="form-grid">
          <Field label="User">
            <select required {...f.bind('user_id')}>
              <option value="">Choose…</option>
              {users.data?.filter((u) => u.active && u.role !== 'ADMIN').map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role.replace('_', ' ').toLowerCase()})</option>)}
            </select>
          </Field>
          <Field label="Sector" hint="optional">
            <select value={f.values.sector_id} onChange={(e) => f.setValues({ ...f.values, sector_id: e.target.value, sub_sector_id: '' })}>
              <option value="">Whole project</option>
              {areas.data?.map((s) => <option key={s.id} value={s.id}>{s.short_code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="Sub-sector" hint="optional">
            <select {...f.bind('sub_sector_id')} disabled={!f.values.sector_id}>
              <option value="">Whole sector</option>
              {subSectors.map((ss: any) => <option key={ss.id} value={ss.id}>{ss.short_code} · {ss.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-actions"><button className="primary" disabled={create.isPending}>Assign</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ serial ranges
function SerialsTab({ project }: { project: any }) {
  const allocations = useQuery({ queryKey: ['allocations', project.id], queryFn: () => api.get<any[]>(`/serial-allocations${qs({ project_id: project.id })}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const scheme = project.tree_id_schemes.find((s: any) => s.active);
  const [yearId, setYearId] = useState(project.planting_years[0]?.id ?? '');
  const f = useForm({ user_id: '', range_start: '', range_end: '', notes: '', scope_key: '' });
  // Suggest the scope key for the common project + planting-year scope; others can be pasted.
  const suggested = scheme && JSON.stringify(scheme.serial_uniqueness_scope) === JSON.stringify(['PROJECT', 'PLANTING_YEAR'])
    ? `PLANTING_YEAR=${yearId}|PROJECT=${project.id}`
    : '';
  const create = useMutation({
    mutationFn: () =>
      api.post('/serial-allocations', {
        project_id: project.id,
        scope_key: f.values.scope_key || suggested,
        user_id: f.values.user_id || null,
        range_start: Number(f.values.range_start),
        range_end: Number(f.values.range_end),
        notes: f.values.notes || null,
      }),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/serial-allocations/${id}/revoke`) });
  return (
    <div className="stack">
      <div className="notice">
        Disconnected devices cannot detect each other’s registrations. Pre-allocating serial ranges per officer is the only way to guarantee collision-free offline issuance.
        When a scope has ranges, serials outside them are rejected at sync.
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Scope key</th><th>Officer</th><th className="num">From</th><th className="num">To</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {allocations.data?.map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ fontSize: 11, maxWidth: 320, wordBreak: 'break-all' }}>{a.scope_key}</td>
                <td>{a.user_name ?? 'Any officer'}</td>
                <td className="num">{a.range_start}</td>
                <td className="num">{a.range_end}</td>
                <td>{a.notes}</td>
                <td><button className="link danger" onClick={() => revoke.mutate(a.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {allocations.data?.length === 0 && <div className="empty">No ranges allocated: any serial is accepted and duplicates are resolved as conflicts.</div>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Allocate a range</h3>
        <ErrorNotice error={create.error ?? revoke.error} />
        <div className="form-grid">
          {suggested !== '' && (
            <Field label="Planting year">
              <select value={yearId} onChange={(e) => setYearId(e.target.value)}>
                {project.planting_years.map((y: any) => <option key={y.id} value={y.id}>{y.year_label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Officer" hint="optional">
            <select {...f.bind('user_id')}>
              <option value="">Any officer in scope</option>
              {users.data?.filter((u) => u.role === 'FIELD_OFFICER' && u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="First serial"><input required type="number" min={1} {...f.bind('range_start')} /></Field>
          <Field label="Last serial"><input required type="number" min={1} {...f.bind('range_end')} /></Field>
        </div>
        <Field label="Scope key" hint={suggested ? 'filled from the planting year' : 'see the scheme’s uniqueness scope'}>
          <input className="mono" required value={f.values.scope_key || suggested} onChange={(e) => f.setValues({ ...f.values, scope_key: e.target.value })} />
        </Field>
        <Field label="Notes"><input {...f.bind('notes')} /></Field>
        <div className="form-actions"><button className="primary" disabled={create.isPending}>Allocate</button></div>
      </form>
    </div>
  );
}
