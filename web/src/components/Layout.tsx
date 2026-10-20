import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, auth } from '../api/client';
import { useAuth } from '../auth';

function Brand() {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M16 3 6 17h6l-5 7h7v5h4v-5h7l-5-7h6z" fill="currentColor" />
      </svg>
      Tree Management
    </div>
  );
}

export function Layout() {
  const user = useAuth()!;
  const isAdmin = user.role === 'ADMIN';
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const conflicts = useQuery({ queryKey: ['conflicts', 'OPEN'], queryFn: () => api.get<any[]>('/conflicts'), enabled: isAdmin, refetchInterval: 60_000 });
  // Close the phone-width drawer after navigating, and on Escape.
  useEffect(() => setNavOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
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
      <header className="mobile-bar">
        <button className="nav-toggle" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="sidebar" onClick={() => setNavOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <Brand />
      </header>
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <aside id="sidebar" className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Brand />
          <span style={{ flex: 1 }} />
          <button className="link close-nav" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            Close
          </button>
        </div>
        <nav className="nav" aria-label="Main">
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
