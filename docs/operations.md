# Operations

## Components

| Component | Production service | Configuration |
|---|---|---|
| API (`backend/`) | Managed container/app runtime, ≥2 instances behind HTTPS | Environment variables in `backend/.env.example`, secrets from the managed secrets service |
| Database | Managed PostgreSQL 16 with PostGIS 3, private networking, PITR | `DATABASE_URL` |
| Photos | Private S3-compatible bucket (Cloudflare R2), no public access | `STORAGE_DRIVER=s3`, `S3_*`; `LEGACY_S3_*` only while moving stores |
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

## Photo storage on Cloudflare R2

Photos (tree photos, their thumbnails and species reference images) live in one private S3-compatible bucket. The
API hands out short-lived signed URLs: phones upload straight to the bucket with a signed PUT, and the portal and
phones show photos through signed GETs. Nothing in the bucket is public.

| Variable | Value for R2 |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | the bucket name, e.g. `tms-photos` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the R2 API token's keys (secrets) |
| `S3_FORCE_PATH_STYLE` | optional; `true` or `false` (R2 accepts both) |

`LEGACY_S3_BUCKET` (with `LEGACY_S3_ENDPOINT`, `LEGACY_S3_REGION`, `LEGACY_S3_ACCESS_KEY_ID`,
`LEGACY_S3_SECRET_ACCESS_KEY`, `LEGACY_S3_FORCE_PATH_STYLE`) names the store photos were in before. While it is set,
any photo not found in the new bucket is read and signed from the old one, so existing photos keep working until they
are copied. Unset `LEGACY_S3_*` values fall back to Neon's own variables (`AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) with path-style addressing, so for the Neon bucket `LEGACY_S3_BUCKET=tree-image`
is usually enough. New uploads and thumbnails always go to the new bucket.

### Moving from Neon Object Storage to R2 (one time)

1. **Create the bucket.** Cloudflare dashboard → R2 Object Storage → Create bucket. Name it (e.g. `tms-photos`),
   location Automatic, default storage class. Leave public access off: no custom domain and no `r2.dev` URL. No CORS
   rule is needed (phones upload outside a browser; the portal shows photos with plain `<img>` tags).
2. **Note the endpoint.** On the R2 overview page, copy the Account ID. The endpoint is
   `https://<account_id>.r2.cloudflarestorage.com` (without the bucket name).
3. **Create an API token.** R2 → Manage R2 API tokens (API → Manage API tokens) → Create API token (an Account API
   token): permission **Object Read & Write**, applied to **this bucket only**, no expiry (or your rotation period).
   Copy the **Access Key ID** and **Secret Access Key**; the secret is shown once. Keep them in the password manager,
   never in the repository.
4. **Set the variables on Render** (API service → Environment): `STORAGE_DRIVER=s3`,
   `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET=<bucket>`,
   `S3_ACCESS_KEY_ID=<access key id>`, `S3_SECRET_ACCESS_KEY=<secret>`, and `LEGACY_S3_BUCKET=tree-image`. Keep the
   Neon variables (`AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) for now: the old
   bucket is read with them. If they are not on the service, also set `LEGACY_S3_ENDPOINT`, `LEGACY_S3_REGION`,
   `LEGACY_S3_ACCESS_KEY_ID` and `LEGACY_S3_SECRET_ACCESS_KEY` from the Neon console. Remove `S3_PUBLIC_ENDPOINT` if set.
5. **Deploy** (saving the variables redeploys). Check: a photo taken on a phone syncs and shows in the portal (it is now
   in R2), and older photos still show (read from Neon).
6. **Copy the existing photos.** From a Render shell on the API service (or from `backend/` on a computer with the same
   variables and `DATABASE_URL_UNPOOLED`):
   - `node dist/media/copy-objects.js --dry-run` (locally: `npm run storage:copy -- --dry-run`) counts what will be
     copied without writing anything;
   - `node dist/media/copy-objects.js` (locally: `npm run storage:copy`) copies every object the database refers to:
     each tree photo and its thumbnail, and each species image. It prints progress every 50 objects and a summary.
   It is idempotent: objects already in R2 are skipped, so run it again after an interruption. "Missing" objects are
   photos that never finished uploading (also missing before the move); "failed" ones are listed and make the command
   exit with an error: run it again.
7. **Run the copy once more** at least 10 minutes after the deploy (upload links issued before it may still have
   written to Neon), until it reports `0 copied`. Spot-check a few older trees' photos in the portal.
8. **Remove the fallback.** Delete `LEGACY_S3_*` from Render (and the Neon `AWS_*` variables once nothing else uses
   them) and let it redeploy. Keep the Neon bucket for a few weeks as a backup, then delete it.

R2 has no object versioning: for the backup policy below, copy the bucket regularly to a second bucket or provider
(for example with `rclone sync`), with credentials separate from the API's.

## Sign in with Google

Off until the API has `GOOGLE_CLIENT_ID`. To turn it on (repository owner, one time):

1. In Google Cloud Console, open **APIs & Services → OAuth consent screen**. Set it up as **External**, with the app name "Tree Management System" and a support email. Publish it.
2. Open **Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
3. Under **Authorised JavaScript origins**, add `https://tms.teasooconsulting.com`, plus any other address the portal is opened at (for example the Vercel URL). No redirect URI is needed.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is a public value; the client secret is not used.
5. In Render, add `GOOGLE_CLIENT_ID` to the API's environment and redeploy. The "Sign in with Google" button then appears on the sign-in page.

**Android app.** The phone uses the same web client ID (from the server) and Android's Credential Manager. Google also needs an **Android** OAuth client in the same Google Cloud project, otherwise the phone shows "Google sign-in did not work":

- Credentials → Create credentials → OAuth client ID → **Android**
- Package name: `com.teasoo.tms.field`
- SHA-1 certificate fingerprint: `7F:15:15:C5:4E:FA:7B:3B:27:2E:56:DE:2E:46:4D:E6:14:74:F3:D3` (the release keystore; each Android release run prints it under "Verify signature")

Google sign-in needs internet. Offline, people sign in with their password, which the device remembers as a salted hash after a password sign-in.

Who can sign in: only existing, active accounts. The first Google sign-in must use the same email as the TMS account (Google must have verified it), and links that Google account to the user. Later sign-ins match the linked Google account. Google sign-in never creates accounts or changes roles. Changing a user's email unlinks Google.

## Species check (Pl@ntNet)

Off until the API has `PLANTNET_API_KEY`. To turn it on (repository owner, one time):

1. Create a free account at https://my.plantnet.org and open **Settings → API key**.
2. In Render, add `PLANTNET_API_KEY` to the API's environment (it is a secret: never put it in the repository or a chat) and redeploy.
3. Optional: `SPECIES_CHECK_DAILY_LIMIT` (default 450). The free plan allows 500 identifications a day; 450 leaves room for testing in the Pl@ntNet website.

What it does: every 15 minutes the server picks, at random, registration photos synced in the last 14 days that have not been checked, and sends them to Pl@ntNet. Checks are spread evenly through the day up to the daily limit. Each photo is checked once. Results are on the web under **Species check**:

- **Agrees**: the officer's species is Pl@ntNet's top suggestion, or scores 30% or more.
- **Disagrees**: Pl@ntNet is at least 40% sure it is a species of another genus, and gives the officer's species under 5%. These wait for an administrator, who keeps the officer's species or corrects it (a correction is a normal tree edit, so phones receive it).
- **Unsure**: anything else, including suggestions of the same genus and photos with no plant found.

On the Trees list, the **Species match** column shows the officer's species' score as a percentage: green at 60% or more, amber 25–59%, red under 25% (`SPECIES_MATCH_GREEN` and `SPECIES_MATCH_AMBER` in `backend/src/trees/trees.controller.ts`). Trees an administrator confirmed or corrected are green. The review list above is separate: it holds only the confident disagreements.

The match uses each species' **scientific name** (genus and species, e.g. *Triplochiton scleroxylon* for Obeche). A species whose scientific name is misspelt or outdated in Lists will always score 0%.

Nothing changes without an administrator. The thresholds are in `backend/src/species/plantnet.ts`. On Render's free plan the server sleeps when idle, so checks only run while it is awake.

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
  larger number adds the missing ones. A sector added on its own (portal or phone) comes with four sub-sectors
  SS1–SS4 unless the form asks for another number (0 for none).
- **Maintenance**: each project's *Maintenance every (days)* setting (project → Edit, 7–730, default 90) sets when
  trees are due: that many days after their last maintenance visit (visit type *Maintenance*), else after planting.
  The dashboard counts trees overdue and due within 14 days; the Trees list filters and sorts by it; phones get the
  interval on their next sync.
- Exports (CSV/Excel) are audited and include sub-sector reference coordinates, never tree coordinates.

## Web portal on Vercel

- Every address of the portal (`/download`, `/login`, `/trees/…`) must be served by the single-page app, and `/api/*` is
  forwarded to the backend on Render. Both rules live in `vercel.json` (repository root) and `web/vercel.json`
  (used when the Vercel project's *Root Directory* is `web`). If `/download` shows Vercel's own "404: NOT_FOUND",
  the deployed version predates these files or the project does not read them: redeploy from `master`.
- Automatic deploys: either Vercel's Git integration (Settings → Git → Production Branch `master`), or the
  *Web deploy* workflow (`.github/workflows/web-deploy.yml`) with the `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
  `VERCEL_PROJECT_ID` secrets. One is enough.
