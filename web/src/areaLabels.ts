/**
 * One way of naming areas everywhere: "S1 · North" for a sector and "S1/SS1 · Riverside" for a sub-sector.
 * The name is left out when it adds nothing: missing, blank, the code again, or a generated placeholder such as
 * "Subsector1" or "Sector 2". Quick setup's own names ("Sector N" for SN, "Sub-sector N" for SSN) are real names.
 */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Generic numbered names: "Sector 2", "Sub-sector 1", "Subsector1", "SS 3", "Block 4"… */
const GENERIC = /^(sub[\s_-]*sector|sector|ss|sb|s|block|area|zone|plot)\s*[#_.-]?\s*(\d+)$/i;

/** Names as quick setup creates them, for the matching code only. */
const QUICK_SETUP: [RegExp, (n: string) => string][] = [
  [/^Sector (\d+)$/, (n) => `S${n}`],
  [/^Sub-sector (\d+)$/, (n) => `SS${n}`],
];

/** The area's own name when it is worth showing, else null. */
export function areaName(code: string | null | undefined, name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  if (code && squash(n) === squash(code)) return null;
  for (const [re, codeFor] of QUICK_SETUP) {
    const m = n.match(re);
    if (m && code && codeFor(m[1]).toUpperCase() === code.toUpperCase()) return n;
  }
  return GENERIC.test(n) ? null : n;
}

const withName = (codes: string, name: string | null) => (name ? `${codes} · ${name}` : codes);

/** "S1 · North", or "S1" when the name is a placeholder. */
export function sectorLabel(s: { short_code?: string | null; name?: string | null }) {
  return withName(s.short_code ?? '', areaName(s.short_code, s.name));
}

/** "S1/SS1 · Riverside", or "S1/SS1" when the sub-sector's name is a placeholder. */
export function subSectorLabel(sectorCode: string | null | undefined, code: string | null | undefined, name: string | null | undefined) {
  const codes = sectorCode ? `${sectorCode}/${code ?? ''}` : code ?? '';
  return withName(codes, areaName(code, name));
}

/** Planting year heading for areas: "2026 planting year", or "Areas without a planting year". */
export const yearHeading = (year?: string | null) => (year ? `${year} planting year` : 'Areas without a planting year');

/** Rows grouped by planting year (newest first), sectors in natural code order (S2 before S10) within each (#115, #116). */
export function groupByYear<T extends { year_label?: string | null; short_code?: string | null }>(rows: T[]): { year: string | null; rows: T[] }[] {
  const num = (c?: string | null) => Number((c ?? '').match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const years = [...new Set(rows.map((r) => r.year_label ?? null))].sort((a, b) => (b ?? '').localeCompare(a ?? ''));
  return years.map((year) => ({
    year,
    rows: rows
      .filter((r) => (r.year_label ?? null) === year)
      .sort((a, b) => (a.short_code ?? '').replace(/\d+$/, '').localeCompare((b.short_code ?? '').replace(/\d+$/, '')) || num(a.short_code) - num(b.short_code)),
  }));
}
