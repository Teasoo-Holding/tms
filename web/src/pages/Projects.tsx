import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useIsAdmin } from '../auth';
import { clean, ErrorNotice, Field, fmtDate, fmtNum, Modal, useForm } from '../components/ui';

export function ProjectsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  return (
    <div>
      <div className="page-header">
        <h1>Projects & areas</h1>
        <span className="spacer" />
        {isAdmin && (
          <button className="primary" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
      </div>
      <ErrorNotice error={projects.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Code</th>
              <th>Status</th>
              <th>Location</th>
              <th>Dates</th>
              <th className="num">Registered trees</th>
            </tr>
          </thead>
          <tbody>
            {projects.data?.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                <td><a href={`/projects/${p.id}`} onClick={(e) => e.preventDefault()}>{p.name}</a></td>
                <td className="mono">{p.short_code}</td>
                <td><span className="pill">{p.status.toLowerCase()}</span></td>
                <td>{p.location ?? '—'}</td>
                <td>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</td>
                <td className="num">{fmtNum(p.tree_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.data?.length === 0 && <div className="empty">No projects yet.</div>}
      </div>
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </div>
  );
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
  });
  const save = useMutation({
    mutationFn: () => {
      const body = clean(f.values);
      if (project) {
        const { physical_id_uniqueness: _ignored, ...rest } = body;
        return api.patch(`/projects/${project.id}`, rest);
      }
      return api.post('/projects', body);
    },
    onSuccess: (p) => {
      onSaved?.(p);
      onClose();
    },
  });
  const codeChanged = project && f.values.short_code.toUpperCase() !== project.short_code;
  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="stack">
        <ErrorNotice error={save.error} />
        <div className="form-grid">
          <Field label="Name"><input required {...f.bind('name')} /></Field>
          <Field label="Short code" hint="used in tree IDs"><input required maxLength={16} {...f.bind('short_code')} /></Field>
          <Field label="Status">
            <select {...f.bind('status')}>
              {['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Location"><input {...f.bind('location')} /></Field>
          <Field label="Start date"><input type="date" {...f.bind('start_date')} /></Field>
          <Field label="End date"><input type="date" {...f.bind('end_date')} /></Field>
        </div>
        <Field label="Description"><textarea {...f.bind('description')} /></Field>
        {!project ? (
          <Field label="Physical tree ID must be unique" hint="cannot be changed later">
            <select required {...f.bind('physical_id_uniqueness')}>
              <option value="" disabled>Choose the approved scope…</option>
              <option value="PROJECT">Within this project</option>
              <option value="GLOBAL">Across all projects</option>
            </select>
          </Field>
        ) : (
          <p className="muted">Physical IDs are unique {project.physical_id_uniqueness === 'GLOBAL' ? 'across all projects' : 'within this project'}.</p>
        )}
        {codeChanged && <div className="notice warning">Changing the short code affects new registrations only. Existing tree IDs keep the code they were registered with.</div>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
