/**
 * Tree ID composition rules. Mirrored by the Android app (TreeIdAssembler.kt);
 * both are checked against spec/tree-id-test-vectors.json.
 */

export const COMPONENT_TYPES = [
  'PROJECT_CODE',
  'PLANTING_YEAR',
  /** The vendor's short code: several vendors tag trees with the same format, each numbering from 1. */
  'VENDOR_CODE',
  'SECTOR_CODE',
  'SUB_SECTOR_CODE',
  /** Fixed text set in the format itself (e.g. a vendor's own tag prefix). */
  'TEXT',
  'SERIAL',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const SCOPE_DIMENSIONS = ['PROJECT', 'PLANTING_YEAR', 'VENDOR', 'SECTOR', 'SUB_SECTOR'] as const;
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

export const ALLOWED_SEPARATORS = ['-', '_', '/', '.', ''];
export const MAX_SERIAL_WIDTH = 12;

export interface SchemeComponent {
  type: ComponentType;
  required: boolean;
  /** The text, for TEXT components. */
  value?: string;
}

export interface IdScheme {
  separator: string;
  serialWidth: number;
  components: SchemeComponent[];
  /** Empty array means serials are unique globally. */
  serialUniquenessScope: ScopeDimension[];
}

export type ComponentValues = Partial<Record<Exclude<ComponentType, 'SERIAL' | 'TEXT'>, string | null | undefined>>;

export interface ScopeEntities {
  project: string;
  plantingYear: string;
  vendor?: string | null;
  sector: string;
  subSector: string;
}

export class TreeIdError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const CODE_PATTERN = /^[A-Za-z0-9]+$/;

export function validateShortCode(code: string): string {
  const trimmed = code.trim();
  if (!CODE_PATTERN.test(trimmed) || trimmed.length > 16) {
    throw new TreeIdError('SHORT_CODE_INVALID');
  }
  return trimmed.toUpperCase();
}

/** Returns a list of problems; an empty list means the scheme is usable. */
export function validateScheme(scheme: IdScheme): string[] {
  const problems: string[] = [];
  if (!ALLOWED_SEPARATORS.includes(scheme.separator)) problems.push('SEPARATOR_UNSUPPORTED');
  if (!Number.isInteger(scheme.serialWidth) || scheme.serialWidth < 1 || scheme.serialWidth > MAX_SERIAL_WIDTH) {
    problems.push('SERIAL_WIDTH_OUT_OF_RANGE');
  }
  const types = scheme.components.map((c) => c.type);
  if (types.some((t) => !COMPONENT_TYPES.includes(t))) problems.push('COMPONENT_UNKNOWN');
  const named = types.filter((t) => t !== 'TEXT');
  if (new Set(named).size !== named.length) problems.push('COMPONENT_DUPLICATED');
  if (scheme.components.some((c) => c.type === 'TEXT' && !CODE_PATTERN.test(c.value ?? '') || (c.type === 'TEXT' && (c.value ?? '').length > 16))) {
    problems.push('TEXT_VALUE_INVALID');
  }
  const serialIdx = types.indexOf('SERIAL');
  if (serialIdx === -1) problems.push('SERIAL_MISSING');
  else if (serialIdx !== types.length - 1) problems.push('SERIAL_NOT_LAST');
  else if (!scheme.components[serialIdx].required) problems.push('SERIAL_MUST_BE_REQUIRED');
  if (scheme.serialUniquenessScope.some((d) => !SCOPE_DIMENSIONS.includes(d))) problems.push('SCOPE_DIMENSION_UNKNOWN');
  if (new Set(scheme.serialUniquenessScope).size !== scheme.serialUniquenessScope.length) {
    problems.push('SCOPE_DIMENSION_DUPLICATED');
  }
  return problems;
}

/**
 * A new project's format: PROJECT-YEAR-VENDOR-000001 (e.g. T4L-2026-KNM-000001), numbered per project,
 * planting year and vendor, so every vendor tagging trees on the project starts from 1.
 */
export const DEFAULT_SCHEME: IdScheme = {
  separator: '-',
  serialWidth: 6,
  components: [
    { type: 'PROJECT_CODE', required: true },
    { type: 'PLANTING_YEAR', required: true },
    { type: 'VENDOR_CODE', required: true },
    { type: 'SERIAL', required: true },
  ],
  serialUniquenessScope: ['PROJECT', 'PLANTING_YEAR', 'VENDOR'],
};

/** A format that names the vendor in the ID or numbers trees per vendor needs a vendor (with a short code) on every tree. */
export function schemeNeedsVendor(scheme: IdScheme): boolean {
  return scheme.components.some((c) => c.type === 'VENDOR_CODE') || scheme.serialUniquenessScope.includes('VENDOR');
}

/** Validates officer-entered serial and left-pads it to the scheme width. */
export function normalizeSerial(input: string, serialWidth: number): string {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) throw new TreeIdError('SERIAL_REQUIRED');
  if (!/^[0-9]+$/.test(trimmed)) throw new TreeIdError('SERIAL_NOT_NUMERIC');
  if (trimmed.length > serialWidth) throw new TreeIdError('SERIAL_TOO_LONG');
  if (/^0+$/.test(trimmed)) throw new TreeIdError('SERIAL_ZERO');
  return trimmed.padStart(serialWidth, '0');
}

/** Read-only prefix shown to the officer before they type the serial. */
export function assemblePrefix(scheme: IdScheme, values: ComponentValues): string {
  const parts: string[] = [];
  for (const component of scheme.components) {
    if (component.type === 'SERIAL') continue;
    const raw = component.type === 'TEXT' ? component.value : values[component.type];
    const value = raw == null ? '' : String(raw).trim();
    if (value.length === 0) {
      if (component.required) throw new TreeIdError(`COMPONENT_MISSING:${component.type}`);
      continue;
    }
    parts.push(value.toUpperCase());
  }
  return parts.length === 0 ? '' : parts.join(scheme.separator) + scheme.separator;
}

export function assemblePhysicalId(scheme: IdScheme, values: ComponentValues, serialInput: string) {
  const prefix = assemblePrefix(scheme, values);
  const serial = normalizeSerial(serialInput, scheme.serialWidth);
  const physicalId = prefix + serial;
  return { prefix, serial, physicalId, normalized: normalizePhysicalId(physicalId) };
}

/** Normalisation used for duplicate detection: case-insensitive, whitespace-insensitive, dash variants unified. */
export function normalizePhysicalId(id: string): string {
  return id
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function serialScopeKey(scope: ScopeDimension[], entities: ScopeEntities): string {
  if (scope.length === 0) return 'GLOBAL';
  const lookup: Record<ScopeDimension, string> = {
    PROJECT: entities.project,
    PLANTING_YEAR: entities.plantingYear,
    VENDOR: entities.vendor ?? 'NONE',
    SECTOR: entities.sector,
    SUB_SECTOR: entities.subSector,
  };
  return [...scope]
    .sort()
    .map((d) => `${d}=${lookup[d]}`)
    .join('|');
}

export type PhysicalIdUniqueness = 'GLOBAL' | 'PROJECT';

export function physicalIdScopeKey(mode: PhysicalIdUniqueness, projectId: string): string {
  return mode === 'GLOBAL' ? 'GLOBAL' : `PROJECT=${projectId}`;
}
