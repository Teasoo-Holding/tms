// Mirrors backend/src/domain/tree-id.ts for live previews; the server re-validates every registration.
/** Parts an administrator can put in a project's format. */
export const COMPONENTS: [string, string][] = [
  ['PROJECT_CODE', 'Project code'],
  ['PLANTING_YEAR', 'Planting year'],
  ['SECTOR_CODE', 'Sector code'],
  ['SUB_SECTOR_CODE', 'Sub-sector code'],
  ['TEXT', 'Fixed text'],
  ['SERIAL', 'Tree number'],
];
/** Parts that only appear in formats from before IDs became per project and planting year (shown for history). */
const LEGACY_COMPONENTS: [string, string][] = [['VENDOR_CODE', 'Vendor code']];
/** Parts that are the same for every tree in a year; the officer never types them. */
export const FIXED_PARTS = ['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'TEXT'];
export const isFixedPart = (type: string) => FIXED_PARTS.includes(type);
export const componentLabel = (type: string) => [...COMPONENTS, ...LEGACY_COMPONENTS].find(([k]) => k === type)?.[1] ?? type;
/** Fixed text: 1–16 letters or digits. */
export const TEXT_VALUE = /^[A-Za-z0-9]{1,16}$/;

export const SCOPES: [string, string][] = [
  ['PROJECT', 'Project'],
  ['PLANTING_YEAR', 'Planting year'],
  ['SECTOR', 'Sector'],
  ['SUB_SECTOR', 'Sub-sector'],
];
const LEGACY_SCOPES: [string, string][] = [['VENDOR', 'Vendor']];
/** One progressive sequence per project and planting year, shared by every vendor. */
export const RECOMMENDED_SCOPE = ['PROJECT', 'PLANTING_YEAR'];

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
  return scope.map((s) => [...SCOPES, ...LEGACY_SCOPES].find(([k]) => k === s)?.[1] ?? s).join(' + ');
}

/** A tree_id_schemes row as returned by GET /projects/:id. */
export interface Scheme {
  id: string;
  version: number;
  active: boolean;
  active_from: string;
  /** Legacy: set only on inactive vendor- or year-specific formats from before migration 007. */
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

/** Where an earlier version applied, for the history table. */
export const appliedTo = (s: Scheme) =>
  s.vendor_id ? `Vendor ${s.vendor_name ?? ''}${s.year_label ? ` in ${s.year_label}` : ''}` : s.planting_year_id ? `Year ${s.year_label ?? ''}` : 'Whole project';

/** The project's current format: one per project, for every vendor and planting year. */
export function currentScheme(schemes: Scheme[]): Scheme | undefined {
  return schemes.find((s) => s.active && !s.vendor_id && !s.planting_year_id) ?? schemes.find((s) => s.active);
}
