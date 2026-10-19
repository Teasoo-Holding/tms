# Tree Management App – Project Spec

Oct 19, 2026 · @Efe

## Overview

The system records every tree visit in the forest, offline, with zero data loss, and shows executives live statistics once data syncs.

It has three parts:

- **Android app** for data collectors and admins. Works fully offline. Records are saved on the phone and upload automatically when the phone reaches internet.
- **Backend** in the cloud. Stores all records, photos, reference lists and user accounts, and enforces who can do what.
- **Web dashboard** for admins (manage reference data and users) and executives (view statistics).

Each tree has a unique, permanent tree ID. Every time a tree is visited, a new visit record is added, so the full history of each tree is kept.

## Users and roles

There are three roles; each user has exactly one, set by an admin.

| Permission | Data collector | Admin | Executive |
| --- | --- | --- | --- |
| Record tree visits (Android app) | Yes | Yes | No |
| Edit own visits, before or after sync | Yes | Yes | No |
| Edit any user's visits | No | Yes | No |
| Manage sectors, subsectors, species, statuses | No | Yes | No |
| Set GPS coordinates for sectors and subsectors | No | Yes | No |
| Manage users (create, deactivate, assign role, reset password) | No | Yes | No |
| View dashboard statistics | No | Yes | Yes |
| View tree records and photos on dashboard | No | Yes | Yes (read-only) |

Users are never hard-deleted. Deactivating a user blocks login but keeps every record they created.

## Android app

The app must do everything below with no internet connection, except the first login and syncing.

### Login

- First login on a phone requires internet. After that, the user stays logged in and can open the app offline.
- On login, the app downloads the reference lists: sectors, subsectors, species and statuses.
- Logout is blocked while any record is unsynced, with a clear message explaining why.

### Record a tree visit

1. Take a photo with the in-app camera (required).
2. Select sector from a dropdown.
3. Select subsector; the list shows only subsectors in the chosen sector.
4. Enter tree ID (required).
5. Select species from a dropdown.
6. Select status (Alive or Dead, from the admin-managed list).
7. Enter a note (optional, free text).
8. Tap Save. The record is stored on the phone immediately and a confirmation is shown.

The last sector and subsector used are pre-selected for the next record, since collectors usually record many trees in one area.

### Tree ID and history

- Tree IDs are unique per tree. Entering a tree ID that already exists adds a new visit to that tree; it is never treated as an error.
- When a known tree ID is entered, the app shows its last recorded species and status (from data on the phone) so the collector can confirm it is the right tree.
- The app shows a list of the collector's own visits, newest first, with a sync badge on each.

### Edit a visit

- Collectors can edit their own visits at any time, including after sync. Admins can edit any visit.
- An edit changes the visit and is saved locally, then synced like a new record.
- Every edit is logged (who, when, old and new values), so nothing is silently overwritten.

### Sync status

- A banner shows the count of records and photos waiting to upload, for example "12 records, 9 photos waiting."
- Sync starts automatically when internet is available. A "Sync now" button is also provided.
- A "Last synced" time is always visible.

### Photos

- Photos are resized to a maximum of 1600 px on the long edge and compressed to about 300 KB (JPEG).
- Photos are stored in the app's private storage, not the phone gallery.

## Web dashboard

The dashboard is a website for admins and executives; what each sees depends on their role.

### Admin: reference data

- Create, edit and deactivate sectors and subsectors. Each has a name, code and GPS coordinates (latitude, longitude).
- Create, edit and deactivate species (common name, optional scientific name) and statuses (starting with Alive and Dead).
- Items in use are deactivated, never deleted, so old records keep their meaning. Deactivated items disappear from app dropdowns after the next sync.

### Admin: user management

- Create users with name, phone or email, and role.
- Deactivate and reactivate users, change roles, reset passwords.
- See each collector's last sync time and number of records.

### Executive: statistics

- Total trees recorded and total visits.
- Alive vs dead, overall and per sector and subsector, based on each tree's latest visit.
- Trees by species.
- Visits recorded over time (per week and per month).
- Records per data collector.
- A map of sectors and subsectors, using the admin-entered GPS coordinates, showing tree counts and alive/dead share.
- Filters: date range, sector, subsector, species, status.

### Tree records

- Search by tree ID to see a tree's full visit history with photos, newest first.
- Browse and filter all visits in a table; export to CSV.
- View an edit log for any visit.

## Data model

The same structure exists on the phone (Room) and on the server (Postgres); every record has an `id` UUID generated where it is created.

| Table | Key fields | Notes |
| --- | --- | --- |
| users | id, name, phone\_or\_email, role (collector, admin, executive), active, created\_at | Managed by admins |
| sectors | id, name, code, latitude, longitude, active, updated\_at | GPS entered by admin |
| subsectors | id, sector\_id, name, code, latitude, longitude, active, updated\_at | Belongs to one sector |
| species | id, common\_name, scientific\_name, active, updated\_at |  |
| statuses | id, name, active, updated\_at | Seeded with Alive, Dead |
| trees | tree\_id (unique), first\_recorded\_at, first\_recorded\_by | One row per physical tree |
| visits | id, tree\_id, sector\_id, subsector\_id, species\_id, status\_id, note, photo\_path, recorded\_by, recorded\_at, updated\_at, version, device\_id | One row per visit; full history kept |
| visit\_edits | id, visit\_id, edited\_by, edited\_at, field, old\_value, new\_value | Audit log of every change |

Phone-only fields on `visits`: `sync_state` (pending, synced, failed) and `photo_sync_state`. These never go to the server.

A tree's current status, species and location are taken from its most recent visit. `recorded_at` is the phone's time when Save was tapped; the server also stores `received_at`.

## Offline and sync rules

Zero data loss is the top requirement; every rule below must hold, and each one gets an automated test.

### Saving

1. A visit is written to the phone's database in a single transaction when Save is tapped, before any network activity.
2. The photo file is saved to private storage first; the visit is saved only once the photo file exists.
3. A visit is never deleted from the phone because of a sync error.

### Uploading

1. Sync runs in the background (WorkManager) whenever the phone has internet, and keeps retrying with back-off until it succeeds. It survives the app being closed and the phone restarting.
2. The visit data uploads first, then its photo. Small text records get through on a weak signal even when photos cannot.
3. Uploads are idempotent: the server uses the phone-generated `id`, so sending the same visit twice never creates a duplicate.
4. A record is marked synced only after the server confirms it was stored. Photos are confirmed separately.
5. Synced records and photos stay on the phone for at least 30 days, as a second copy.

### Downloading

- Each sync also downloads changes to sectors, subsectors, species and statuses, and the collector's own visits edited on the dashboard.
- Reference data changes are applied using `updated_at`, so only what changed is downloaded.

### Edits and conflicts

- Each visit has a `version` number that goes up by one on every edit.
- If an edit arrives for an older version (for example, an admin edited it on the dashboard while the collector edited it offline), the latest edit is applied, and both edits are kept in `visit_edits` and flagged as a conflict on the dashboard for an admin to review. No edit is ever discarded.

### Safety nets

- Logout and app data reset are blocked while anything is unsynced.
- An "Export backup" option in the app writes all unsynced records and photos to a single file the collector can copy off the phone.
- The dashboard shows each collector's last sync time, so admins notice a phone that has not synced for days.

## Tech stack and repo structure

The stack is native Android plus Supabase, chosen for reliable offline storage and easy statistics queries.

| Part | Technology | Why |
| --- | --- | --- |
| Android language and UI | Kotlin, Jetpack Compose | Current Android standard |
| Local database | Room (SQLite) | Reliable, transactional offline storage |
| Background sync | WorkManager | Retries survive app close and restarts |
| Camera | CameraX | In-app photo capture |
| Minimum Android version | API 24 (Android 7.0) | Covers older and budget phones |
| Backend | Supabase: Postgres, Auth, Storage | SQL for statistics; row-level security for roles |
| Web dashboard | Next.js (React), TypeScript | Charts, tables, map in one site |
| Charts and map | Recharts, Leaflet with OpenStreetMap | Free, no API key needed |
| Hosting | Supabase (backend), Vercel (dashboard) | Free tiers to start |

One Git repository holds everything:

```
tree-app/
  android/      Android Studio project
  dashboard/    Next.js web dashboard
  supabase/     database schema, security rules, migrations
  docs/         this spec
  CLAUDE.md     summary of this spec for Claude Code
```

## Security and privacy

Roles are enforced on the server, not just hidden in the app, so a modified app cannot bypass them.

- Row-level security in Supabase: collectors can insert visits and edit only their own; executives can only read; admins can do everything.
- All traffic uses HTTPS. Photos are stored in a private bucket and shown only to logged-in users.
- The phone's database is private to the app. A lost phone is handled by an admin deactivating that user.
- The only personal data stored is staff names and contact details. Handle it in line with the Nigeria Data Protection Act 2023, and publish a privacy policy if the app goes on Google Play.
- The database is backed up daily (Supabase plan dependent; confirm before launch).

## Build phases and acceptance criteria

Build in five phases; each must pass its checks before the next starts.

1. **Offline recording app.** Local database, record-a-visit screen, photo capture and compression, visit list, edit with audit log. Reference data is hard-coded sample data for now.
   - [ ] With the phone in airplane mode, record 50 visits with photos, restart the phone, and all 50 are still there.
   - [ ] Entering an existing tree ID shows its last species and status and adds a new visit.
2. **Backend.** Supabase project, schema, row-level security, user accounts, photo storage.
   - [ ] Security tests show each role can do only what the roles table allows.
3. **Sync.** Login, reference data download, upload queue, retries, conflict handling, sync banner, logout block, export backup.
   - [ ] Record 100 visits offline, reconnect: all 100 visits and photos reach the server with no duplicates.
   - [ ] Kill the app and cut the connection mid-upload: after reconnecting, everything still arrives exactly once.
   - [ ] Edit the same visit on the phone (offline) and the dashboard: both edits appear in the log and the conflict is flagged.
4. **Admin dashboard.** Login, reference data management with GPS, user management, tree records and history.
   - [ ] A new species added on the dashboard appears in the app's dropdown after the next sync.
5. **Executive statistics.** Totals, alive/dead, species, trends, per-collector counts, sector map, filters, CSV export.
   - [ ] Dashboard figures match direct database counts for a test data set.

After phase 5, run a field trial with two or three collectors for one to two weeks in a real no-network area before full rollout.

## Open questions

- [ ] Tree ID format: numbers only, letters and numbers, or a printed tag or QR code that could be scanned?
- [ ] If a tree ID is recorded in a different sector than its previous visits, should the app warn the collector?
- [ ] One photo per visit, or allow several?
- [ ] Will each collector have their own phone, or will phones be shared?
- [ ] How many collectors and admins at launch, and roughly how many visits per month? This sets hosting costs.
- [ ] Install through Google Play (private or public listing) or by sharing the app file directly?
- [ ] Statuses beyond Alive and Dead later (for example Diseased, Damaged)? The design already supports this.
