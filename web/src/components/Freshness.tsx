import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, qs } from '../api/client';
import { fmtNum, relativeTime } from './ui';

/** One phone as of its last contact (GET /reports/freshness). Counts are null for app versions that do not report them. */
export interface FreshnessDevice {
  device_id: string;
  user_id: string;
  user_name: string;
  device_name: string | null;
  last_sync_at: string | null;
  pending_operations: number | null;
  pending_photos: number | null;
  oldest_pending_at: string | null;
  status_reported_at: string | null;
  app_version: string | null;
}
export interface Freshness {
  generated_at: string;
  last_sync_at: string | null;
  devices: FreshnessDevice[];
  devices_with_pending: number;
  pending_operations: number;
  pending_photos: number;
}

/** Freshness of one project (or everything the user can see), refreshed every minute while the page is open. */
export function useFreshness(projectId?: string) {
  const query = qs({ project_id: projectId });
  return useQuery({ queryKey: ['freshness', query], queryFn: () => api.get<Freshness>(`/reports/freshness${query}`), refetchInterval: 60_000 });
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtTime = (v: string) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
/** "08:10" today, else "3 Nov, 08:10" (with the year when it is not this year). */
export function fmtWhen(v: string) {
  const d = new Date(v);
  const now = new Date();
  if (sameDay(d, now)) return fmtTime(v);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}
/** Sub-label for headline totals: "as of 10:12" (the last sync), or "nothing synced yet". */
export const asOf = (v?: string | null) => (v ? `as of ${fmtWhen(v)}` : 'nothing synced yet');

const waiting = (d: FreshnessDevice) => (d.pending_operations ?? 0) + (d.pending_photos ?? 0) > 0;
const deviceLabel = (d: FreshnessDevice) => (d.device_name ? `${d.user_name} (${d.device_name})` : d.user_name);
function waitingText(d: FreshnessDevice) {
  const parts = [d.pending_operations && plural(d.pending_operations, 'record'), d.pending_photos && plural(d.pending_photos, 'photo')].filter(Boolean);
  return `${parts.join(', ')} waiting${d.oldest_pending_at ? ` since ${fmtWhen(d.oldest_pending_at)}` : ''}`;
}
const syncText = (d: FreshnessDevice) => (d.last_sync_at ? `last synced ${fmtWhen(d.last_sync_at)}` : 'not synced yet');

/**
 * Persistent banner: when the data was last synced and how many phones reported unsent records at their last contact,
 * with a per-phone list behind "Details". Shown above totals on the dashboard, visits and field activity.
 */
export function FreshnessBanner({ freshness }: { freshness?: Freshness }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!freshness) return null;
  const f = freshness;
  const stale = !f.last_sync_at || Date.now() - Date.parse(f.last_sync_at) > 86_400_000;
  const reporting = f.devices.some((d) => d.status_reported_at);
  return (
    <section className={`notice freshness ${f.devices_with_pending || stale ? 'warning' : ''}`} role="status" aria-label="Data freshness">
      <div className="freshness-line">
        <span>
          <strong>Data as of {f.last_sync_at ? relativeTime(f.last_sync_at) : 'no sync yet'}</strong>
          {f.last_sync_at && <span className="muted"> ({new Date(f.last_sync_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</span>}
        </span>
        {f.devices_with_pending > 0 ? (
          <span>
            {plural(f.devices_with_pending, 'device has', 'devices have')} unsent records ({plural(f.pending_operations, 'record')}, {plural(f.pending_photos, 'photo')}) as of{' '}
            {f.devices_with_pending === 1 ? 'its' : 'their'} last contact
          </span>
        ) : (
          reporting && <span>No device reported unsent records at its last contact</span>
        )}
        {f.devices.length > 0 && (
          <button type="button" className="link" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'Details'}
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} className="freshness-devices">
          {f.devices.map((d) => (
            <li key={d.device_id}>
              <strong>{deviceLabel(d)}</strong>
              <span className={waiting(d) ? '' : 'muted'}>
                {waiting(d) ? waitingText(d) : d.status_reported_at ? 'nothing waiting' : 'unsent records not reported (older app)'}
              </span>
              <span className="muted">
                {syncText(d)}
                {d.status_reported_at && ` · last contact ${relativeTime(d.status_reported_at)}`}
                {d.app_version && ` · app ${d.app_version}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Phones that may still hold records for a period: those that reported unsent records (older than the period's end,
 * when known), and those that have not synced since the period started. `start` and `end` are epoch ms (null: open).
 */
export function awaitingDevices(f: Freshness | undefined, start: number | null, end: number | null, userIds?: string[] | null) {
  if (!f) return [];
  return f.devices.filter(
    (d) =>
      (!userIds || userIds.includes(d.user_id)) &&
      ((waiting(d) && (!d.oldest_pending_at || end == null || Date.parse(d.oldest_pending_at) < end)) ||
        !d.last_sync_at ||
        (start != null && Date.parse(d.last_sync_at) < start)),
  );
}

/** Shown instead of a zero that may only mean "not synced yet". */
export function AwaitingBadge({ devices }: { devices?: FreshnessDevice[] }) {
  const title = devices?.length ? devices.map((d) => `${deviceLabel(d)}: ${waiting(d) ? waitingText(d) : syncText(d)}`).join('\n') : undefined;
  return (
    <span className="pill awaiting" title={title}>
      awaiting sync
    </span>
  );
}

/** Empty state when nothing has arrived but phones may still hold the period's records. */
export function AwaitingNotice({ devices, period }: { devices: FreshnessDevice[]; period: string }) {
  const pending = devices.filter(waiting);
  const unsynced = devices.filter((d) => !waiting(d));
  const since = unsynced.map((d) => d.last_sync_at).filter(Boolean).sort()[0];
  const lead = [
    unsynced.length > 0 && `${plural(unsynced.length, "device hasn't", "devices haven't")} synced ${since ? `since ${fmtWhen(since)}` : 'yet'}`,
    pending.length > 0 && `${plural(pending.length, 'device has', 'devices have')} unsent records`,
  ].filter(Boolean);
  return (
    <div className="awaiting-state" role="status">
      <strong>
        <AwaitingBadge devices={devices} /> No records have arrived for {period} yet.
      </strong>
      <p>{lead.join('; ')}:</p>
      <ul>
        {devices.map((d) => (
          <li key={d.device_id}>
            {deviceLabel(d)}, {waiting(d) ? waitingText(d) : syncText(d)}
          </li>
        ))}
      </ul>
      <p className="muted">Ask them to connect to the internet and open Ready to send.</p>
    </div>
  );
}

/** "+14 waiting" next to an officer whose phones reported unsent records. */
export function WaitingTag({ devices }: { devices: FreshnessDevice[] }) {
  const n = devices.reduce((s, d) => s + (d.pending_operations ?? 0), 0);
  const photos = devices.reduce((s, d) => s + (d.pending_photos ?? 0), 0);
  if (!n && !photos) return null;
  return (
    <span className="pill awaiting" title={devices.filter(waiting).map((d) => `${deviceLabel(d)}: ${waitingText(d)}`).join('\n')}>
      {n ? `${fmtNum(n)} waiting` : `${fmtNum(photos)} photos waiting`}
    </span>
  );
}
