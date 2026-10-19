import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { config } from '../config';

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
  inspect(key: string): Promise<StoredObjectInfo>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

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
  private readonly client = S3Storage.client(config.s3.endpoint);
  /** Presigned URLs must name an endpoint devices can reach, which may differ from the internal one. */
  private readonly presigner = config.s3.publicEndpoint ? S3Storage.client(config.s3.publicEndpoint) : this.client;

  private static client(endpoint?: string) {
    return new S3Client({
      region: config.s3.region,
      endpoint,
      forcePathStyle: config.s3.forcePathStyle,
      // Only send checksums we set explicitly; SDK-added CRC headers would break presigned uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createUploadUrl(key: string, mimeType: string, byteSize: number, sha256: string) {
    const checksum = Buffer.from(sha256, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: config.s3.bucket,
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
    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }), { expiresIn: 300 });
  }

  async inspect(key: string): Promise<StoredObjectInfo> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return { exists: false };
      throw e;
    }
    const object = await this.client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return { exists: true, ...(await hashStream(object.Body as Readable)) };
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

  async inspect(key: string): Promise<StoredObjectInfo> {
    const file = this.filePath(key);
    if (!fs.existsSync(file)) return { exists: false };
    return { exists: true, ...(await hashStream(fs.createReadStream(file))) };
  }
}
