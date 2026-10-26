import { useMutation, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ActivePill, Chevron, clean, Details, EditButton, EmptyState, ErrorNotice, Field, fmtDateTime, fmtNum, isStale, Modal, PageHeader, PasswordInput, relativeTime, RowMenu, Tabs, useForm } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administrator', FIELD_OFFICER: 'Field officer', EXECUTIVE: 'Executive' };

export function UsersPage() {
  const me = useAuth()!;
  const [tab, setTab] = useState<'users' | 'devices'>('users');
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const navigate = useNavigate();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<any[]>('/devices'), enabled: tab === 'devices' });
  const toggle = useMutation({ mutationFn: (u: any) => api.patch(`/users/${u.id}`, { active: !u.active }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/devices/${id}/revoke`) });
  return (
    <div>
      <PageHeader title="Users" actions={tab === 'users' && <button className="primary" onClick={() => setEditing({})}>+ User</button>} />
      <Tabs tabs={[['users', 'People'], ['devices', 'Phones']]} value={tab} onChange={setTab} />
      <ErrorNotice error={users.error ?? toggle.error ?? revoke.error} />
      {tab === 'users' ? (
        <div className="card table-wrap tall">
          {!!users.data?.length && (
          <table>
            <thead>
              <tr>
                <th className="expander" /><th>Name</th><th className="hide-sm">Role</th><th>Last sync</th><th className="hide-sm">State</th><th className="actions" />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => {
                const fieldUser = u.role === 'FIELD_OFFICER';
                const stale = fieldUser && u.active && isStale(u.last_sync_at, 7);
                return (
                <Fragment key={u.id}>
                <tr className="clickable" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id} style={u.active ? undefined : { opacity: 0.65 }}>
                  <td className="expander"><Chevron open={open === u.id} /></td>
                  <td>
                    {u.full_name}
                    <div className="muted show-sm">{ROLE_LABEL[u.role]}{!u.active && ' · inactive'}</div>
                  </td>
                  <td className="hide-sm">
                    {ROLE_LABEL[u.role]}
                    {u.role === 'EXECUTIVE' && <div className="muted">{u.all_projects ? 'All projects' : 'Assigned projects'}</div>}
                  </td>
                  <td className="nowrap" title={u.last_sync_at ? fmtDateTime(u.last_sync_at) : 'Never synced'}>
                    {fieldUser || u.last_sync_at ? <span className={stale ? 'stale' : ''}>{relativeTime(u.last_sync_at)}{stale && <span className="visually-hidden"> (more than 7 days)</span>}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="hide-sm"><ActivePill active={u.active} /></td>
                  <td className="actions">
                    <EditButton name={u.full_name} onClick={() => setEditing(u)} />
                    <RowMenu
                      items={[
                        { label: 'Edit', onClick: () => setEditing(u) },
                        { label: 'View activity', onClick: () => navigate(`/audit?actor=${u.id}`) },
                        u.id !== me.id && {
                          label: u.active ? 'Deactivate' : 'Activate',
                          danger: u.active,
                          onClick: () => (!u.active || confirm(`Deactivate ${u.full_name}? Their sessions end now.`)) && toggle.mutate(u),
                        },
                      ]}
                    />
                  </td>
                </tr>
                {open === u.id && (
                  <tr className="details-row">
                    <td />
                    <td colSpan={5}>
                      <Details
                        items={[
                          ['Username', u.username && <span className="mono">{u.username}</span>],
                          ['Phone', u.phone],
                          ['Email', u.email],
                          ['Access', u.role === 'EXECUTIVE' ? (u.all_projects ? 'All projects' : 'Assigned projects only') : null],
                          ['Trees registered', fmtNum(u.trees_registered ?? 0)],
                          ['Visits recorded', fmtNum(u.observations_recorded ?? 0)],
                        ]}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
          {users.data?.length === 0 && <EmptyState title="No users yet" />}
        </div>
      ) : (
        <div className="card table-wrap tall">
          <table>
            <thead><tr><th>Phone</th><th>Officer</th><th>Last sync</th><th className="hide-sm">State</th><th className="actions" /></tr></thead>
            <tbody>
              {devices.data?.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.name ?? 'Unnamed'}
                    <div className="muted">{d.app_version ? `v${d.app_version}` : ''}{d.unverified_media ? ` · ${d.unverified_media} photos waiting` : ''}</div>
                  </td>
                  <td>{d.user_name}</td>
                  <td className="nowrap" title={fmtDateTime(d.last_sync_at)}>
                    <span className={!d.revoked_at && isStale(d.last_sync_at, 7) ? 'stale' : ''}>{relativeTime(d.last_sync_at)}</span>
                  </td>
                  <td className="hide-sm">{d.revoked_at ? <span className="pill critical">Revoked</span> : <span className="pill good">Active</span>}</td>
                  <td className="actions">
                    {!d.revoked_at && <RowMenu items={[{ label: 'Revoke', danger: true, onClick: () => confirm('Revoke this phone? It can no longer sync.') && revoke.mutate(d.id) }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices.data?.length === 0 && <EmptyState title="No phones yet">They appear after an officer signs in on the app.</EmptyState>}
        </div>
      )}
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: any; onClose: () => void }) {
  const isNew = !user.id;
  const f = useForm({
    full_name: user.full_name ?? '',
    username: user.username ?? '',
    phone: user.phone ?? '',
    email: user.email ?? '',
    role: user.role ?? 'FIELD_OFFICER',
    all_projects: user.all_projects ?? false,
    password: '',
    active: user.active ?? true,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      // Blank optional fields are sent as null, which clears them on edit.
      const body: any = clean({ ...f.values, username: f.values.username.trim(), phone: f.values.phone.trim(), email: f.values.email.trim() });
      // Only executives can see every project; for other roles the flag is always off.
      body.all_projects = f.values.role === 'EXECUTIVE' && f.values.all_projects;
      if (!body.password) delete body.password;
      return isNew ? api.post('/users', body) : api.patch(`/users/${user.id}`, body);
    },
    onSuccess: onClose,
  });
  const submit = () => {
    if (![f.values.username, f.values.phone, f.values.email].some((v) => v.trim())) {
      setLocalError('Give a username, phone number or email so the person can sign in.');
      return;
    }
    setLocalError(null);
    save.mutate();
  };
  return (
    <Modal title={isNew ? 'Add user' : 'Edit user'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
        {localError && <div className="notice error" role="alert">{localError}</div>}
        <ErrorNotice error={save.error} />
        <div className="form-grid">
          <Field label="Full name"><input required {...f.bind('full_name')} /></Field>
          <Field label="Username" hint="3–40 letters, digits, . _ -">
            <input autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} pattern="(?=.*[A-Za-z])[A-Za-z0-9._\-]{3,40}" title="3–40 characters: letters, digits, . _ or -, including at least one letter" {...f.bind('username')} />
          </Field>
          <Field label="Phone">
            <input type="tel" autoComplete="off" pattern="\+?[0-9][0-9 \(\)\-.]*" title="Digits, optionally starting with +; spaces, dashes and brackets are allowed" {...f.bind('phone')} />
          </Field>
          <Field label="Email" hint="optional"><input type="email" autoComplete="off" {...f.bind('email')} /></Field>
          <Field label="Role">
            <select {...f.bind('role')}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label={isNew ? 'Initial password' : 'Reset password'} hint={isNew ? 'at least 10 characters' : 'leave blank to keep'}>
            <PasswordInput autoComplete="new-password" required={isNew} minLength={10} {...f.bind('password')} />
          </Field>
        </div>
        {f.values.role === 'EXECUTIVE' && (
          <div>
            <label className="check"><input type="checkbox" {...f.bindCheck('all_projects')} /> Teasoo management – sees all projects</label>
            {!f.values.all_projects && <p className="muted" style={{ margin: '2px 0 0 22px' }}>Sees only projects they are given access to (project → People).</p>}
          </div>
        )}
        <label className="check"><input type="checkbox" {...f.bindCheck('active')} /> Active (can sign in)</label>
        {!isNew && <p className="muted" style={{ margin: 0 }}>Changing the role or password signs the user out of all devices.</p>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
