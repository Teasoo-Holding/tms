# Operations

## Components

| Component | Production service | Configuration |
|---|---|---|
| API (`backend/`) | Managed container/app runtime, ≥2 instances behind HTTPS | Environment variables in `backend/.env.example`, secrets from the managed secrets service |
| Database | Managed PostgreSQL 16 with PostGIS 3, private networking, PITR | `DATABASE_URL` |
| Photos | Private S3-compatible bucket, versioning on, no public access | `STORAGE_DRIVER=s3`, `S3_*` |
| Web (`web/`) | Static hosting/CDN or the provided nginx image | `VITE_API_BASE`, `VITE_MAP_STYLE_URL` at build time |
| Android (`android/`) | Signed release build via MDM or Play | `-PtmsApiBaseUrl=https://…/ -PtmsMapStyleUrl=…` |

Production requirements enforced by the code: `NODE_ENV=production` makes `JWT_ACCESS_SECRET`,
`DATABASE_URL` and `LOCAL_STORAGE_SIGNING_SECRET` mandatory, and the demo seed refuses to run.
Use separate development, staging and production environments with separate buckets and databases.

## Releases

1. CI runs backend tests against PostGIS, the web build, and Android unit tests (`.github/workflows/ci.yml`).
2. Back up the database (or confirm PITR), then run migrations as a one-off release step:
   `node dist/database/migrate.js`. Migrations are forward-only SQL files in `backend/migrations/`,
   each applied in its own transaction.
3. Deploy the API, then the web build.
4. Android: bump `versionCode`; Room migrations must be added for any schema change (destructive
   migration is disabled on purpose so field data is never dropped).

## Monitoring (architecture §12)

`GET /api/v1/health` (unauthenticated): liveness and database connectivity — use for uptime checks.

`GET /api/v1/health/metrics` (authenticated): open conflicts, failed and stale photo verifications,
rejected sync operations and total operations in 24 h, active devices, app versions. Suggested alerts:

- rejected operations > 5% of operations over 24 h
- any photo `FAILED` verification older than 1 day, or stale `PENDING` uploads
- open conflicts older than 7 days
- devices not synced in 7 days (also shown on the dashboard)
- API 5xx rate and p95 latency, database CPU/storage, bucket size (from the platform)

Logs never include passwords or tokens; request bodies are not logged.

## Backup and restore

A database backup does **not** include photographs. Both must be backed up and restored together.

- Database: managed automated backups + point-in-time recovery; an independent daily logical
  backup (`pg_dump -Fc`) into a separate account/region with separate credentials.
- Photos: bucket versioning + lifecycle rules; replicate to a second bucket in another failure domain.
- Agree RPO/RTO with stakeholders before launch (open question 8).

### Restore rehearsal (do before production launch, then quarterly)

1. Restore the database to a scratch instance at a chosen time; run `migrate` (should be a no-op).
2. Point a scratch API at it and at the replicated bucket.
3. Check: `SELECT count(*) FROM tree_media WHERE upload_state = 'VERIFIED'` and, for a sample,
   `GET /media/{id}/view-url` returns the photo; checksums match `tree_media.checksum_sha256`.
4. Check a device can sync against the restored server. Devices whose cursor is ahead of the restored
   change log must re-bootstrap: clear their sync cursor (or reinstall after confirming no unsynced
   records). Records they hold that the restore lost are re-sent from their outbox only if still pending;
   compare device outbox counts before restoring a production incident.
5. Record timings against the RTO.

## Day-to-day administration

- Create users, assign them to projects/areas, and (optionally) allocate serial ranges before field
  teams go out.
- Review **Conflicts** regularly; every resolution is audited and reaches devices on their next sync.
- Revoke lost devices from **Users & devices**; the device cannot sync or refresh its session afterwards.
- Exports (CSV/Excel) are audited and include sub-sector reference coordinates, never tree coordinates.
