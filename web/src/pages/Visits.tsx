import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { subSectorLabel } from '../areaLabels';
import { useIsAdmin } from '../auth';
import { Pagination, usePage } from '../components/Pagination';
import { FiltersButton, ReportFilters, useReportFilters } from '../components/ReportFilters';
import { fmtHeight, Lightbox, Thumbs } from '../components/Photos';
import { Chevron, EmptyState, ErrorNotice, fmtNum, PageHeader, StatusBadge, todayStamp, VISIT_TYPES, VisitTypeTag } from '../components/ui';
import { SHOW_HEIGHT } from '../features';

/** Days are counted in the browser's time zone. */
const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();
/** Records of a session shown at first, and added by each "Show more". */
const RECORDS_STEP = 25;

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (v: string) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const timeRange = (a: string, b: string) => (fmtTime(a) === fmtTime(b) ? fmtTime(a) : `${fmtTime(a)}–${fmtTime(b)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const names = (cs: { user_name: string }[]) => cs.map((c) => c.user_name).join(', ');

/**
 * Visits grouped as the field teams work: one row per project and day ("visit day"), opening into the day's field
 * sessions per data collector, each listing its tree records. Filters and search keep a day when any of its
 * records match, and the counts are of the matching records.
 */
export function VisitsPage() {
  const isAdmin = useIsAdmin();
  const f = useReportFilters(['recorded_by', 'q', 'visit_type']);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(f.get('q'));
  // Keep the search box in step with the URL (e.g. after "Reset filters" or following a link).
  useEffect(() => setQ(f.get('q')), [f.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users'), enabled: isAdmin });
  const page = usePage('', 25);
  const { overdue_days: _unused, ...filters } = f.values;
  const exportQuery = qs({ ...filters, tz: TZ });
  const pageQuery = qs({ ...filters, tz: TZ, limit: page.limit, offset: page.offset });
  const days = useQuery({ queryKey: ['visit-days', pageQuery], queryFn: () => api.get(`/reports/visit-days${pageQuery}`) });
  const total: number = days.data?.total ?? 0;
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  // The open day ("date~project") is in the URL, so it can be linked to.
  const open = params.get('day') ?? '';
  const toggleDay = (key: string) => {
    const next = new URLSearchParams(params);
    if (open === key) next.delete('day');
    else next.set('day', key);
    setParams(next, { replace: true });
  };
  const exportXlsx = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download(`/reports/visits.xlsx${exportQuery}`, `visits-${todayStamp()}.xlsx`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };
  const items: any[] = days.data?.items ?? [];
  const manyProjects = new Set(items.map((d) => d.project_id)).size > 1 || !f.get('project_id');

  return (
    <div className="stack">
      <PageHeader
        title="Visits"
        subtitle={`One row per project and day; open a day to see each field session and its trees. Times in ${TZ.replace(/_/g, ' ')}.`}
        actions={
          <>
            {days.data && <span className="pill">{plural(total, 'day')}</span>}
            <button onClick={exportXlsx} disabled={exporting} title="A Days sheet (as listed here) and every record">{exporting ? 'Exporting…' : 'Export to Excel'}</button>
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
        <ReportFilters f={f} dateNote="Dates are visit dates. A day is listed when any of its records match." onClose={() => setFiltersOpen(false)}>
          <label className="field">
            Visit type
            <select value={f.get('visit_type')} onChange={(e) => f.set('visit_type', e.target.value)}>
              <option value="">Any type</option>
              {VISIT_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          {isAdmin && (
            <label className="field">
              Data collector
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

      <ErrorNotice error={days.error ?? exportError} />
      <div className={`card table-wrap ${days.isFetching ? 'refetching' : ''}`}>
        {items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th className="expander" />
                <th>Day</th>
                {manyProjects && <th className="hide-sm">Project</th>}
                <th className="num">Trees registered</th>
                <th className="num hide-sm">Follow-up visits</th>
                <th className="num hide-sm">Corrections</th>
                <th className="num hide-sm">Photos</th>
                <th className="hide-sm">Data collectors</th>
                <th className="num hide-sm">Sessions</th>
                <th className="hide-sm">Time</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const key = `${d.date}~${d.project_id}`;
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr className="clickable" onClick={() => toggleDay(key)} aria-expanded={isOpen}>
                      <td className="expander"><Chevron open={isOpen} /></td>
                      <td>
                        <button type="button" className="link" onClick={(e) => (e.stopPropagation(), toggleDay(key))} aria-expanded={isOpen}>
                          <strong className="nowrap">{fmtDay(d.date)}</strong>
                        </button>
                        <div className="muted show-sm">
                          {manyProjects && `${d.project_name} · `}
                          {plural(d.visits, 'follow-up')} · {names(d.collectors)} · {timeRange(d.first_at, d.last_at)}
                        </div>
                      </td>
                      {manyProjects && <td className="hide-sm">{d.project_name}</td>}
                      <td className="num">{fmtNum(d.trees_registered)}</td>
                      <td className="num hide-sm">{fmtNum(d.visits)}</td>
                      <td className="num hide-sm">{d.corrections ? fmtNum(d.corrections) : <span className="muted">0</span>}</td>
                      <td className="num hide-sm">{fmtNum(d.photos)}</td>
                      <td className="hide-sm" title={names(d.collectors)}>
                        {d.collector_count <= 2 ? names(d.collectors) : `${d.collectors[0].user_name} and ${d.collector_count - 1} others`}
                      </td>
                      <td className="num hide-sm">{fmtNum(d.sessions)}</td>
                      <td className="hide-sm nowrap">{timeRange(d.first_at, d.last_at)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="details-row">
                        <td colSpan={manyProjects ? 10 : 9} style={{ padding: 0 }}>
                          <VisitDay date={d.date} projectId={d.project_id} filters={filters} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {days.data && items.length === 0 && <EmptyState title="No visits found">{f.active ? 'Clear a filter or widen the period.' : undefined}</EmptyState>}
        {days.isLoading && <div className="empty">Loading…</div>}
        <Pagination page={page} total={total} label="visit days" />
      </div>
    </div>
  );
}

/** One open day: its field sessions, per data collector, in the order the work started. */
function VisitDay({ date, projectId, filters }: { date: string; projectId: string; filters: Record<string, string> }) {
  const query = qs({ ...filters, project_id: projectId, tz: TZ });
  const day = useQuery({ queryKey: ['visit-day', date, query], queryFn: () => api.get(`/reports/visit-days/${date}${query}`) });
  if (day.error) return <div style={{ padding: 12 }}><ErrorNotice error={day.error} /></div>;
  if (!day.data) return <div className="empty">Loading…</div>;
  const sessions: any[] = day.data.sessions;
  return (
    <div className="visit-day">
      {sessions.map((s) => (
        <Session key={`${s.field_session_id ?? 'none'}~${s.user_id}`} session={s} date={date} query={query} />
      ))}
      {sessions.length === 0 && <div className="empty">No records match the filters on this day.</div>}
    </div>
  );
}

function Session({ session: s, date, query }: { session: any; date: string; query: string }) {
  const [limit, setLimit] = useState(RECORDS_STEP);
  const [photos, setPhotos] = useState<any[] | null>(null);
  const recordsQuery = `${query}&${qs({ field_session_id: s.field_session_id ?? 'none', recorded_by: s.user_id, limit }).slice(1)}`;
  const records = useQuery({ queryKey: ['visit-day-records', date, recordsQuery], queryFn: () => api.get(`/reports/visit-days/${date}/records${recordsQuery}`) });
  const items: any[] = records.data?.items ?? [];
  const total: number = records.data?.total ?? s.records;
  const counts = [
    s.trees_registered && plural(s.trees_registered, 'tree registered', 'trees registered'),
    s.visits && plural(s.visits, 'follow-up visit'),
    s.corrections && plural(s.corrections, 'correction'),
    plural(s.photos, 'photo'),
  ].filter(Boolean);
  const subs: string[] = s.sub_sectors ?? [];
  return (
    <section className="visit-session" aria-label={`${s.user_name}, ${timeRange(s.first_at, s.last_at)}`}>
      <header>
        <div>
          <strong>{s.user_name}</strong>
          <span className="muted"> · {timeRange(s.first_at, s.last_at)}{s.field_session_id ? '' : ' · no field session (older app)'}</span>
        </div>
        <div className="muted">
          {counts.join(' · ')}
          {subs.length > 0 && <> · {subs.length > 4 ? `${subs.slice(0, 4).join(', ')} and ${subs.length - 4} more areas` : subs.join(', ')}</>}
          {s.vendors?.length > 0 && <> · Vendor {s.vendors.join(', ')}</>}
        </div>
      </header>
      <ErrorNotice error={records.error} />
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th><th>Tree ID</th><th>Status</th><th className="hide-sm">Species</th><th className="hide-sm">Area</th><th>Photo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} style={r.superseded ? { opacity: 0.6 } : undefined}>
                  <td className="nowrap">{fmtTime(r.observed_at)}</td>
                  <td className="nowrap">
                    <Link className="mono" to={`/trees/${r.tree_id}`}>{r.physical_tree_id}</Link>
                    <div className="muted show-sm">{r.species} · {subSectorLabel(r.sector, r.sub_sector, r.sub_sector_name)}</div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <StatusBadge code={r.status_code} name={r.status} terminal={r.status_terminal} />
                      <VisitTypeTag visit={r} />
                      {r.is_amendment && <span className="pill warning" title={r.amendment_reason ?? undefined}>Correction</span>}
                      {r.superseded && <span className="pill">Superseded</span>}
                    </div>
                    {(r.remarks || (SHOW_HEIGHT && r.height_cm != null)) && (
                      <div className="muted">{[SHOW_HEIGHT && r.height_cm != null && fmtHeight(Number(r.height_cm)), r.remarks].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td className="hide-sm">{r.species}</td>
                  <td className="hide-sm nowrap">{subSectorLabel(r.sector, r.sub_sector, r.sub_sector_name)}</td>
                  <td>
                    {r.media.length ? (
                      <div className="thumb-cell">
                        <Thumbs media={r.media.slice(0, 1)} onOpen={() => setPhotos(r.media)} />
                        {r.media.length > 1 && <span className="muted">+{r.media.length - 1}</span>}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {records.isLoading && <div className="empty">Loading…</div>}
      {total > items.length && items.length > 0 && (
        <div className="more-toggle" style={{ padding: 8 }}>
          <button type="button" onClick={() => setLimit((n) => n + RECORDS_STEP)} disabled={records.isFetching}>
            {records.isFetching ? 'Loading…' : `Show more (${fmtNum(items.length)} of ${fmtNum(total)})`}
          </button>
        </div>
      )}
      {photos && <Lightbox media={photos} index={0} onClose={() => setPhotos(null)} />}
    </section>
  );
}
