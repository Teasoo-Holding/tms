# Tree Management System (TMS)

Offline-first, area-based reforestation registry: an Android app for field officers, a web portal for
administrators and executives, and a NestJS + PostGIS backend with a sync gateway.

| Directory | What it is | Stack |
|---|---|---|
| [`backend/`](backend) | API, sync gateway, reports (modular monolith) | NestJS, TypeScript, PostgreSQL 16 + PostGIS, S3-compatible storage |
| [`web/`](web) | Admin console and read-only executive dashboard | React, TypeScript, Vite, MapLibre GL |
| [`android/`](android) | TMS Field app | Kotlin, Jetpack Compose, Room, WorkManager, CameraX, MapLibre |
| [`spec/`](spec) | Tree-ID test vectors shared by backend and Android tests | JSON |
| [`docs/`](docs) | PRD, architecture, OpenAPI contract, decisions, operations | |
| [`app/`](app) (repo root Gradle project) | Earlier standalone Android prototype (`com.example.teasoo_tms`), kept as-is. Independent of `android/` | Kotlin, Room |

## Documents

- [Product requirements](docs/PRD.md) and [technical architecture](docs/architecture.md)
- [API contract (OpenAPI 3.1)](docs/openapi.yaml)
- [Implementation decisions and open questions](docs/decisions.md) — **read before go-live**: the eight
  stakeholder decisions are settings, not hard-coded choices.
- [Operations: deployment, monitoring, backup and restore](docs/operations.md)

## Run it locally

Requirements: Node 22, PostgreSQL 16 with PostGIS 3 (or Docker), JDK 17+ and the Android SDK for the app.

```bash
# Database: either docker compose up db, or a local PostGIS with a "tms" user/database
cd backend
cp .env.example .env            # set PUBLIC_BASE_URL=http://localhost:5173 to view photos in the dev portal
npm ci && npm run migrate && npm run seed
npm run dev                      # API on http://localhost:3000/api/v1

cd ../web
npm ci && npm run dev            # portal on http://localhost:5173 (proxies /api to :3000)
```

Seeded demo accounts (development only) share the password `ChangeMe!2026`:
`admin@tms.local` (administrator), `exec@tms.local` (executive), `officer@tms.local` (field officer, whole
project), `officer2@tms.local` (field officer, one sub-sector).

Full stack in containers (PostGIS, MinIO, API, web on http://localhost:8080):

```bash
docker compose up --build
docker compose exec api node dist/database/seed.js   # optional demo data
```

Android (emulator reaches the host API at `10.0.2.2`):

```bash
cd android
./gradlew :app:assembleDebug                                     # app/build/outputs/apk/debug/
./gradlew :app:assembleRelease -PtmsApiBaseUrl=https://api.example.org/ -PtmsMapStyleUrl=https://…
```

## Neon (cloud backend)

The repo is linked to Neon project `icy-recipe-66236245`, branch `production` (`.neon`, git-ignored). `neon.ts`
declares the services; `neon deploy` provisions them and writes their variables to the repo-root `.env.local`,
which the backend loads automatically (variables already in the process environment win).

| Service | Status | Used by |
|---|---|---|
| Postgres (PostGIS available) | Provisioned | Backend `pg` pool on the pooled `DATABASE_URL`; migrations and seed use `DATABASE_URL_UNPOOLED` |
| Object Storage, bucket `assets` | Provisioned, verified end to end | Photo upload/verification/download (`AWS_*` vars select the S3 driver, path-style) |
| Functions (`hello`) | Deployed, responds | Sample only |
| Neon Auth | Provisioned | Not used yet — the app keeps its own sign-in |
| AI Gateway | Disabled in `neon.ts` | Requires a paid Neon plan |

```bash
npm ci                       # repo root: @neon/config for neon.ts
neon deploy                  # provision neon.ts and refresh .env.local
cd backend && npm run migrate && npm run seed   # needs direct TCP access to Neon (port 5432)
```

If your shell already exports `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for another account, unset them when
running the backend locally, or the Neon credentials in `.env.local` are ignored.

## Tests

```bash
cd backend && TEST_DATABASE_URL=postgres://tms:tms@localhost:5432/tms_test npm test   # unit + integration (real PostGIS)
cd android && ./gradlew :app:testDebugUnitTest                                       # JVM + Robolectric
cd web && npm run build                                                              # type-check + build
```

The backend integration tests reset the `tms_test` database on each run.

## Acceptance criteria (PRD §8) → where they are implemented and tested

| # | Criterion | Implementation | Test |
|---|---|---|---|
| 1 | Register offline by entering only the serial | `RegisterScreen`, `TreeRepository.register` | `LocalStoreTest.registrationWrites…`, backend `registers a tree from the serial alone` |
| 2 | Shows assembled ID, saves it with the format version | `TreeIdAssembler` (Kotlin) / `domain/tree-id.ts`, `id_components_snapshot` | `TreeIdAssemblerTest`, `tree-id.spec.ts` (shared vectors) |
| 3 | Planting year chosen explicitly, part of the ID | Planting-year picker; `PLANTING_YEAR` component | backend scheme/version tests |
| 4 | Area coordinates and boundaries available offline | Bootstrap → Room; `AreaMapScreen` | `ApiContractTest` |
| 5 | No tree GPS required | No tree coordinate column or field anywhere | backend `does not require any tree-level GPS` |
| 6 | Repeat visits add observations | Append-only `tree_observations`, amendments supersede | `observations` tests (backend + Android) |
| 7 | Replacement has new ID and link | `replaces_tree_id`, single active replacement per tree | `replacement planting and lineage` |
| 8 | Original remains after replacement | Original never modified; lineage query | same |
| 9 | Cross-device duplicates detected without overwrite | Partial unique indexes + `CONFLICT` records | `duplicate physical IDs across disconnected devices` |
| 10 | Interrupted uploads resume without duplicates | Operation ledger + device-generated UUIDs | `replaying the same batch…`, `replayedOperationUsesItsOriginalOutcome` |
| 11 | Photos removed only after verified upload and association | Server SHA-256/size verification; `MediaDeletionPolicy` | `media verification`, `MediaDeletionPolicyTest`, `photosAreOffloadedOnly…` |
| 12 | Executives see read-only reports with last sync time | Dashboard; `last_server_sync_at` | `executives are read-only`, report totals test |
| 13 | No access to unassigned projects | `AccessService` on every query and write | `access control` tests |
| 14 | Backup and media restoration tested | Procedure in [operations.md](docs/operations.md) | **Manual rehearsal required before launch** |
