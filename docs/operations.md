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
4. Android: Room migrations must be added for any schema change (destructive migration is disabled on
   purpose so field data is never dropped). `versionCode` is set by the release workflow.

### What runs automatically on each merge to `master`

| What | When | Where it is set up |
|---|---|---|
| CI: backend lint, build and tests; web build; Android unit tests | every push to `master` and every pull request | `.github/workflows/ci.yml` |
| Database migrations on the Neon production branch | merges that change `backend/migrations/**`, `backend/src/database/**` or the workflow; also by hand from the Actions tab | `.github/workflows/migrate.yml` |
| API redeploy on Render after the migrations | at the end of the migrations workflow, only if the `RENDER_DEPLOY_HOOK_URL` secret is set | `.github/workflows/migrate.yml` |
| API deploy on Render | every merge, by Render itself (auto-deploy) | Render dashboard |
| Web portal deploy on Vercel (including the public download page at `/` and `/download`) | every merge, by Vercel itself | Vercel dashboard |
| Android release: unit tests, signed APK + AAB, GitHub Release `android-v1.0.<run number>` marked latest with `tms-field-<version>.apk` and `tms-field.apk` | merges that change `android/**` or the workflow; pushing a tag `android-vX.Y.Z` (version X.Y.Z); by hand from the Actions tab (version optional) | `.github/workflows/android-release.yml` |

The download page links to `https://github.com/Teasoo-Holding/tms/releases/latest/download/tms-field.apk`,
so it always offers the newest release without a web redeploy; it reads the version and date from the
public GitHub API and still shows the button if that call fails. `versionCode` is the workflow run
number plus 100, so every release installs over the previous one. If two releases run at once, the one with the
higher `versionCode` stays "latest".

### One-time settings (repository owner)

GitHub (Settings → Secrets and variables → Actions):

- Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`:
  the release keystore. Keep the same keystore forever, or phones cannot update the app.
- Variable `TMS_API_BASE_URL`: the backend address the app uses, with the trailing slash; optional
  `TMS_MAP_STYLE_URL`, `TMS_PORTAL_URL`.
- Secret `NEON_DATABASE_URL_UNPOOLED`: the direct (non `-pooler`) connection string of the production branch.
- Optional secret `RENDER_DEPLOY_HOOK_URL`: Render → API service → Settings → Deploy Hook.
- Settings → Actions → General → Workflow permissions: allow read and write (the release workflow
  publishes Releases with the built-in token; the workflow also asks for `contents: write`).
- Settings → Environments → `production`: optionally add required reviewers to gate migrations.
- The repository must stay public for the download link and release lookup to work without sign-in
  (or host the APK elsewhere and change `APK_URL` in `web/src/pages/Landing.tsx`).

Render (API service → Settings): keep **Auto-Deploy** on (or "After CI checks pass") with branch `master`.
Migrations only add to the schema, so the API code may start a moment before them; the deploy hook then
restarts it on the migrated database.

Vercel (project → Settings → Git): production branch `master`; root directory `web`. `web/vercel.json`
proxies `/api` to the API and serves every other path (including `/download`) from the single-page app.

## Sessions

Field phones often lose the network mid-request. Refresh tokens rotate, but a phone that presents its
previous token again (because the response carrying the new one was lost) gets a fresh pair, as long as the
token issued in its place was never used; the lost pair stops working. Presenting an old token after its
replacement was used is treated as theft and ends the whole session (the phone must sign in again).

| Variable | Default | Meaning |
|---|---|---|
| `ACCESS_TOKEN_TTL_SECONDS` | 900 | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | 90 | How long a phone may go without refreshing its session |
| `OFFLINE_SESSION_DAYS` | 30 | How long a phone may keep working without contacting the server |

Deactivating a user, revoking a device or signing out still ends sessions at the next online contact.

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
- **Settings → Defaults → Default height unit** (cm, m, in or ft) sets how phones show tree heights; they
  pick it up on their next sync. Heights are always stored in centimetres.
- New planting year: on the project's **Areas** tab, *Quick setup* creates numbered sectors (S1, S2, …)
  with sub-sectors (SS1, SS2, …) in one step; rename them or add GPS later. Running it again with a
  larger number adds the missing ones.
- Exports (CSV/Excel) are audited and include sub-sector reference coordinates, never tree coordinates.

## Web portal on Vercel

- Every address of the portal (`/download`, `/login`, `/trees/…`) must be served by the single-page app, and `/api/*` is
  forwarded to the backend on Render. Both rules live in `vercel.json` (repository root) and `web/vercel.json`
  (used when the Vercel project's *Root Directory* is `web`). If `/download` shows Vercel's own "404: NOT_FOUND",
  the deployed version predates these files or the project does not read them: redeploy from `master`.
- Automatic deploys: either Vercel's Git integration (Settings → Git → Production Branch `master`), or the
  *Web deploy* workflow (`.github/workflows/web-deploy.yml`) with the `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
  `VERCEL_PROJECT_ID` secrets. One is enough.
