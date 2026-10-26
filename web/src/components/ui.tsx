import { useMutation } from '@tanstack/react-query';
import { InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';

export function Modal({ title, onClose, children, wide, small }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; small?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}${small ? ' small' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Page title; actions sit on the right and wrap below on narrow screens. Keep `subtitle` for text that prevents mistakes. */
export function PageHeader({ title, subtitle, actions, crumbs, mono, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
  mono?: boolean;
  /** Extra inline content after the title block (e.g. status pills). */
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-title">
        {crumbs && <div className="crumbs muted">{crumbs}</div>}
        <h1 className={mono ? 'mono' : undefined}>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {children}
      <span className="spacer" />
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Card section header: title, optional short description and right-aligned actions. */
export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = Array.isArray(e.details) ? e.details : null;
  return (
    <div className="notice error" role="alert">
      {e.message ?? 'Something went wrong.'}
      {details && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {details.map((d: any, i: number) => (
            <li key={i}>{typeof d === 'string' ? d : `${d.path ? d.path + ': ' : ''}${d.message}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Password input with an accessible show/hide toggle. Accepts the usual input props (value, onChange, autoComplete…). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="password-toggle" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  ALIVE: 'good',
  HEALTHY: 'good',
  PLANTED: 'good',
  NEEDS_INSPECTION: 'warning',
  DAMAGED: 'warning',
  DEAD: 'critical',
  MISSING: 'critical',
};
/** Tree status pill: always a text label; the tone is a secondary cue only. */
export function StatusPill({ code, name }: { code?: string | null; name?: string | null }) {
  return (
    <span className={`pill ${code ? (STATUS_TONE[code] ?? '') : ''}`}>
      <span className="dot" aria-hidden />
      {name ?? 'Not observed'}
    </span>
  );
}

export function RecordStatePill({ state }: { state: string }) {
  if (state === 'ACTIVE') return null;
  return <span className={`pill ${state === 'CONFLICT' ? 'warning' : 'critical'}`}>{state === 'CONFLICT' ? 'In conflict' : 'Rejected'}</span>;
}

export function ActivePill({ active }: { active: boolean }) {
  return <span className={`pill ${active ? 'good' : ''}`}>{active ? 'Active' : 'Inactive'}</span>;
}

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
export const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');
export const fmtNum = (v?: number | null) => (v == null ? '—' : v.toLocaleString());

const DAY = 86_400_000;
/** True when the timestamp is missing or older than `days`. */
export const isStale = (v: string | null | undefined, days: number) => !v || Date.now() - new Date(v).getTime() > days * DAY;

/** Builds a CSV file client-side and downloads it. Values are quoted; formula-leading cells are neutralised. */
export function downloadCsv(filename: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function relativeTime(v?: string | null) {
  if (!v) return 'never';
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Simple controlled-form helper. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const bind = (key: keyof T) => ({
    value: (values[key] ?? '') as string,
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  const bindCheck = (key: keyof T) => ({
    checked: !!values[key],
    onChange: (e: { target: { checked: boolean } }) => setValues((v) => ({ ...v, [key]: e.target.checked })),
  });
  return { values, setValues, bind, bindCheck };
}

/** Empty strings become null so optional API fields are cleared rather than sent as "". */
export function clean<T extends Record<string, any>>(values: T): T {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])) as T;
}

// ------------------------------------------------------------------ row actions ("⋯" menu)
export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The per-row/per-card actions menu: Edit, Activate/Deactivate, Delete… Falsy items are skipped, so callers can
 * write `isAdmin && {…}`. The list is portalled and fixed-positioned so table scrolling never clips it.
 */
export function RowMenu({ items, label = 'Actions' }: { items: (MenuItem | false | null | undefined)[]; label?: string }) {
  const list = items.filter(Boolean) as MenuItem[];
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        btn.current?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);
  if (list.length === 0) return null;
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const roomBelow = window.innerHeight - r.bottom;
    setPos(roomBelow < list.length * 44 + 24 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return (
    <span className="row-menu" onClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" className="icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="menu" role="menu" style={pos} onKeyDown={onMenuKey} onClick={(e) => e.stopPropagation()}>
            {list.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={it.danger ? 'danger' : undefined}
                disabled={it.disabled}
                onClick={() => {
                  setPos(null);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Pencil button at the right end of a row/card, before its "⋯" menu, opening the item's edit form. */
export function EditButton({ name, onClick, label = 'Edit' }: { name: string; onClick: () => void; label?: string }) {
  const text = `${label} ${name}`;
  return (
    <button type="button" className="icon-btn edit-btn" aria-label={text} title={text} onClick={(e) => (e.stopPropagation(), onClick())}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h4L19 9l-4-4L4 16v4z" />
        <path d="M13.5 6.5l4 4" />
      </svg>
    </button>
  );
}

/** What a delete confirmation needs: the API path and how to name the item. */
export interface DeleteTarget {
  /** e.g. "species", "planting year". */
  what: string;
  /** The item's own name, shown in bold. */
  name: string;
  path: string;
  /** One short line, only when it prevents a mistake (e.g. what else is removed). */
  note?: string;
  onDeleted?: () => void;
}

/** Small confirmation naming the item. A refusal (409 IN_USE / HAS_TREES) shows the server's message as-is. */
export function DeleteDialog({ target, onClose }: { target: DeleteTarget; onClose: () => void }) {
  const del = useMutation({
    mutationFn: () => api.del(target.path),
    onSuccess: () => {
      onClose();
      target.onDeleted?.();
    },
  });
  const refused = (del.error as ApiError | null)?.status === 409;
  return (
    <Modal title={`Delete ${target.what}?`} onClose={onClose} small>
      <div className="stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{target.name}</strong> will be deleted permanently.
        </p>
        {target.note && <p className="muted" style={{ margin: 0 }}>{target.note}</p>}
        {refused ? <div className="notice warning" role="alert">{(del.error as ApiError).message}</div> : <ErrorNotice error={del.error} />}
        <div className="form-actions" style={{ marginTop: 4 }}>
          <button type="button" onClick={onClose} autoFocus>{refused ? 'Close' : 'Cancel'}</button>
          {!refused && (
            <button type="button" className="danger-solid" onClick={() => del.mutate()} disabled={del.isPending}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Holds the item awaiting delete confirmation; render `dialog` once in the page. */
export function useDelete() {
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  return { ask: setTarget, dialog: target && <DeleteDialog target={target} onClose={() => setTarget(null)} /> };
}

/** A plain table for chart data and small summaries. */
export function SimpleTable({ head, rows, numeric = [] }: { head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  if (rows.length === 0) return <div className="empty">No data for these filters.</div>;
  const isNum = (i: number) => numeric.includes(i) || (i > 0 && numeric.length === 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={isNum(i) ? 'num' : ''}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={isNum(ci) ? 'num' : ''}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Label/value pairs for a row's secondary details; empty values are skipped. */
export function Details({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  if (shown.length === 0) return null;
  return (
    <dl className="kv">
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Chevron for expandable rows. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chevron${open ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Today as YYYY-MM-DD, for download file names. */
export const todayStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
