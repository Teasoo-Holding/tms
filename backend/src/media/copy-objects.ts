import { Client } from 'pg';
import { config } from '../config';
import { Queryable } from '../database/db.service';
import { isNotFound, LocalStorage, ObjectStorage, S3Storage } from './storage';

/**
 * Copies every stored photo from the earlier store (LEGACY_S3_*) to the current one (S3_* / STORAGE_DRIVER): tree
 * photos and their thumbnails, and species reference images. Idempotent: objects already in the current store are
 * skipped, so it can be run again after an interruption, or once more just before LEGACY_S3_* is removed.
 *
 *   npm run storage:copy -- --dry-run      (development, from backend/)
 *   node dist/media/copy-objects.js        (production: a one-off job or shell on the API service)
 *
 * --dry-run lists what would be copied without writing anything.
 */

export interface StoredObject {
  key: string;
  contentType: string;
}

export interface CopyResult {
  total: number;
  /** Copied now (or, in a dry run, that would be copied). */
  copied: number;
  /** Already in the current store. */
  skipped: number;
  /** In neither store: the database names an object that was never uploaded (e.g. a photo still pending). */
  missing: string[];
  failed: { key: string; error: string }[];
}

/** Every object key the database refers to. */
export async function referencedObjects(db: Queryable): Promise<StoredObject[]> {
  const { rows } = await db.query<{ key: string; content_type: string }>(
    `SELECT object_key AS key, mime_type AS content_type FROM tree_media WHERE object_key IS NOT NULL
     UNION SELECT thumb_key, 'image/jpeg' FROM tree_media WHERE thumb_key IS NOT NULL
     UNION SELECT object_key, 'image/jpeg' FROM species_images
     UNION SELECT thumb_key, 'image/jpeg' FROM species_images
     ORDER BY 1`,
  );
  return rows.map((r) => ({ key: r.key, contentType: r.content_type }));
}

export async function copyObjects(
  objects: StoredObject[],
  from: ObjectStorage,
  to: ObjectStorage,
  { dryRun = false, concurrency = 4, log = (_: string) => undefined }: { dryRun?: boolean; concurrency?: number; log?: (line: string) => void } = {},
): Promise<CopyResult> {
  const result: CopyResult = { total: objects.length, copied: 0, skipped: 0, missing: [], failed: [] };
  let done = 0;
  const copyOne = async ({ key, contentType }: StoredObject) => {
    try {
      if (await to.exists(key)) {
        result.skipped++;
      } else if (dryRun) {
        if (await from.exists(key)) result.copied++;
        else result.missing.push(key);
      } else {
        let body: Buffer | null = null;
        try {
          body = await from.getObject(key);
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
        if (body) {
          await to.putObject(key, body, contentType);
          result.copied++;
        } else {
          result.missing.push(key);
        }
      }
    } catch (e: any) {
      result.failed.push({ key, error: e?.message ?? String(e) });
    }
    done++;
    if (done % 50 === 0 || done === objects.length) {
      log(`${done} of ${objects.length}: ${result.copied} ${dryRun ? 'to copy' : 'copied'}, ${result.skipped} already there, ${result.missing.length} missing, ${result.failed.length} failed`);
    }
  };
  const queue = [...objects];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await copyOne(next);
    }),
  );
  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!config.legacyS3) throw new Error('Set LEGACY_S3_BUCKET (and the other LEGACY_S3_* settings) to the store to copy from.');
  const from = new S3Storage(config.legacyS3);
  const to = config.storageDriver === 's3' ? new S3Storage() : new LocalStorage();
  console.log(`${dryRun ? 'Dry run: ' : ''}copying from bucket ${config.legacyS3.bucket} (${config.legacyS3.endpoint ?? 'AWS'}) to ` +
    (config.storageDriver === 's3' ? `bucket ${config.s3.bucket} (${config.s3.endpoint ?? 'AWS'})` : `local folder ${config.localStorageDir}`));
  const db = new Client({ connectionString: config.migrationDatabaseUrl });
  await db.connect();
  let objects: StoredObject[];
  try {
    objects = await referencedObjects(db);
  } finally {
    await db.end();
  }
  const r = await copyObjects(objects, from, to, { dryRun, log: console.log });
  console.log(`Done: ${r.total} objects, ${r.copied} ${dryRun ? 'to copy' : 'copied'}, ${r.skipped} already there, ${r.missing.length} missing, ${r.failed.length} failed.`);
  for (const key of r.missing.slice(0, 20)) console.log(`  missing: ${key}`);
  for (const f of r.failed.slice(0, 20)) console.log(`  failed: ${f.key}: ${f.error}`);
  if (r.failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
