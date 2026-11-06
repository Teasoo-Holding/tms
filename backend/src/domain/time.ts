/**
 * Every date and time the system shows is West Africa Time (Africa/Lagos, UTC+1, no daylight saving), and a
 * "day" in reports runs from midnight to midnight WAT. Times are still stored as UTC instants.
 */
export const TIME_ZONE = 'Africa/Lagos';
export const TIME_ZONE_LABEL = 'WAT';

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** The WAT calendar date (YYYY-MM-DD) of an instant. */
export function watDate(v: Date | string): string {
  const p = parts(typeof v === 'string' ? new Date(v) : v);
  return `${p.year}-${p.month}-${p.day}`;
}

/** An instant as WAT wall-clock time with its offset, e.g. 2026-11-06T09:15:00+01:00. */
export function watIso(d: Date): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+01:00`;
}

/** A Date whose UTC fields read as WAT wall-clock time: Excel has no time zones, so cells show WAT. */
export function watWallClock(d: Date): Date {
  return new Date(d.getTime() + 60 * 60 * 1000);
}
