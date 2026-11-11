import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/** A point in the photo as fractions of its width (x, from the left) and height (y, from the top). */
export const Point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export type Point = z.infer<typeof Point>;
export const Points = z.object({ stick_bottom: Point, stick_top: Point, tree_base: Point, tree_top: Point });
export type Points = z.infer<typeof Points>;

/** What the model reports about one photo. */
export const PhotoReading = z.object({
  suitable: z.boolean(),
  unsuitable_reason: z.string(),
  points: Points,
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.string(),
});
export type PhotoReading = z.infer<typeof PhotoReading>;

export const MODEL = 'claude-opus-5-5';

const point = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false };
const SCHEMA = {
  type: 'object',
  properties: {
    suitable: { type: 'boolean' },
    unsuitable_reason: { type: 'string' },
    points: {
      type: 'object',
      properties: { stick_bottom: point, stick_top: point, tree_base: point, tree_top: point },
      required: ['stick_bottom', 'stick_top', 'tree_base', 'tree_top'],
      additionalProperties: false,
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
  },
  required: ['suitable', 'unsuitable_reason', 'points', 'confidence', 'notes'],
  additionalProperties: false,
};

const SYSTEM = `You help measure young trees in field photos for a reforestation tree registry. Each photo should show one young tree (a seedling or sapling) with a straight reference stick standing upright beside it. You are told how long the stick is.

Find four points in the photo:
- stick_bottom: where the stick meets the ground.
- stick_top: the top end of the stick.
- tree_base: where the tree's stem meets the ground.
- tree_top: the highest living part of the tree (top leaf or bud).
Give each point as fractions of the image: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge). Be as precise as you can; a person will check the points and the height is worked out from them.

Set suitable to false, with a short unsuitable_reason, instead of guessing, when: no reference stick is visible; the stick, the tree's base or the tree's top is hidden or cut off by the edge of the photo; the stick is clearly much nearer to or farther from the camera than the tree; the stick is strongly tilted; the photo is too blurred or dark to see the points; or it is unclear which tree is meant. When suitable is false, still give your best points, or 0 for any you cannot see. When suitable is true, unsuitable_reason is an empty string.

confidence is how sure you are of the four points. notes is one or two plain sentences for the reviewer about what you saw (for example "Stick slightly behind the tree; top leaf partly against the sky"). Do not comment on the tree's health or species.`;

/** Asks Claude for the stick and tree points in one photo. Throws on API errors; returns null when the model declines. */
export async function readPhoto(apiKey: string, photo: Buffer, mimeType: string, referenceLabel: string): Promise<PhotoReading | null> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: photo.toString('base64') } },
          { type: 'text', text: `The reference stick is ${referenceLabel} long. Find the four points.` },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = PhotoReading.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('The model returned an unexpected answer.');
  return parsed.data;
}
