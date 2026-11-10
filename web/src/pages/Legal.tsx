import { ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TeasooLogo } from '../components/Brand';

/**
 * Public Privacy and Terms pages (#86), in plain language. Change LAST_UPDATED whenever either page changes in a way
 * that matters to readers. Set LEGAL_REVIEWED to true once a qualified legal or privacy professional has approved
 * the text; until then each page says it is waiting for that review.
 */
export const LAST_UPDATED = '10 November 2026';
export const LEGAL_REVIEWED = true;

const ORG = 'Teasoo Consulting Ltd';
const ADDRESS = '43 Oghosa Crescent, Off Ihama Road, GRA, Benin City, Edo State, Nigeria';
const EMAIL = 'info@teasooconsulting.com';
const Mail = () => <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

function LegalLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Tree Management System`;
  }, [title]);
  return (
    <div className="landing-page legal-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="landing-header">
        <div className="landing-wrap landing-header-row">
          <Link to="/" aria-label="Tree Management System home"><TeasooLogo height={36} /></Link>
          <nav className="landing-nav" aria-label="Legal pages">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="landing-wrap legal">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
        {!LEGAL_REVIEWED && (
          <p className="notice warning" role="note">This page is a draft. It is waiting for review by a legal professional.</p>
        )}
        <p className="landing-lead">{intro}</p>
        {children}
        <h2>Contact us</h2>
        <p>
          {ORG}
          <br />
          {ADDRESS}
          <br />
          Email: <Mail />
        </p>
      </main>
      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-row">
          <span>© {new Date().getFullYear()} {ORG} · Tree Management System</span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

/** "Privacy · Terms", for footers and the sign-in page. */
export function LegalLinks() {
  return (
    <span className="legal-links">
      <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
    </span>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy"
      intro="This page explains what personal information the Tree Management System (TMS) collects, why we use it, who can see it, how long we keep it, and what your rights are."
    >
      <h2>Who we are</h2>
      <p>
        TMS is run by {ORG}, a company in Benin City, Nigeria. We decide how personal information in TMS is used. In data protection law this
        makes us the data controller.
      </p>
      <p>
        We follow the Nigeria Data Protection Act 2023. If you live in another country, its privacy laws may also give you rights. You can
        contact our data protection officer at <Mail />.
      </p>

      <h2>What TMS is for</h2>
      <p>
        TMS records trees planted in reforestation projects: each tree's ID, species, area, status, height and photos, and every visit
        to it. Field officers use the TMS Field app on Android phones. Managers, administrators and project sponsors use the web portal.
      </p>

      <h2>What we collect</h2>
      <h3>If you have a TMS account</h3>
      <ul>
        <li>your name, and the username, email address or phone number you sign in with</li>
        <li>your role (for example field officer or administrator) and the projects you work on</li>
        <li>
          your password. We only keep a scrambled version (a "hash") that cannot be turned back into your password. The phone keeps a
          similar hash so you can sign in without internet.
        </li>
        <li>if you sign in with Google: your Google account ID and email address. We do not get your Google password.</li>
      </ul>
      <h3>What you record</h3>
      <ul>
        <li>tree records and visits, with who made them, when, and in which field session</li>
        <li>photos of trees. A sample is checked by Pl@ntNet to confirm the species (see below). Please do not photograph people. If someone appears by accident, ask us to remove the photo.</li>
        <li>
          the GPS position of planting areas, which administrators record. TMS does not record the position of each tree, and it does not
          track where you are.
        </li>
      </ul>
      <h3>About your phone and how you use TMS</h3>
      <ul>
        <li>a device ID, the phone's make and model, the app version, and when the phone last sent its records</li>
        <li>a log of important actions, such as signing in, editing records and exporting data. We use it for security and audits.</li>
        <li>
          our hosting providers may record technical details, such as IP addresses, in their logs. They do this to run and protect the
          service.
        </li>
      </ul>
      <p>
        TMS does not use advertising or tracking cookies. The web portal stores your sign-in session in your browser so you stay signed
        in.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>to let you sign in and do the work your role allows</li>
        <li>to keep an accurate, checkable record of the trees in each project, and who recorded what</li>
        <li>to produce reports for the organisations and sponsors running the projects</li>
        <li>to keep TMS secure, fix problems and give support</li>
      </ul>
      <p>
        We use your information because it is needed to provide TMS to you and to the projects you work on, and because we have a
        legitimate interest in keeping project records accurate and secure.
      </p>

      <h2>Who can see it</h2>
      <ul>
        <li>people in your project, according to their role. For example, administrators can see who recorded each tree.</li>
        <li>
          project sponsors and clients. They see tree records and photos through read-only reports. Those reports do not show who
          collected the data.
        </li>
        <li>
          the companies that host TMS for us: Neon (database and storage), Render (server), Vercel (website) and, if you sign in with
          Google, Google. They process data only to provide their service to us.
        </li>
        <li>
          Pl@ntNet, a plant identification service run by French research institutes. Each day we send it a sample of tree photos,
          only the photo, to check which species the tree is. It does not receive names or other details about you.
        </li>
      </ul>
      <p>We do not sell your information, and we do not share it with anyone else, unless the law requires us to.</p>
      <p>
        Our hosting providers' data centres may be outside Nigeria, for example in the United States or Europe. When information is
        stored abroad, we rely on our providers' security and contract terms to protect it.
      </p>

      <h2>How long we keep it</h2>
      <p>We keep a project's records while the project runs. When a project ends, we keep its data for 24 months and then delete it.</p>
      <p>
        When an account is closed, we remove the person's details within the same 24 months. Records they made stay part of the project
        record until the project's data is deleted.
      </p>

      <h2>How we protect it</h2>
      <ul>
        <li>all connections to TMS are encrypted</li>
        <li>passwords are stored only as hashes</li>
        <li>people can only see the projects they are given access to</li>
        <li>important actions are logged</li>
      </ul>

      <h2>Your rights</h2>
      <p>Under the Nigeria Data Protection Act you can ask us to:</p>
      <ul>
        <li>tell you what personal information we hold about you, and give you a copy</li>
        <li>correct information that is wrong</li>
        <li>delete your information, where we do not need to keep it</li>
        <li>stop or limit how we use it</li>
        <li>give you your information in a format you can take elsewhere</li>
      </ul>
      <p>
        Email <Mail /> to use any of these rights. We will reply as soon as we can, and within the time the law sets. If you are not
        happy with our answer, you can complain to the Nigeria Data Protection Commission.
      </p>

      <h2>Changes to this page</h2>
      <p>If we change this page in a way that matters, we will update the date at the top.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of use"
      intro="These terms explain how you may use the Tree Management System (TMS): the TMS Field app and the web portal. By using TMS, you agree to them."
    >
      <h2>Who provides TMS</h2>
      <p>TMS is provided by {ORG}, Benin City, Nigeria.</p>

      <h2>Who can use TMS</h2>
      <p>
        You need an account to use TMS. Accounts are created by an administrator for people working on a project. Project sponsors and
        clients can also view read-only reports through links we give them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>keep your password secret and do not share your account</li>
        <li>if you sign in with Google, use the Google account with the same email as your TMS account</li>
        <li>if you think someone else has used your account, tell your administrator or email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> straight away</li>
        <li>if you leave a project, your administrator may switch off your account</li>
      </ul>

      <h2>Using TMS properly</h2>
      <p>You must:</p>
      <ul>
        <li>record only what you have seen, as accurately as you can</li>
        <li>use TMS only for the projects you work on</li>
        <li>photograph trees, not people</li>
      </ul>
      <p>You must not:</p>
      <ul>
        <li>enter false or misleading records</li>
        <li>try to see data you have not been given access to, or get around TMS security</li>
        <li>use TMS to break the law or harm anyone</li>
        <li>copy or share project data outside your work, unless the project allows it</li>
      </ul>
      <p>We may switch off an account that breaks these rules.</p>

      <h2>The TMS Field app</h2>
      <ul>
        <li>The app is installed from our website, not from Google Play. Install it only from the TMS download page.</li>
        <li>The app offers updates when they are ready. Please install them.</li>
        <li>
          Records you make without internet stay on the phone until it can send them. If a phone is lost or reset before it has sent its
          records, those records may be lost. Send records when you can, and do not uninstall the app while records are waiting.
        </li>
      </ul>

      <h2>What we provide, and its limits</h2>
      <ul>
        <li>we aim to keep TMS working, but it may sometimes be unavailable, for example during updates or when a provider has problems</li>
        <li>we may change, add or remove features</li>
        <li>reports show what has been recorded. They are only as accurate as the records entered.</li>
      </ul>
      <p>As far as the law allows, we are not responsible for losses caused by TMS being unavailable or by records that are wrong or missing.</p>

      <h2>Privacy</h2>
      <p>
        Our <Link to="/privacy">Privacy page</Link> explains how we use personal information.
      </p>

      <h2>Help and support</h2>
      <p>
        Ask your project administrator first. You can also email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>

      <h2>Changes and the law</h2>
      <p>If we change these terms in a way that matters, we will update the date at the top. These terms are governed by the laws of Nigeria.</p>
    </LegalLayout>
  );
}
