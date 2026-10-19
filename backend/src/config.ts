import * as fs from 'fs';
import * as path from 'path';

/** Loads .env (if present) without overriding variables already set by the platform. */
function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadDotEnv();

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
  databaseUrl: required('DATABASE_URL', 'postgres://tms:tms@localhost:5432/tms'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret'),
  accessTokenTtlSeconds: num('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTokenTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
  offlineSessionDays: num('OFFLINE_SESSION_DAYS', 7),
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? './var/media',
  localStorageSigningSecret: required('LOCAL_STORAGE_SIGNING_SECRET', 'dev-media-secret'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  s3: {
    bucket: process.env.S3_BUCKET ?? 'tms-media',
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  mediaMaxBytes: num('MEDIA_MAX_BYTES', 15 * 1024 * 1024),
  uploadUrlTtlSeconds: num('UPLOAD_URL_TTL_SECONDS', 600),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  syncBatchMaxOperations: num('SYNC_BATCH_MAX_OPERATIONS', 200),
  changesPageSize: num('CHANGES_PAGE_SIZE', 500),
};
