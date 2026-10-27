import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { copyText, EXPIRY, linkState, ShareLink, shareUrl } from '../components/ShareLinks';
import { EmptyState, ErrorNotice, Field, fmtDate, Modal, PageHeader, relativeTime, RowMenu } from '../components/ui';

/** Every read-only client link across projects: create, copy, open and revoke them in one place. */
export function ClientLinksPage() {
  const links = useQuery({ queryKey: ['share-links'], queryFn: () => api.get<ShareLink[]>('/share-links') });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/share-links/${id}/revoke`) });
  const [creating, setCreating] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (l: ShareLink) => {
    if (l.path && (await copyText(shareUrl(l.path)))) {
      setCopied(l.id);
      setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 2000);
    }
  };
  const all = links.data ?? [];
  const active = all.filter((l) => l.status === 'ACTIVE');
  const shown = showOld ? all : active;

  return (
    <div className="stack">
      <PageHeader
        title="Client links"
        subtitle="Read-only links that show a client one project's results: charts, maps and exports, without an account."
        actions={<button className="primary" onClick={() => setCreating(true)}>+ New link</button>}
      />
      <ErrorNotice error={links.error ?? revoke.error} />
      <div className="row">
        <span className="muted">{active.length} active of {all.length}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <label className="check">
          <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show revoked and expired
        </label>
      </div>
      <div className={`card table-wrap ${links.isFetching ? 'refetching' : ''}`}>
        {shown.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Project</th><th>For</th><th className="hide-sm">Created</th><th className="hide-sm">Expires</th><th className="hide-sm">Last used</th><th>State</th><th className="actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const [tone, state] = linkState(l);
                const usable = state === 'Active';
                return (
                  <tr key={l.id}>
                    <td>{l.project_name}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{l.label || <span className="muted">Untitled link</span>}</td>
                    <td className="nowrap hide-sm" title={l.created_by_name ? `by ${l.created_by_name}` : undefined}>{fmtDate(l.created_at)}</td>
                    <td className="nowrap hide-sm">{l.expires_at ? fmtDate(l.expires_at) : 'Never'}</td>
                    <td className="nowrap hide-sm">{relativeTime(l.last_used_at)}</td>
                    <td><span className={`pill ${tone}`}>{state}</span></td>
                    <td className="actions nowrap">
                      {usable && l.path && (
                        <>
                          <button onClick={() => copy(l)}>{copied === l.id ? 'Copied' : 'Copy link'}</button>{' '}
                          <a className="btn" href={shareUrl(l.path)} target="_blank" rel="noreferrer">Open</a>
                        </>
                      )}
                      {usable && !l.path && <span className="muted" title="Made before links could be copied again: create a new one for this client, then revoke this one.">Cannot copy</span>}
                      {usable && (
                        <RowMenu
                          items={[{ label: 'Revoke', danger: true, onClick: () => confirm(`Revoke “${l.label || 'Untitled link'}” for ${l.project_name}? Anyone using it loses access.`) && revoke.mutate(l.id) }]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {links.data && shown.length === 0 && (
          <EmptyState title={all.length ? 'No active links' : 'No client links yet'} action={<button className="primary" onClick={() => setCreating(true)}>+ New link</button>}>
            Create a link for a client or sponsor to follow a project&rsquo;s progress.
          </EmptyState>
        )}
        {links.isLoading && <div className="empty">Loading…</div>}
      </div>
      {creating && <NewLinkForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewLinkForm({ onClose }: { onClose: () => void }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const [projectId, setProjectId] = useState('');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('90');
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<{ path: string }>(`/projects/${projectId}/share-links`, { label: label.trim() || null, expires_in_days: days ? Number(days) : null }),
  });
  const url = create.data ? shareUrl(create.data.path) : null;
  const project = projects.data?.find((p) => p.id === projectId);

  return (
    <Modal title={url ? 'Link ready' : 'New client link'} onClose={onClose}>
      {url ? (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0 }}>
            {project?.name}{label.trim() ? ` · for ${label.trim()}` : ''}. Send it to the client; you can copy it again from this page while it is active.
          </p>
          <input id="new-share-url" className="mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
          <div className="form-actions">
            <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
            <button className="primary" onClick={async () => setCopied(await copyText(url, 'new-share-url'))}>{copied ? 'Copied' : 'Copy link'}</button>
            <button onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <ErrorNotice error={create.error ?? projects.error} />
          <div className="form-grid">
            <Field label="Project">
              <select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Choose…</option>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Who is it for?">
              <input maxLength={120} placeholder="Client name" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Expires">
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                {EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!projectId || create.isPending}>{create.isPending ? 'Creating…' : 'Create link'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
