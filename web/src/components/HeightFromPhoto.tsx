import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { fmtLongDateTime } from '../time';
import { useViewUrl } from './Photos';
import { CardHeader, ErrorNotice, Field } from './ui';

type Point = { x: number; y: number };
type Key = 'stick_bottom' | 'stick_top' | 'tree_base' | 'tree_top';
type Points = Record<Key, Point>;
const KEYS: [Key, string, string][] = [
  ['stick_bottom', 'Stick bottom', '#1d6bd8'],
  ['stick_top', 'Stick top', '#1d6bd8'],
  ['tree_base', 'Tree base', '#d03b3b'],
  ['tree_top', 'Tree top', '#d03b3b'],
];

/** Same formula as the server: the tree's length in the photo against the stick's, times the stick's height. */
function heightOf(p: Points, w: number, h: number, stickCm: number) {
  const len = (a: Point, b: Point) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  const stick = len(p.stick_bottom, p.stick_top);
  return stick >= 20 ? Math.round(((stickCm * len(p.tree_base, p.tree_top)) / stick) * 10) / 10 : null;
}

/**
 * Height from photo (#109), for administrators: AI marks the reference stick and the tree on a photo, and TMS works
 * out the height from the year's stick (3 ft in 2025, 1 m in 2026). The administrator checks or moves the points,
 * then saves it as an estimate. Field measurements are never changed.
 */
export function HeightFromPhoto({ treeId, hasPhoto }: { treeId: string; hasPhoto: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['height-status'], queryFn: () => api.get<{ enabled: boolean }>('/height-estimates/status') });
  const list = useQuery({ queryKey: ['height-estimates', treeId], queryFn: () => api.get<any[]>(`/trees/${treeId}/height-estimates`) });
  const run = useMutation({
    mutationFn: () => api.post(`/trees/${treeId}/height-estimates`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['height-estimates', treeId] }),
  });
  const estimates = list.data ?? [];
  const pending = estimates.find((e) => e.status === 'SUGGESTED' || e.status === 'UNSUITABLE');
  const saved = estimates.filter((e) => e.status === 'CONFIRMED');
  return (
    <section className="card">
      <CardHeader
        title="Height from photo"
        description="AI finds the measuring stick and the tree in the photo, and TMS works out the height from the stick used that year: 3 ft in 2025, 1 m in 2026. You check it before it is saved. Saved heights are estimates, kept apart from heights measured in the field."
      />
      <ErrorNotice error={run.error} />
      {status.data && !status.data.enabled && (
        <p className="muted" style={{ margin: 0 }}>
          Turned off. To turn it on, add an Anthropic API key as <code>ANTHROPIC_API_KEY</code> in the API’s settings on Render.
        </p>
      )}
      {status.data?.enabled && !pending && (
        <button disabled={!hasPhoto || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Reading the photo…' : saved.length ? 'Estimate again from the photo' : 'Estimate height from the photo'}
        </button>
      )}
      {status.data?.enabled && !hasPhoto && <p className="muted">This tree has no uploaded photo yet.</p>}
      {pending && <Review key={pending.id} e={pending} treeId={treeId} />}
      {saved.length > 0 && (
        <ul className="height-estimates">
          {saved.map((e) => (
            <li key={e.id}>
              <strong>{e.confirmed_height_cm} cm</strong> <span className="pill">Estimate</span>
              <div className="muted">
                {e.method_note} Saved {fmtLongDateTime(e.reviewed_at)}.
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Review({ e, treeId }: { e: any; treeId: string }) {
  const qc = useQueryClient();
  const photo = useViewUrl({ id: e.media_id, upload_state: 'VERIFIED' }, 'full');
  const [points, setPoints] = useState<Points>(e.points ?? e.suggested_points);
  const [moving, setMoving] = useState<Key>('tree_top');
  const [typed, setTyped] = useState('');
  const img = useRef<HTMLDivElement>(null);
  useEffect(() => setPoints(e.points ?? e.suggested_points), [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => qc.invalidateQueries({ queryKey: ['height-estimates', treeId] });
  const confirm = useMutation({
    mutationFn: () => api.post(`/height-estimates/${e.id}/confirm`, typed ? { points, height_cm: Number(typed) } : { points }),
    onSuccess: done,
  });
  const discard = useMutation({ mutationFn: () => api.post(`/height-estimates/${e.id}/discard`), onSuccess: done });
  const cm = points ? heightOf(points, e.image_width, e.image_height, e.reference_length_cm) : null;
  const place = (ev: MouseEvent<HTMLDivElement>) => {
    const r = img.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    setPoints((p) => ({ ...p, [moving]: { x, y } }));
  };
  const height = typed ? Number(typed) : cm;
  return (
    <div className="stack">
      {e.status === 'UNSUITABLE' ? (
        <div className="notice warning" role="status">
          <strong>This photo may not be suitable:</strong> {e.unsuitable_reason} You can still mark the points yourself, or discard it.
        </div>
      ) : (
        <p style={{ margin: 0 }}>
          Suggested height: <strong>{e.suggested_height_cm} cm</strong> · AI confidence: {e.confidence} · Stick: {e.reference_label}
          {e.ai_notes && <span className="muted"> · {e.ai_notes}</span>}
        </p>
      )}
      <fieldset className="height-points">
        <legend>Choose a point, then click the photo to move it</legend>
        {KEYS.map(([k, label, colour]) => (
          <label key={k} className="radio">
            <input type="radio" name={`point-${e.id}`} checked={moving === k} onChange={() => setMoving(k)} />
            <span className="dot" style={{ background: colour }} aria-hidden />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="height-photo" ref={img} onClick={place} role="img" aria-label="Tree photo with the stick and tree marked">
        {photo.data ? <img src={photo.data.url} alt="" draggable={false} /> : <div className="empty">Loading the photo…</div>}
        {points && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
            <line x1={points.stick_bottom.x} y1={points.stick_bottom.y} x2={points.stick_top.x} y2={points.stick_top.y} stroke="#1d6bd8" strokeWidth="0.006" />
            <line x1={points.tree_base.x} y1={points.tree_base.y} x2={points.tree_top.x} y2={points.tree_top.y} stroke="#d03b3b" strokeWidth="0.006" />
          </svg>
        )}
        {points &&
          KEYS.map(([k, label, colour]) => (
            <span key={k} className={`height-marker${moving === k ? ' active' : ''}`} style={{ left: `${points[k].x * 100}%`, top: `${points[k].y * 100}%`, borderColor: colour }} title={label} />
          ))}
      </div>
      <p style={{ margin: 0 }}>
        Height from these points: <strong>{cm != null ? `${cm} cm` : 'mark the stick first'}</strong>
      </p>
      <Field label="Or type the height in cm (optional)">
        <input type="number" inputMode="decimal" min="1" value={typed} onChange={(ev) => setTyped(ev.target.value)} style={{ maxWidth: 160 }} />
      </Field>
      <ErrorNotice error={confirm.error ?? discard.error} />
      <div className="row">
        <button className="primary" disabled={!height || confirm.isPending} onClick={() => confirm.mutate()}>
          {height ? `Save estimate: ${height} cm` : 'Save estimate'}
        </button>
        <button disabled={discard.isPending} onClick={() => discard.mutate()}>Discard</button>
      </div>
    </div>
  );
}
