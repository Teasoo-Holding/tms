import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AppError } from '../common/errors';
import { parse } from '../common/validation';
import { config } from '../config';
import { Db } from '../database/db.service';
import { MediaService, UploadSessionBody } from './media.service';
import { LocalStorage, OBJECT_STORAGE, ObjectStorage } from './storage';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService, private readonly db: Db, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Post('upload-sessions')
  createSession(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.media.createUploadSession(user, parse(UploadSessionBody, body));
  }

  @Roles('ADMIN', 'FIELD_OFFICER')
  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.complete(user, id);
  }

  @Get(':id/view-url')
  view(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('size') size?: string) {
    return this.media.viewUrl(user, id, size === 'thumb' ? 'thumb' : 'full');
  }

  // ---- development-only local storage endpoints (signed URLs, mirrors S3 presigned PUT/GET)
  @Public()
  @Put('local/upload')
  async localUpload(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const store = this.local();
    if (!store.verify(q.key, 'put', Number(q.expires), q.signature)) throw new AppError(403, 'URL_INVALID', 'The upload link is invalid or has expired.');
    const file = store.filePath(q.key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.part`;
    const out = fs.createWriteStream(tmp);
    const hash = createHash('sha256');
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.mediaMaxBytes) req.destroy(new Error('too large'));
      hash.update(chunk);
    });
    req.pipe(out);
    out.on('finish', () => {
      fs.renameSync(tmp, file); // atomic replace: a partial upload never looks complete
      res.status(200).json({ byte_size: size, sha256: hash.digest('hex') });
    });
    req.on('error', () => {
      out.destroy();
      fs.rmSync(tmp, { force: true });
      if (!res.headersSent) res.status(413).json({ code: 'MEDIA_TOO_LARGE', message: 'The upload is too large.' });
    });
  }

  @Public()
  @Get('local/download')
  localDownload(@Query() q: Record<string, string>, @Res() res: Response) {
    const store = this.local();
    if (!store.verify(q.key, 'get', Number(q.expires), q.signature)) throw new AppError(403, 'URL_INVALID', 'The link is invalid or has expired.');
    const file = store.filePath(q.key);
    if (!fs.existsSync(file)) throw new AppError(404, 'NOT_FOUND', 'Photo not found.');
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(file).pipe(res);
  }

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    return this.storage;
  }
}
