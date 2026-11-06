import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client';
import { previewId, SAMPLE_VENDOR_CODE } from '../idscheme';
import { useIsAdmin } from '../auth';
import { Pagination, usePage, usePaged } from '../components/Pagination';
import { clean, EditButton, EmptyState, ErrorNotice, Field, fmtNum, Modal, PageHeader, RowMenu, useDelete, useForm } from '../components/ui';

export function ProjectsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const del = useDelete();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const paged = usePaged(projects.data ?? [], usePage('', 25));
  return (
    <div>
      <PageHeader title="Projects" actions={isAdmin && <button className="primary" onClick={() => setCreating(true)}>+ New project</button>} />
      <ErrorNotice error={projects.error} />
      <div className="card table-wrap">
        {!!projects.data?.length && (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th className="num">Trees</th>
                {isAdmin && <th className="actions" />}
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td>
                    <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                    <div className="muted">
                      <span className="mono">{p.short_code}</span>
                      {p.location && ` · ${p.location}`}
                    </div>
                  </td>
                  <td><span className="pill">{p.status.toLowerCase()}</span></td>
                  <td className="num">{fmtNum(p.tree_count)}</td>
                  {isAdmin && (
                    <td className="actions">
                      <EditButton name={p.name} onClick={() => setEditing(p)} />
                      <RowMenu
                        items={[
                          { label: 'Edit', onClick: () => setEditing(p) },
                          {
                            label: 'Delete',
                            danger: true,
                            onClick: () => del.ask({ what: 'project', name: p.name, path: `/projects/${p.id}`, note: 'Only a project without trees can be deleted. All its setup is removed.' }),
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {projects.data?.length === 0 && (
          <EmptyState title="No projects yet" action={isAdmin && <button className="primary" onClick={() => setCreating(true)}>+ New project</button>}>
            {!isAdmin && 'Ask an administrator to give you access.'}
          </EmptyState>
        )}
        {projects.isLoading && <div className="empty">Loading…</div>}
      </div>
      <Pagination page={paged.page} total={paged.total} label="projects" />
      {del.dialog}
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} />}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`, { state: { created: true } })} />}
    </div>
  );
}

/** The backend's short-code rule (1–16 letters or digits, stored upper-case). */
const SHORT_CODE = /^[A-Z0-9]{1,16}$/;
const UNIQUENESS: [string, string, string][] = [
  ['PROJECT', 'Within this project', 'The same tag number may exist in another project.'],
  ['GLOBAL', 'Across all projects', 'A tag number can only be used once in the whole system.'],
];
/** A sample tree ID in the default format (project code, planting year, vendor code, 6-digit serial). */
function sampleTreeId(code: string, year: string) {
  return previewId(DEFAULT_COMPONENTS, '-', 6, { PROJECT_CODE: code || 'CODE', PLANTING_YEAR: year, VENDOR_CODE: SAMPLE_VENDOR_CODE }, '1');
}
const DEFAULT_COMPONENTS = ['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'SERIAL'].map((type) => ({ type, required: true }));

/** Whether a (valid) short code is free, checked shortly after typing stops. */
function useShortCodeAvailable(code: string, enabled: boolean) {
  const [settled, setSettled] = useState(code);
  useEffect(() => {
    const t = setTimeout(() => setSettled(code), 300);
    return () => clearTimeout(t);
  }, [code]);
  const q = useQuery({
    queryKey: ['short-code-available', settled],
    queryFn: () => api.get<{ code: string; available: boolean }>(`/projects/short-code-available${qs({ code: settled })}`),
    enabled: enabled && settled === code && SHORT_CODE.test(settled),
    staleTime: 10_000,
  });
  return settled === code ? q : undefined;
}

export function ProjectForm({ project, onClose, onSaved }: { project?: any; onClose: () => void; onSaved?: (p: any) => void }) {
  const f = useForm({
    name: project?.name ?? '',
    short_code: project?.short_code ?? '',
    description: project?.description ?? '',
    location: project?.location ?? '',
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
    status: project?.status ?? 'DRAFT',
    physical_id_uniqueness: project?.physical_id_uniqueness ?? '',
    maintenance_interval_days: String(project?.maintenance_interval_days ?? 90),
  });
  const set = (key: 'short_code' | 'physical_id_uniqueness', value: string) => f.setValues((v) => ({ ...v, [key]: value }));
  // Creating asks for confirmation of the permanent choices first.
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...clean(f.values), maintenance_interval_days: Number(f.values.maintenance_interval_days) };
      if (project) {
        // The short code and uniqueness scope are fixed once the project exists.
        const { physical_id_uniqueness: _scope, short_code: _code, ...rest } = body;
        return api.patch(`/projects/${project.id}`, rest);
      }
      return api.post('/projects', body);
    },
    onSuccess: (p) => {
      onSaved?.(p);
      onClose();
    },
  });
  const code = f.values.short_code;
  const codeInvalid = !project && code !== '' && !SHORT_CODE.test(code);
  const availability = useShortCodeAvailable(code, !project);
  const codeTaken = availability?.data?.available === false;
  const datesInvalid = !!f.values.start_date && !!f.values.end_date && f.values.end_date < f.values.start_date;
  const year = (f.values.start_date || String(new Date().getFullYear())).slice(0, 4);
  const sample = sampleTreeId(code, year);
  const scope = UNIQUENESS.find(([v]) => v === f.values.physical_id_uniqueness);
  const blocked = codeInvalid || codeTaken || datesInvalid;
  const submit = () => {
    if (blocked) return;
    if (!project && !confirming) return setConfirming(true);
    save.mutate();
  };

  if (confirming) {
    return (
      <Modal title="Create this project?" onClose={onClose}>
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="stack">
          <ErrorNotice error={save.error} />
          <p style={{ margin: 0 }}>
            <strong>{f.values.name}</strong>: check these choices. They are permanent and can’t be changed after the project is created.
          </p>
          <dl className="kv">
            <dt>Short code</dt>
            <dd>
              <span className="mono"><strong>{code}</strong></span>
              <div className="muted">Part of every tree ID, e.g. <span className="mono">{sample.prefix}{sample.serial}</span></div>
            </dd>
            <dt>Tree ID unique</dt>
            <dd>
              <strong>{scope?.[1]}</strong>
              <div className="muted">{scope?.[2]}</div>
            </dd>
          </dl>
          <div className="form-actions">
            <button type="button" onClick={() => (save.reset(), setConfirming(false))}>Back to edit</button>
            <button className="primary" disabled={save.isPending} autoFocus>{save.isPending ? 'Creating…' : 'Create project'}</button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="stack">
        <ErrorNotice error={save.error} />
        <div className="form-grid">
          <Field label="Name"><input required {...f.bind('name')} /></Field>
          {project ? (
            <Field label="Short code" hint="fixed: part of every tree ID">
              <input value={project.short_code} readOnly aria-readonly className="mono" />
            </Field>
          ) : (
            <Field label="Short code" hint="1–16 letters or digits">
              <input
                required
                maxLength={16}
                className="mono"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => set('short_code', e.target.value.toUpperCase())}
                aria-invalid={codeInvalid || codeTaken}
                aria-describedby="short-code-help"
              />
              <span id="short-code-help" className="short-code-help" aria-live="polite">
                {codeInvalid && <span className="field-error">Use only letters A–Z and digits 0–9, with no spaces or symbols.</span>}
                {codeTaken && <span className="field-error">Another project already uses {code}. Choose a different code.</span>}
                {availability?.data?.available && <span className="good-text">{code} is available.</span>}
                <span className="hint">Can’t be changed after saving; it’s part of every tree ID, e.g.</span>
              </span>
              <span className="id-preview small" aria-label={`Sample tree ID ${sample.prefix}${sample.serial}`}>
                {sample.prefix}<span className="serial">{sample.serial}</span>
              </span>
            </Field>
          )}
          <Field label="Status">
            <select {...f.bind('status')}>
              {['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Location"><input {...f.bind('location')} /></Field>
          <Field label="Start date"><input type="date" {...f.bind('start_date')} /></Field>
          <Field label="End date">
            <input type="date" min={f.values.start_date || undefined} {...f.bind('end_date')} aria-invalid={datesInvalid} aria-describedby={datesInvalid ? 'end-date-error' : undefined} />
            {datesInvalid && <span id="end-date-error" className="field-error" role="alert">The end date is before the start date. Choose an end date on or after the start date, or clear it.</span>}
          </Field>
          <Field label="Maintenance every (days)" hint="7–730; trees are due this long after their last maintenance visit, or their planting">
            <input type="number" required min={7} max={730} step={1} inputMode="numeric" {...f.bind('maintenance_interval_days')} />
          </Field>
        </div>
        <Field label="Description"><textarea {...f.bind('description')} /></Field>
        {!project ? (
          <fieldset className="choice-list neutral">
            <legend>Physical tree ID must be unique <span className="hint muted">— permanent: can’t be changed after saving</span></legend>
            {UNIQUENESS.map(([value, label, help]) => (
              <label key={value} className={`choice${f.values.physical_id_uniqueness === value ? ' on' : ''}`}>
                <input type="radio" name="physical_id_uniqueness" required value={value} checked={f.values.physical_id_uniqueness === value} onChange={() => set('physical_id_uniqueness', value)} />
                <span>
                  <strong>{label}</strong>
                  <span className="muted">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="muted">
            Physical IDs are unique {project.physical_id_uniqueness === 'GLOBAL' ? 'across all projects' : 'within this project'}. This and the short code are fixed.
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending || blocked}>{project ? 'Save' : 'Continue'}</button>
        </div>
      </form>
    </Modal>
  );
}
