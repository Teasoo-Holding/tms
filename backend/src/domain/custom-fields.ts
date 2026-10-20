/** Administrator-defined fields on trees and observations. Values are stored as jsonb keyed by field key. */

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type CustomValue = string | number | boolean | null;

export interface FieldDefinition {
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  required: boolean;
  active: boolean;
}

export class CustomFieldError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Checks submitted values against the project's definitions and returns the cleaned values.
 * Unknown keys and wrongly typed values are refused. A missing required value is NOT refused here:
 * forms enforce it, and a device whose cached configuration predates a new required field must
 * still be able to sync what it recorded (data loss is worse than a gap an administrator can fill).
 */
export function validateCustomValues(defs: FieldDefinition[], values: Record<string, unknown> | null | undefined): Record<string, CustomValue> {
  const out: Record<string, CustomValue> = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [key, raw] of Object.entries(values ?? {})) {
    const def = byKey.get(key);
    if (!def) throw new CustomFieldError('CUSTOM_FIELD_UNKNOWN', `“${key}” is not a field of this project.`);
    if (raw === null || raw === undefined || raw === '') continue;
    out[key] = coerce(def, raw);
  }
  return out;
}

function coerce(def: FieldDefinition, raw: unknown): CustomValue {
  const bad = () => new CustomFieldError('CUSTOM_FIELD_INVALID', `“${def.label}” has an invalid value.`);
  switch (def.field_type) {
    case 'TEXT':
      if (typeof raw !== 'string' || raw.length > 1000) throw bad();
      return raw.trim();
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) throw bad();
      return n;
    }
    case 'DATE':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw bad();
      return raw;
    case 'BOOLEAN':
      if (typeof raw !== 'boolean') throw bad();
      return raw;
    case 'SELECT':
      // A choice the administrator has since removed is still a valid historical value.
      if (typeof raw !== 'string' || raw.length > 200) throw bad();
      return raw;
  }
}
