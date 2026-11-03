import { Link } from 'react-router-dom';
import { fmtNum } from './ui';

/** Where a tree stands in the list it was opened from (GET …/trees/:id/neighbours with the list's filters and sort). */
export interface Neighbours {
  previous_id: string | null;
  next_id: string | null;
  /** 1-based; null when the tree is not in the list (e.g. its status changed since). */
  position: number | null;
  total: number;
}

/** The list's filters and sort (not its page), from the list's own search string, for the neighbours request. */
export function neighbourQuery(listSearch: string, keys: string[]) {
  const from = new URLSearchParams(listSearch);
  const out = new URLSearchParams();
  keys.forEach((k) => from.get(k) && out.set(k, from.get(k)!));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** The list's search string on the page that holds [position], so "Back to list" lands where the tree is. */
export function listSearchAt(listSearch: string, position: number | null | undefined, defaultSize = 50) {
  const p = new URLSearchParams(listSearch);
  if (position) {
    const size = Number(p.get('size')) || defaultSize;
    const offset = Math.floor((position - 1) / size) * size;
    if (offset) p.set('offset', String(offset));
    else p.delete('offset');
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** "Back to list", then Previous / Next through the list the tree was opened from, with its place in that list. */
export function TreePager({ data, backTo, onGo }: { data?: Neighbours | null; backTo: string; onGo: (id: string) => void }) {
  const at = data?.position;
  return (
    <nav className="tree-pager no-print" aria-label="Trees in this list">
      <Link to={backTo}>← Back to list</Link>
      {data && at != null && data.total > 1 && (
        <div className="tree-pager-steps">
          <button type="button" disabled={!data.previous_id} onClick={() => data.previous_id && onGo(data.previous_id)}>
            ‹ Previous<span className="visually-hidden"> tree</span>
          </button>
          <span className="muted" aria-live="polite">
            {!data.next_id ? 'Last tree' : !data.previous_id ? 'First tree' : 'Tree'} · {fmtNum(at)} of {fmtNum(data.total)}
          </span>
          <button type="button" disabled={!data.next_id} onClick={() => data.next_id && onGo(data.next_id)}>
            Next<span className="visually-hidden"> tree</span> ›
          </button>
        </div>
      )}
    </nav>
  );
}
