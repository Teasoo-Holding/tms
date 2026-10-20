import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ActivePill, clean, EmptyState, ErrorNotice, Field, fmtDateTime, fmtNum, isStale, Modal, PageHeader, relativeTime, Tabs, useForm } from '../components/ui';

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
      <PageHeader
        title="Users & devices"
        subtitle="People who can sign in, what they have recorded, and the field devices they sync from. Sync older than 7 days is highlighted."
        actions={tab === 'users' && <button className="primary" onClick={() => setEditing({})}>Add user</button>}
      />
      <Tabs tabs={[['users', 'Users'], ['devices', 'Field devices']]} value={tab} onChange={setTab} />
      <ErrorNotice error={users.error ?? toggle.error ?? revoke.error} />
      {tab === 'users' ? (
        <div className="card table-wrap tall">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Username</th><th>Phone</th><th>Email</th><th>Role</th><th>State</th><th className="num">Trees registered</th><th className="num">Observations</th><th>Last sync</th><th />
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => {
                const fieldUser = u.role === 'FIELD_OFFICER';
                const stale = fieldUser && u.active && isStale(u.last_sync_at, 7);
                return (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td className="mono">{u.username ?? <span className="muted">—</span>}</td>
                  <td className="nowrap">{u.phone ?? <span className="muted">—</span>}</td>
                  <td>{u.email ?? <span className="muted">—</span>}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td><ActivePill active={u.active} /></td>
                  <td className="num">{fmtNum(u.trees_registered ?? 0)}</td>
                  <td className="num">{fmtNum(u.observations_recorded ?? 0)}</td>
                  <td className="nowrap" title={u.last_sync_at ? fmtDateTime(u.last_sync_at) : 'Never synced'}>
                    {fieldUser || u.last_sync_at ? <span className={stale ? 'stale' : ''}>{relativeTime(u.last_sync_at)}{stale && <span className="visually-hidden"> (more than 7 days)</span>}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="row" style={{ flexWrap: 'nowrap' }}>
                    <Link to={`/audit?actor=${u.id}`}>View activity</Link>
                    <button className="link" onClick={() => setEditing(u)}>Edit</button>
                    {u.id !== me.id && (
                      <button className="link" onClick={() => (!u.active || confirm(`Deactivate ${u.full_name}? Their sessions end now; offline devices lock when they next revalidate.`)) && toggle.mutate(u)}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {users.data?.length === 0 && <EmptyState title="No users yet">Add administrators, executives and field officers.</EmptyState>}
        </div>
      ) : (
        <div className="card table-wrap tall">
          <table>
            <thead><tr><th>Device</th><th>Officer</th><th>App version</th><th>Last sync</th><th className="num">Unverified photos</th><th>State</th><th /></tr></thead>
            <tbody>
              {devices.data?.map((d) => (
                <tr key={d.id}>
                  <td>{d.name ?? 'Unnamed'}<div className="muted mono" style={{ fontSize: 11 }}>{d.id}</div></td>
                  <td>{d.user_name}</td>
                  <td>{d.app_version ?? '—'}</td>
                  <td className="nowrap" title={fmtDateTime(d.last_sync_at)}>
                    <span className={!d.revoked_at && isStale(d.last_sync_at, 7) ? 'stale' : ''}>{relativeTime(d.last_sync_at)}</span>
                  </td>
                  <td className="num">{d.unverified_media}</td>
                  <td>{d.revoked_at ? <span className="pill critical">Revoked</span> : <span className="pill good">Active</span>}</td>
                  <td>{!d.revoked_at && <button className="link danger" onClick={() => confirm('Revoke this device? It can no longer sync or refresh its session.') && revoke.mutate(d.id)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices.data?.length === 0 && <EmptyState title="No devices yet">Devices appear here after a field officer signs in on the Android app.</EmptyState>}
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
    password: '',
    active: user.active ?? true,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      // Blank optional fields are sent as null, which clears them on edit.
      const body: any = clean({ ...f.values, username: f.values.username.trim(), phone: f.values.phone.trim(), email: f.values.email.trim() });
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
        <p className="muted" style={{ margin: 0 }}>People sign in with any of username, phone or email.</p>
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
            <input type="password" autoComplete="new-password" required={isNew} minLength={10} {...f.bind('password')} />
          </Field>
        </div>
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
