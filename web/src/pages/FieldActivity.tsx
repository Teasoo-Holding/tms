import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { ChartCard, Legend, SERIES, StackedColumns, StatTile } from '../charts/charts';
import { CardHeader, Chevron, EmptyState, ErrorNotice, fmtNum, PageHeader, SimpleTable } from '../components/ui';

interface Counts {
  trees_registered: number;
  visits: number;
  corrections: number;
  photos: number;
}
interface Session extends Counts {
  field_session_id: string | null;
  first_at: string;
  last_at: string;
  project_id: string;
  project_name: string;
  planting_year: string;
  sectors: string[];
  sub_sectors: string[];
  vendors: string[];
}
interface Day extends Counts {
  date: string;
  user_id: string;
  user_name: string;
  first_at: string;
  last_at: string;
  sessions: Session[];
}
interface Officer extends Counts {
  user_id: string;
  user_name: string;
  role: string;
  days_active: number;
  sessions: number;
}
interface Report {
  from: string;
  to: string;
  tz: string;
  officers: Officer[];
  days: Day[];
}

/** The browser's time zone: a day is the officer's working day where the report is read. */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const QUICK: [string, number][] = [['Today', 0], ['7 days', 6], ['30 days', 29]];
/** "2026-10-27" → "Tue 27 Oct", without a time-zone shift. */
const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const timeRange = (a: string, b: string) => (fmtTime(a) === fmtTime(b) ? fmtTime(a) : `${fmtTime(a)}–${fmtTime(b)}`);
/** Every date from `from` to `to`, inclusive. */
function datesBetween(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const sum = (xs: Counts[], k: keyof Counts) => xs.reduce((n, x) => n + x[k], 0);

/** What field officers did, per day and field session: trees registered, visits, corrections and photos. */
export function FieldActivityPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const from = get('from') || daysAgo(6);
  const to = get('to') || ymd(new Date());
  const projectId = get('project_id');
  const userId = get('user_id');
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<any[]>('/projects') });
  // Fetched for every officer (the officer filter applies on the page), so the officer list stays complete.
  const query = qs({ project_id: projectId, from, to, tz: TZ });
  const report = useQuery({ queryKey: ['field-activity', query], queryFn: () => api.get<Report>(`/reports/field-activity${query}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.download(`/reports/field-activity.csv${qs({ project_id: projectId, from, to, tz: TZ, user_id: userId })}`, `field-activity-${from}-to-${to}.csv`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  const r = report.data;
  const allOfficers = r?.officers ?? [];
  const officers = allOfficers.filter((o) => !userId || o.user_id === userId);
  const days = (r?.days ?? []).filter((d) => !userId || d.user_id === userId);
  const quick = QUICK.find(([, n]) => from === daysAgo(n) && to === ymd(new Date()))?.[0];

  // Trees registered per day, stacked by officer (the eight most active get their own colour).
  const dates = r ? datesBetween(r.from, r.to) : [];
  const top = officers.slice(0, 8);
  const others = officers.length > top.length;
  const series = [
    ...top.map((o, i) => ({ key: o.user_id, label: o.user_name, color: SERIES[i] })),
    ...(others ? [{ key: 'others', label: 'Others', color: 'var(--border-strong)' }] : []),
  ];
  const topIds = new Set(top.map((o) => o.user_id));
  const perDay = (date: string, key: string) =>
    days.filter((d) => d.date === date && (key === 'others' ? !topIds.has(d.user_id) : d.user_id === key)).reduce((n, d) => n + d.trees_registered, 0);
  // Columns are labelled by day name; values are looked up by date.
  const dateOf = new Map(dates.map((d) => [fmtDay(d), d]));
  const label = (date: string) => fmtDay(date);

  return (
    <div className="stack">
      <PageHeader
        title="Field activity"
        subtitle={`What officers recorded each day, by field session. Days and times in ${TZ}.`}
        actions={<button onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button>}
      />

      <section className="card filter-panel" aria-label="Filters">
        <div className="filters" style={{ marginBottom: 0 }}>
          <label className="field">
            Project
            <select value={projectId} onChange={(e) => update({ project_id: e.target.value, user_id: '' })}>
              <option value="">All projects</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="field">
            Period
            <div className="row" style={{ gap: 4 }} role="group" aria-label="Quick periods">
              {QUICK.map(([text, n]) => (
                <button key={text} type="button" className={quick === text ? 'primary' : ''} aria-pressed={quick === text}
                  onClick={() => update({ from: n === 6 ? '' : daysAgo(n), to: '' })}>
                  {text}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            From
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
          </label>
          <label className="field">
            To
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </label>
          <label className="field">
            Officer
            <select value={userId} onChange={(e) => update({ user_id: e.target.value })}>
              <option value="">Everyone</option>
              {allOfficers.map((o) => <option key={o.user_id} value={o.user_id}>{o.user_name}</option>)}
              {userId && !allOfficers.some((o) => o.user_id === userId) && <option value={userId}>Selected officer</option>}
            </select>
          </label>
        </div>
      </section>

      <ErrorNotice error={report.error ?? exportError} />
      {report.isLoading && <div className="empty">Loading…</div>}
      {r && (
        <div className={`stack ${report.isFetching ? 'refetching' : ''}`}>
          <div className="grid stats">
            <StatTile label="Trees registered" value={fmtNum(sum(officers, 'trees_registered'))} />
            <StatTile label="Visits" value={fmtNum(sum(officers, 'visits'))} foot={sum(officers, 'corrections') ? `plus ${fmtNum(sum(officers, 'corrections'))} corrections` : undefined} />
            <StatTile label="Photos" value={fmtNum(sum(officers, 'photos'))} />
            <StatTile label="Officers active" value={fmtNum(officers.length)} foot={`${fmtNum(officers.reduce((n, o) => n + o.sessions, 0))} field sessions`} />
          </div>

          <ChartCard
            title="Trees registered per day"
            empty={sum(officers, 'trees_registered') === 0 && 'No trees registered in this period.'}
            legend={<Legend items={series} />}
            table={<SimpleTable head={['Day', ...series.map((s) => s.label)]} rows={dates.map((d) => [label(d), ...series.map((s) => fmtNum(perDay(d, s.key)))])} />}
          >
            <StackedColumns categories={dates.map(label)} series={series} values={(c, k) => perDay(dateOf.get(c) ?? c, k)} />
          </ChartCard>

          <section className="card">
            <CardHeader title="By officer" />
            {officers.length ? (
              <SimpleTable
                head={['Officer', 'Trees', 'Visits', 'Corrections', 'Photos', 'Days active', 'Sessions']}
                rows={officers.map((o) => [o.user_name, fmtNum(o.trees_registered), fmtNum(o.visits), fmtNum(o.corrections), fmtNum(o.photos), fmtNum(o.days_active), fmtNum(o.sessions)])}
              />
            ) : (
              <EmptyState title="No field activity in this period">Widen the period or choose another project.</EmptyState>
            )}
          </section>

          {days.length > 0 && (
            <section className="card">
              <CardHeader title="By day" description="Open a row to see the officer’s field sessions: when, where and for which vendor." />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="expander" /><th>Day</th><th>Officer</th><th className="hide-sm">Time</th>
                      <th className="num">Trees</th><th className="num">Visits</th><th className="num hide-sm">Photos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const key = `${d.date}|${d.user_id}`;
                      return (
                        <Fragment key={key}>
                          <tr className="clickable" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                            <td className="expander"><Chevron open={open === key} /></td>
                            <td className="nowrap">{fmtDay(d.date)}</td>
                            <td>{d.user_name}</td>
                            <td className="nowrap hide-sm">{timeRange(d.first_at, d.last_at)}</td>
                            <td className="num">{fmtNum(d.trees_registered)}</td>
                            <td className="num">{fmtNum(d.visits)}{d.corrections ? <span className="muted"> +{d.corrections}</span> : null}</td>
                            <td className="num hide-sm">{fmtNum(d.photos)}</td>
                          </tr>
                          {open === key && (
                            <tr className="details-row">
                              <td />
                              <td colSpan={6}>
                                <SessionList sessions={d.sessions} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Trees registered are first visits; visits are later visits; corrections replace an earlier visit and are counted apart. Records of rejected trees are left out.
            Work recorded by older app versions, which do not mark field sessions, is shown as one session per officer and day.
          </p>
        </div>
      )}
    </div>
  );
}

function SessionList({ sessions }: { sessions: Session[] }) {
  return (
    <ul className="item-list">
      {sessions.map((s, i) => (
        <li key={`${s.field_session_id ?? 'none'}|${s.project_id}|${s.planting_year}|${i}`}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 6 }}>
              <strong className="nowrap">{timeRange(s.first_at, s.last_at)}</strong>
              <span>{s.project_name} · {s.planting_year}</span>
              {!s.field_session_id && <span className="pill" title="Recorded by an app version that does not mark field sessions">No session</span>}
            </div>
            <div className="muted" style={{ overflowWrap: 'anywhere' }}>
              {s.sub_sectors.join(', ') || s.sectors.join(', ')}
              {s.vendors.length > 0 && <> · vendor {s.vendors.join(', ')}</>}
            </div>
          </div>
          <div className="muted nowrap">
            {fmtNum(s.trees_registered)} trees · {fmtNum(s.visits)} visits{s.corrections ? ` · ${fmtNum(s.corrections)} corrections` : ''} · {fmtNum(s.photos)} photos
          </div>
        </li>
      ))}
    </ul>
  );
}
