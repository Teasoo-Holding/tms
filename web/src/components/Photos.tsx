import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

/** Where signed photo URLs come from: the signed-in API, or a client share link's own photo endpoint. */
export interface PhotoSource {
  /** Part of the cache key, so URLs from different sources never mix. */
  key: string;
  viewUrl: (mediaId: string, size: 'thumb' | 'full') => Promise<{ url: string; size?: 'thumb' | 'full' }>;
}
const portalPhotos: PhotoSource = {
  key: 'portal',
  viewUrl: (id, size) => api.get(`/media/${id}/view-url${size === 'thumb' ? '?size=thumb' : ''}`),
};
const PhotoSourceContext = createContext<PhotoSource>(portalPhotos);
/** Wrap a public page (e.g. a client link) so its photos load through that page's own endpoint. */
export const PhotoSourceProvider = PhotoSourceContext.Provider;
const urlKey = (source: PhotoSource, id: string, size: 'thumb' | 'full') => ['media-url', source.key, id, size];

/**
 * Signed photo URL: `thumb` (~320 px) for galleries, `full` only in the lightbox. Signed URLs live a few
 * minutes, so results are cached for 4 minutes and then fetched again.
 */
export function useViewUrl(media: any, size: 'thumb' | 'full', enabled = true) {
  const source = useContext(PhotoSourceContext);
  return useQuery({
    queryKey: urlKey(source, media.id, size),
    queryFn: () => source.viewUrl(media.id, size),
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 1.5;
interface View { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 };

/**
 * Zoom and pan for the photo viewer: buttons, the mouse wheel, pinch, drag to pan, and double-click or double-tap to
 * toggle. The frame (photo plus any measurement overlay) is centred in the stage and scaled about its centre; it is
 * kept covering the stage, so the photo never slides out of view.
 */
function useZoom(reset: unknown) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => setView(FIT), [reset]);

  const clamp = useCallback((v: View): View => {
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s));
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!frame || !stage || s === 1) return { s, x: 0, y: 0 };
    const maxX = Math.max(0, (frame.offsetWidth * s - stage.clientWidth) / 2);
    const maxY = Math.max(0, (frame.offsetHeight * s - stage.clientHeight) / 2);
    return { s, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  }, []);
  /** A screen point as an offset from the stage's centre (the frame's untransformed centre). */
  const offset = (clientX?: number, clientY?: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || clientX == null || clientY == null) return { x: 0, y: 0 };
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };
  /** Scales [from] to [s], keeping the photo point under [at] (an offset from the centre) where it is. */
  const scaled = (from: View, s: number, at: { x: number; y: number }): View => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s)) / from.s;
    return { s: from.s * k, x: at.x - k * (at.x - from.x), y: at.y - k * (at.y - from.y) };
  };
  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => setView(clamp(scaled(viewRef.current, viewRef.current.s * factor, offset(clientX, clientY)))),
    [clamp],
  );
  const fit = useCallback(() => setView(FIT), []);
  const toggle = (clientX?: number, clientY?: number) => (viewRef.current.s > 1 ? fit() : zoomBy(2.5, clientX, clientY));

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!frameRef.current) return;
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX, e.clientY);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // One pointer pans (when zoomed in); two pinch. A quick second tap toggles the zoom on touch screens.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; x: number; y: number; dist: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastPointerType = useRef('mouse');
  const start = () => {
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = mid ? { view: viewRef.current, x: mid.x, y: mid.y, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 } : null;
  };
  const handlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      lastPointerType.current = e.pointerType;
      if (e.button !== 0) return;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) moved.current = false;
      start();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      const pts = [...pointers.current.values()];
      if (pts.length > 1 && g.dist > 0) {
        moved.current = true;
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const v = scaled(g.view, (g.view.s * dist) / g.dist, offset(g.x, g.y));
        setView(clamp({ ...v, x: v.x + mid.x - g.x, y: v.y + mid.y - g.y }));
      } else if (pts.length === 1) {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
        if (g.view.s > 1) setView(clamp({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }));
      }
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const wasOnly = pointers.current.size === 1;
      pointers.current.delete(e.pointerId);
      start();
      if (e.pointerType !== 'touch' || !wasOnly || moved.current) return;
      const tap = { t: Date.now(), x: e.clientX, y: e.clientY };
      const last = lastTap.current;
      if (last && tap.t - last.t < 300 && Math.hypot(tap.x - last.x, tap.y - last.y) < 30) {
        lastTap.current = null;
        toggle(tap.x, tap.y);
      } else {
        lastTap.current = tap;
      }
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      pointers.current.delete(e.pointerId);
      start();
    },
    // Double-click with a mouse; touch screens use the double tap above (some browsers also send dblclick).
    onDoubleClick: (e: ReactMouseEvent) => lastPointerType.current !== 'touch' && toggle(e.clientX, e.clientY),
  };
  return { stageRef, frameRef, view, zoomBy, fit, handlers, moved };
}

export function Lightbox({ media, index: initial, observation, onClose }: { media: any[]; index: number; observation?: any; onClose: () => void }) {
  const [index, setIndex] = useState(initial);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const m = media[index];
  const url = useViewUrl(m, 'full');
  // The thumbnail is usually cached already: show it while the full-size photo loads.
  const source = useContext(PhotoSourceContext);
  const thumb = useQueryClient().getQueryData<{ url: string }>(urlKey(source, m.id, 'thumb'));
  const zoom = useZoom(`${index}:${size?.w}x${size?.h}`);
  const { zoomBy, fit } = zoom;
  const zoomed = zoom.view.s > 1;
  const go = useCallback((d: number) => (setSize(null), setIndex((i) => (i + d + media.length) % media.length)), [media.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && media.length > 1) go(1);
      else if (e.key === 'ArrowLeft' && media.length > 1) go(-1);
      else if (e.key === '+' || e.key === '=') zoomBy(STEP);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / STEP);
      else if (e.key === '0') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go, media.length, zoomBy, fit]);

  // Height measured on a photo: overlay its markers on the photo it was measured on
  // (or the observation's only/first photo when the measurement does not name one).
  const hm = SHOW_HEIGHT && observation?.height_method === 'PHOTO_REFERENCE' ? observation.height_measurement : null;
  const pts = hm?.points ?? {};
  const appliesHere = hm && (hm.media_id ? hm.media_id === m.id : index === 0);
  const overlay = appliesHere && isPt(pts.ref_top) && isPt(pts.ref_bottom) && isPt(pts.tree_top) && isPt(pts.tree_base);
  const frameStyle = { transform: `translate(${zoom.view.x}px, ${zoom.view.y}px) scale(${zoom.view.s})` };
  const canZoom = m.upload_state === 'VERIFIED' && !!url.data;
  // Where the last press started: a click that started beside the photo closes the viewer.
  const pressedBackdrop = useRef(false);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div
        ref={zoom.stageRef}
        className={`lightbox-stage${zoomed ? ' zoomed' : ''}`}
        {...zoom.handlers}
        onPointerDownCapture={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
        // Not after a drag or a pinch, and not while zoomed in (a stray tap would lose the place).
        onClick={() => pressedBackdrop.current && !zoomed && !zoom.moved.current && onClose()}
      >
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
          <div ref={zoom.frameRef} className="lightbox-frame" style={frameStyle}>
            <img
              src={url.data.url}
              alt={`Tree photo captured ${fmtDateTime(m.captured_at)}`}
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {overlay && size && <MeasurementOverlay w={size.w} h={size.h} points={pts} />}
          </div>
        )}
      </div>
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
        {canZoom && (
          <span className="lightbox-zoom" role="group" aria-label="Zoom">
            <button onClick={() => zoomBy(1 / STEP)} disabled={!zoomed} aria-label="Zoom out" title="Zoom out (−)">−</button>
            <span className="lightbox-zoom-level" aria-live="polite">{Math.round(zoom.view.s * 100)}%</span>
            <button onClick={() => zoomBy(STEP)} disabled={zoom.view.s >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">+</button>
            <button onClick={fit} disabled={!zoomed} aria-label="Fit the photo to the screen" title="Fit (0)">Fit</button>
          </span>
        )}
        <button onClick={onClose} aria-label="Close the photo viewer" title="Close (Esc)">Close</button>
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
