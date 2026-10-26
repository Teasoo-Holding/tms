import { useMutation, useQuery } from '@tanstack/react-query';
import { DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { ErrorNotice, useDelete } from './ui';

// Reference photos of a species (what it looks like), shown to field officers when they register a tree.
// The API serves the bytes only with the bearer token, so images are fetched as blobs and shown via object URLs.

export interface SpeciesImage {
  id: string;
  species_id: string;
  sort_order: number;
  caption: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  updated_at: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_MB = 15;

/** Splits picked/dropped files into acceptable images and a warning about the rest (null when none were skipped). */
function checkImages(files: FileList | null) {
  const all = Array.from(files ?? []);
  const ok = all.filter((f) => ACCEPT.split(',').includes(f.type) && f.size <= MAX_MB * 1024 * 1024);
  const skipped = all.length - ok.length;
  return { ok, rejected: skipped ? `${skipped} file${skipped === 1 ? ' was' : 's were'} skipped: use JPEG, PNG or WebP images up to ${MAX_MB} MB.` : null };
}

/** An image's bytes never change, so object URLs are kept for the session (keyed by id and size). */
const urls = new Map<string, Promise<string>>();

function useImageUrl(id: string, size: 'thumb' | 'full') {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});
  useEffect(() => {
    const key = `${id}:${size}`;
    let live = true;
    let p = urls.get(key);
    if (!p) {
      p = api.blob(`/species-images/${id}/content?size=${size}`).then((b) => URL.createObjectURL(b));
      urls.set(key, p);
      p.catch(() => urls.delete(key));
    }
    p.then((url) => live && setState({ url }), () => live && setState({ failed: true }));
    return () => {
      live = false;
    };
  }, [id, size]);
  return state;
}

export function useSpeciesImages(speciesId: string) {
  return useQuery({
    queryKey: ['species-images', speciesId],
    queryFn: async () => (await api.get<{ images: SpeciesImage[] }>(`/species/${speciesId}/images`)).images,
    placeholderData: undefined,
  });
}

function Img({ image, size, alt, className }: { image: SpeciesImage; size: 'thumb' | 'full'; alt: string; className?: string }) {
  const { url, failed } = useImageUrl(image.id, size);
  if (url) return <img src={url} alt={alt} className={className} />;
  return <span className="muted" style={{ fontSize: 12 }}>{failed ? 'Unavailable' : 'Loading…'}</span>;
}

/** The species' first photo, small, for its row in the list. */
export function SpeciesCover({ speciesId, name }: { speciesId: string; name: string }) {
  const images = useSpeciesImages(speciesId);
  const first = images.data?.[0];
  return (
    <span className="species-cover" title={images.data ? `${images.data.length} photo${images.data.length === 1 ? '' : 's'}` : undefined}>
      {first ? <Img image={first} size="thumb" alt={`Photo of ${name}`} /> : <span className="muted">—</span>}
    </span>
  );
}

/** Upload, order, caption and delete a species' photos (administrators). */
export function SpeciesImagesEditor({ speciesId, name }: { speciesId: string; name: string }) {
  const images = useSpeciesImages(speciesId);
  const list = images.data ?? [];
  const [viewing, setViewing] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const del = useDelete();

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('file', f));
      return api.upload(`/admin/species/${speciesId}/images`, form);
    },
  });
  const patch = useMutation({ mutationFn: ({ id, ...body }: { id: string; sort_order?: number; caption?: string | null }) => api.patch(`/admin/species-images/${id}`, body) });
  // Moving a photo renumbers the list, so photos that shared a number still end up in the shown order.
  const reorder = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      for (const [i, img] of next.entries()) if (img.sort_order !== i) await api.patch(`/admin/species-images/${img.id}`, { sort_order: i });
    },
  });

  const add = (files: FileList | null) => {
    const { ok, rejected } = checkImages(files);
    setRejected(rejected);
    if (ok.length) upload.mutate(ok);
    if (input.current) input.current.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="muted">Photos field officers see when choosing this species. The first one is its cover.</div>
      <ErrorNotice error={images.error ?? upload.error ?? patch.error ?? reorder.error} />
      {rejected && <div className="notice warning" role="alert">{rejected}</div>}
      <div
        className={`dropzone${dragging ? ' active' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />
        <button type="button" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Add photos'}
        </button>
        <span className="muted">or drop images here (JPEG, PNG or WebP, up to {MAX_MB} MB each)</span>
      </div>
      {images.isLoading && <span className="muted">Loading photos…</span>}
      {list.length > 0 && (
        <div className="species-photos">
          {list.map((img, i) => (
            <figure key={img.id} className="species-photo">
              <button type="button" className="thumb" onClick={() => setViewing(i)} aria-label={`Open photo ${i + 1} of ${name}`}>
                <Img image={img} size="thumb" alt="" />
              </button>
              <Caption image={img} onSave={(caption) => patch.mutate({ id: img.id, caption })} />
              <div className="species-photo-actions">
                <button type="button" className="icon-btn" disabled={i === 0 || reorder.isPending} onClick={() => reorder.mutate({ from: i, to: i - 1 })} aria-label="Move earlier" title="Move earlier">‹</button>
                <button type="button" className="icon-btn" disabled={i === list.length - 1 || reorder.isPending} onClick={() => reorder.mutate({ from: i, to: i + 1 })} aria-label="Move later" title="Move later">›</button>
                <span className="spacer" />
                <button type="button" className="danger" onClick={() => del.ask({ what: 'photo', name: img.caption || `Photo ${i + 1} of ${name}`, path: `/admin/species-images/${img.id}` })}>
                  Delete
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}
      {images.data && list.length === 0 && <span className="muted">No photos yet.</span>}
      {del.dialog}
      {viewing !== null && list[viewing] && <SpeciesImageViewer images={list} index={viewing} name={name} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Saved when the field loses focus (or on Enter), only if it changed. */
function Caption({ image, onSave }: { image: SpeciesImage; onSave: (caption: string | null) => void }) {
  const [value, setValue] = useState(image.caption ?? '');
  useEffect(() => setValue(image.caption ?? ''), [image.caption]);
  const commit = () => value.trim() !== (image.caption ?? '') && onSave(value.trim() || null);
  return (
    <input
      className="species-photo-caption"
      placeholder="Caption (optional)"
      maxLength={500}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
    />
  );
}

/** Full-size viewer, styled like the tree photo viewer. */
export function SpeciesImageViewer({ images, index: initial, name, onClose }: { images: SpeciesImage[]; index: number; name: string; onClose: () => void }) {
  const [index, setIndex] = useState(initial);
  const img = images[Math.min(index, images.length - 1)];
  const full = useImageUrl(img.id, 'full');
  const thumb = useImageUrl(img.id, 'thumb');
  const go = useCallback((d: number) => setIndex((i) => (i + d + images.length) % images.length), [images.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) go(1);
      if (e.key === 'ArrowLeft' && images.length > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go, images.length]);
  const src = full.url ?? thumb.url;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {src ? (
        <div className="lightbox-frame">
          <img src={src} alt={img.caption ?? `Photo of ${name}`} className={full.url ? undefined : 'lightbox-preview'} />
        </div>
      ) : (
        <div className="lightbox-caption">{full.failed ? 'The photo could not be loaded.' : 'Loading photo…'}</div>
      )}
      <div className="lightbox-caption">
        {images.length > 1 && <button onClick={() => go(-1)} aria-label="Previous photo">‹ Prev</button>}
        <span>
          {img.caption ?? name}
          {images.length > 1 && ` · ${index + 1} of ${images.length}`}
        </span>
        {images.length > 1 && <button onClick={() => go(1)} aria-label="Next photo">Next ›</button>}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ photos picked before the species exists

/** A photo chosen in the form but not uploaded yet; `error` is set when its upload failed. */
export interface PendingPhoto {
  key: string;
  file: File;
  /** Local object URL for the preview; revoked when the photo is removed or the form closes. */
  url: string;
  error?: string;
}

let pendingSeq = 0;

/**
 * Uploads the photos one request each (a request is all-or-nothing on the server), in order, so a failure
 * names the photo it belongs to. Returns the photos that failed, with their error.
 */
export async function uploadPendingPhotos(speciesId: string, photos: PendingPhoto[]): Promise<PendingPhoto[]> {
  const failed: PendingPhoto[] = [];
  for (const p of photos) {
    const form = new FormData();
    form.append('file', p.file);
    try {
      await api.upload(`/admin/species/${speciesId}/images`, form);
      URL.revokeObjectURL(p.url);
    } catch (e) {
      failed.push({ ...p, error: (e as Error).message || 'Upload failed.' });
    }
  }
  return failed;
}

/**
 * Pick/drop photos with local previews; nothing is uploaded here (the form uploads them after saving).
 * `picking` false hides the drop zone, e.g. when only failed uploads are left to retry or remove.
 */
export function PendingPhotos({ photos, onChange, picking = true, busy }: { photos: PendingPhoto[]; onChange: (photos: PendingPhoto[]) => void; picking?: boolean; busy?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Previews still shown when the form closes are released then (the latest list, not the first).
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const add = (files: FileList | null) => {
    const { ok, rejected } = checkImages(files);
    setRejected(rejected);
    if (ok.length) onChange([...photos, ...ok.map((file) => ({ key: `p${++pendingSeq}`, file, url: URL.createObjectURL(file) }))]);
    if (input.current) input.current.value = '';
  };
  const remove = (p: PendingPhoto) => {
    URL.revokeObjectURL(p.url);
    onChange(photos.filter((x) => x.key !== p.key));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {picking && (
        <>
          <div className="muted">Optional. Photos field officers see when choosing this species; the first one is its cover. They upload when you save.</div>
          {rejected && <div className="notice warning" role="alert">{rejected}</div>}
          <div
            className={`dropzone${dragging ? ' active' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => (e.preventDefault(), setDragging(false), add(e.dataTransfer.files))}
          >
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>Add photos</button>
            <span className="muted">or drop images here (JPEG, PNG or WebP, up to {MAX_MB} MB each)</span>
          </div>
        </>
      )}
      {photos.length > 0 && (
        <div className="species-photos">
          {photos.map((p, i) => (
            <figure key={p.key} className="species-photo">
              <span className="thumb" style={{ cursor: 'default' }}>
                <img src={p.url} alt={`Photo ${i + 1} to upload: ${p.file.name}`} />
                {!p.error && <span className="tag">Not uploaded yet</span>}
              </span>
              <span className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{p.file.name}</span>
              {p.error && <span className="pill critical" style={{ whiteSpace: 'normal' }}>Failed: {p.error}</span>}
              <div className="species-photo-actions">
                <span className="spacer" />
                <button type="button" className="danger" disabled={busy} onClick={() => remove(p)} aria-label={`Remove ${p.file.name}`}>Remove</button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
