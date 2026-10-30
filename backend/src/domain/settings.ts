import { z } from 'zod';
import { Queryable } from '../database/db.service';

/** Units tree heights are shown in. Heights are always stored in centimetres. */
export const HEIGHT_UNITS = ['cm', 'm', 'in', 'ft'] as const;
export type HeightUnit = (typeof HEIGHT_UNITS)[number];

/** Organisation-wide settings administrators can change; sent to the portal and to phones. */
export const SettingsPatch = z.object({ height_unit: z.enum(HEIGHT_UNITS) }).partial().strict();
export type Settings = { height_unit: HeightUnit };

export async function readSettings(q: Queryable): Promise<Settings> {
  const { rows } = await q.query(`SELECT value FROM system_settings WHERE key = 'height_unit'`);
  const unit = rows[0]?.value;
  return { height_unit: (HEIGHT_UNITS as readonly string[]).includes(unit) ? unit : 'cm' };
}
