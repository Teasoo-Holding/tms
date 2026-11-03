import { DeleteObjectsCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { config, S3Settings } from '../config';

export interface StoredObjectInfo {
  exists: boolean;
  byteSize?: number;
  sha256?: string;
}

/**
 * Private object storage. Objects are reachable only through short-lived signed URLs.
 * Checksums are computed server-side from the stored bytes, not trusted from the client.
 */
export interface ObjectStorage {
  createUploadUrl(key: string, mimeType: string, byteSize: number, sha256: string): Promise<{ url: string; headers: Record<string, string> }>;
  createDownloadUrl(key: string): Promise<string>;
  /** Whether the object exists (a metadata request; the bytes are not read). */
  exists(key: string): Promise<boolean>;
  inspect(key: string): Promise<StoredObjectInfo>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Best effort; missing objects are ignored. */
  deleteObjects(keys: string[]): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** A missing object, as each driver reports it (S3 404 / NoSuchKey, a missing local file). */
export function isNotFound(e: any): boolean {
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey' || e?.code === 'ENOENT';
}

async function hashStream(stream: Readable): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    byteSize += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), byteSize };
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  /** Presigned URLs must name an endpoint devices can reach, which may differ from the internal one. */
  private readonly presigner: S3Client;

  constructor(private readonly settings: S3Settings = config.s3) {
    this.client = this.makeClient(settings.endpoint);
    this.presigner = settings.publicEndpoint ? this.makeClient(settings.publicEndpoint) : this.client;
  }

  private makeClient(endpoint?: string) {
    const { region, forcePathStyle, accessKeyId, secretAccessKey } = this.settings;
    return new S3Client({
      region,
      endpoint,
      forcePathStyle,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      // Only send checksums we set explicitly; SDK-added CRC headers would break presigned uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createUploadUrl(key: string, mimeType: string, byteSize: number, sha256: string) {
    const checksum = Buffer.from(sha256, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: byteSize,
      // The store itself rejects bytes that do not match the declared checksum.
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.presigner, command, { expiresIn: config.uploadUrlTtlSeconds });
    return { url, headers: { 'Content-Type': mimeType, 'x-amz-checksum-sha256': checksum } };
  }

  createDownloadUrl(key: string) {
    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }), { expiresIn: 300 });
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async inspect(key: string): Promise<StoredObjectInfo> {
    if (!(await this.exists(key))) return { exists: false };
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    return { exists: true, ...(await hashStream(object.Body as Readable)) };
  }

  async getObject(key: string) {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    return Buffer.from(await (object.Body as any).transformToByteArray());
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    // Thumbnails never change: let browsers and phones cache them.
    await this.client.send(
      new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=31536000, immutable' }),
    );
  }

  async deleteObjects(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.settings.bucket, Delete: { Objects: batch, Quiet: true } }));
    }
  }
}

/** Development driver: files on local disk, signed with an HMAC token. Not for production. */
export class LocalStorage implements ObjectStorage {
  constructor(private readonly root = path.resolve(config.localStorageDir)) {
    fs.mkdirSync(this.root, { recursive: true });
  }

  sign(key: string, action: 'put' | 'get', expires: number) {
    return createHmac('sha256', config.localStorageSigningSecret).update(`${action}:${key}:${expires}`).digest('hex');
  }

  verify(key: string, action: 'put' | 'get', expires: number, signature: string) {
    if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(key, action, expires), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private url(key: string, action: 'put' | 'get', ttl: number) {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const q = new URLSearchParams({ key, expires: String(expires), signature: this.sign(key, action, expires) });
    return `${config.publicBaseUrl}/api/v1/media/local/${action === 'put' ? 'upload' : 'download'}?${q}`;
  }

  filePath(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep)) throw new Error('Invalid key');
    return resolved;
  }

  async createUploadUrl(key: string, mimeType: string) {
    return { url: this.url(key, 'put', config.uploadUrlTtlSeconds), headers: { 'Content-Type': mimeType } };
  }

  async createDownloadUrl(key: string) {
    return this.url(key, 'get', 300);
  }

  async exists(key: string) {
    return fs.existsSync(this.filePath(key));
  }

  async inspect(key: string): Promise<StoredObjectInfo> {
    const file = this.filePath(key);
    if (!fs.existsSync(file)) return { exists: false };
    return { exists: true, ...(await hashStream(fs.createReadStream(file))) };
  }

  async getObject(key: string) {
    return fs.promises.readFile(this.filePath(key));
  }

  async putObject(key: string, body: Buffer) {
    const file = this.filePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, body);
  }

  async deleteObjects(keys: string[]) {
    for (const key of keys) await fs.promises.rm(this.filePath(key), { force: true });
  }
}

/**
 * While photos move from one store to another: writes and upload URLs go to the new (primary) store; an object not
 * found there is read, inspected or signed from the earlier (legacy) store, so photos keep working before they are
 * copied (see copy-objects.ts). Deletes reach both.
 */
export class FallbackStorage implements ObjectStorage {
  constructor(readonly primary: ObjectStorage, readonly legacy: ObjectStorage) {}

  createUploadUrl(key: string, mimeType: string, byteSize: number, sha256: string) {
    return this.primary.createUploadUrl(key, mimeType, byteSize, sha256);
  }

  async createDownloadUrl(key: string) {
    if (!(await this.primary.exists(key)) && (await this.legacy.exists(key))) return this.legacy.createDownloadUrl(key);
    return this.primary.createDownloadUrl(key);
  }

  async exists(key: string) {
    return (await this.primary.exists(key)) || this.legacy.exists(key);
  }

  async inspect(key: string) {
    const info = await this.primary.inspect(key);
    // A photo uploaded to the earlier store just before the move can still be verified.
    return info.exists ? info : this.legacy.inspect(key);
  }

  async getObject(key: string) {
    try {
      return await this.primary.getObject(key);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      return this.legacy.getObject(key);
    }
  }

  putObject(key: string, body: Buffer, contentType: string) {
    return this.primary.putObject(key, body, contentType);
  }

  async deleteObjects(keys: string[]) {
    const [primary] = await Promise.allSettled([this.primary.deleteObjects(keys), this.legacy.deleteObjects(keys)]);
    if (primary.status === 'rejected') throw primary.reason;
  }
}

/** The configured store: STORAGE_DRIVER, plus the legacy store as a read fallback when LEGACY_S3_BUCKET is set. */
export function createObjectStorage(): ObjectStorage {
  const primary = config.storageDriver === 's3' ? new S3Storage() : new LocalStorage();
  return config.legacyS3 ? new FallbackStorage(primary, new S3Storage(config.legacyS3)) : primary;
}
