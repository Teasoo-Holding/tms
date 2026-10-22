import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, auth, signInName } from '../api/client';
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
    ['/visits', 'Visits', true],
    ['/projects', 'Projects', true],
    ['/conflicts', 'Conflicts', isAdmin],
    ['/reference', 'Lists', isAdmin],
    ['/users', 'Users', isAdmin],
    ['/audit', 'Audit log', isAdmin],
    ['/settings', 'Settings', isAdmin],
  ];
  return (
    <div className="shell">
      <header className="mobile-bar">
        <button className="nav-toggle icon-btn" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="sidebar" onClick={() => setNavOpen(true)}>
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
          <button className="icon-btn close-nav" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {links.filter(([, , show]) => show).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <NavIcon to={to} />
              {label}
              {to === '/conflicts' && !!conflicts.data?.length && <span className="badge">{conflicts.data.length}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }} title={signInName(user)}>{user.full_name}</div>
          {user.role === 'EXECUTIVE' && <div>Read-only</div>}
          <button style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => auth.logout()}>
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

const ICONS: Record<string, string> = {
  '/': 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z',
  '/trees': 'M12 3 6 12h4l-3 5h10l-3-5h4zM12 17v4',
  '/visits': 'M8 3v3M16 3v3M4 8h16M5 5h14v15H5zM9 14l2 2 4-4',
  '/projects': 'M3 7h7l2 2h9v10H3z',
  '/conflicts': 'M12 4 2 20h20zM12 10v4M12 17v.5',
  '/reference': 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  '/users': 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6',
  '/audit': 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  '/settings': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-3h-4l-1 3-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4z',
};

function NavIcon({ to }: { to: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="nav-icon">
      <path d={ICONS[to]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
