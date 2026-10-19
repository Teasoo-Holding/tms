import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ActivePill, ErrorNotice, Field, fmtDateTime, Modal, relativeTime, Tabs, useForm } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administrator', FIELD_OFFICER: 'Field officer', EXECUTIVE: 'Executive' };

export function UsersPage() {
  const me = useAuth()!;
  const [tab, setTab] = useState<'users' | 'devices'>('users');
  const [editing, setEditing] = useState<any | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<any[]>('/devices'), enabled: tab === 'devices' });
  const toggle = useMutation({ mutationFn: (u: any) => api.patch(`/users/${u.id}`, { active: !u.active }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/devices/${id}/revoke`) });
  return (
    <div>
      <div className="page-header">
        <h1>Users & devices</h1>
        <span className="spacer" />
        {tab === 'users' && <button className="primary" onClick={() => setEditing({})}>Add user</button>}
      </div>
      <Tabs tabs={[['users', 'Users'], ['devices', 'Field devices']]} value={tab} onChange={setTab} />
      <ErrorNotice error={users.error ?? toggle.error ?? revoke.error} />
      {tab === 'users' ? (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>State</th><th /></tr></thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td><ActivePill active={u.active} /></td>
                  <td className="row" style={{ flexWrap: 'nowrap' }}>
                    <button className="link" onClick={() => setEditing(u)}>Edit</button>
                    {u.id !== me.id && (
                      <button className="link" onClick={() => (!u.active || confirm(`Deactivate ${u.full_name}? Their sessions end now; offline devices lock when they next revalidate.`)) && toggle.mutate(u)}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Device</th><th>Officer</th><th>App version</th><th>Last sync</th><th className="num">Unverified photos</th><th>State</th><th /></tr></thead>
            <tbody>
              {devices.data?.map((d) => (
                <tr key={d.id}>
                  <td>{d.name ?? 'Unnamed'}<div className="muted mono" style={{ fontSize: 11 }}>{d.id}</div></td>
                  <td>{d.user_name}</td>
                  <td>{d.app_version ?? '—'}</td>
                  <td title={fmtDateTime(d.last_sync_at)}>{relativeTime(d.last_sync_at)}</td>
                  <td className="num">{d.unverified_media}</td>
                  <td>{d.revoked_at ? <span className="pill critical">Revoked</span> : <span className="pill good">Active</span>}</td>
                  <td>{!d.revoked_at && <button className="link danger" onClick={() => confirm('Revoke this device? It can no longer sync or refresh its session.') && revoke.mutate(d.id)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices.data?.length === 0 && <div className="empty">No devices have signed in yet.</div>}
        </div>
      )}
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: any; onClose: () => void }) {
  const isNew = !user.id;
  const f = useForm({ full_name: user.full_name ?? '', email: user.email ?? '', role: user.role ?? 'FIELD_OFFICER', password: '' });
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...f.values };
      if (!isNew && !body.password) delete body.password;
      return isNew ? api.post('/users', body) : api.patch(`/users/${user.id}`, body);
    },
    onSuccess: onClose,
  });
  return (
    <Modal title={isNew ? 'Add user' : 'Edit user'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <ErrorNotice error={save.error} />
        <div className="form-grid">
          <Field label="Full name"><input required {...f.bind('full_name')} /></Field>
          <Field label="Email"><input type="email" required {...f.bind('email')} /></Field>
          <Field label="Role">
            <select {...f.bind('role')}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label={isNew ? 'Initial password' : 'New password'} hint={isNew ? 'at least 10 characters' : 'leave blank to keep'}>
            <input type="password" autoComplete="new-password" required={isNew} minLength={10} {...f.bind('password')} />
          </Field>
        </div>
        {!isNew && <p className="muted" style={{ margin: 0 }}>Changing the role or password signs the user out of all devices.</p>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
