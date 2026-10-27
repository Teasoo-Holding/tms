# Change log

All changes reach `master` through pull requests on Teasoo-Holding/tms. Database changes are numbered
migrations in `backend/migrations/` and are applied by the *Migrate* workflow.

For what the system does, and a step-by-step test script, see
[TMS-Overview-and-Test-Script.pdf](TMS-Overview-and-Test-Script.pdf). The source is the HTML file next to it;
print it to PDF again after changing it.

## 2026-10-27: Vendor in sessions and tree IDs, field activity report, client links (migration 009)
- **Vendors:**
  - The vendor is chosen once when a field session starts, whenever the project has vendors.
  - The vendor's short code is part of the tree ID (e.g. `T4L-2026-KNM-000001`), and each vendor numbers its own trees from 1 per planting year.
  - Migration 009 adds the vendor code to every project's format (new version); existing IDs don't change.
  - Vendors need a short code.
- **Field activity:**
  - Phones send a field-session id with every record.
  - `GET /reports/field-activity` (+ `.csv`) gives trees, visits and photos per officer, per day and per session.
  - Web "Field activity" page and phone Administration → Field activity.
- **Client links:**
  - Web "Client links" page and phone Administration → Client links: create, copy, open, revoke.
  - Links can be copied again later: the link is stored encrypted, so links made before this change can't be re-copied.
  - The client page gains "Trees planted over time", "Trees by vendor" and "Alive share by sector" charts.

## 2026-10-27: Add species with photos, edit buttons, dot density map, account switching
- **Species:** reference photos can be added while creating a species (web and phone), or later.
- **Admin lists:** a pencil edit button at the right end of each item: species, statuses, vendors, users, years, areas, custom fields; also projects on the web.
- **Density map:** one dot per registered tree, scattered inside its sector/sub-sector (green alive, red dead, grey not visited). Positions are illustrative (trees have no GPS); very large plantings show 1 dot per N trees. Web, client link and phone.
- **Accounts:** signing in as a different person (e.g. officer → administrator) ends the previous person's field session.
- **Screen edges:** full-screen views (camera, photo viewer, species gallery) keep at least a fixed margin above the navigation buttons on every device.

## 2026-10-26: Species reference photos, tree height, whole photos, keyboard (migration 008)
- **Species photos:**
  - Admins add several reference photos per species, on the web (edit a species) or the phone (Reference data → long-press → Reference photos).
  - Phones download them after each sync and keep them for offline use.
  - Officers choose the species from picture cards and can swipe through all of a species' photos full screen, then choose it.
- **API:**
  - `POST /admin/species/:id/images`, `PATCH`/`DELETE /admin/species-images/:id`
  - `GET /species/:id/images`
  - `GET /species-images/:id/content?size=thumb|full`
  - `species_images` in the phone sync
- **Tree height:** an optional field on registration and visits, in cm (default), m, inches or feet; stored in cm. Shown on the tree page (with a growth chart), in My visits and on the web.
- **Photos:** previews and the tree page show the whole photo at its own shape, not cropped. Tap for full screen with pinch-to-zoom.
- **Keyboard:** screens are laid out above the keyboard, so the field being typed in (e.g. the note) stays visible.

## 2026-10-23: Simpler field app, project/year tree IDs, density map (migration 007)
- **Android:**
  - The home screen has a large "Start field session" button. During a session it shows one large "Register trees" button and a red "End session" button. "Map" and "Visit trees" are gone; use Find a tree to visit a tree.
  - The app no longer asks for the type of visit or the planting date. Date and time are recorded automatically, and the planting date is the day the tree is registered.
  - The sub-sector is a drop-down.
  - Photos show on the form with Retake and Remove.
  - A "Tree registered" confirmation appears after each save, before the next form.
  - My visits is grouped by day; open a day to see what was recorded, with photos.
  - The tree's photo shows wherever the tree is shown.
  - Text and buttons are larger.
  - Administration has a density map.
- **Tree IDs:**
  - Each project has one format, shared by all vendors, and tree numbers run on per project and planting year.
  - Migration 007 retires vendor and year formats and removes the vendor part from project formats.
  - New formats can't contain a vendor part.
  - Existing IDs stay valid.
- **Backend:**
  - `GET /reports/density` and `GET /share/:token/density` return each area's hectares, trees, trees per hectare and alive share.
  - `GET /trees/:id/media` returns a tree's photos.
  - Visit type defaults to Visit.
  - `planted_on` defaults to the date of the first visit.
- **Web:**
  - A "Density map" page, also on the client share page.
  - Photos on the tree page (the latest shown large), in each visits row and in conflict review.
  - The visit-type filter and the planted-on field are removed.
  - A single ID format per project.

## 2026-10-22: PR #21. Deletion, clear data, client sharing, backups (migration 006)
- **Backend:** reference data can be deleted, and phones drop deleted rows. Admins can clear all data (needs a
  typed confirmation and their password). Clients get read-only share links per project. Admins can export
  everything as one Excel workbook. Photos get thumbnails.
- **Android:** simpler, KoboCollect-style home screen. Long-press or swipe to delete or deactivate.
  "Ready to send" screen with Free up space, Export backup and Restore. A light backup in `Download/TMS`
  survives reinstalls. The phone resets itself after a server clear.
- **Web:** simpler layout; row menus with delete; Settings page with Export all and Clear data; client share
  links and a public `/share/:token` report with Excel, CSV and Print.

## 2026-10-21: PR #20. Portal connection fix
- The backend accepts the `tms.teasooconsulting.com` portal and API addresses that end in a slash.

## 2026-10-21: PR #19. UX round (migration 005)
- Visit type, with Visit as the default. Timestamps are automatic and cannot be edited. Status can be chosen.
  The camera shutter is always visible. Passwords have a show/hide button. The keyboard closes when you tap
  outside it or use the button above it.
- Admins can type the ID for a replanted tree. The audit log shows the latest 10 entries. Height
  measurement is hidden.

## 2026-10-20: PR #18. Teasoo operating model (migration 004)
- Areas belong to a planting year and are drawn from corner points.
- Several vendors per year, each with its own ID format. Precedence: vendor + year, then vendor, then year,
  then the project default.
- Executives are either management (all projects) or clients/sponsors (assigned projects only).

## 2026-10-20: PR #17. Alignment with the project spec (migration 003)
- Alive/Dead statuses. A photo is required on every observation. Sign in with username, phone or email.
- Export backup, My visits, dashboard filters, a visits table with CSV, an alive/dead map, and a warning when
  a tree is visited in a different sector.

## 2026-10-20: PR #16. Admin on Android, custom fields, photos, audit (migration 002)
- Custom fields (e.g. batch number), photos on observations, and an audit trail per account.
- Dashboard charts. Administration on the phone.

## 2026-10-20: PR #15. Role-aware home and field sessions

## 2026-10-19: PRs #10–#14. Initial system
- NestJS backend with Postgres/PostGIS on Neon, the offline-first Android app, and the web portal.
- Neon object storage for photos. GitHub Actions for migrations and signed Android release builds.
