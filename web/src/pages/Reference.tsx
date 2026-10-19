import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { ActivePill, clean, ErrorNotice, Field, Modal, Tabs, useForm } from '../components/ui';

type Kind = 'tree-species' | 'tree-statuses' | 'vendors';
interface Col { key: string; label: string; type?: 'text' | 'number' | 'bool' | 'email'; required?: boolean; immutable?: boolean; hint?: string }

const CONFIG: Record<Kind, { title: string; singular: string; columns: Col[]; note: string }> = {
  'tree-species': {
    title: 'Species',
    singular: 'species',
    note: 'Deactivated species stay on existing trees but cannot be chosen for new ones.',
    columns: [
      { key: 'scientific_name', label: 'Scientific name', required: true },
      { key: 'common_name', label: 'Common name' },
      { key: 'code', label: 'Code' },
    ],
  },
  'tree-statuses': {
    title: 'Statuses',
    singular: 'status',
    note: 'Statuses are recorded through dated observations. Terminal statuses (e.g. Dead, Missing) are reported separately from trees that are merely overdue for inspection.',
    columns: [
      { key: 'code', label: 'Code', required: true, immutable: true, hint: 'UPPER_CASE, fixed once created' },
      { key: 'name', label: 'Name', required: true },
      { key: 'sort_order', label: 'Order', type: 'number' },
      { key: 'is_terminal', label: 'Terminal', type: 'bool' },
      { key: 'allows_replacement', label: 'Replaceable', type: 'bool' },
      { key: 'requires_photo', label: 'Photo required', type: 'bool' },
    ],
  },
  vendors: {
    title: 'Vendors',
    singular: 'vendor',
    note: 'Changing a vendor short code affects new tree IDs only; registered IDs keep the code they were issued with.',
    columns: [
      { key: 'name', label: 'Name', required: true },
      { key: 'short_code', label: 'Short code', hint: 'optional ID component' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'contact_phone', label: 'Phone' },
      { key: 'contact_email', label: 'Email', type: 'email' },
      { key: 'location', label: 'Location' },
    ],
  },
};

export function ReferencePage() {
  const [kind, setKind] = useState<Kind>('tree-species');
  const [editing, setEditing] = useState<any | null>(null);
  const cfg = CONFIG[kind];
  const rows = useQuery({ queryKey: [kind], queryFn: () => api.get<any[]>(`/${kind}`) });
  const toggle = useMutation({ mutationFn: (r: any) => api.patch(`/${kind}/${r.id}`, { active: !r.active }) });
  return (
    <div>
      <div className="page-header">
        <h1>Species, statuses & vendors</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({})}>Add {cfg.singular}</button>
      </div>
      <Tabs tabs={(Object.keys(CONFIG) as Kind[]).map((k) => [k, CONFIG[k].title])} value={kind} onChange={setKind} />
      <p className="subtle" style={{ marginTop: 0 }}>{cfg.note}</p>
      <ErrorNotice error={rows.error ?? toggle.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr>{cfg.columns.map((c) => <th key={c.key}>{c.label}</th>)}<th>State</th><th /></tr></thead>
          <tbody>
            {rows.data?.map((r) => (
              <tr key={r.id}>
                {cfg.columns.map((c) => <td key={c.key} className={c.key === 'code' || c.key === 'short_code' ? 'mono' : ''}>{c.type === 'bool' ? (r[c.key] ? 'Yes' : 'No') : (r[c.key] ?? '—')}</td>)}
                <td><ActivePill active={r.active} /></td>
                <td className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="link" onClick={() => setEditing(r)}>Edit</button>
                  <button className="link" onClick={() => toggle.mutate(r)}>{r.active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ReferenceForm kind={kind} row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReferenceForm({ kind, row, onClose }: { kind: Kind; row: any; onClose: () => void }) {
  const cfg = CONFIG[kind];
  const isNew = !row.id;
  const f = useForm<Record<string, any>>(Object.fromEntries(cfg.columns.map((c) => [c.key, row[c.key] ?? (c.type === 'bool' ? false : c.type === 'number' ? 0 : '')])));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = clean({ ...f.values });
      cfg.columns.forEach((c) => {
        if (c.type === 'number') body[c.key] = Number(body[c.key] ?? 0);
        if (!isNew && c.immutable) delete body[c.key];
      });
      return isNew ? api.post(`/${kind}`, body) : api.patch(`/${kind}/${row.id}`, body);
    },
    onSuccess: onClose,
  });
  return (
    <Modal title={`${isNew ? 'Add' : 'Edit'} ${cfg.singular}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <ErrorNotice error={save.error} />
        <div className="form-grid">
          {cfg.columns.filter((c) => c.type !== 'bool').map((c) => (
            <Field key={c.key} label={c.label} hint={c.hint}>
              <input type={c.type ?? 'text'} required={c.required} disabled={!isNew && c.immutable} {...f.bind(c.key)} />
            </Field>
          ))}
        </div>
        {cfg.columns.filter((c) => c.type === 'bool').map((c) => (
          <label className="check" key={c.key}><input type="checkbox" {...f.bindCheck(c.key)} /> {c.label}</label>
        ))}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
