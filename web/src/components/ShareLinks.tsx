import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { EmptyState, ErrorNotice, Field, fmtDate, Modal, relativeTime, RowMenu } from './ui';

interface ShareLink {
  id: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  created_by_name: string | null;
}

const EXPIRY: [string, string][] = [['', 'Never'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']];

function linkState(l: ShareLink): ['good' | 'critical' | '', string] {
  if (l.revoked_at) return ['critical', 'Revoked'];
  if (l.expires_at && new Date(l.expires_at).getTime() < Date.now()) return ['', 'Expired'];
  return ['good', 'Active'];
}

/** Read-only client links for one project: create (token shown once), list and revoke. */
export function ShareLinksModal({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const links = useQuery({ queryKey: ['share-links', projectId], queryFn: () => api.get<ShareLink[]>(`/projects/${projectId}/share-links`) });
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('90');
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<{ path: string; token: string }>(`/projects/${projectId}/share-links`, { label: label.trim() || null, expires_in_days: days ? Number(days) : null }),
    onSuccess: () => {
      setLabel('');
      setCopied(false);
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/share-links/${id}/revoke`) });
  const url = create.data ? `${window.location.origin}/share/${create.data.token}` : null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
  };

  return (
    <Modal title={`Share ${projectName}`} onClose={onClose}>
      <div className="stack">
        {url ? (
          <div className="stack share-new" style={{ gap: 10 }}>
            <strong>Link ready</strong>
            <input id="share-url" className="mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
            <div className="row">
              <button className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
              <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="link" onClick={() => create.reset()}>New link</button>
            </div>
            <div className="notice warning">Copy it now: this link is shown only once.</div>
          </div>
        ) : (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => (e.preventDefault(), create.mutate())}>
            <ErrorNotice error={create.error} />
            <div className="form-grid">
              <Field label="Who is it for?">
                <input maxLength={120} placeholder="Client name" value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label="Expires">
                <select value={days} onChange={(e) => setDays(e.target.value)}>
                  {EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div>
              <button className="primary" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create link'}</button>
            </div>
          </form>
        )}

        <div>
          <h3 style={{ marginTop: 8 }}>Links</h3>
          <ErrorNotice error={links.error ?? revoke.error} />
          {links.data?.length === 0 && <EmptyState title="No links yet" />}
          <ul className="item-list">
            {links.data?.map((l) => {
              const [tone, state] = linkState(l);
              return (
                <li key={l.id}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong style={{ overflowWrap: 'anywhere' }}>{l.label || 'Untitled link'}</strong>
                      <span className={`pill ${tone}`}>{state}</span>
                    </div>
                    <div className="muted">
                      Created {fmtDate(l.created_at)} · last used {relativeTime(l.last_used_at)} · {l.expires_at ? `expires ${fmtDate(l.expires_at)}` : 'no expiry'}
                    </div>
                  </div>
                  {state === 'Active' && (
                    <RowMenu
                      items={[{ label: 'Revoke', danger: true, onClick: () => confirm(`Revoke “${l.label || 'Untitled link'}”? Anyone using it loses access.`) && revoke.mutate(l.id) }]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
