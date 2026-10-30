import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads dotenv files without overriding variables already set by the platform. Earlier files win:
 * backend/.env, backend/.env.local, then the repo-root .env.local that `neon deploy` / `neon env pull` write.
 */
function loadDotEnv() {
  const files = ['.env', '.env.local', '../.env.local'].map((f) => path.resolve(process.cwd(), f));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
loadDotEnv();

// Neon Object Storage injects AWS-standard variables; their presence selects it as the photo store.
const neonStorageEndpoint = process.env.AWS_ENDPOINT_URL_S3;

function required(name: string, devDefault?: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production' || devDefault === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return devDefault;
}

function num(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

export const config = {
  port: num('PORT', 3000),
  /** Pooled connection for application traffic. */
  databaseUrl: required('DATABASE_URL', 'postgres://tms:tms@localhost:5432/tms'),
  /** Direct (unpooled) connection for migrations, which PgBouncer's transaction mode can break. */
  migrationDatabaseUrl: process.env.DATABASE_URL_UNPOOLED || required('DATABASE_URL', 'postgres://tms:tms@localhost:5432/tms'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret'),
  accessTokenTtlSeconds: num('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTokenTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 90),
  offlineSessionDays: num('OFFLINE_SESSION_DAYS', 30),
  storageDriver: (process.env.STORAGE_DRIVER ?? (neonStorageEndpoint ? 's3' : 'local')) as 'local' | 's3',
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? './var/media',
  localStorageSigningSecret: required('LOCAL_STORAGE_SIGNING_SECRET', 'dev-media-secret'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  s3: {
    // "tree-image" is the private bucket declared in neon.ts.
    bucket: process.env.S3_BUCKET ?? (neonStorageEndpoint ? 'tree-image' : 'tms-media'),
    region: process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || neonStorageEndpoint || undefined,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined,
    // Neon requires path-style addressing.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || !!neonStorageEndpoint,
  },
  mediaMaxBytes: num('MEDIA_MAX_BYTES', 15 * 1024 * 1024),
  uploadUrlTtlSeconds: num('UPLOAD_URL_TTL_SECONDS', 600),
  /**
   * Browser origins allowed to call the API. Entries may use a * wildcard (e.g. https://*.vercel.app).
   * The Teasoo portal (tms.teasooconsulting.com and other teasooconsulting.com sites) and Vercel
   * deployments are always allowed: the API uses bearer tokens, not cookies, so another site cannot
   * act for a signed-in user, and Vercel preview URLs change with every deploy.
   */
  corsOrigins: [
    ...(process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    'https://teasooconsulting.com',
    'https://*.teasooconsulting.com',
    'https://*.vercel.app',
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => (o.includes('*') ? new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$', 'i') : o.replace(/\/$/, ''))),
  syncBatchMaxOperations: num('SYNC_BATCH_MAX_OPERATIONS', 200),
  changesPageSize: num('CHANGES_PAGE_SIZE', 500),
};
