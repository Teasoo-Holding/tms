# Project Spec (19 Oct 2026) vs PRD: gap analysis

The *Tree Management App – Project Spec* (the "spec") is a simpler, earlier-style description of the
same system as `docs/PRD.md`. The system was built to the PRD. This page lists where the two differ,
what the current build does, and what still needs a decision.

Legend: ✅ in the build · 🟡 partly, or done differently · ❌ not built · ❓ needs a stakeholder decision

## 1. Where the two documents disagree (decisions needed)

| Topic | Spec | PRD (what was built) | Recommendation |
|---|---|---|---|
| Tree ID | Free text; a known ID simply adds a visit | Configurable structured ID (project/year/vendor/sector codes plus a typed serial), versioned, with serial ranges | ❓ Keep the PRD's structured ID; it prevents typos and duplicates offline. The app now treats a known ID as a visit (see 2.1). |
| Editing visits | Edit any field at any time; every change logged field by field (`visit_edits`) | Observations are append-only; a correction is a new, audited record that supersedes the old one | ❓ Keep corrections: same outcome (nothing is silently overwritten) and a clearer history. |
| Concurrent edits | Latest edit wins, both kept, flagged | No blind last-write-wins: the later edit is held for administrator review | ❓ Keep the PRD rule; it never loses either edit. |
| Photo per visit | Required on every visit | ✅ Now required on every visit (registration and observation); corrections may reuse the earlier photos | Aligned with the spec. |
| Statuses | Alive / Dead | ✅ Alive and Dead (migration 003); older statuses deactivated but kept on historic records | Aligned with the spec. |
| Stack | Supabase, Next.js, Recharts, Leaflet | NestJS + Postgres/PostGIS (Neon), React (Vite), MapLibre, Render/Vercel | Built to the architecture document; the spec's stack would be a rewrite. |
| Minimum Android | API 24 (Android 7.0) | API 26 (Android 8.0) | ❓ API 26 covers about 97% of active devices. Lower it only if field phones run Android 7. |
| Login identifier | Phone or email | ✅ Username, phone or email; administrators set usernames and email is optional | Aligned (and extended) with the spec. |

## 2. Spec requirements and their status

### 2.1 Android app
| Requirement | Status |
|---|---|
| Works offline after first login; reference lists downloaded | ✅ |
| Photo with in-app camera | ✅ |
| Sector → subsector cascading, last area pre-selected | ✅ Field session: project, planting year and sector chosen once; one-tap sub-sector switch |
| Entering an existing tree ID adds a visit and shows last species/status | ✅ The register screen offers "Record a visit to this tree" and shows its species, status and last-seen date |
| Own visits list, newest first, with sync badge | ✅ "My visits" (today, last 7 days, all) |
| Edit own visits; admins edit any | 🟡 Corrections (see 1). Admins can correct any observation. |
| Sync banner ("12 records, 9 photos waiting"), Sync now, last synced | ✅ |
| Photos ≤1600 px, ~300 KB JPEG, app-private | ✅ Added in this release (resized and orientation fixed on capture) |
| Logout blocked while anything is unsynced | ✅ Added in this release |
| Synced photos kept on the phone ≥30 days | ✅ Added in this release (released early only if storage runs low) |
| "Export backup" file of unsynced records and photos | ✅ Sync details → Export backup (one zip: queued operations, records, photos) |

### 2.2 Web dashboard
| Requirement | Status |
|---|---|
| Sectors/subsectors with GPS; species; statuses; deactivate, never delete | ✅ (also polygon boundaries and GeoJSON import) |
| Users: create, deactivate, role, reset password | ✅ |
| Each collector's last sync time and record count | ✅ Added in this release |
| Totals, alive vs dead (overall, per sector), by species | ✅ Charts added in this release |
| Visits per week and per month | ✅ Weekly activity added; monthly trend existing |
| Records per collector | ✅ |
| Map of areas with tree counts and alive/dead share | ✅ Web dashboard map and phone area map, coloured by dead share, with per-area counts |
| Filters: date range, sector, subsector, species, status | ✅ Web dashboard, visits table and exports; phone dashboard |
| Tree search with full history and photos | ✅ Photos, heights and growth chart added in this release |
| Browse/filter all visits in a table; CSV export | ✅ Web "Visits" page with the same filters and CSV export |
| Edit log per visit | ✅ Audit log, filterable by person, activity, project and date |

### 2.3 Data, sync and security
All of the spec's offline and sync rules (single-transaction save, background retries that survive
restarts, data before photos, idempotent uploads, confirmed-before-synced, incremental reference
downloads, roles enforced on the server, private photo bucket) are met by the PRD build.
`received_at` is stored as `synced_at`.

Operational items to confirm before launch:
- daily database backup (Neon point-in-time restore window on the chosen plan)
- a privacy notice under the Nigeria Data Protection Act 2023
- the field trial

## 3. Added beyond both documents (this release)
- **Custom fields:** administrators add project-specific fields (e.g. nursery batch number) to registrations or visits, typed, optionally required, optionally remembered for the field session.
- **Tree height:** typed in, or measured on the photo against a stick of known length. The marked points are kept for review, and growth is charted per tree and per species.
- **Android administration:** project setup and configuration, users, audit log and chart dashboard on the phone (online).

## 4. Spec open questions, answered by the build
- **ID format:** configurable (numbers plus prefix codes); a QR code is not supported yet.
- **Different sector than last visit:** the phone warns before saving a visit to a tree registered in another sector or sub-sector.
- **Photos per visit:** several are allowed.
- **Shared phones:** supported. A phone holding another user's unsent records refuses a different sign-in until those records are synced.
- **Distribution:** signed APK from GitHub Actions; an AAB for Google Play is built too.
