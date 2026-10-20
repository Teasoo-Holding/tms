import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { ReportFilters, useReportFilters } from '../components/ReportFilters';
import { EmptyState, ErrorNotice, fmtDateTime, fmtNum, PageHeader, StatusPill } from '../components/ui';

const PAGE = 100;

export function VisitsPage() {
  const isAdmin = useIsAdmin();
  const f = useReportFilters(['recorded_by', 'q']);
  const [q, setQ] = useState(f.get('q'));
  // Keep the search box in step with the URL (e.g. after "Reset filters" or following a link).
  useEffect(() => setQ(f.get('q')), [f.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users'), enabled: isAdmin });
  const offset = Number(f.get('offset') || 0);
  const { overdue_days: _unused, ...filters } = f.values;
  const exportQuery = qs(filters);
  const pageQuery = qs({ ...filters, limit: PAGE, offset });
  const visits = useQuery({ queryKey: ['visits', pageQuery], queryFn: () => api.get(`/reports/visits${pageQuery}`) });
  const total: number = visits.data?.total ?? 0;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download(`/reports/visits.csv${exportQuery}`, 'visits.csv');
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Visits"
        subtitle="Every recorded visit, newest first."
        actions={
          <>
            {visits.data && <span className="pill">{fmtNum(total)} matching</span>}
            <button onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
          </>
        }
      />

      <ReportFilters f={f} dateNote="Dates filter by the day of the visit; the other filters apply to the visited tree.">
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => (e.preventDefault(), f.set('q', q.trim()))}>
          <label className="field">
            Tree ID
            <input type="search" placeholder="Part of a tree ID" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== f.get('q') && f.set('q', q.trim())} />
          </label>
        </form>
        {isAdmin && (
          <label className="field">
            Recorded by
            <select value={f.get('recorded_by')} onChange={(e) => f.set('recorded_by', e.target.value)}>
              <option value="">Anyone</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}{u.active ? '' : ' (inactive)'}</option>
              ))}
            </select>
          </label>
        )}
      </ReportFilters>

      <ErrorNotice error={visits.error ?? exportError} />
      <div className={`card table-wrap tall ${visits.isFetching ? 'refetching' : ''}`}>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Tree ID</th><th>Area</th><th>Species</th><th>Status</th><th className="num">Height</th><th>Recorded by</th><th className="num">Photos</th><th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {visits.data?.items.map((v: any) => (
              <tr key={v.id} style={v.superseded ? { opacity: 0.6 } : undefined}>
                <td className="nowrap" title={`Recorded ${fmtDateTime(v.recorded_at)} · synced ${fmtDateTime(v.synced_at)}`}>{fmtDateTime(v.observed_at)}</td>
                <td className="nowrap">
                  <Link className="mono" to={`/trees/${v.tree_id}`}>{v.physical_tree_id}</Link>
                  <div className="muted">{v.project} · {v.planting_year}</div>
                </td>
                <td className="nowrap">{v.sector} / {v.sub_sector}</td>
                <td>{v.species}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <StatusPill code={v.status_code} name={v.status} />
                    {v.is_initial && <span className="pill">First visit</span>}
                    {v.is_amendment && <span className="pill warning" title={v.amendment_reason ?? undefined}>Correction</span>}
                    {v.superseded && <span className="pill" title="A later correction replaces this visit">Superseded</span>}
                  </div>
                  {v.is_amendment && v.amendment_reason && <div className="muted">{v.amendment_reason}</div>}
                </td>
                <td className="num nowrap">
                  {v.height_cm == null ? <span className="muted">—</span> : `${fmtNum(v.height_cm)} cm`}
                  {v.height_cm != null && v.height_method && <div className="muted">{String(v.height_method).replace(/_/g, ' ').toLowerCase()}</div>}
                </td>
                <td>{v.recorded_by}</td>
                <td className="num">{v.photos || <span className="muted">0</span>}</td>
                <td style={{ maxWidth: 280 }}>{v.remarks ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visits.data?.items.length === 0 && <EmptyState title="No visits match these filters">Clear a filter or widen the period. Visits appear after field devices sync.</EmptyState>}
        {visits.isLoading && <div className="empty">Loading visits…</div>}
      </div>
      {total > PAGE && (
        <div className="row">
          <button disabled={offset === 0} onClick={() => f.update({ offset: offset - PAGE > 0 ? String(offset - PAGE) : '' })}>Previous</button>
          <span className="muted">{fmtNum(offset + 1)}–{fmtNum(Math.min(offset + PAGE, total))} of {fmtNum(total)}</span>
          <button disabled={offset + PAGE >= total} onClick={() => f.update({ offset: String(offset + PAGE) })}>Next</button>
        </div>
      )}
    </div>
  );
}
