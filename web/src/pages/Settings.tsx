import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import { ErrorNotice, Field, fmtNum, PageHeader, PasswordInput, todayStamp } from '../components/ui';

const CONFIRM = 'DELETE ALL DATA';
type Scope = 'FIELD_DATA' | 'EVERYTHING';

export function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportAll = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download('/reports/export.xlsx', `tms-export-${todayStamp()}.xlsx`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="stack">
      <PageHeader title="Settings" />
      <section className="card">
        <div className="card-header" style={{ alignItems: 'center', marginBottom: 0 }}>
          <h2>Export all data</h2>
          <button className="primary" onClick={exportAll} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Export all data (Excel)'}
          </button>
        </div>
        {!!exportError && <div style={{ marginTop: 12 }}><ErrorNotice error={exportError} /></div>}
      </section>
      <ClearData />
    </div>
  );
}

function ClearData() {
  const [scope, setScope] = useState<Scope>('FIELD_DATA');
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const clear = useMutation({
    mutationFn: () => api.post('/admin/clear-data', { scope, confirm: typed.trim(), password }),
    onSuccess: () => {
      setTyped('');
      setPassword('');
    },
  });
  const valid = typed.trim() === CONFIRM && password.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) clear.mutate();
  };
  const err = clear.error as ApiError | null;
  const r = clear.data;
  return (
    <section className="card danger-zone">
      <h2>Danger zone</h2>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <fieldset className="choice-list">
          <legend>Clear data</legend>
          <label className={`choice${scope === 'FIELD_DATA' ? ' on' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'FIELD_DATA'} onChange={() => setScope('FIELD_DATA')} />
            <span>
              <strong>Field data only</strong>
              <span className="muted">Trees, visits, photos and sync history. Projects and setup stay.</span>
            </span>
          </label>
          <label className={`choice${scope === 'EVERYTHING' ? ' on' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'EVERYTHING'} onChange={() => setScope('EVERYTHING')} />
            <span>
              <strong>Everything</strong>
              <span className="muted">Also projects, areas, ID formats, species, statuses and vendors.</span>
            </span>
          </label>
        </fieldset>
        <p className="muted" style={{ margin: 0 }}>User accounts and the audit log are kept. This cannot be undone.</p>
        <div className="form-grid">
          <Field label={`Type ${CONFIRM}`}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={!!typed && typed.trim() !== CONFIRM} />
          </Field>
          <Field label="Your password">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
        {err?.code === 'PASSWORD_INCORRECT' ? (
          <div className="notice error" role="alert">Your password is incorrect.</div>
        ) : (
          <ErrorNotice error={clear.error} />
        )}
        {r && (
          <div className="notice" role="status">
            <strong>Cleared.</strong> Removed {fmtNum(r.trees)} trees, {fmtNum(r.visits)} visits and {fmtNum(r.photos)} photos
            {r.scope === 'EVERYTHING' ? `, and ${fmtNum(r.projects)} projects` : ''}. Phones reset on their next sync.
          </div>
        )}
        <div>
          <button className="danger-solid" disabled={!valid || clear.isPending}>
            {clear.isPending ? 'Clearing…' : scope === 'EVERYTHING' ? 'Clear everything' : 'Clear field data'}
          </button>
        </div>
      </form>
    </section>
  );
}
