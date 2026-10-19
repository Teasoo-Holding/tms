// Mirrors backend/src/domain/tree-id.ts for live previews; the server re-validates every registration.
export const COMPONENTS: [string, string][] = [
  ['PROJECT_CODE', 'Project code'],
  ['PLANTING_YEAR', 'Planting year'],
  ['VENDOR_CODE', 'Vendor code'],
  ['SECTOR_CODE', 'Sector code'],
  ['SUB_SECTOR_CODE', 'Sub-sector code'],
  ['SERIAL', 'Serial number'],
];
export const SCOPES: [string, string][] = [
  ['PROJECT', 'Project'],
  ['PLANTING_YEAR', 'Planting year'],
  ['VENDOR', 'Vendor'],
  ['SECTOR', 'Sector'],
  ['SUB_SECTOR', 'Sub-sector'],
];

export function previewId(components: { type: string; required: boolean }[], separator: string, width: number, values: Record<string, string | undefined>, serial = '1') {
  const parts = components
    .filter((c) => c.type !== 'SERIAL')
    .map((c) => values[c.type]?.toUpperCase() || (c.required ? `‹${c.type.toLowerCase()}›` : ''))
    .filter(Boolean);
  const prefix = parts.length ? parts.join(separator) + separator : '';
  return { prefix, serial: serial.padStart(Math.max(width, 1), '0').slice(-Math.max(width, 1)) };
}

export function scopeLabel(scope: string[]) {
  if (!scope.length) return 'all projects (global)';
  return scope.map((s) => SCOPES.find(([k]) => k === s)?.[1] ?? s).join(' + ');
}
