import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { auth } from './api/client';
import { useAuth } from './auth';
import { TooltipProvider } from './charts/Tooltip';
import { Layout } from './components/Layout';
import { AuditPage } from './pages/Audit';
import { ClientLinksPage } from './pages/ClientLinks';
import { ConflictsPage } from './pages/Conflicts';
import { DashboardPage } from './pages/Dashboard';
import { FieldActivityPage } from './pages/FieldActivity';
import { LandingPage } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ProjectsPage } from './pages/Projects';
import { ReferencePage } from './pages/Reference';
import { SettingsPage } from './pages/Settings';
import { SharePage } from './pages/Share';
import { TreeDetailPage } from './pages/TreeDetail';
import { TreesPage } from './pages/Trees';
import { UsersPage } from './pages/Users';
import { VisitsPage } from './pages/Visits';
import './styles.css';
import { GlossaryPage } from './pages/Glossary';
import { PrivacyPage, TermsPage } from './pages/Legal';
import { SpeciesCheckPage } from './pages/SpeciesCheck';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, placeholderData: (prev: unknown) => prev } },
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  }),
});

/** Client share links (/share/:token), the app download page (/download), /privacy and /terms are public: they render without signing in. */
function Root() {
  return (
    <Routes>
      <Route path="/share/:token/*" element={<SharePage />} />
      <Route path="/download" element={<LandingPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="*" element={<App />} />
    </Routes>
  );
}

function App() {
  const user = useAuth();
  const { pathname } = useLocation();
  // Visitors see the landing page at /; any other address (e.g. /login) asks them to sign in.
  if (!user) return pathname === '/' ? <LandingPage /> : <LoginPage />;
  if (user.role === 'FIELD_OFFICER') {
    return (
      <div className="main">
        <div className="notice">Field officers use the Android app. <a href="/download">Download it here.</a></div>
        <button style={{ marginTop: 12 }} onClick={() => auth.logout()}>Sign out</button>
      </div>
    );
  }
  const admin = user.role === 'ADMIN';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {/* The density map now lives on client reports, once areas have GPS outlines. */}
        <Route path="density" element={<Navigate to="/" replace />} />
        <Route path="trees" element={<TreesPage />} />
        <Route path="trees/:id" element={<TreeDetailPage />} />
        <Route path="visits" element={<VisitsPage />} />
        <Route path="field-activity" element={<FieldActivityPage />} />
        <Route path="glossary" element={<GlossaryPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        {admin && <Route path="client-links" element={<ClientLinksPage />} />}
        {admin && <Route path="conflicts" element={<ConflictsPage />} />}
        {admin && <Route path="species-check" element={<SpeciesCheckPage />} />}
        {admin && <Route path="reference" element={<ReferencePage />} />}
        {admin && <Route path="users" element={<UsersPage />} />}
        {admin && <Route path="audit" element={<AuditPage />} />}
        {admin && <Route path="settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
