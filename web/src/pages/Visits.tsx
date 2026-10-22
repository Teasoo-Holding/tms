import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { FiltersButton, ReportFilters, useReportFilters } from '../components/ReportFilters';
import { Chevron, Details, EmptyState, ErrorNotice, fmtDate, fmtDateTime, fmtNum, PageHeader, StatusPill, VISIT_TYPES, visitTypeLabel } from '../components/ui';
import { SHOW_HEIGHT } from '../features';

const PAGE = 100;

export function VisitsPage() {
  const isAdmin = useIsAdmin();
  const f = useReportFilters(['recorded_by', 'q', 'visit_type']);
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
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

  const toggleRow = (id: string) => setOpen((o) => (o === id ? null : id));
  const cols = isAdmin ? 5 : 4;

  return (
    <div className="stack">
      <PageHeader
        title="Visits"
        actions={
          <>
            {visits.data && <span className="pill">{fmtNum(total)}</span>}
            <button onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
          </>
        }
      />

      <div className="toolbar">
        <form className="search" role="search" onSubmit={(e) => (e.preventDefault(), f.set('q', q.trim()))}>
          <input type="search" aria-label="Search by tree ID" placeholder="Search tree ID" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== f.get('q') && f.set('q', q.trim())} />
        </form>
        <FiltersButton count={f.count - (f.get('q') ? 1 : 0)} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />
      </div>

      {filtersOpen && (
        <ReportFilters f={f} dateNote="Dates are visit dates." onClose={() => setFiltersOpen(false)}>
          <label className="field">
            Visit type
            <select value={f.get('visit_type')} onChange={(e) => f.set('visit_type', e.target.value)}>
              <option value="">All types</option>
              {VISIT_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
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
      )}

      <ErrorNotice error={visits.error ?? exportError} />
      <div className={`card table-wrap tall ${visits.isFetching ? 'refetching' : ''}`}>
        {!!visits.data?.items.length && (
          <table>
            <thead>
              <tr>
                <th className="expander" /><th>Date</th><th>Tree ID</th><th>Status</th>{isAdmin && <th className="hide-sm">Recorded by</th>}
              </tr>
            </thead>
            <tbody>
              {visits.data.items.map((v: any) => (
                <Fragment key={v.id}>
                  <tr className="clickable" style={v.superseded ? { opacity: 0.6 } : undefined} onClick={() => toggleRow(v.id)} aria-expanded={open === v.id}>
                    <td className="expander"><Chevron open={open === v.id} /></td>
                    <td className="nowrap">{fmtDate(v.observed_at)}</td>
                    <td className="nowrap">
                      <Link className="mono" to={`/trees/${v.tree_id}`} onClick={(e) => e.stopPropagation()}>{v.physical_tree_id}</Link>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <StatusPill code={v.status_code} name={v.status} />
                        {v.is_amendment && <span className="pill warning">Correction</span>}
                        {v.superseded && <span className="pill">Superseded</span>}
                      </div>
                    </td>
                    {isAdmin && <td className="hide-sm">{v.recorded_by}</td>}
                  </tr>
                  {open === v.id && (
                    <tr className="details-row">
                      <td />
                      <td colSpan={cols - 1}>
                        <Details
                          items={[
                            ['Visited', fmtDateTime(v.observed_at)],
                            ['Type', visitTypeLabel(v.visit_type)],
                            ['Project', `${v.project} · ${v.planting_year}`],
                            ['Area', `${v.sector} / ${v.sub_sector}`],
                            ['Species', v.species],
                            ['Recorded by', v.recorded_by],
                            ['Photos', v.photos ? String(v.photos) : null],
                            SHOW_HEIGHT && v.height_cm != null ? ['Height', `${fmtNum(v.height_cm)} cm`] : ['', null],
                            ['Remarks', v.remarks],
                            ['Correction reason', v.is_amendment ? v.amendment_reason : null],
                            ['Synced', fmtDateTime(v.synced_at)],
                          ]}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {visits.data?.items.length === 0 && <EmptyState title="No visits found">{f.active ? 'Clear a filter or widen the period.' : undefined}</EmptyState>}
        {visits.isLoading && <div className="empty">Loading…</div>}
      </div>
      {total > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => f.update({ offset: offset - PAGE > 0 ? String(offset - PAGE) : '' })}>Previous</button>
          <span className="muted">{fmtNum(offset + 1)}–{fmtNum(Math.min(offset + PAGE, total))} of {fmtNum(total)}</span>
          <button disabled={offset + PAGE >= total} onClick={() => f.update({ offset: String(offset + PAGE) })}>Next</button>
        </div>
      )}
    </div>
  );
}
