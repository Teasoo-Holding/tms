import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { EmptyState, ErrorNotice, Field, fmtDateTime, Modal, PageHeader, Tabs } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  DUPLICATE_PHYSICAL_ID: 'Duplicate tree ID',
  DUPLICATE_SERIAL: 'Duplicate serial in scope',
  DUPLICATE_REPLACEMENT: 'Tree replaced twice',
  REVISION_MISMATCH: 'Concurrent edit',
};

const RESOLUTIONS: Record<string, [string, string, boolean][]> = {
  DUPLICATE: [
    ['CORRECT_INCOMING_SERIAL', 'The incoming label was mis-keyed: give it the correct serial and add it to the registry', true],
    ['CORRECT_EXISTING_SERIAL', 'The existing record is wrong: correct its serial, then add the incoming tree with the disputed ID', true],
    ['REJECT_INCOMING', 'Set the incoming submission aside (it is kept, not deleted)', false],
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
  const conflicts = useQuery({ queryKey: ['conflicts', status], queryFn: () => api.get<any[]>(`/conflicts${qs({ status })}`) });
  return (
    <div>
      <PageHeader
        title="Sync conflicts"
        subtitle="Submissions that collided at sync are never overwritten. Both records stay intact until you decide; every resolution is audited and reaches devices on their next sync."
      />
      <Tabs tabs={[['OPEN', 'Open'], ['RESOLVED', 'Resolved']]} value={status} onChange={setStatus} />
      <ErrorNotice error={conflicts.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Project</th><th>Incoming</th><th>Existing</th><th>Submitted</th>{status === 'RESOLVED' && <th>Resolution</th>}<th /></tr></thead>
          <tbody>
            {conflicts.data?.map((c) => (
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
        {conflicts.data?.length === 0 && <EmptyState title={status === 'OPEN' ? 'No open conflicts' : 'Nothing resolved yet'}>{status === 'OPEN' ? 'All synced records are consistent.' : undefined}</EmptyState>}
      </div>
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
  const options = RESOLUTIONS[d.conflict_type.startsWith('DUPLICATE_') && d.conflict_type !== 'DUPLICATE_REPLACEMENT' ? 'DUPLICATE' : d.conflict_type];
  const needsSerial = options.find(([k]) => k === resolution)?.[2];
  return (
    <Modal title={TYPE_LABEL[d.conflict_type]} onClose={onClose} wide>
      <div className="stack">
        <div className="grid cols-2">
          <TreeCard title="Incoming submission" tree={d.incoming} />
          <TreeCard title={d.conflict_type === 'REVISION_MISMATCH' ? 'Current server record' : 'Existing record'} tree={d.existing} />
        </div>
        {d.conflict_type === 'REVISION_MISMATCH' && (
          <section className="card">
            <h3>Incoming edit (based on revision {d.details.base_revision}; server is at {d.details.server_revision})</h3>
            <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(d.details.changes, null, 2)}</pre>
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
            {needsSerial && <Field label="Corrected serial"><input required inputMode="numeric" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>}
            <Field label="Notes" hint="why this resolution; kept in the audit log"><textarea required minLength={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="form-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={resolve.isPending}>Resolve</button>
            </div>
          </form>
        ) : (
          <div className="notice">Resolved {fmtDateTime(d.resolved_at)}: {d.resolution?.replace(/_/g, ' ').toLowerCase()}. {d.resolution_notes}</div>
        )}
      </div>
    </Modal>
  );
}

function TreeCard({ title, tree }: { title: string; tree: any }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {tree ? (
        <dl className="kv">
          <dt>Tree ID</dt><dd><Link className="mono" to={`/trees/${tree.id}`}>{tree.physical_tree_id}</Link></dd>
          <dt>State</dt><dd>{tree.record_state.toLowerCase()}</dd>
          <dt>Registered by</dt><dd>{tree.created_by_name}</dd>
          <dt>Recorded on device</dt><dd>{fmtDateTime(tree.client_recorded_at)}</dd>
          <dt>Synced</dt><dd>{fmtDateTime(tree.synced_at)}</dd>
          <dt>Photos</dt><dd>{tree.media_count}</dd>
          <dt>Notes</dt><dd>{tree.notes ?? '—'}</dd>
        </dl>
      ) : (
        <p className="muted">Not available.</p>
      )}
    </section>
  );
}
