import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { SHOW_HEIGHT } from '../features';
import { fmtDateTime } from './ui';

// Tree photos wherever a tree is shown: thumbnails (~320 px, signed URLs from /media/:id/view-url?size=thumb)
// that open a full-size viewer. Photos still uploading or failed show a placeholder instead.

/** 85 cm, 42.5 cm; 1.2 m, 1.25 m from 100 cm up. */
export const fmtHeight = (cm: number) => (cm >= 100 ? `${Number((cm / 100).toFixed(2))} m` : `${Number(cm.toFixed(1))} cm`);

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

/**
 * Signed photo URL: `thumb` (~320 px) for galleries, `full` only in the lightbox. Signed URLs live a few
 * minutes, so results are cached for 4 minutes and then fetched again.
 */
export function useViewUrl(media: any, size: 'thumb' | 'full', enabled = true) {
  return useQuery({
    queryKey: ['media-url', media.id, size],
    queryFn: () => api.get<{ url: string; size?: 'thumb' | 'full' }>(`/media/${media.id}/view-url${size === 'thumb' ? '?size=thumb' : ''}`),
    enabled: enabled && media.upload_state === 'VERIFIED',
    staleTime: 240_000,
    gcTime: 240_000,
    // A signed URL must not be shown past its lifetime: no placeholder from another photo.
    placeholderData: undefined,
  });
}

export function Thumbs({ media, onOpen }: { media: any[]; onOpen: (index: number) => void }) {
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
  const url = useViewUrl(media, 'thumb', inView);
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

export function Lightbox({ media, index: initial, observation, onClose }: { media: any[]; index: number; observation?: any; onClose: () => void }) {
  const [index, setIndex] = useState(initial);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const m = media[index];
  const url = useViewUrl(m, 'full');
  // The thumbnail is usually cached already: show it while the full-size photo loads.
  const thumb = useQueryClient().getQueryData<{ url: string }>(['media-url', m.id, 'thumb']);
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
  const hm = SHOW_HEIGHT && observation?.height_method === 'PHOTO_REFERENCE' ? observation.height_measurement : null;
  const pts = hm?.points ?? {};
  const appliesHere = hm && (hm.media_id ? hm.media_id === m.id : index === 0);
  const overlay = appliesHere && isPt(pts.ref_top) && isPt(pts.ref_bottom) && isPt(pts.tree_top) && isPt(pts.tree_base);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {m.upload_state !== 'VERIFIED' ? (
        <div className="lightbox-caption">This photo is still uploading.</div>
      ) : !url.data ? (
        thumb && !url.isError ? (
          <div className="lightbox-frame">
            <img src={thumb.url} alt="" className="lightbox-preview" />
          </div>
        ) : (
          <div className="lightbox-caption">{url.isError ? 'The photo could not be loaded.' : 'Loading photo…'}</div>
        )
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


/** Newest photo first: by capture time, verified photos before ones still uploading. */
export function newestFirst(media: any[]) {
  return [...media].sort((a, b) => Number(b.upload_state === 'VERIFIED') - Number(a.upload_state === 'VERIFIED') || String(b.captured_at).localeCompare(String(a.captured_at)));
}

/** The tree's most recent photo, large, at the top of its page. Opens the full-size viewer on click. */
export function LatestPhoto({ media, onOpen }: { media: any; onOpen: () => void }) {
  const full = useViewUrl(media, 'full');
  const thumb = useViewUrl(media, 'thumb');
  const src = full.data?.url ?? thumb.data?.url;
  if (media.upload_state !== 'VERIFIED') {
    return <div className="photo-hero placeholder">{media.upload_state === 'FAILED' ? 'The latest photo failed verification.' : 'The latest photo is still uploading.'}</div>;
  }
  return (
    <figure className="photo-hero">
      <button type="button" onClick={onOpen} aria-label={`Open the latest photo, captured ${fmtDateTime(media.captured_at)}`}>
        {src ? <img src={src} alt={`Latest photo of the tree, captured ${fmtDateTime(media.captured_at)}`} className={full.data ? undefined : 'loading'} /> : <span className="muted">{full.isError ? 'Photo unavailable' : 'Loading photo…'}</span>}
      </button>
      <figcaption className="muted">Latest photo · captured {fmtDateTime(media.captured_at)}</figcaption>
    </figure>
  );
}

/**
 * Photos of one tree, loaded on demand (for tables and dialogs that show a tree without its full record).
 * With `observationId`, that visit's photos come first and the tree's other photos follow.
 */
export function TreePhotos({ treeId, observationId }: { treeId: string; observationId?: string }) {
  const media = useQuery({ queryKey: ['tree-media', treeId], queryFn: () => api.get<any[]>(`/trees/${treeId}/media`) });
  const [open, setOpen] = useState<{ list: any[]; index: number } | null>(null);
  if (media.isLoading) return <span className="muted">Loading photos…</span>;
  if (media.isError) return <span className="muted">Photos could not be loaded.</span>;
  const all = newestFirst(media.data ?? []);
  if (all.length === 0) return <span className="muted">No photos yet.</span>;
  const visit = observationId ? all.filter((m) => m.observation_id === observationId) : [];
  const rest = observationId ? all.filter((m) => m.observation_id !== observationId) : all;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {visit.length > 0 && (
        <div>
          <div className="muted">This visit</div>
          <Thumbs media={visit} onOpen={(index) => setOpen({ list: visit, index })} />
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {observationId && <div className="muted">{visit.length ? 'Other photos of this tree' : 'Photos of this tree (none from this visit)'}</div>}
          <Thumbs media={rest} onOpen={(index) => setOpen({ list: rest, index })} />
        </div>
      )}
      {open && <Lightbox media={open.list} index={open.index} onClose={() => setOpen(null)} />}
    </div>
  );
}
