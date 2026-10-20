// Mirrors backend/src/domain/tree-id.ts for live previews; the server re-validates every registration.
export const COMPONENTS: [string, string][] = [
  ['PROJECT_CODE', 'Project code'],
  ['PLANTING_YEAR', 'Planting year'],
  ['VENDOR_CODE', 'Vendor code'],
  ['SECTOR_CODE', 'Sector code'],
  ['SUB_SECTOR_CODE', 'Sub-sector code'],
  ['TEXT', 'Fixed text'],
  ['SERIAL', 'Tree number'],
];
/** Parts that are the same for every tree of a vendor in a year; the officer never types them. */
export const FIXED_PARTS = ['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'TEXT'];
export const isFixedPart = (type: string) => FIXED_PARTS.includes(type);
export const componentLabel = (type: string) => COMPONENTS.find(([k]) => k === type)?.[1] ?? type;
/** Fixed text: 1–16 letters or digits. */
export const TEXT_VALUE = /^[A-Za-z0-9]{1,16}$/;

export const SCOPES: [string, string][] = [
  ['PROJECT', 'Project'],
  ['PLANTING_YEAR', 'Planting year'],
  ['VENDOR', 'Vendor'],
  ['SECTOR', 'Sector'],
  ['SUB_SECTOR', 'Sub-sector'],
];
/** Lets two vendors reuse the same tree numbers in a year; their full IDs differ by the vendor code. */
export const RECOMMENDED_SCOPE = ['PROJECT', 'PLANTING_YEAR', 'VENDOR'];

export interface SchemeComponent {
  type: string;
  required: boolean;
  value?: string;
}

export function previewId(components: SchemeComponent[], separator: string, width: number, values: Record<string, string | null | undefined>, serial = '15') {
  const parts = components
    .filter((c) => c.type !== 'SERIAL')
    .map((c) => (c.type === 'TEXT' ? c.value?.toUpperCase() || '‹text›' : values[c.type]?.toUpperCase() || (c.required ? `‹${componentLabel(c.type).toLowerCase()}›` : '')))
    .filter(Boolean);
  const prefix = parts.length ? parts.join(separator) + separator : '';
  return { prefix, serial: serial.padStart(Math.max(width, 1), '0').slice(-Math.max(width, 1)) };
}

export function scopeLabel(scope: string[]) {
  if (!scope.length) return 'all projects (global)';
  return scope.map((s) => SCOPES.find(([k]) => k === s)?.[1] ?? s).join(' + ');
}

/** A tree_id_schemes row as returned by GET /projects/:id. */
export interface Scheme {
  id: string;
  version: number;
  active: boolean;
  active_from: string;
  vendor_id: string | null;
  planting_year_id: string | null;
  vendor_name: string | null;
  vendor_short_code: string | null;
  year_label: string | null;
  component_definition: SchemeComponent[];
  separator: string;
  serial_width: number;
  serial_uniqueness_scope: string[];
}

export type SchemeLevel = 'vendor_year' | 'vendor' | 'year' | 'default';
export const LEVEL_LABEL: Record<SchemeLevel, string> = {
  vendor_year: 'Vendor in this year',
  vendor: 'Vendor (all years)',
  year: 'This planting year',
  default: 'Project default',
};
export const levelOf = (s: { vendor_id: string | null; planting_year_id: string | null }): SchemeLevel =>
  s.vendor_id ? (s.planting_year_id ? 'vendor_year' : 'vendor') : s.planting_year_id ? 'year' : 'default';

/** The format the phone uses: vendor + year, then vendor, then year, then the project default. */
export function effectiveScheme(schemes: Scheme[], vendorId: string | null | undefined, yearId: string | null | undefined): Scheme | undefined {
  const active = schemes.filter((s) => s.active);
  const find = (v: string | null, y: string | null) => active.find((s) => s.vendor_id === v && s.planting_year_id === y);
  return (
    (vendorId && yearId ? find(vendorId, yearId) : undefined) ??
    (vendorId ? find(vendorId, null) : undefined) ??
    (yearId ? find(null, yearId) : undefined) ??
    find(null, null)
  );
}
