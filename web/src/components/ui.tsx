import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="link" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {children}
      </div>
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

const STATUS_TONE: Record<string, string> = {
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
    value: values[key] ?? '',
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
