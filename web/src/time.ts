/**
 * Every date and time is shown in West Africa Time (Africa/Lagos, UTC+1, no daylight saving), labelled "WAT",
 * whatever the viewer's own time zone. A "day" in reports runs from midnight to midnight WAT.
 */
export const TIME_ZONE = 'Africa/Lagos';
export const TZ_LABEL = 'WAT';
/** One line for pages with day totals. */
export const DAY_NOTE = 'Days run from midnight to midnight West Africa Time (WAT).';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, ...opts });
const CLOCK = fmt({ hour: '2-digit', minute: '2-digit' });
const DATE = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY_MONTH_TIME = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KEY = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** The WAT calendar day (YYYY-MM-DD) of an instant. */
export const watDay = (v: string | number | Date = new Date()) => KEY.format(toDate(v));
/** Today's WAT date, YYYY-MM-DD. */
export const todayWat = () => watDay(new Date());
/** The WAT date `n` days before today, YYYY-MM-DD. */
export function daysAgoWat(n: number) {
  const [y, m, d] = todayWat().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** "09:15" in WAT, without the label (for ranges; see timeRange). */
export const fmtClock = (v: string | number | Date) => CLOCK.format(toDate(v));
/** "09:15 WAT". */
export const fmtTime = (v?: string | null) => (v ? `${fmtClock(v)} ${TZ_LABEL}` : '—');
/** "09:15 WAT", or "09:15–10:40 WAT". */
export function timeRange(a: string, b: string) {
  const x = fmtClock(a);
  const y = fmtClock(b);
  return `${x === y ? x : `${x}–${y}`} ${TZ_LABEL}`;
}
/** The WAT date of an instant, "6 Nov 2026". */
export const fmtDate = (v?: string | null) => (v ? DATE.format(toDate(v)) : '—');
/** "6 Nov 2026, 09:15 WAT". */
export const fmtDateTime = (v?: string | number | Date | null) => (v ? `${DATE_TIME.format(toDate(v))} ${TZ_LABEL}` : '—');
/** "09:15 WAT" today, else "3 Nov, 08:10 WAT" (with the year when it is not this year). */
export function fmtWhen(v: string) {
  const d = toDate(v);
  const now = new Date();
  if (watDay(d) === watDay(now)) return fmtTime(v);
  return `${(watDay(d).slice(0, 4) === watDay(now).slice(0, 4) ? DAY_MONTH_TIME : DATE_TIME).format(d)} ${TZ_LABEL}`;
}
const SHORT_DATE = fmt({ day: 'numeric', month: 'short', year: '2-digit' });
/** "6 Nov 26" in WAT, for chart axes. */
export const fmtShortDate = (v: string | number | Date) => SHORT_DATE.format(toDate(v));

const GOV_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });
const GOV_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
/** GOV.UK style: "10 November 2026 at 11:10am WAT". */
export function fmtLongDateTime(v?: string | null) {
  if (!v) return '—';
  const d = toDate(v);
  const parts = Object.fromEntries(GOV_TIME.formatToParts(d).map((p) => [p.type, p.value]));
  return `${GOV_DATE.format(d)} at ${parts.hour}:${parts.minute}${String(parts.dayPeriod ?? '').toLowerCase().replace(/\./g, '')} ${TZ_LABEL}`;
}
