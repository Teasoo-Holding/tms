import { z, ZodTypeAny } from 'zod';
import { badRequest } from './errors';

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_FAILED',
      'Some fields are missing or invalid. Correct them and try again.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const uuid = z.string().uuid();
export const shortCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,16}$/, 'Use 1–16 letters or digits')
  .transform((s) => s.toUpperCase());
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const isoDateTime = z.string().datetime({ offset: true });
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

/** GeoJSON Polygon (WGS 84 lon/lat). Detailed validity is checked by PostGIS. */
export const geoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(z.array(z.tuple([longitude, latitude]).or(z.tuple([longitude, latitude, z.number()]))).min(4))
    .min(1),
});

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
