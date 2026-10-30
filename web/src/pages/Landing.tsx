import { useQuery } from '@tanstack/react-query';
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

const FEATURES: [string, string][] = [
  ['Works offline in the field', 'Register trees and record visits with photos and heights without a signal; everything syncs when the phone is back online.'],
  ['Tree IDs without QR codes', 'Each tree gets a readable ID from the project, planting year and sector, written on its tag. No printing or scanning needed.'],
  ['Dashboards and density map', 'Survival, growth and planting progress per project, sector and vendor, with a dot density map of every area.'],
  ['Reports for clients', 'Share a read-only project report by link, and export to Excel or CSV at any time.'],
];

/** Public landing page: what TMS is, and the Android field app download. Shown at / to visitors and always at /download. */
export function LandingPage() {
  const user = useAuth();
  const release = useQuery({ queryKey: ['android-release'], queryFn: latestRelease, retry: false, staleTime: 10 * 60_000 });
  const r = release.data;
  return (
    <div className="landing">
      <header className="share-header">
        <BrandMark />
        <span className="spacer" />
        <Link className="btn" to={user ? '/' : '/login'}>{user ? 'Open the portal' : 'Sign in'}</Link>
      </header>

      <section className="landing-hero">
        <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden className="landing-logo">
          <path d="M16 3 6 17h6l-5 7h7v5h4v-5h7l-5-7h6z" fill="currentColor" />
        </svg>
        <h1>TMS — Tree Management System</h1>
        <p className="landing-lead">
          Tree Management System by Teasoo: register and monitor every tree planted, offline in the field.
        </p>
        <div className="landing-actions">
          <a className="btn primary landing-download" href={APK_URL}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Download the Android app
          </a>
          <Link className="btn landing-secondary" to={user ? '/' : '/login'}>{user ? 'Open the web portal' : 'Sign in to the web portal'}</Link>
        </div>
        <p className="muted landing-meta" aria-live="polite">
          {r?.version
            ? <>Version {r.version}{r.publishedAt && <> · released {fmtDate(r.publishedAt)}</>}{r.sizeMb && <> · {r.sizeMb} MB</>} · Android 8 or later</>
            : 'TMS Field for Android phones and tablets'}
        </p>
      </section>

      <section className="landing-features" aria-label="Features">
        {FEATURES.map(([title, text]) => (
          <div className="card" key={title}>
            <h2>{title}</h2>
            <p className="subtle">{text}</p>
          </div>
        ))}
      </section>

      <section className="card landing-install">
        <h2>Installing the app</h2>
        <ol>
          <li>On the phone or tablet, tap <strong>Download the Android app</strong> above.</li>
          <li>
            When Android asks, allow your browser to <strong>install unknown apps</strong> (Settings → Apps → your browser → Install unknown apps). The app is not
            on Google Play, so this is needed once.
          </li>
          <li>Open the downloaded <span className="mono">tms-field.apk</span> and tap <strong>Install</strong>. To update later, download and install it again; your data on the phone is kept.</li>
          <li>Open <strong>TMS Field</strong> and sign in with the username and password your administrator gave you.</li>
        </ol>
        <p className="muted" style={{ margin: 0 }}>No account yet? Ask your Teasoo administrator to create one and assign you to your project.</p>
      </section>

      <footer className="landing-footer muted">© Teasoo Consulting · Tree Management System</footer>
    </div>
  );
}
