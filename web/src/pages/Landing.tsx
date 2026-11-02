import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate } from '../components/ui';
import { BrandMark } from './Share';

/** Published by .github/workflows/android-release.yml under a stable name, so this link always gets the newest app. */
export const APK_URL = 'https://github.com/Teasoo-Holding/tms/releases/latest/download/tms-field.apk';
const LATEST_RELEASE = 'https://api.github.com/repos/Teasoo-Holding/tms/releases/latest';

interface Release {
  version: string;
  publishedAt: string | null;
  sizeMb: number | null;
}

/** Version and date of the newest release (public GitHub API, no sign-in). The button works without it. */
async function latestRelease(): Promise<Release> {
  const res = await fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  const apk = (r.assets ?? []).find((a: any) => a.name === 'tms-field.apk');
  return {
    version: String(r.tag_name ?? '').replace(/^android-v/, ''),
    publishedAt: r.published_at ?? null,
    sizeMb: apk?.size ? Math.round((apk.size / 1048576) * 10) / 10 : null,
  };
}

// ------------------------------------------------------------------ icons (inline, no external images)
/** 24×24 line icon; decorative, the heading next to it says what it is. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="landing-icon" aria-hidden>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

const ICONS = {
  offline: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10 18.5h4" />
      <path d="M9 9.5a4.2 4.2 0 0 1 6 0M10.6 11.8a1.9 1.9 0 0 1 2.8 0" />
      <path d="M4 4l16 16" />
    </>
  ),
  register: (
    <>
      <path d="M12 21v-6" />
      <path d="M12 15c-4 0-6.5-2.6-6.5-5.8C5.5 6 8.4 3 12 3s6.5 3 6.5 6.2c0 3.2-2.5 5.8-6.5 5.8z" />
      <path d="M9.5 9.5l1.8 1.8 3.4-3.6" />
    </>
  ),
  visits: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
      <path d="M3.5 12H2M22 12h-1.5" />
    </>
  ),
  areas: (
    <>
      <path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z" />
      <path d="M9 3.5v14.5M15 6v14.5" />
      <circle cx="6" cy="10" r="0.6" fill="currentColor" />
      <circle cx="12" cy="13" r="0.6" fill="currentColor" />
      <circle cx="18" cy="9" r="0.6" fill="currentColor" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  share: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

const FEATURES: { icon: ReactNode; title: string; text: string; points: string[] }[] = [
  {
    icon: ICONS.offline,
    title: 'Offline field app',
    text: 'Built for plantations without a signal. Everything an officer records stays on the phone until it can be sent.',
    points: ['Works without internet, including sign-in after the first time', 'Syncs by itself when a connection comes back', 'Shared tablets: each officer signs in with their own account'],
  },
  {
    icon: ICONS.register,
    title: 'Fast tree registration',
    text: 'A tree is registered in a few taps, with an ID that is easy to write on its tag and read back later.',
    points: ['Tree IDs with vendor codes and a suggested next number', 'Species chosen from picture cards', 'Photo with retake, optional height, and a clear “Tree registered” confirmation'],
  },
  {
    icon: ICONS.visits,
    title: 'Visits & history',
    text: 'Every follow-up visit adds to the tree’s history, so you can see how it has done since planting.',
    points: ['Find a tree by its ID', 'Record alive or dead, with photos', 'Corrections are kept next to the original, never overwritten'],
  },
  {
    icon: ICONS.areas,
    title: 'Areas',
    text: 'Organise each project the way it is planted on the ground.',
    points: ['Planting years with their own sectors and sub-sectors', 'Quick setup creates numbered areas in one step', 'Optional GPS corners and a dot density map'],
  },
  {
    icon: ICONS.reports,
    title: 'Dashboards & reports',
    text: 'Managers see progress as it syncs, filtered by project, year, area, vendor or species.',
    points: ['Status, species, vendors and planting over time', 'Field activity per officer and day', 'Export to Excel at any time'],
  },
  {
    icon: ICONS.share,
    title: 'Client sharing',
    text: 'Give clients and sponsors a live, read-only report of their project.',
    points: ['One private link per audience', 'No account or password needed', 'Links can expire or be revoked'],
  },
  {
    icon: ICONS.admin,
    title: 'Administration & audit',
    text: 'Control who does what, and see every change that was made.',
    points: ['Roles for officers, administrators and executives', 'Vendors and tree ID formats per project', 'A searchable audit log of every action'],
  },
];

const STEPS: [string, string][] = [
  ['Set up the project and areas', 'An administrator adds the project, its planting years, sectors and sub-sectors, vendors and the tree ID format.'],
  ['Officers register trees offline', 'In the field, officers register each tree with its species and photo, and come back for follow-up visits.'],
  ['Data syncs automatically', 'When the phone finds a connection, records and photos upload on their own. Nothing to export or copy.'],
  ['Managers and clients follow progress', 'Dashboards, reports and shared client links update as soon as the data arrives.'],
];

const AUDIENCES: [string, string, string][] = [
  ['Field officers', 'A simple Android app that works all day without a signal: register trees, record visits, take photos.', 'Android app'],
  ['Project managers & administrators', 'Set up projects and areas, manage people and vendors, review data and fix mistakes with a full audit trail.', 'Web portal'],
  ['Executives & sponsors', 'Live dashboards and read-only report links: how many trees were planted, where, and how many are alive.', 'Dashboards and links'],
];

const FAQ: [string, ReactNode][] = [
  ['Does the app work without internet?', 'Yes. After the first sign-in, officers can sign in, register trees and record visits with no connection at all. Records and photos are kept on the phone and sync automatically once it is back online.'],
  ['What happens to the photos?', 'Each photo is stored with its tree and visit. Photos upload in the background when there is a connection, and the portal shows which ones have arrived.'],
  ['Is our data secure?', 'Everyone signs in with their own account and role, and officers and clients only see the projects they are assigned to. Connections to the server are encrypted, client links are read-only and can be revoked, and every change is recorded in the audit log.'],
  ['Who creates accounts?', 'Your administrator. There is no self sign-up: an administrator creates each account, chooses its role and assigns it to a project. Ask them if you need access.'],
];

/** Hero illustration: a phone confirming a registration next to a small dashboard card. Decorative. */
function HeroArt() {
  return (
    <svg className="landing-art" viewBox="0 0 360 300" role="img" aria-label="The TMS field app confirming a registered tree, next to a dashboard chart">
      <rect x="150" y="40" width="200" height="150" rx="12" className="art-card" />
      <text x="168" y="68" className="art-title">Trees planted</text>
      <text x="168" y="96" className="art-big">12,480</text>
      {[38, 52, 46, 70, 64, 88, 96].map((h, i) => (
        <rect key={i} x={170 + i * 24} y={172 - h} width="14" height={h} rx="3" className={i === 6 ? 'art-bar strong' : 'art-bar'} />
      ))}
      <rect x="20" y="20" width="140" height="260" rx="22" className="art-phone" />
      <rect x="30" y="38" width="120" height="224" rx="10" className="art-screen" />
      <rect x="70" y="27" width="40" height="5" rx="2.5" className="art-notch" />
      <circle cx="90" cy="110" r="30" className="art-ok-bg" />
      <path d="M76 110l10 10 19-20" className="art-ok" />
      <text x="90" y="166" textAnchor="middle" className="art-title">Tree registered</text>
      <text x="90" y="186" textAnchor="middle" className="art-id">T4L-2026-KNM-000124</text>
      <rect x="44" y="214" width="92" height="30" rx="8" className="art-button" />
      <text x="90" y="234" textAnchor="middle" className="art-button-text">Next tree</text>
    </svg>
  );
}

/** Public landing page: what TMS is, who it is for, and the Android field app download. Shown at / to visitors and always at /download. */
export function LandingPage() {
  const user = useAuth();
  const release = useQuery({ queryKey: ['android-release'], queryFn: latestRelease, retry: false, staleTime: 10 * 60_000 });
  const r = release.data;
  const portal = user ? '/' : '/login';
  const portalLabel = user ? 'Open the portal' : 'Sign in to the portal';
  const download = (
    <a className="btn primary landing-download" href={APK_URL}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Download the Android app
    </a>
  );
  const releaseLine = (
    <p className="muted landing-meta" aria-live="polite">
      {r?.version
        ? <>Version {r.version}{r.publishedAt && <> · released {fmtDate(r.publishedAt)}</>}{r.sizeMb && <> · {r.sizeMb} MB</>} · Android 8 or later</>
        : 'TMS Field for Android phones and tablets · Android 8 or later'}
    </p>
  );

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="landing-header">
        <div className="landing-wrap landing-header-row">
          <BrandMark />
          <nav className="landing-nav" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#download">Download</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link className="btn" to={portal}>{user ? 'Open the portal' : 'Sign in'}</Link>
        </div>
      </header>

      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-wrap landing-hero-grid">
            <div className="landing-hero-text">
              <p className="landing-eyebrow">TMS by Teasoo Consulting</p>
              <h1 id="hero-title">Tree Management System</h1>
              <p className="landing-lead">Register and monitor every tree planted — offline in the field, live for managers and sponsors.</p>
              <div className="landing-actions">
                {download}
                <Link className="btn landing-secondary" to={portal}>{portalLabel}</Link>
              </div>
              {releaseLine}
            </div>
            <HeroArt />
          </div>
        </section>

        <section id="features" className="landing-section" aria-labelledby="features-title">
          <div className="landing-wrap">
            <h2 id="features-title" className="landing-h2">Everything from planting to reporting</h2>
            <p className="landing-intro">One Android app for the field and one web portal for the office, working on the same live data.</p>
            <div className="landing-features">
              {FEATURES.map((f) => (
                <article className="card landing-feature" key={f.title}>
                  <Icon>{f.icon}</Icon>
                  <h3>{f.title}</h3>
                  <p className="subtle">{f.text}</p>
                  <ul>
                    {f.points.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="landing-section alt" aria-labelledby="how-title">
          <div className="landing-wrap">
            <h2 id="how-title" className="landing-h2">How it works</h2>
            <ol className="landing-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="landing-step-n" aria-hidden>{i + 1}</span>
                  <h3>{title}</h3>
                  <p className="subtle">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="who-title">
          <div className="landing-wrap">
            <h2 id="who-title" className="landing-h2">Who it’s for</h2>
            <div className="landing-audiences">
              {AUDIENCES.map(([title, text, tag]) => (
                <article className="card" key={title}>
                  <span className="pill">{tag}</span>
                  <h3>{title}</h3>
                  <p className="subtle">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="download" className="landing-section alt" aria-labelledby="download-title">
          <div className="landing-wrap landing-download-grid">
            <div>
              <h2 id="download-title" className="landing-h2">Install the field app</h2>
              <p className="landing-intro">TMS Field is installed straight from this page; it is not on Google Play.</p>
              <div className="landing-actions start">{download}</div>
              {releaseLine}
            </div>
            <div className="card landing-install">
              <ol>
                <li>On the phone or tablet, tap <strong>Download the Android app</strong>.</li>
                <li>
                  When Android asks, allow your browser to <strong>install unknown apps</strong> (Settings → Apps → your browser → Install unknown apps). This is
                  needed once.
                </li>
                <li>Open the downloaded <span className="mono">tms-field.apk</span> and tap <strong>Install</strong>. To update later, install the new version the same way; the data on the phone is kept.</li>
                <li>Open <strong>TMS Field</strong> and sign in with the account your administrator gave you.</li>
              </ol>
              <p className="muted" style={{ margin: 0 }}>Needs Android 8 or later. No account yet? Ask your administrator to create one and assign you to your project.</p>
            </div>
          </div>
        </section>

        <section id="faq" className="landing-section" aria-labelledby="faq-title">
          <div className="landing-wrap landing-narrow">
            <h2 id="faq-title" className="landing-h2">Questions</h2>
            <div className="landing-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p className="subtle">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-row">
          <span>© {new Date().getFullYear()} Teasoo Consulting · Tree Management System</span>
          <Link to={portal}>{user ? 'Open the portal' : 'Portal sign-in'}</Link>
        </div>
      </footer>
    </div>
  );
}
