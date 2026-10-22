import { useMutation, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api } from '../api/client';
import { ActivePill, Chevron, clean, Details, EmptyState, ErrorNotice, Field, Modal, PageHeader, RowMenu, Tabs, useDelete, useForm } from '../components/ui';

export type Kind = 'tree-species' | 'tree-statuses' | 'vendors';
/** `main` columns show in the table; the rest open in the row's details. */
interface Col { key: string; label: string; type?: 'text' | 'number' | 'bool' | 'email'; required?: boolean; immutable?: boolean; hint?: string; main?: boolean }

const CONFIG: Record<Kind, { title: string; singular: string; columns: Col[]; note?: string; name: (r: any) => string }> = {
  'tree-species': {
    title: 'Species',
    singular: 'species',
    name: (r) => r.common_name ? `${r.common_name} (${r.scientific_name})` : r.scientific_name,
    columns: [
      { key: 'scientific_name', label: 'Scientific name', required: true, main: true },
      { key: 'common_name', label: 'Common name', main: true },
      { key: 'code', label: 'Code' },
    ],
  },
  'tree-statuses': {
    title: 'Statuses',
    singular: 'status',
    name: (r) => r.name,
    columns: [
      { key: 'name', label: 'Name', required: true, main: true },
      { key: 'code', label: 'Code', required: true, immutable: true, hint: 'UPPER_CASE, fixed once created' },
      { key: 'sort_order', label: 'Order', type: 'number' },
      { key: 'is_terminal', label: 'Terminal (dead, missing)', type: 'bool', main: true },
      { key: 'allows_replacement', label: 'Replaceable', type: 'bool' },
      { key: 'requires_photo', label: 'Photo required', type: 'bool' },
    ],
  },
  vendors: {
    title: 'Vendors',
    singular: 'vendor',
    note: 'A new short code applies to new tree IDs only.',
    name: (r) => r.name,
    columns: [
      { key: 'name', label: 'Name', required: true, main: true },
      { key: 'short_code', label: 'Short code', hint: 'used in tree IDs', main: true },
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
  const [open, setOpen] = useState<string | null>(null);
  const del = useDelete();
  const cfg = CONFIG[kind];
  const rows = useQuery({ queryKey: [kind], queryFn: () => api.get<any[]>(`/${kind}`) });
  const toggle = useMutation({ mutationFn: (r: any) => api.patch(`/${kind}/${r.id}`, { active: !r.active }) });
  const main = cfg.columns.filter((c) => c.main);
  const rest = cfg.columns.filter((c) => !c.main);
  const show = (c: Col, r: any) => (c.type === 'bool' ? (r[c.key] ? 'Yes' : 'No') : r[c.key] ?? '—');
  return (
    <div>
      <PageHeader title="Lists" actions={<button className="primary" onClick={() => setEditing({})}>+ {cfg.singular[0].toUpperCase() + cfg.singular.slice(1)}</button>} />
      <Tabs tabs={(Object.keys(CONFIG) as Kind[]).map((k) => [k, CONFIG[k].title])} value={kind} onChange={(k) => (setKind(k), setOpen(null))} />
      <ErrorNotice error={rows.error ?? toggle.error} />
      <div className="card table-wrap">
        {!!rows.data?.length && (
          <table>
            <thead>
              <tr>
                <th className="expander" />
                {main.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>State</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                    <td className="expander"><Chevron open={open === r.id} /></td>
                    {main.map((c) => <td key={c.key} className={c.key === 'short_code' ? 'mono' : ''}>{show(c, r)}</td>)}
                    <td><ActivePill active={r.active} /></td>
                    <td className="actions">
                      <RowMenu
                        items={[
                          { label: 'Edit', onClick: () => setEditing(r) },
                          { label: r.active ? 'Deactivate' : 'Activate', onClick: () => toggle.mutate(r) },
                          { label: 'Delete', danger: true, onClick: () => del.ask({ what: cfg.singular, name: cfg.name(r), path: `/${kind}/${r.id}` }) },
                        ]}
                      />
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="details-row">
                      <td />
                      <td colSpan={main.length + 2}>
                        <Details items={rest.map((c) => [c.label, show(c, r)])} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {rows.data?.length === 0 && <EmptyState title={`No ${cfg.title.toLowerCase()} yet`} />}
      </div>
      {del.dialog}
      {editing && <ReferenceForm kind={kind} row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function ReferenceForm({ kind, row, onClose }: { kind: Kind; row: any; onClose: () => void }) {
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
        {!isNew && cfg.note && <p className="muted" style={{ margin: 0 }}>{cfg.note}</p>}
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
