import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useIsAdmin } from '../auth';
import { ChartEmpty, LineChart, SERIES } from '../charts/charts';
import { CardHeader, ErrorNotice, Field, fmtDate, fmtDateTime, Modal, PageHeader, RecordStatePill, StatusPill } from '../components/ui';
import type { CustomField } from './ProjectDetail';

export function TreeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const [correcting, setCorrecting] = useState(false);
  const [lightbox, setLightbox] = useState<{ media: any[]; index: number; observation?: any } | null>(null);
  const tree = useQuery({ queryKey: ['tree', id], queryFn: () => api.get(`/trees/${id}`) });
  const t = tree.data;
  const defs = useQuery({
    queryKey: ['custom-fields', t?.project_id],
    queryFn: () => api.get<CustomField[]>(`/projects/${t.project_id}/custom-fields`),
    enabled: !!t?.project_id,
  });
  if (tree.error) return <ErrorNotice error={tree.error} />;
  if (!t) return null;
  const media: any[] = t.media ?? [];
  const observations: any[] = t.observations ?? [];
  const treeDefs = (defs.data ?? []).filter((d) => d.applies_to === 'TREE');
  const obsDefs = (defs.data ?? []).filter((d) => d.applies_to === 'OBSERVATION');
  const heights = observations
    .filter((o) => !o.superseded && o.height_cm != null)
    .map((o) => ({ x: new Date(o.observed_at).getTime(), y: Number(o.height_cm) }))
    .sort((a, b) => a.x - b.x);
  return (
    <div className="stack">
      <PageHeader
        crumbs={<><Link to="/trees">Trees</Link> / {t.project_name}</>}
        title={t.physical_tree_id}
        mono
        subtitle="Registration details, custom data, growth and every observation recorded for this tree."
        actions={
          <>
            <Link className="btn" to={`/visits?q=${encodeURIComponent(t.physical_tree_id)}`}>All visits for this tree</Link>
            {isAdmin && <button onClick={() => setCorrecting(true)}>Correct serial</button>}
          </>
        }
      >
        <StatusPill code={t.status_code} name={t.status_name} />
        <RecordStatePill state={t.record_state} />
      </PageHeader>

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
          <h3 style={{ marginTop: 16 }}>Custom fields</h3>
          <CustomValues values={t.custom_fields} defs={treeDefs} empty="No custom fields recorded at registration." />
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
        <CardHeader title="Growth" description="Height at each visit (corrected entries replace the originals)." />
        {heights.length < 2 ? (
          <ChartEmpty>Record height on at least two visits to see growth.{heights.length === 1 && ` One height so far: ${fmtHeight(heights[0].y)}.`}</ChartEmpty>
        ) : (
          <LineChart
            series={[{ key: 'height', label: 'Height', color: SERIES[2], points: heights }]}
            unit="cm"
            xFormat={(x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}
            ariaLabel={`Height of tree ${t.physical_tree_id} over time`}
          />
        )}
      </section>

      <section className="card">
        <CardHeader title="Observation history" description="Newest first. Superseded entries were replaced by a correction and are kept for the record." />
        {observations.length === 0 && <div className="empty">No observations recorded yet.</div>}
        <ol className="timeline">
          {observations.map((o: any) => {
            const photos = media.filter((m: any) => m.observation_id === o.id);
            return (
              <li key={o.id} className={o.superseded ? 'superseded' : ''}>
                <div className="row">
                  <StatusPill code={o.status_code} name={o.status_name} />
                  <strong>{fmtDateTime(o.observed_at)}</strong>
                  {o.is_initial && <span className="pill">Registration</span>}
                  {o.is_amendment && <span className="pill warning">Correction</span>}
                  {o.superseded && <span className="pill">Superseded by a correction</span>}
                </div>
                <div className="muted">
                  Recorded by <strong className="subtle">{o.recorded_by_name ?? 'unknown'}</strong> on {fmtDateTime(o.recorded_at ?? o.observed_at)} · synced {fmtDateTime(o.synced_at)}
                </div>
                <dl className="obs-meta">
                  <div>
                    <dt>Height</dt>
                    <dd>
                      {o.height_cm != null ? (
                        <>
                          <strong>{fmtHeight(Number(o.height_cm))}</strong>{' '}
                          <span className="muted">({o.height_method === 'PHOTO_REFERENCE' ? 'measured on photo' : 'entered'})</span>
                        </>
                      ) : (
                        <span className="muted">not recorded</span>
                      )}
                    </dd>
                  </div>
                  {customEntries(o.custom_fields, obsDefs).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {o.amendment_reason && <div>Correction reason: {o.amendment_reason}</div>}
                {o.remarks && <div>{o.remarks}</div>}
                <Thumbs media={photos} onOpen={(index) => setLightbox({ media: photos, index, observation: o })} />
              </li>
            );
          })}
        </ol>
        {media.some((m: any) => !m.observation_id) && (
          <>
            <h3 style={{ marginTop: 8 }}>Other photos</h3>
            <Thumbs
              media={media.filter((m: any) => !m.observation_id)}
              onOpen={(index) => setLightbox({ media: media.filter((m: any) => !m.observation_id), index })}
            />
          </>
        )}
      </section>
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
      {correcting && <CorrectSerial tree={t} onClose={() => setCorrecting(false)} />}
    </div>
  );
}

const fmtHeight = (cm: number) => (cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(cm % 1 ? 1 : 0)} cm`);

function formatValue(v: unknown, type?: CustomField['field_type']): string {
  if (v == null || v === '') return '—';
  if (type === 'BOOLEAN' || typeof v === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No';
  if (type === 'DATE' && typeof v === 'string') return fmtDate(v);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** [label, formatted value] pairs: defined fields in their configured order, then unknown keys shown raw. */
function customEntries(values: Record<string, unknown> | null | undefined, defs: CustomField[]): [string, string][] {
  if (!values) return [];
  const known = [...defs].sort((a, b) => a.sort_order - b.sort_order).filter((d) => d.key in values);
  const unknown = Object.keys(values).filter((k) => !defs.some((d) => d.key === k));
  return [
    ...known.map((d): [string, string] => [d.label + (d.active ? '' : ' (inactive)'), formatValue(values[d.key], d.field_type)]),
    ...unknown.map((k): [string, string] => [k, formatValue(values[k])]),
  ];
}

function CustomValues({ values, defs, empty }: { values: Record<string, unknown> | null | undefined; defs: CustomField[]; empty: string }) {
  const entries = customEntries(values, defs);
  if (entries.length === 0) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <dl className="kv">
      {entries.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Becomes true once the element scrolls near the viewport, so photo URLs are only requested when needed. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') return setInView(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return { ref, inView };
}

function useViewUrl(media: any, enabled = true) {
  return useQuery({
    queryKey: ['media-url', media.id],
    queryFn: () => api.get<{ url: string; expires_in: number }>(`/media/${media.id}/view-url`),
    enabled: enabled && media.upload_state === 'VERIFIED',
    staleTime: 240_000,
  });
}

function Thumbs({ media, onOpen }: { media: any[]; onOpen: (index: number) => void }) {
  if (media.length === 0) return null;
  return (
    <div className="thumbs">
      {media.map((m, i) => (
        <Thumb key={m.id} media={m} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}

function Thumb({ media, onOpen }: { media: any; onOpen: () => void }) {
  const { ref, inView } = useInView<HTMLButtonElement>();
  const url = useViewUrl(media, inView);
  if (media.upload_state !== 'VERIFIED') {
    return (
      <span className="thumb placeholder" title={`Captured ${fmtDateTime(media.captured_at)}`}>
        {media.upload_state === 'FAILED' ? 'Photo failed verification' : 'Photo uploading'}
      </span>
    );
  }
  return (
    <button ref={ref} type="button" className="thumb" onClick={onOpen} aria-label={`Open photo captured ${fmtDateTime(media.captured_at)}`}>
      {url.data ? <img src={url.data.url} alt="" loading="lazy" /> : <span className="muted" style={{ fontSize: 12 }}>{url.isError ? 'Unavailable' : 'Loading…'}</span>}
    </button>
  );
}

type Pt = [number, number];
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function Lightbox({ media, index: initial, observation, onClose }: { media: any[]; index: number; observation?: any; onClose: () => void }) {
  const [index, setIndex] = useState(initial);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const m = media[index];
  const url = useViewUrl(m);
  const go = useCallback((d: number) => (setSize(null), setIndex((i) => (i + d + media.length) % media.length)), [media.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && media.length > 1) go(1);
      if (e.key === 'ArrowLeft' && media.length > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go, media.length]);

  // Height measured on a photo: overlay its markers on the photo it was measured on
  // (or the observation's only/first photo when the measurement does not name one).
  const hm = observation?.height_method === 'PHOTO_REFERENCE' ? observation.height_measurement : null;
  const pts = hm?.points ?? {};
  const appliesHere = hm && (hm.media_id ? hm.media_id === m.id : index === 0);
  const overlay = appliesHere && isPt(pts.ref_top) && isPt(pts.ref_bottom) && isPt(pts.tree_top) && isPt(pts.tree_base);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {m.upload_state !== 'VERIFIED' ? (
        <div className="lightbox-caption">This photo is still uploading.</div>
      ) : !url.data ? (
        <div className="lightbox-caption">{url.isError ? 'The photo could not be loaded.' : 'Loading photo…'}</div>
      ) : (
        <div className="lightbox-frame">
          <img
            src={url.data.url}
            alt={`Tree photo captured ${fmtDateTime(m.captured_at)}`}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {overlay && size && <MeasurementOverlay w={size.w} h={size.h} points={pts} />}
        </div>
      )}
      <div className="lightbox-caption">
        {media.length > 1 && <button onClick={() => go(-1)} aria-label="Previous photo">‹ Prev</button>}
        <span>
          Captured {fmtDateTime(m.captured_at)}
          {media.length > 1 && ` · ${index + 1} of ${media.length}`}
        </span>
        {overlay && (
          <span>
            <span className="key" style={{ background: REF_COLOR }} />Reference{hm.reference_cm ? ` ${hm.reference_cm} cm` : ''}
            <span className="key" style={{ background: TREE_COLOR, marginLeft: 12 }} />Tree{observation.height_cm != null ? ` ${fmtHeight(Number(observation.height_cm))}` : ''}
          </span>
        )}
        {media.length > 1 && <button onClick={() => go(1)} aria-label="Next photo">Next ›</button>}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const REF_COLOR = 'var(--series-4)';
const TREE_COLOR = 'var(--series-3)';

/** Points are normalised 0..1 of the photo; drawn in the image's own pixel space so markers stay round. */
function MeasurementOverlay({ w, h, points }: { w: number; h: number; points: Record<string, Pt> }) {
  const r = Math.max(w, h) * 0.008;
  const P = (k: string): Pt => [points[k][0] * w, points[k][1] * h];
  const seg = (a: string, b: string, color: string, label: string) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeOpacity={0.55} strokeWidth={5} vectorEffect="non-scaling-stroke" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        {[[x1, y1], [x2, y2]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        <text x={Math.max(x1, x2) + r * 2} y={(y1 + y2) / 2} fill="#fff" stroke="#000" strokeWidth={r * 0.35} paintOrder="stroke" fontSize={r * 3} fontWeight={700}>
          {label}
        </text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Height measurement markers">
      {seg('ref_top', 'ref_bottom', REF_COLOR, 'Reference')}
      {seg('tree_top', 'tree_base', TREE_COLOR, 'Tree')}
    </svg>
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
