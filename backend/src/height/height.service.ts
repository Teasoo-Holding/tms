import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { AppError, badRequest, notFound } from '../common/errors';
import { config } from '../config';
import { Db } from '../database/db.service';
import { OBJECT_STORAGE, ObjectStorage } from '../media/storage';
import { MODEL, PhotoReading, Points, readPhoto } from './ai';

/** The reference stick placed beside trees in each planting year (#109). */
export const REFERENCE_STICKS: Record<string, { cm: number; label: string }> = {
  '2025': { cm: 91.44, label: '3 ft (91.44 cm)' },
  '2026': { cm: 100, label: '1 m (100 cm)' },
};

export type ReadPhoto = (photo: Buffer, mimeType: string, referenceLabel: string) => Promise<PhotoReading | null>;

const pixels = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

/** Height from the four points: the tree's length in the photo against the stick's. */
export function heightFrom(points: Points, w: number, h: number, stickCm: number) {
  const stick = pixels(points.stick_bottom, points.stick_top, w, h);
  const tree = pixels(points.tree_base, points.tree_top, w, h);
  return { stick, tree, cm: stick >= 20 ? Math.round(((stickCm * tree) / stick) * 10) / 10 : null };
}

/**
 * Tree height estimates from photos (#109). Claude finds the reference stick and the tree in a photo; TMS works out
 * the height from the year's stick length. An administrator checks or moves the points and confirms the height,
 * which is saved as an estimate, apart from field measurements.
 */
@Injectable()
export class HeightService {
  /** Replaced in tests. */
  read: ReadPhoto = (photo, mime, label) => readPhoto(config.anthropicApiKey!, photo, mime, label);

  constructor(private readonly db: Db, private readonly audit: AuditService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  get enabled() {
    return !!config.anthropicApiKey;
  }

  async list(treeId: string) {
    const { rows } = await this.db.query(
      `SELECT e.*, e.reference_length_cm::float8 AS reference_length_cm, e.suggested_height_cm::float8 AS suggested_height_cm,
              e.confirmed_height_cm::float8 AS confirmed_height_cm, e.stick_pixels::float8 AS stick_pixels, e.tree_pixels::float8 AS tree_pixels,
              u.full_name AS reviewed_by_name
         FROM tree_height_estimates e LEFT JOIN users u ON u.id = e.reviewed_by
        WHERE e.tree_id = $1 AND e.status <> 'DISCARDED' ORDER BY e.created_at DESC`,
      [treeId],
    );
    return rows;
  }

  private async one(id: string) {
    const rows = await this.db.query('SELECT tree_id FROM tree_height_estimates WHERE id = $1', [id]);
    if (!rows.rows[0]) throw notFound('Height estimate');
    return (await this.list(rows.rows[0].tree_id)).find((e) => e.id === id) ?? null;
  }

  /**
   * Starts an estimate on one of the tree's photos (by default its registration photo). "manual" (free, always
   * available, #118): the administrator marks the four points. "ai": Claude suggests them (needs ANTHROPIC_API_KEY).
   */
  async estimate(user: AuthUser, treeId: string, mediaId?: string, method: 'ai' | 'manual' = 'ai') {
    if (method === 'ai' && !this.enabled) throw new AppError(404, 'HEIGHT_ESTIMATES_OFF', 'AI height estimates are not turned on. Mark the points yourself instead.');
    const tree = await this.db.one(this.db, `SELECT t.id, t.project_id, py.year_label FROM trees t JOIN planting_years py ON py.id = t.planting_year_id WHERE t.id = $1`, [treeId]);
    if (!tree) throw notFound('Tree');
    const stick = REFERENCE_STICKS[tree.year_label];
    if (!stick) throw badRequest('NO_REFERENCE_STICK', `No reference stick is set for the ${tree.year_label} planting year.`);
    const media = await this.db.one(
      this.db,
      `SELECT m.id, m.object_key, m.mime_type FROM tree_media m LEFT JOIN tree_observations o ON o.id = m.observation_id
        WHERE m.tree_id = $1 AND m.upload_state = 'VERIFIED' AND m.object_key IS NOT NULL AND ($2::uuid IS NULL OR m.id = $2)
        ORDER BY COALESCE(o.is_initial, false) DESC, m.created_at DESC LIMIT 1`,
      [treeId, mediaId ?? null],
    );
    if (!media) throw badRequest('NO_PHOTO', 'This tree has no uploaded photo to measure.');
    const photo = await this.storage.getObject(media.object_key);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(photo).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (method === 'manual') {
      // Starting points for the reviewer to move: stick on the left, tree on the right.
      const start = { stick_bottom: { x: 0.3, y: 0.85 }, stick_top: { x: 0.3, y: 0.35 }, tree_base: { x: 0.6, y: 0.85 }, tree_top: { x: 0.6, y: 0.55 } };
      const row = await this.db.one(
        this.db,
        `INSERT INTO tree_height_estimates (tree_id, media_id, project_id, status, reference_length_cm, reference_label, image_width, image_height, points, requested_by)
         VALUES ($1, $2, $3, 'SUGGESTED', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [treeId, media.id, tree.project_id, stick.cm, stick.label, w, h, JSON.stringify(start), user.id],
      );
      await this.audit.record({ actorId: user.id, action: 'height_estimate.request', entityType: 'tree', entityId: treeId, projectId: tree.project_id, metadata: { estimate_id: row!.id, method } });
      return this.one(row!.id);
    }
    let reading: PhotoReading | null;
    try {
      reading = await this.read(photo, media.mime_type ?? 'image/jpeg', stick.label);
    } catch {
      throw new AppError(503, 'HEIGHT_ESTIMATE_FAILED', 'The photo could not be read just now. Try again in a minute.');
    }
    const measured = reading ? heightFrom(reading.points, w, h, stick.cm) : null;
    const unsuitable = !reading || !reading.suitable || !measured?.cm;
    const reason = !reading
      ? 'The photo could not be assessed.'
      : !reading.suitable
        ? reading.unsuitable_reason || 'The photo is not suitable for measuring.'
        : !measured?.cm
          ? 'The reference stick is too small in the photo to measure against.'
          : null;
    const row = await this.db.one(
      this.db,
      `INSERT INTO tree_height_estimates (tree_id, media_id, project_id, status, reference_length_cm, reference_label, image_width, image_height,
              suggested_points, points, stick_pixels, tree_pixels, suggested_height_cm, confidence, unsuitable_reason, ai_notes, model, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [treeId, media.id, tree.project_id, unsuitable ? 'UNSUITABLE' : 'SUGGESTED', stick.cm, stick.label, w, h,
        reading ? JSON.stringify(reading.points) : null, measured?.stick ?? null, measured?.tree ?? null, measured?.cm ?? null,
        reading?.confidence ?? null, reason, reading?.notes ?? null, MODEL, user.id],
    );
    await this.audit.record({ actorId: user.id, action: 'height_estimate.request', entityType: 'tree', entityId: treeId, projectId: tree.project_id, metadata: { estimate_id: row!.id } });
    return this.one(row!.id);
  }

  /**
   * Saves the estimate after review. [points]: the reviewer's corrected points (the height is worked out again);
   * [heightCm]: a height the reviewer typed instead. Field measurements are not touched.
   */
  async confirm(user: AuthUser, id: string, points?: Points, heightCm?: number) {
    const e = await this.db.one(this.db, 'SELECT * FROM tree_height_estimates WHERE id = $1', [id]);
    if (!e) throw notFound('Height estimate');
    if (e.status === 'CONFIRMED' || e.status === 'DISCARDED') throw badRequest('ESTIMATE_CLOSED', 'This estimate has already been reviewed.');
    const used = points ?? e.points;
    const measured = used ? heightFrom(used, e.image_width, e.image_height, Number(e.reference_length_cm)) : null;
    const cm = heightCm ?? measured?.cm;
    if (!cm || cm <= 0) throw badRequest('HEIGHT_REQUIRED', 'Mark the stick and the tree on the photo, or type the height.');
    const reviewer = await this.db.one(this.db, 'SELECT full_name FROM users WHERE id = $1', [user.id]);
    const who = reviewer?.full_name ?? 'an administrator';
    const note =
      heightCm != null && heightCm !== measured?.cm
        ? `Estimated from a photo against a ${e.reference_label} reference stick; height typed by ${who} after review.`
        : e.model
          ? `Estimated from a photo against a ${e.reference_label} reference stick; points suggested by AI${points ? ' and adjusted' : ''} and checked by ${who}.`
          : `Estimated from a photo against a ${e.reference_label} reference stick; points marked by ${who}.`;
    await this.db.query(
      `UPDATE tree_height_estimates SET status = 'CONFIRMED', points = $2, stick_pixels = $3, tree_pixels = $4, confirmed_height_cm = $5,
              method_note = $6, reviewed_by = $7, reviewed_at = now() WHERE id = $1`,
      [id, used ? JSON.stringify(used) : null, measured?.stick ?? null, measured?.tree ?? null, cm, note, user.id],
    );
    await this.audit.record({ actorId: user.id, action: 'height_estimate.confirm', entityType: 'tree', entityId: e.tree_id, projectId: e.project_id, metadata: { estimate_id: id, height_cm: cm } });
    return this.one(id);
  }

  async discard(user: AuthUser, id: string) {
    const e = await this.db.one(this.db, `UPDATE tree_height_estimates SET status = 'DISCARDED', reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status <> 'CONFIRMED' RETURNING tree_id, project_id`, [id, user.id]);
    if (!e) throw badRequest('ESTIMATE_CLOSED', 'Only estimates not yet saved can be discarded.');
    await this.audit.record({ actorId: user.id, action: 'height_estimate.discard', entityType: 'tree', entityId: e.tree_id, projectId: e.project_id, metadata: { estimate_id: id } });
    return { id, status: 'DISCARDED' };
  }
}
