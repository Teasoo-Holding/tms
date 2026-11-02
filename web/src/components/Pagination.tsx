import { ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Page sizes offered under every table. */
export const PAGE_SIZES = [25, 50, 100] as const;
const fmtNum = (n: number) => n.toLocaleString();
const isSize = (n: number) => (PAGE_SIZES as readonly number[]).includes(n);

export interface PageState {
  offset: number;
  limit: number;
  /** Moves to [offset] (and changes the page size when [limit] is given). */
  go: (offset: number, limit?: number) => void;
}

/**
 * Position and page size kept in the URL (`offset` and `size`, or `<key>_offset` and `<key>_size` when a page has
 * several tables), so a page of a list is a shareable link and survives reloads. Filters that change the list should
 * drop the offset, as useReportFilters does.
 */
export function usePage(key = '', defaultSize = 50): PageState {
  const [params, setParams] = useSearchParams();
  const offKey = key ? `${key}_offset` : 'offset';
  const sizeKey = key ? `${key}_size` : 'size';
  const size = Number(params.get(sizeKey));
  const limit = isSize(size) ? size : defaultSize;
  const offset = Math.max(0, Math.floor(Number(params.get(offKey)) || 0));
  const go = (o: number, l = limit) => {
    const next = new URLSearchParams(params);
    if (o > 0) next.set(offKey, String(o));
    else next.delete(offKey);
    if (l !== defaultSize) next.set(sizeKey, String(l));
    else next.delete(sizeKey);
    setParams(next, { replace: true });
  };
  return { offset, limit, go };
}

/** The same in component state, for tables repeated on one page (e.g. one per sector card). */
export function useLocalPage(defaultSize = 25): PageState {
  const [state, setState] = useState({ offset: 0, limit: defaultSize });
  return { ...state, go: (offset, limit = state.limit) => setState({ offset, limit }) };
}

/**
 * The bar under a table: "1–50 of 1,234", Previous / Next and the page size. Nothing is shown while every row fits on
 * the smallest page, so short lists stay uncluttered.
 */
export function Pagination({ page, total, label = 'rows' }: { page: PageState; total: number; label?: string }) {
  if (total <= PAGE_SIZES[0] && page.offset === 0) return null;
  const { offset, limit, go } = page;
  const first = total ? Math.min(offset + 1, total) : 0;
  const last = Math.min(offset + limit, total);
  return (
    <nav className="pager no-print" aria-label={`Pages of ${label}`}>
      <button type="button" disabled={offset === 0} onClick={() => go(Math.max(0, offset - limit))}>Previous</button>
      <span className="muted" aria-live="polite">
        {fmtNum(first)}–{fmtNum(last)} of {fmtNum(total)}
      </span>
      <button type="button" disabled={offset + limit >= total} onClick={() => go(offset + limit)}>Next</button>
      <label className="page-size">
        <span className="muted">Per page</span>
        {/* A new size keeps the first visible row on screen. */}
        <select value={limit} onChange={(e) => {
          const l = Number(e.target.value);
          go(Math.floor(offset / l) * l, l);
        }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}

/**
 * Client-side paging of a list already loaded in full (users, lists, links…): the visible slice and its bar. A page
 * past the end (after rows were removed or filtered out) falls back to the last page.
 */
export function usePaged<T>(items: T[], page: PageState) {
  const lastStart = items.length ? Math.floor((items.length - 1) / page.limit) * page.limit : 0;
  const offset = Math.min(page.offset, lastStart);
  const clamped: PageState = { ...page, offset };
  return { rows: items.slice(offset, offset + page.limit), page: clamped, total: items.length };
}

/**
 * Client-side paging where a hook cannot go (e.g. a table rendered once per card): renders the visible rows through
 * [children] and the bar below them.
 */
export function Paged<T>({ items, label, size = 25, children }: { items: T[]; label?: string; size?: number; children: (rows: T[]) => ReactNode }) {
  const { rows, page, total } = usePaged(items, useLocalPage(size));
  return (
    <>
      {children(rows)}
      <Pagination page={page} total={total} label={label} />
    </>
  );
}
