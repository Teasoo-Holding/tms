import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { TreePhotos } from '../components/Photos';
import { Pagination, usePage } from '../components/Pagination';
import { EmptyState, ErrorNotice, Field, fmtDateTime, Modal, PageHeader, Tabs } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  DUPLICATE_PHYSICAL_ID: 'Duplicate tree ID',
  DUPLICATE_SERIAL: 'Duplicate serial in scope',
  DUPLICATE_REPLACEMENT: 'Tree replaced twice',
  REVISION_MISMATCH: 'Concurrent edit',
};

const RESOLUTIONS: Record<string, [string, string, boolean][]> = {
  DUPLICATE: [
    ['KEEP_EXISTING_RECORD', 'Keep the existing record. The incoming submission is set aside (kept, not deleted).', false],
    ['ACCEPT_INCOMING_RECORD', 'Accept the incoming submission. It takes the tree ID; the existing record is set aside with its visits and photos (kept, not deleted).', false],
    ['CORRECT_INCOMING_SERIAL', 'The incoming label was mis-keyed: give it the correct serial and add it to the registry', true],
    ['CORRECT_EXISTING_SERIAL', 'The existing record is wrong: correct its serial, then add the incoming tree with the disputed ID', true],
  ],
  DUPLICATE_REPLACEMENT: [
    ['KEEP_UNLINKED', 'Keep the incoming tree as an ordinary tree, not a replacement', false],
    ['REJECT_INCOMING', 'Set the incoming submission aside (it is kept, not deleted)', false],
  ],
  REVISION_MISMATCH: [
    ['APPLY_INCOMING_CHANGES', 'Apply the incoming edit on top of the current record', false],
    ['KEEP_EXISTING', 'Keep the current record and discard the incoming edit', false],
  ],
};

export function ConflictsPage() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [selected, setSelected] = useState<string | null>(null);
  const page = usePage('', 25);
  // Paged on the server: conflicts can pile up after a large import.
  const conflicts = useQuery({
    queryKey: ['conflicts', status, page.offset, page.limit],
    queryFn: () => api.get<{ items: any[]; total: number }>(`/conflicts${qs({ status, limit: page.limit, offset: page.offset })}`),
  });
  const items = conflicts.data?.items;
  return (
    <div>
      <PageHeader title="Conflicts" />
      <Tabs tabs={[['OPEN', 'Open'], ['RESOLVED', 'Resolved']]} value={status} onChange={(s) => (setStatus(s), page.go(0))} />
      <ErrorNotice error={conflicts.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Project</th><th>Incoming</th><th>Existing</th><th>Submitted</th>{status === 'RESOLVED' && <th>Resolution</th>}<th /></tr></thead>
          <tbody>
            {items?.map((c) => (
              <tr key={c.id}>
                <td>{TYPE_LABEL[c.conflict_type]}</td>
                <td>{c.project_name}</td>
                <td className="mono">{c.incoming_physical_id}</td>
                <td className="mono">{c.existing_physical_id}</td>
                <td>{fmtDateTime(c.created_at)}<div className="muted">{c.submitted_by_name}</div></td>
                {status === 'RESOLVED' && <td>{c.resolution?.replace(/_/g, ' ').toLowerCase()}<div className="muted">{c.resolved_by_name}: {c.resolution_notes}</div></td>}
                <td><button onClick={() => setSelected(c.id)}>{status === 'OPEN' ? 'Review' : 'View'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && <EmptyState title={status === 'OPEN' ? 'No open conflicts' : 'Nothing resolved yet'} />}
      </div>
      <Pagination page={page} total={conflicts.data?.total ?? 0} label="conflicts" />
      {selected && <ConflictReview id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ConflictReview({ id, onClose }: { id: string; onClose: () => void }) {
  const c = useQuery({ queryKey: ['conflict', id], queryFn: () => api.get(`/conflicts/${id}`) });
  const [resolution, setResolution] = useState('');
  const [serial, setSerial] = useState('');
  const [notes, setNotes] = useState('');
  const resolve = useMutation({ mutationFn: () => api.post(`/conflicts/${id}/resolve`, { resolution, notes, serial_input: serial || undefined }), onSuccess: onClose });
  const d = c.data;
  if (!d) return null;
  const base = RESOLUTIONS[d.conflict_type.startsWith('DUPLICATE_') && d.conflict_type !== 'DUPLICATE_REPLACEMENT' ? 'DUPLICATE' : d.conflict_type];
  // Name the records by age, so the choice reads "keep the older" or "accept the most recent" (#124).
  const incomingAge = age(d.incoming, d.existing);
  const existingAge = age(d.existing, d.incoming);
  const named = (key: string, label: string) =>
    key === 'KEEP_EXISTING_RECORD'
      ? `Keep the ${existingAge ? `${existingAge.toLowerCase()} ` : ''}existing record (${d.existing?.physical_tree_id ?? '—'}). The incoming submission is set aside: kept, not deleted, and listed under Rejected records.`
      : key === 'ACCEPT_INCOMING_RECORD'
        ? `Accept the ${incomingAge ? `${incomingAge.toLowerCase()} ` : ''}incoming submission. It takes the tree ID; the existing record is set aside with its visits and photos: kept, not deleted, and listed under Rejected records.`
        : label;
  const options = base.map(([key, label, serial]) => [key, named(key, label), serial] as [string, string, boolean]);
  const summary: Record<string, string> = {
    KEEP_EXISTING_RECORD: `${d.existing?.physical_tree_id ?? 'The existing record'} stays as it is. The incoming submission is set aside.`,
    ACCEPT_INCOMING_RECORD: `The incoming submission becomes ${d.existing?.physical_tree_id ?? 'the tree'}. The existing record is set aside, not deleted.`,
  };
  const needsSerial = options.find(([k]) => k === resolution)?.[2];
  return (
    <Modal title={TYPE_LABEL[d.conflict_type]} onClose={onClose} wide>
      <div className="stack">
        <div className="grid cols-2">
          <TreeCard title="Incoming submission" tree={d.incoming} age={age(d.incoming, d.existing)} />
          <TreeCard title={d.conflict_type === 'REVISION_MISMATCH' ? 'Current server record' : 'Existing record'} tree={d.existing} age={age(d.existing, d.incoming)} />
        </div>
        {d.conflict_type === 'REVISION_MISMATCH' && (
          <section className="card">
            <h3>Incoming edit (based on revision {d.details.base_revision}; server is at {d.details.server_revision})</h3>
            <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(d.details.changes, null, 2)}</pre>
          </section>
        )}
        {d.status === 'OPEN' ? (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), resolve.mutate())}>
            <ErrorNotice error={resolve.error} />
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <legend className="subtle" style={{ marginBottom: 8 }}>Resolution</legend>
              {options.map(([key, label]) => (
                <label className="check" key={key}>
                  <input type="radio" name="resolution" required value={key} checked={resolution === key} onChange={() => setResolution(key)} /> {label}
                </label>
              ))}
            </fieldset>
            {summary[resolution] && (
              <div className="notice" role="status">
                <strong>What happens:</strong> {summary[resolution]} The decision, who made it and your notes go into the audit log.
              </div>
            )}
            {needsSerial && <Field label="Corrected serial"><input required inputMode="numeric" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>}
            <Field label="Notes" hint="why this resolution; kept in the audit log"><textarea required minLength={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="form-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!resolution || resolve.isPending}>
                {resolution === 'KEEP_EXISTING_RECORD' ? 'Keep the existing record' : resolution === 'ACCEPT_INCOMING_RECORD' ? 'Accept the incoming submission' : 'Resolve'}
              </button>
            </div>
          </form>
        ) : (
          <div className="notice">Resolved {fmtDateTime(d.resolved_at)}: {d.resolution?.replace(/_/g, ' ').toLowerCase()}. {d.resolution_notes}</div>
        )}
      </div>
    </Modal>
  );
}

/** When a record was recorded in the field: its first visit, else when it reached the server. */
const recordedAt = (t: any) => (t ? Date.parse(t.recorded_at ?? t.client_recorded_at ?? t.synced_at ?? t.created_at) : NaN);
/** "Older" or "Most recent", by recorded time, then sync time (#117). */
function age(tree: any, other: any): 'Older' | 'Most recent' | null {
  if (!tree || !other) return null;
  const a = recordedAt(tree);
  const b = recordedAt(other);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (a !== b) return a < b ? 'Older' : 'Most recent';
  const sa = Date.parse(tree.synced_at);
  const sb = Date.parse(other.synced_at);
  return sa === sb || Number.isNaN(sa) || Number.isNaN(sb) ? null : sa < sb ? 'Older' : 'Most recent';
}

function TreeCard({ title, tree, age }: { title: string; tree: any; age?: 'Older' | 'Most recent' | null }) {
  return (
    <section className="card">
      <h3>
        {title} {age && <span className={`pill ${age === 'Older' ? '' : 'good'}`}>{age}</span>}
      </h3>
      {tree ? (
        <dl className="kv">
          <dt>Tree ID</dt><dd><Link className="mono" to={`/trees/${tree.id}`}>{tree.physical_tree_id}</Link></dd>
          <dt>State</dt><dd>{tree.record_state.toLowerCase()}</dd>
          <dt>Registered by</dt><dd>{tree.created_by_name}</dd>
          <dt>Recorded in the field</dt><dd>{fmtDateTime(tree.recorded_at ?? tree.client_recorded_at)}</dd>
          <dt>Visits after registration</dt><dd>{tree.visit_count ?? 0}</dd>
          <dt>Synced</dt><dd>{fmtDateTime(tree.synced_at)}</dd>
          <dt>Photos</dt><dd>{tree.media_count ? <TreePhotos treeId={tree.id} /> : 'None'}</dd>
          <dt>Notes</dt><dd>{tree.notes ?? '—'}</dd>
        </dl>
      ) : (
        <p className="muted">Not available.</p>
      )}
    </section>
  );
}
