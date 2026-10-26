import {
  Body, CallHandler, Controller, Delete, ExecutionContext, Get, HttpCode, Inject, Injectable, Logger, Param, ParseUUIDPipe, Patch,
  PayloadTooLargeException, Post, Query, Res, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { OBJECT_STORAGE, ObjectStorage } from '../media/storage';

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 20;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FULL_PX = 1600;
const THUMB_PX = 400;

/** The row shape sent to the web portal and the phones (bootstrap and change feed use the same columns). */
export const SPECIES_IMAGE_COLUMNS = 'id, species_id, sort_order, caption, width, height, byte_size, updated_at';

const UpdateBody = z.object({
  sort_order: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  caption: z.string().trim().max(500).nullish().transform((v) => (v ? v : v === undefined ? undefined : null)),
});

interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Multipart "file" fields, held in memory; a wrong type or an oversized file is a 400 like other input errors. */
@Injectable()
class ImageUploadInterceptor extends FilesInterceptor('file', MAX_FILES, {
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) =>
    TYPES.includes(file.mimetype) ? cb(null, true) : cb(badRequest('IMAGE_TYPE_UNSUPPORTED', 'Upload JPEG, PNG or WebP images.'), false),
}) {
  async intercept(ctx: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(ctx, next);
    } catch (e) {
      if (e instanceof PayloadTooLargeException) throw badRequest('IMAGE_TOO_LARGE', `Images must be ${MAX_BYTES / 1048576} MB or smaller.`);
      throw e;
    }
  }
}

/**
 * Reference photos of each species, so field officers can recognise and pick a species by picture.
 * Images are re-encoded on upload (orientation fixed, size capped) and served through the API, not
 * by redirect, so the phone's bearer token stays on the request.
 */
@Controller()
export class SpeciesImagesController {
  private readonly log = new Logger('SpeciesImages');

  constructor(private readonly db: Db, private readonly audit: AuditService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Roles('ADMIN')
  @Post('admin/species/:speciesId/images')
  @UseInterceptors(ImageUploadInterceptor)
  async upload(@CurrentUser() user: AuthUser, @Param('speciesId', ParseUUIDPipe) speciesId: string, @UploadedFiles() files: UploadedImage[] | undefined) {
    if (!files?.length) throw badRequest('IMAGE_REQUIRED', 'Choose at least one image to upload.');
    if (!(await this.db.one(this.db, 'SELECT id FROM tree_species WHERE id = $1', [speciesId]))) throw notFound('Species');

    const prepared: ({ id: string } & Awaited<ReturnType<SpeciesImagesController['prepare']>>)[] = [];
    for (const file of files) prepared.push({ id: randomUUID(), ...(await this.prepare(file)) });
    const keys = prepared.flatMap((p) => [`species/${speciesId}/${p.id}.jpg`, `species/${speciesId}/${p.id}.thumb.jpg`]);
    try {
      for (const p of prepared) {
        await this.storage.putObject(`species/${speciesId}/${p.id}.jpg`, p.full, 'image/jpeg');
        await this.storage.putObject(`species/${speciesId}/${p.id}.thumb.jpg`, p.thumb, 'image/jpeg');
      }
      return await this.db.tx(async (tx) => {
        const species = await this.db.one(tx, 'SELECT id FROM tree_species WHERE id = $1 FOR UPDATE', [speciesId]);
        if (!species) throw notFound('Species');
        const { rows } = await tx.query('SELECT COALESCE(max(sort_order) + 1, 0)::int AS next FROM species_images WHERE species_id = $1', [speciesId]);
        const images = [];
        for (const [i, p] of prepared.entries()) {
          const row = await this.db.one(
            tx,
            `INSERT INTO species_images (id, species_id, object_key, thumb_key, width, height, byte_size, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${SPECIES_IMAGE_COLUMNS}`,
            [p.id, speciesId, `species/${speciesId}/${p.id}.jpg`, `species/${speciesId}/${p.id}.thumb.jpg`, p.width, p.height, p.full.length, rows[0].next + i, user.id],
          );
          await this.audit.record(
            { actorId: user.id, action: 'species_image.create', entityType: 'species_image', entityId: p.id, after: row, metadata: { filename: p.filename } },
            tx,
          );
          images.push(row);
        }
        return { images };
      });
    } catch (e) {
      this.removeObjects(keys);
      throw e;
    }
  }

  @Roles('ADMIN')
  @Patch('admin/species-images/:id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(UpdateBody, body);
    const cols = (['sort_order', 'caption'] as const).filter((c) => b[c] !== undefined);
    if (cols.length === 0) throw badRequest('NOTHING_TO_UPDATE', 'Provide at least one field to update.');
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, `SELECT ${SPECIES_IMAGE_COLUMNS} FROM species_images WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound('Species image');
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const after = await this.db.one(tx, `UPDATE species_images SET ${sets}, updated_at = now() WHERE id = $1 RETURNING ${SPECIES_IMAGE_COLUMNS}`, [
        id, ...cols.map((c) => b[c]),
      ]);
      await this.audit.record({ actorId: user.id, action: 'species_image.update', entityType: 'species_image', entityId: id, before, after }, tx);
      return after;
    });
  }

  @Roles('ADMIN')
  @Delete('admin/species-images/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const keys = await this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM species_images WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Species image');
      await tx.query('DELETE FROM species_images WHERE id = $1', [id]);
      await this.audit.record({ actorId: user.id, action: 'species_image.delete', entityType: 'species_image', entityId: id, before }, tx);
      return [before.object_key, before.thumb_key];
    });
    // Stored files go after the deletion has committed (best effort).
    this.removeObjects(keys);
  }

  @Get('species/:speciesId/images')
  async list(@Param('speciesId', ParseUUIDPipe) speciesId: string) {
    if (!(await this.db.one(this.db, 'SELECT id FROM tree_species WHERE id = $1', [speciesId]))) throw notFound('Species');
    const { rows } = await this.db.query(
      `SELECT ${SPECIES_IMAGE_COLUMNS} FROM species_images WHERE species_id = $1 ORDER BY sort_order, created_at`,
      [speciesId],
    );
    return { images: rows };
  }

  // Phones download every photo (two sizes) when they first sync, well past the per-minute request limit.
  @SkipThrottle()
  @Get('species-images/:id/content')
  async content(@Param('id', ParseUUIDPipe) id: string, @Query('size') size: string | undefined, @Res() res: Response) {
    if (size !== undefined && size !== 'thumb' && size !== 'full') throw badRequest('SIZE_INVALID', 'Use size=thumb or size=full.');
    const image = await this.db.one(this.db, 'SELECT object_key, thumb_key FROM species_images WHERE id = $1', [id]);
    if (!image) throw notFound('Species image');
    let body: Buffer;
    try {
      body = await this.storage.getObject(size === 'thumb' ? image.thumb_key : image.object_key);
    } catch (e: any) {
      if (e?.code === 'ENOENT' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) throw notFound('Species image');
      throw e;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(body);
  }

  /** Upright (EXIF), at most 1600 px, JPEG; plus a 400 px thumbnail. Anything sharp cannot read is refused. */
  private async prepare(file: UploadedImage) {
    try {
      const { data: full, info } = await sharp(file.buffer)
        .rotate()
        .resize(FULL_PX, FULL_PX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(file.buffer).rotate().resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
      return { full, thumb, width: info.width, height: info.height, filename: file.originalname };
    } catch {
      throw badRequest('IMAGE_INVALID', `${file.originalname || 'The file'} is not a readable image.`);
    }
  }

  private removeObjects(keys: string[]) {
    void this.storage.deleteObjects(keys).catch((e) => this.log.warn(`Species image clean-up incomplete: ${e?.message ?? e}`));
  }
}
