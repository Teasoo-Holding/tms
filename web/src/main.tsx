import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { TooltipProvider } from './charts/Tooltip';
import { Layout } from './components/Layout';
import { AuditPage } from './pages/Audit';
import { ConflictsPage } from './pages/Conflicts';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ProjectsPage } from './pages/Projects';
import { ReferencePage } from './pages/Reference';
import { TreeDetailPage } from './pages/TreeDetail';
import { TreesPage } from './pages/Trees';
import { UsersPage } from './pages/Users';
import './styles.css';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, placeholderData: (prev: unknown) => prev } },
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  }),
});

function App() {
  const user = useAuth();
  if (!user) return <LoginPage />;
  if (user.role === 'FIELD_OFFICER') {
    return (
      <div className="main">
        <div className="notice">Field officers use the Android app. This web portal is for administrators and executives.</div>
      </div>
    );
  }
  const admin = user.role === 'ADMIN';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="trees" element={<TreesPage />} />
        <Route path="trees/:id" element={<TreeDetailPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        {admin && <Route path="conflicts" element={<ConflictsPage />} />}
        {admin && <Route path="reference" element={<ReferencePage />} />}
        {admin && <Route path="users" element={<UsersPage />} />}
        {admin && <Route path="audit" element={<AuditPage />} />}
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
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
