import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useIsAdmin } from '../auth';
import { ErrorNotice, Field, fmtDate, fmtDateTime, Modal, RecordStatePill, StatusPill } from '../components/ui';

export function TreeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const [correcting, setCorrecting] = useState(false);
  const tree = useQuery({ queryKey: ['tree', id], queryFn: () => api.get(`/trees/${id}`) });
  const t = tree.data;
  if (tree.error) return <ErrorNotice error={tree.error} />;
  if (!t) return null;
  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <div className="muted"><Link to="/trees">Trees</Link> / {t.project_name}</div>
          <h1 className="mono">{t.physical_tree_id}</h1>
        </div>
        <StatusPill code={t.status_code} name={t.status_name} />
        <RecordStatePill state={t.record_state} />
        <span className="spacer" />
        {isAdmin && <button onClick={() => setCorrecting(true)}>Correct serial</button>}
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>Registration</h2>
          <dl className="kv">
            <dt>Internal ID</dt><dd className="mono" style={{ fontSize: 12 }}>{t.id}</dd>
            <dt>Planting year</dt><dd>{t.year_label}</dd>
            <dt>Area</dt><dd>{t.sector_code} · {t.sector_name} / {t.sub_sector_code} · {t.sub_sector_name}</dd>
            <dt>Species</dt><dd>{t.species_name}{t.species_common_name && ` (${t.species_common_name})`}</dd>
            <dt>Vendor</dt><dd>{t.vendor_name ?? '—'}</dd>
            <dt>Planted on</dt><dd>{fmtDate(t.planted_on)}</dd>
            <dt>ID format</dt>
            <dd>
              Version {t.id_scheme_version}:{' '}
              {t.id_components_snapshot.components.map((c: any) => (
                <span key={c.type} className="mono" title={c.type} style={{ marginRight: 6 }}>
                  {c.value ?? '∅'}{c.matches_current_code === false && <span className="muted"> (code since changed)</span>}
                </span>
              ))}
            </dd>
            <dt>Registered</dt><dd>{fmtDateTime(t.created_at)} by {t.created_by_name}</dd>
            <dt>Synced</dt><dd>{fmtDateTime(t.synced_at)}</dd>
            <dt>Revision</dt><dd>{t.revision}</dd>
            {t.notes && (<><dt>Notes</dt><dd>{t.notes}</dd></>)}
          </dl>
          <p className="muted" style={{ marginBottom: 0 }}>Location is the sub-sector; individual trees carry no GPS position.</p>
        </section>

        <section className="card">
          <h2>Replacement lineage</h2>
          {t.lineage.length <= 1 ? (
            <p className="muted">This tree has not been replaced and does not replace another tree.</p>
          ) : (
            <ol className="timeline">
              {t.lineage.map((l: any) => (
                <li key={l.id}>
                  <div>
                    {l.id === t.id ? <strong className="mono">{l.physical_tree_id}</strong> : <Link className="mono" to={`/trees/${l.id}`}>{l.physical_tree_id}</Link>}{' '}
                    <span className="muted">· planting year {l.year_label} · {l.status_name ?? 'not observed'}</span>
                  </div>
                  <div className="muted">{l.generation < 0 ? 'Original (replaced)' : l.generation === 0 ? 'This tree' : `Replacement generation ${l.generation}`}</div>
                </li>
              ))}
            </ol>
          )}
          {t.physical_id_history.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>ID corrections</h3>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {t.physical_id_history.map((h: any) => (
                  <li key={h.id}>
                    <span className="mono">{h.previous_physical_id}</span> → <span className="mono">{h.new_physical_id}</span>
                    <div className="muted">{fmtDateTime(h.changed_at)} by {h.changed_by_name}: {h.reason}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Observation history</h2>
        <ol className="timeline">
          {t.observations.map((o: any) => (
            <li key={o.id} className={o.superseded ? 'superseded' : ''}>
              <div className="row">
                <StatusPill code={o.status_code} name={o.status_name} />
                <strong>{fmtDateTime(o.observed_at)}</strong>
                {o.is_initial && <span className="pill">Registration</span>}
                {o.is_amendment && <span className="pill warning">Correction</span>}
                {o.superseded && <span className="pill">Superseded by a correction</span>}
              </div>
              <div className="muted">
                Recorded by {o.recorded_by_name} on {fmtDateTime(o.recorded_at)} · synced {fmtDateTime(o.synced_at)}
              </div>
              {o.amendment_reason && <div>Correction reason: {o.amendment_reason}</div>}
              {o.remarks && <div>{o.remarks}</div>}
              <Photos media={t.media.filter((m: any) => m.observation_id === o.id)} />
            </li>
          ))}
        </ol>
        <Photos media={t.media.filter((m: any) => !m.observation_id)} label="Other photos" />
      </section>
      {correcting && <CorrectSerial tree={t} onClose={() => setCorrecting(false)} />}
    </div>
  );
}

function Photos({ media, label }: { media: any[]; label?: string }) {
  if (media.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {label && <h3>{label}</h3>}
      <div className="row">{media.map((m) => <Photo key={m.id} media={m} />)}</div>
    </div>
  );
}

function Photo({ media }: { media: any }) {
  const url = useQuery({ queryKey: ['media-url', media.id], queryFn: () => api.get(`/media/${media.id}/view-url`), enabled: media.upload_state === 'VERIFIED', staleTime: 240_000 });
  if (media.upload_state !== 'VERIFIED') return <span className="pill warning">Photo {media.upload_state === 'FAILED' ? 'failed verification' : 'still uploading'}</span>;
  if (!url.data) return <span className="muted">Loading photo…</span>;
  return (
    <a href={url.data.url} target="_blank" rel="noreferrer">
      <img src={url.data.url} alt={`Tree photo captured ${fmtDateTime(media.captured_at)}`} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
    </a>
  );
}

function CorrectSerial({ tree, onClose }: { tree: any; onClose: () => void }) {
  const [serial, setSerial] = useState(tree.serial_number);
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/trees/${tree.id}/physical-id-corrections`, { serial_input: serial, reason }), onSuccess: onClose });
  const prefix = tree.physical_tree_id.slice(0, tree.physical_tree_id.length - tree.serial_number.length);
  return (
    <Modal title="Correct the serial number" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <p className="subtle" style={{ margin: 0 }}>Use this when the registered serial does not match the physical label. The previous ID is kept in the tree’s history and the change is audited.</p>
        <ErrorNotice error={save.error} />
        <div className="id-preview">{prefix}<span className="serial">{serial.padStart(tree.serial_number.length, '0')}</span></div>
        <Field label="Serial"><input required inputMode="numeric" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Reason"><textarea required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save correction</button>
        </div>
      </form>
    </Modal>
  );
}
