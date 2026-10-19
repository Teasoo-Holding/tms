import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, qs } from '../api/client';
import { ErrorNotice, fmtDateTime } from '../components/ui';

const ENTITY_TYPES = ['project', 'planting_year', 'tree_id_scheme', 'sector', 'sub_sector', 'species', 'status', 'vendor', 'user', 'assignment', 'serial_allocation', 'device', 'tree', 'observation', 'conflict', 'report'];

export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const logs = useInfiniteQuery({
    queryKey: ['audit', entityType],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.get<any[]>(`/audit-logs${qs({ entity_type: entityType, before_id: pageParam, limit: 100 })}`),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id : undefined),
  });
  const rows = logs.data?.pages.flat() ?? [];
  return (
    <div>
      <div className="page-header"><h1>Audit log</h1></div>
      <div className="filters">
        <label className="field">
          Entity
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </div>
      <ErrorNotice error={logs.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th /></tr></thead>
          <tbody>
            {rows.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td>{fmtDateTime(l.created_at)}</td>
                  <td>{l.actor_name ?? 'system'}</td>
                  <td className="mono">{l.action}</td>
                  <td>{l.entity_type} <span className="muted mono" style={{ fontSize: 11 }}>{l.entity_id}</span></td>
                  <td><button className="link" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : 'Details'}</button></td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={5}>
                      <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{JSON.stringify({ before: l.before, after: l.after, metadata: l.metadata }, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !logs.isLoading && <div className="empty">No entries.</div>}
      </div>
      {logs.hasNextPage && <button style={{ marginTop: 12 }} onClick={() => logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>Load older entries</button>}
    </div>
  );
}
