import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { InfoTip } from '../components/InfoTip';
import { Pagination, usePage } from '../components/Pagination';
import { Lightbox, useViewUrl } from '../components/Photos';
import { EmptyState, ErrorNotice, fmtNum, PageHeader, SimpleTable, Tabs } from '../components/ui';
import { SPECIES_CHECK_TERMS } from '../glossary';
import { fmtLongDateTime } from '../time';

type State = 'open' | 'reviewed' | 'all';
type Colour = 'green' | 'amber' | 'red';
/** Rates based on fewer checked photos than this are not shown. */
const MIN_FOR_RATE = 5;

const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const COLOUR_LABEL: Record<Colour, string> = { green: 'Likely right', amber: 'Possibly wrong', red: 'Likely wrong' };
const PILL: Record<Colour, string> = { green: 'good', amber: 'warning', red: 'critical' };

/** "White Afara (Terminalia superba)", with the scientific name in italics. */
function SpeciesName({ scientific, common }: { scientific?: string | null; common?: string | null }) {
  if (!scientific) return <>—</>;
  return common ? <>{common} (<i>{scientific}</i>)</> : <i>{scientific}</i>;
}

/**
 * Species check (#101, #107): Pl@ntNet scores a daily sample of new tree photos against the recorded species.
 * Trees under 75% (amber and red) wait here for an administrator, who confirms the species or corrects it.
 */
export function SpeciesCheckPage() {
  const [state, setState] = useState<State>('open');
  const [projectId, setProjectId] = useState('');
  const projectFieldId = useId();
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
  const t = a?.totals;
  const rate = (r: any) => (r.checked < MIN_FOR_RATE ? <span className="muted">Not enough results yet</span> : pct(r.likely_right_rate));
  const row = (r: any, label: ReactNode) => [label, fmtNum(r.checked), fmtNum(r.green), fmtNum(r.amber), fmtNum(r.red), fmtNum(r.corrected), rate(r)];
  const head = ['Checked', 'Likely right', 'Possibly wrong', 'Likely wrong', 'Corrected', 'Share likely right'];
  const count = (n?: number) => (n == null ? '' : ` (${fmtNum(n)})`);

  return (
    <div className="stack species-check-page">
      <PageHeader
        title="Check tree species"
        subtitle={
          <>
            Each day, a sample of new tree photos is sent to Pl@ntNet, a plant identification service. It scores how likely the recorded species is.
            Trees scoring under 75% are listed here for you to check. Nothing changes until you decide.
          </>
        }
        actions={
          <div className="field inline-field">
            <label htmlFor={projectFieldId}>Project</label>
            <select id={projectFieldId} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        }
      />
      {s && !s.enabled && (
        <div className="notice warning" role="status">
          Species checking is turned off. To turn it on, add a Pl@ntNet API key as <code>PLANTNET_API_KEY</code> in the API’s settings on Render.
        </div>
      )}
      {s?.enabled && (
        <p className="muted" style={{ margin: 0 }}>
          {fmtNum(s.checked_today)} {s.checked_today === 1 ? 'photo' : 'photos'} checked today. Up to {fmtNum(s.daily_limit)} are checked each day.
          {s.quota_reached_today ? ' Pl@ntNet’s daily limit has been reached. Checking starts again tomorrow.' : ''}
        </p>
      )}

      {t && (
        <div className="grid stats">
          <div className="card stat">
            <span className="label">Likely right <InfoTip term={SPECIES_CHECK_TERMS.green} /></span>
            <span className="value">{fmtNum(t.green)} <span className="stat-of">of {fmtNum(t.checked)}</span></span>
            <span className="foot">{t.checked >= MIN_FOR_RATE ? `${pct(t.likely_right_rate)} of photos checked` : 'Not enough results yet'}</span>
          </div>
          <div className="card stat">
            <span className="label">Possibly wrong <InfoTip term={SPECIES_CHECK_TERMS.amber} /></span>
            <span className="value">{fmtNum(t.amber)}</span>
            <span className="foot">Score from 25% to 74%</span>
          </div>
          <div className="card stat">
            <span className="label">Likely wrong <InfoTip term={SPECIES_CHECK_TERMS.red} /></span>
            <span className="value">{fmtNum(t.red)}</span>
            <span className="foot">Score under 25%</span>
          </div>
          <div className="card stat">
            <span className="label">Reviewed <InfoTip term={SPECIES_CHECK_TERMS.reviewed} /></span>
            <span className="value">{fmtNum(t.kept + t.corrected)}</span>
            <span className="foot">{fmtNum(t.corrected)} corrected, {fmtNum(t.kept)} confirmed</span>
          </div>
        </div>
      )}

      <Tabs<State>
        tabs={[['open', `To review${count(t?.to_review)}`], ['reviewed', `Reviewed${count(t ? t.kept + t.corrected : undefined)}`], ['all', `All checked${count(t?.checked)}`]]}
        value={state}
        onChange={(v) => {
          setState(v);
          page.go(0);
        }}
      />
      <ErrorNotice error={list.error} />
      {list.data && list.data.items.length === 0 && (
        <EmptyState title={state === 'open' ? 'Nothing to review' : state === 'reviewed' ? 'No trees reviewed yet' : 'No photos checked yet'}>
          {state === 'open' ? 'Every checked photo scored 75% or more, or has been reviewed.' : 'Photos are checked after they sync.'}
        </EmptyState>
      )}
      <div className="stack">
        {list.data?.items.map((c) => <CheckCard key={c.id} c={c} />)}
      </div>
      {list.data && <Pagination page={page} total={list.data.total} label="trees" />}

      {a && a.by_officer.length > 0 && (
        <div className="stack">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Results by officer</h2>
            <SimpleTable head={['Officer', ...head]} numeric={[1, 2, 3, 4, 5, 6]} rows={a.by_officer.map((r: any) => row(r, r.name))} />
          </section>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Results by species</h2>
            <SimpleTable
              head={['Species', ...head]}
              numeric={[1, 2, 3, 4, 5, 6]}
              rows={a.by_species.map((r: any) => row(r, <SpeciesName scientific={r.scientific_name} common={r.common_name} />))}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function CheckCard({ c }: { c: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [other, setOther] = useState('');
  const groupName = useId();
  const media = { id: c.media_id, upload_state: 'VERIFIED' };
  const thumb = useViewUrl(media, 'thumb');
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species'), enabled: c.review_state === 'OPEN' });
  const review = useMutation({
    mutationFn: (body: { action: 'keep' } | { action: 'correct'; species_id: string }) => api.post(`/species-checks/${c.id}/review`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['species-checks'] });
      qc.invalidateQueries({ queryKey: ['species-agreement'] });
      qc.invalidateQueries({ queryKey: ['trees'] });
    },
  });
  const colour = c.colour as Colour;
  const reviewed = c.review_state === 'KEPT' || c.review_state === 'CORRECTED';
  const top = (c.results ?? [])[0];
  // Pl@ntNet's suggestion is one of your species when it matches the closest species on your list.
  const topIsListed = !!c.top_name && c.suggested_scientific_name?.toLowerCase() === c.top_name.toLowerCase();
  const topCommon = topIsListed ? c.suggested_common_name : top?.commonNames?.[0];
  const suggestedName = c.suggested_common_name ?? c.suggested_scientific_name;
  return (
    <article className="card species-check">
      <button className="species-check-photo" onClick={() => setOpen(true)} aria-label={`Open the photo of tree ${c.physical_tree_id}`}>
        {thumb.data ? <img src={thumb.data.url} alt="" /> : <span className="muted">Loading…</span>}
      </button>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/trees/${c.tree_id}`} className="mono"><strong>{c.physical_tree_id}</strong></Link>
          {reviewed ? (
            <span className="pill good">{c.review_state === 'KEPT' ? 'Confirmed' : 'Corrected'}</span>
          ) : (
            colour && <span className={`pill ${PILL[colour]}`}>{COLOUR_LABEL[colour]}</span>
          )}
        </div>
        <div className="muted">
          Recorded by {c.recorded_by_name ?? 'an unknown officer'} · checked {fmtLongDateTime(c.checked_at)}
        </div>
        <dl className="species-check-facts">
          <div>
            <dt>Recorded as</dt>
            <dd>
              <SpeciesName scientific={c.claimed_scientific_name} common={c.claimed_common_name} />
              <span className={`species-match ${colour ?? ''}`} style={{ marginLeft: 10 }}><span className="dot" aria-hidden />Pl@ntNet’s score: {pct(c.claimed_score)}</span>
            </dd>
          </div>
          <div>
            <dt>Pl@ntNet suggests</dt>
            <dd>
              {c.top_name ? (
                <>
                  <SpeciesName scientific={c.top_name} common={topCommon} /> · {pct(c.top_score)}
                  {!topIsListed && <span className="muted"> · Not on your species list</span>}
                </>
              ) : (
                <span className="muted">No plant found in the photo</span>
              )}
            </dd>
          </div>
          {!topIsListed && c.suggested_scientific_name && c.suggested_score >= 0.1 && (
            <div>
              <dt>Closest species on your list</dt>
              <dd>
                <SpeciesName scientific={c.suggested_scientific_name} common={c.suggested_common_name} /> · {pct(c.suggested_score)}
              </dd>
            </div>
          )}
        </dl>
        {c.current_species_id !== c.claimed_species_id && (
          <div className="muted">
            Now recorded as <SpeciesName scientific={c.current_scientific_name} common={c.current_common_name} />.
          </div>
        )}
        {c.review_state === 'OPEN' ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <button disabled={review.isPending} onClick={() => review.mutate({ action: 'keep' })}>Species is correct</button>
              {c.suggested_species_id && (c.suggested_score ?? 0) >= 0.1 && (
                <button disabled={review.isPending} onClick={() => review.mutate({ action: 'correct', species_id: c.suggested_species_id })}>
                  Change species to {suggestedName}
                </button>
              )}
              <button type="button" className="link-button" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
                Choose a different species
              </button>
            </div>
            {c.top_name && !topIsListed && <p className="muted" style={{ margin: 0 }}>Pl@ntNet’s suggestion isn’t on your species list, so it can’t be chosen here.</p>}
            {choosing && (
              <fieldset className="species-choice">
                <legend>Change species to</legend>
                {(species.data ?? [])
                  .filter((sp) => sp.active && sp.id !== c.current_species_id)
                  .map((sp) => (
                    <label key={sp.id} className="radio">
                      <input type="radio" name={groupName} value={sp.id} checked={other === sp.id} onChange={() => setOther(sp.id)} />
                      <span>
                        <SpeciesName scientific={sp.scientific_name} common={sp.common_name} />
                      </span>
                    </label>
                  ))}
                <div>
                  <button className="primary" disabled={!other || review.isPending} onClick={() => review.mutate({ action: 'correct', species_id: other })}>
                    Change species
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        ) : reviewed ? (
          <div className="muted">
            {c.review_state === 'KEPT' ? 'Confirmed' : 'Corrected'} by {c.reviewed_by_name} · {fmtLongDateTime(c.reviewed_at)}
          </div>
        ) : null}
        <ErrorNotice error={review.error} />
      </div>
      {open && <Lightbox media={[media]} index={0} onClose={() => setOpen(false)} />}
    </article>
  );
}
