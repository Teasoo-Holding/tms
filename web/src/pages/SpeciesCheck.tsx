import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { InfoTip } from '../components/InfoTip';
import { Pagination, usePage } from '../components/Pagination';
import { Lightbox, useViewUrl } from '../components/Photos';
import { EmptyState, ErrorNotice, fmtNum, PageHeader, SimpleTable, Tabs } from '../components/ui';
import { SPECIES_CHECK_TERMS } from '../glossary';
import { fmtDateTime } from '../time';

type State = 'open' | 'reviewed' | 'all';
const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const speciesName = (sci?: string | null, common?: string | null) => (sci ? (common ? `${common} (${sci})` : sci) : '—');

/**
 * Species check (#101): Pl@ntNet's view of a daily sample of registration photos. Clear disagreements with the
 * officer's species wait here for an administrator, who keeps the officer's species or corrects it.
 */
export function SpeciesCheckPage() {
  const [state, setState] = useState<State>('open');
  const [projectId, setProjectId] = useState('');
  const page = usePage('', 25);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  const status = useQuery({ queryKey: ['species-check-status'], queryFn: () => api.get<any>('/species-checks/status'), refetchInterval: 60_000 });
  const list = useQuery({
    queryKey: ['species-checks', state, projectId, page.offset, page.limit],
    queryFn: () => api.get<{ items: any[]; total: number }>(`/species-checks${qs({ state, project_id: projectId || undefined, limit: page.limit, offset: page.offset })}`),
  });
  const agreement = useQuery({ queryKey: ['species-agreement', projectId], queryFn: () => api.get<any>(`/species-checks/agreement${qs({ project_id: projectId || undefined })}`) });
  const s = status.data;
  const a = agreement.data;
  const row = (r: any, label: string) => [label, fmtNum(r.checked), fmtNum(r.agree), fmtNum(r.disagree), fmtNum(r.unsure), fmtNum(r.corrected), pct(r.agreement_rate)];
  const head = ['Checked', 'Agree', 'Disagree', 'Unsure', 'Corrected', 'Agreement'];

  return (
    <div className="stack">
      <PageHeader
        title="Species check"
        subtitle="Pl@ntNet looks at a daily sample of registration photos and suggests the species. Where it clearly disagrees with the officer, the tree waits here for review. Nothing changes until you decide."
        actions={
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        }
      />
      {s && !s.enabled && (
        <div className="notice warning" role="status">
          The species check is off. Add a Pl@ntNet API key as <code>PLANTNET_API_KEY</code> in the API's settings on Render to turn it on.
        </div>
      )}
      {s?.enabled && (
        <p className="muted" style={{ margin: 0 }}>
          {fmtNum(s.checked_today)} of {fmtNum(s.daily_limit)} photos checked today{s.quota_reached_today ? ' (Pl@ntNet’s daily limit reached; checks resume tomorrow)' : ''}.
          Checks run every 15 minutes, spread through the day.
        </p>
      )}

      {a && (
        <div className="grid stats">
          <div className="card stat">
            <span className="label">Agreement rate <InfoTip term={SPECIES_CHECK_TERMS.agreement} /></span>
            <span className="value">{pct(a.totals.agreement_rate)}</span>
            <span className="foot">{fmtNum(a.totals.checked)} photos checked</span>
          </div>
          <div className="card stat">
            <span className="label">To review <InfoTip term={SPECIES_CHECK_TERMS.disagree} /></span>
            <span className="value">{fmtNum(a.totals.to_review)}</span>
          </div>
          <div className="card stat">
            <span className="label">Corrected</span>
            <span className="value">{fmtNum(a.totals.corrected)}</span>
            <span className="foot">{fmtNum(a.totals.kept)} kept as recorded</span>
          </div>
          <div className="card stat">
            <span className="label">Unsure <InfoTip term={SPECIES_CHECK_TERMS.unsure} /></span>
            <span className="value">{fmtNum(a.totals.unsure)}</span>
          </div>
        </div>
      )}

      <Tabs<State> tabs={[['open', 'To review'], ['reviewed', 'Reviewed'], ['all', 'All checked']]} value={state} onChange={(t) => { setState(t); page.go(0); }} />
      <ErrorNotice error={list.error} />
      {list.data && list.data.items.length === 0 && (
        <EmptyState title={state === 'open' ? 'Nothing to review' : 'No checked photos yet'}>
          {state === 'open' ? 'Pl@ntNet agrees with the officers, or is unsure, on every photo checked so far.' : 'Photos are checked after they sync.'}
        </EmptyState>
      )}
      <div className="stack">
        {list.data?.items.map((c) => <CheckCard key={c.id} c={c} />)}
      </div>
      {list.data && <Pagination page={page} total={list.data.total} />}

      {a && a.by_officer.length > 0 && (
        <div className="stack">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>By officer</h2>
            <SimpleTable head={['Officer', ...head]} numeric={[1, 2, 3, 4, 5, 6]} rows={a.by_officer.map((r: any) => row(r, r.name))} />
          </section>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>By species</h2>
            <SimpleTable head={['Species', ...head]} numeric={[1, 2, 3, 4, 5, 6]} rows={a.by_species.map((r: any) => row(r, speciesName(r.scientific_name, r.common_name)))} />
          </section>
        </div>
      )}
    </div>
  );
}

function CheckCard({ c }: { c: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  const media = { id: c.media_id, upload_state: 'VERIFIED' };
  const thumb = useViewUrl(media, 'thumb');
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species'), enabled: c.review_state === 'OPEN' });
  const review = useMutation({
    mutationFn: (body: { action: 'keep' } | { action: 'correct'; species_id: string }) => api.post(`/species-checks/${c.id}/review`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['species-checks'] });
      qc.invalidateQueries({ queryKey: ['species-agreement'] });
    },
  });
  const verdict: Record<string, string> = { AGREE: 'Agrees', DISAGREE: 'Disagrees', UNSURE: 'Unsure' };
  return (
    <article className="card species-check">
      <button className="species-check-photo" onClick={() => setOpen(true)} aria-label="Open the photo">
        {thumb.data ? <img src={thumb.data.url} alt={`Registration photo of tree ${c.physical_tree_id}`} /> : <span className="muted">Loading…</span>}
      </button>
      <div className="stack" style={{ gap: 6 }}>
        <div>
          <Link to={`/trees/${c.tree_id}`} className="mono"><strong>{c.physical_tree_id}</strong></Link>
          <span className="muted"> · {c.recorded_by_name ?? 'Unknown officer'} · checked {fmtDateTime(c.checked_at)}</span>
          {' '}<span className={`pill ${c.verdict === 'DISAGREE' ? 'critical' : c.verdict === 'AGREE' ? 'good' : ''}`}>{verdict[c.verdict]}</span>
        </div>
        <div>
          Officer chose <strong>{speciesName(c.claimed_scientific_name, c.claimed_common_name)}</strong>
          <span className="muted"> · Pl@ntNet {pct(c.claimed_score)}</span>
        </div>
        <div>
          Pl@ntNet suggests <strong>{c.top_name ?? 'no plant found'}</strong> <span className="muted">{c.top_name ? pct(c.top_score) : ''}</span>
          {c.top_name && c.suggested_scientific_name?.toLowerCase() !== c.top_name.toLowerCase() && (
            <span className="muted">{c.suggested_scientific_name ? ` · closest of your species: ${c.suggested_scientific_name} ${pct(c.suggested_score)}` : ' · not one of your species'}</span>
          )}
        </div>
        {c.current_species_id !== c.claimed_species_id && (
          <div className="muted">Now recorded as {speciesName(c.current_scientific_name, c.current_common_name)}.</div>
        )}
        {c.review_state === 'OPEN' ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <button disabled={review.isPending} onClick={() => review.mutate({ action: 'keep' })}>Keep the officer’s species</button>
            {c.suggested_species_id && (
              <button className="primary" disabled={review.isPending} onClick={() => review.mutate({ action: 'correct', species_id: c.suggested_species_id })}>
                Change to {c.suggested_common_name ?? c.suggested_scientific_name}
              </button>
            )}
            <select aria-label="Another species" value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Another species…</option>
              {(species.data ?? []).filter((s) => s.active && s.id !== c.claimed_species_id).map((s) => (
                <option key={s.id} value={s.id}>{speciesName(s.scientific_name, s.common_name)}</option>
              ))}
            </select>
            {other && <button disabled={review.isPending} onClick={() => review.mutate({ action: 'correct', species_id: other })}>Change</button>}
          </div>
        ) : c.review_state ? (
          <div className="muted">
            {c.review_state === 'KEPT' ? 'Kept as recorded' : 'Corrected'} by {c.reviewed_by_name} · {fmtDateTime(c.reviewed_at)}
          </div>
        ) : null}
        <ErrorNotice error={review.error} />
      </div>
      {open && <Lightbox media={[media]} index={0} onClose={() => setOpen(false)} />}
    </article>
  );
}
