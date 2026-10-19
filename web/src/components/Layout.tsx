import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api, auth } from '../api/client';
import { useAuth } from '../auth';

export function Layout() {
  const user = useAuth()!;
  const isAdmin = user.role === 'ADMIN';
  const conflicts = useQuery({ queryKey: ['conflicts', 'OPEN'], queryFn: () => api.get<any[]>('/conflicts'), enabled: isAdmin, refetchInterval: 60_000 });
  const links: [string, string, boolean][] = [
    ['/', 'Dashboard', true],
    ['/trees', 'Trees', true],
    ['/projects', 'Projects & areas', true],
    ['/conflicts', 'Conflicts', isAdmin],
    ['/reference', 'Species, statuses & vendors', isAdmin],
    ['/users', 'Users & devices', isAdmin],
    ['/audit', 'Audit log', isAdmin],
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
            <path d="M16 3 6 17h6l-5 7h7v5h4v-5h7l-5-7h6z" fill="currentColor" />
          </svg>
          Tree Management
        </div>
        <nav className="nav">
          {links.filter(([, , show]) => show).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
              {to === '/conflicts' && !!conflicts.data?.length && <span className="badge">{conflicts.data.length}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.full_name}</div>
          <div>{user.role === 'ADMIN' ? 'Administrator' : user.role === 'EXECUTIVE' ? 'Executive (read-only)' : 'Field officer'}</div>
          <button className="link" style={{ marginTop: 6 }} onClick={() => auth.logout()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
