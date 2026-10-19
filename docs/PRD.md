# Tree Management System — Product Requirements Document

**Version:** 1.2  
**Date:** 19 October 2026  
**Status:** Draft for stakeholder validation  
**Phase:** Phase 1

## 1. Executive summary

The Tree Management System (TMS) is an offline-first platform for managing reforestation projects, area-based tree inventories, planting-year cohorts, field observations, and tree replacement history.

The system comprises:
- A native Android application for Field Officers.
- A web administration portal for Administrators.
- A read-only web dashboard for Executives.
- A managed cloud backend, relational database, and private object storage.

The application must operate in remote areas without internet access. Field Officers save records locally and synchronise them when connectivity returns.

### 1.1 Area-based inventory principle

TMS uses an **area-based approach, not a census approach**. Administrators define the GPS reference coordinates and boundaries for sectors and sub-sectors. Individual tree records reference their assigned sub-sector (and therefore its sector/project geography). TMS does **not** require or assume that each tree has an individually captured GPS coordinate.

A tree may optionally have a location coordinate in a future enhancement, but individual tree GPS capture is out of Phase 1 scope unless explicitly approved later. Maps and reports must not imply that every tree has a surveyed point location.

## 2. Problem statement

Reforestation fieldwork often takes place where internet connectivity is unreliable. Paper records and disconnected spreadsheets make it difficult to maintain consistent tree IDs, track tree health over time, identify replacements, and consolidate field reports.

TMS provides a common registry and history for trees, areas, planting years, vendors, field officers, and project performance.

## 3. Goals and success measures

### Goals
1. Capture and edit tree records offline.
2. Assign each tree to a project, sector, sub-sector, species, planting year, and configurable identifier scheme.
3. Use physical tree labels as the source for the trailing serial number.
4. Preserve the identity and history of dead trees that are replanted.
5. Maintain dated observations and status history for each tree.
6. Keep area-level GPS points and boundaries under Administrator control.
7. Synchronise records and photographs safely to managed cloud storage.
8. Provide administration, executive reporting, auditability, and exports.

### Proposed success measures
- Field Officers can register and update records fully offline.
- Local records survive app closure and device restart.
- Sync retries do not create duplicate records or observations.
- Physical IDs are validated locally where possible and authoritatively on the server.
- Tree replacements retain a traceable link to the original tree.
- Photographs are removed locally only after verified upload and record association.
- Executive reports disclose their latest server sync time and data completeness.

## 4. User roles

### 4.1 Administrator
Can create and manage projects, identifier formats, planting years, sectors, sub-sectors, area GPS coordinates and boundaries, species, statuses, vendors, users, assignments, tree records, replacement links, conflicts, reports, and audit records.

### 4.2 Field Officer
Can access assigned projects/areas, register trees, enter physical label serial numbers, select planting year/species/status/sector/sub-sector, take photographs, edit permitted fields, create follow-up observations, and manage sync retries. No individual tree GPS capture is required.

### 4.3 Executive
Read-only access through the web dashboard to project summaries, planting-year comparisons, tree status and observation trends, replacement counts, geographic area views, data completeness, and authorised reports.

All access restrictions must be enforced by the backend, not only by the UI.

## 5. Scope

### 5.1 Phase 1 — included
- Native Android application.
- Offline login/session policy and cached project configuration.
- Project and planting-year management.
- Configurable tree ID composition and serial number entry.
- Sector/sub-sector hierarchy with Administrator-entered GPS reference coordinates and boundaries.
- Species, status, vendor, user, and assignment management.
- Tree registration and editing.
- Tree observation history.
- Tree replacement and lineage.
- Local database, persistent sync outbox, retry and conflict handling.
- Photograph capture, upload verification, and safe local offloading.
- Web admin portal and read-only executive dashboard.
- Maps displaying area boundaries and area-level reference points.
- CSV/Excel export, audit logs, backup, monitoring, and restore testing.

### 5.2 Out of scope unless separately approved
- Required GPS coordinate for every individual tree.
- Tree-level precision mapping or tree census.
- AI species identification.
- IoT sensors, drones, satellite detection, and advanced remote sensing.
- Vendor payments or financial accounting.
- Complex approval workflows beyond data conflict/replacement review.
- Public access to project data.

## 6. Functional requirements

### 6.1 Project management
Administrators can create, edit, activate, pause, complete, and archive projects. Project fields include unique internal ID, project name/code, description, location, dates, status, assigned users, and configuration references.

Project short codes are configurable and used in tree ID generation. Codes must be unique within the agreed scope and changes must not silently rewrite existing tree IDs.

### 6.2 Planting year
Administrators can create and manage planting years/cohorts for each project. A planting-year entry includes internal ID, displayed year/name, optional start/end dates, active state, and project association. Field Officers select the planting year when registering a tree.

The planting year is a business attribute and a component of the configured tree ID when enabled. It must not be inferred solely from the registration date. Historical planting years remain selectable for authorised back-entry and follow-up work.

### 6.3 Configurable tree ID format
Administrators configure the format from ordered components, for example:

`T4L-2024-000001`

Possible components:
- Project short code (e.g. `T4L`)
- Planting year (e.g. `2024`)
- Vendor short code (optional)
- Sector short code (optional)
- Sub-sector short code (optional)
- Serial number (entered by Field Officer)

Example extended format:

`T4L-2024-V03-S02-SS04-000001`

The exact format is configurable and may be changed for future registrations. The Administrator defines separators, component order, required/optional components, padding width, and the scope in which serial numbers must be unique.

**Field Officer workflow:** the app shows the assembled prefix and asks the officer to enter only the trailing serial number. The app then constructs and displays the full Tree ID before save. If the physical label includes the entire ID, the officer should be able to compare the assembled ID with the label. The officer must not be asked to re-enter prefix parts already supplied by the system.

ID configuration must be versioned. Each tree stores the full physical ID as registered and the format version used to create it. Updating the format applies to new registrations only by default. Existing IDs are not rewritten automatically.

#### Serial number uniqueness
The Administrator must define whether serials are unique globally, per project, per planting year, per vendor, per sector/sub-sector, or within another configured scope. The full assembled physical ID must always be unique within the authoritative business scope.

Offline devices can only detect duplicates in their local data and downloaded cache. The server enforces uniqueness at sync. Duplicate submissions must be preserved as conflicts for review, not silently overwritten.

If the organisation needs guaranteed collision-free serial allocation while devices are offline, Administrators must pre-allocate serial ranges to officers or areas, or use another controlled issuance process. Independent disconnected devices cannot guarantee global uniqueness without prior allocation.

### 6.4 Sector and sub-sector geography
Administrators enter the GPS reference coordinates for each sector and sub-sector and may define boundaries as polygons. These coordinates describe the area, not each tree.

Fields include internal ID, name/code, parent relationship, latitude/longitude reference point, optional polygon geometry, area description, and active state. Support validated GeoJSON import/export where required.

Tree records reference a sub-sector; the sector and project are derived through the hierarchy. Field Officers select the appropriate area. The application must not require tree-level GPS. If a future project elects to capture tree GPS, it must be an explicit optional extension.

Offline map data and boundary geometry can be downloaded for assigned areas. The app should display the selected area and its boundaries when local map data is available. It must not suggest that area membership proves the exact location of an individual tree.

### 6.5 Species and status configuration
Administrators create, edit, and deactivate species and statuses. Existing records retain references to deactivated entries. Suggested statuses include Planted, Healthy, Needs inspection, Damaged, Dead, and Missing; final definitions are approved by project stakeholders.

Status is time-varying and should be represented by dated observations. A cached current status may be maintained for fast filtering, but observation history is the authoritative record of change.

### 6.6 Vendor management
Administrators create and maintain vendors, including vendor ID, name, optional short code, contact details, location, and active state. Vendor may be an ID component if enabled in the project format. Historical tree IDs and vendor attribution must not be silently changed when a vendor's short code changes.

### 6.7 Tree registration
A tree record contains:
- Internal immutable UUID.
- Full physical Tree ID.
- Original serial number component.
- ID format version and component snapshot.
- Project, planting year, sector/sub-sector reference.
- Species and current recorded status.
- Optional vendor attribution.
- Initial planting/registration details.
- Notes.
- Created/updated timestamps and actor IDs.
- Sync and data-quality state.

The app saves the record locally before reporting success. It validates required fields and checks local duplicates. The server is authoritative for duplicate checks.

### 6.8 Tree observations
A Field Officer can add a dated observation to an existing tree. Observation fields include observation UUID, tree UUID, observed status, observed date/time, recording time, officer, remarks, and one or more photos where required. No tree GPS is required.

Observations are append-only in normal workflows. Corrections are audited amendments. Store `observed_at`, `recorded_at`, and `synced_at` separately because field observations may be uploaded days later.

### 6.9 Dead trees and replacement planting
A dead tree remains in the registry with its original physical ID, planting year, observations, photos and history. A replacement tree is a **new tree entity with a new physical ID** and its own planting year/serial and history.

The replacement record links to the original through `replaces_tree_id` or an equivalent replacement relationship. The original tree may have a terminal status such as Dead or Replaced, but must never be deleted or have its identity reused.

Support multiple replacements over time if project policy allows it. Report original trees, replacement trees, and total planting events separately to prevent double counting. A replacement must not be counted as the original tree surviving.

### 6.10 Photo capture and retention
Photographs are stored in app-private local files and tracked in the database by media UUID, tree/observation association, checksum, local path, remote object key, and upload state.

A photo can be deleted locally only after:
1. Cloud storage confirms durable object storage.
2. Checksum/size verification succeeds.
3. The server confirms the photo is associated with the correct tree or observation.
4. The local app stores the verification acknowledgement.
5. No pending operation still depends on the local file.

Unsynced media must never be purged automatically. Local retention of synced records is configurable; photos can be offloaded independently. Low storage warnings and manual retry controls are required.

### 6.11 Synchronisation
Use a persistent outbox. Each operation has a stable UUID, entity UUID, operation type, device ID, base revision, local timestamp and payload. Server responses are item-level: accepted, already processed, conflict, or rejected.

Sync includes uploads and downloads:
- Upload new trees, edits, observations, and media associations.
- Download updated configuration, assignments, and authorised server changes.
- Use server-issued change cursors.
- Retry with exponential backoff and jitter.
- Keep failures visible and actionable.
- Use idempotency keys to make repeated requests safe.
- Detect concurrent metadata edits with version checks.
- Do not use blind last-write-wins for conflicting tree records.

### 6.12 User and device management
Administrators create accounts, assign roles and area scopes, deactivate accounts, and manage credentials securely. Passwords are never stored in plaintext. The offline session policy defines expiry, cached access, device registration, and behaviour when a user is revoked while disconnected.

### 6.13 Reports
Reports include:
- Trees registered by project, planting year, sector, sub-sector, species, vendor, and status.
- Observation and condition trends over time.
- Replacement tree counts and original-to-replacement lineage.
- Records with missing required fields or pending sync.
- Field Officer activity.
- Area coverage based on assigned sector/sub-sector geometry.
- Data completeness and last successful server sync time.

Do not label registered-tree totals as survival totals. Survival analysis requires a defined baseline, observation protocol, and reporting period. Reports must distinguish unknown/overdue trees from confirmed dead or missing trees.

## 7. Non-functional requirements
- Offline-first capture and editing.
- Local transaction durability through app closure and device restart.
- Secure API transport and role/project-level authorisation.
- Encryption of sensitive local data where required by the risk assessment.
- Reliable retries and duplicate-safe sync.
- Support for the agreed minimum Android version and device specification.
- Responsive local search and forms on target devices.
- Configurable retention and media storage warnings.
- Auditability of administrative actions, ID corrections, merges and replacements.
- Managed backups and tested restoration.
- Versioned API and database migrations.
- Monitoring for sync failures, storage use, API errors, and backup completion.

## 8. Acceptance criteria
1. Field Officer can register a tree offline by entering only the serial portion of a configured ID.
2. App displays the assembled full ID and saves it with the ID format version.
3. Planting year is selected explicitly and forms part of the ID where configured.
4. Admin-entered sector/sub-sector GPS coordinates and boundaries are available offline for assigned areas.
5. No individual tree GPS is required to register or observe a tree.
6. Repeat visits create new observations on the same tree.
7. A replacement has a new ID and a link to the original dead tree.
8. Original tree records and observations remain available after replacement.
9. Duplicate physical IDs across devices are detected server-side without overwriting records.
10. Interrupted uploads resume without duplicate tree or observation records.
11. Local photos are removed only after verified upload and association.
12. Executives can view read-only reports and see the last server sync timestamp.
13. Access controls prevent users from accessing unassigned projects.
14. Backup and media restoration are tested before production launch.

## 9. Delivery plan
1. Requirements validation and identifier policy.
2. Database/API and administration foundation.
3. Android offline registry and observations.
4. Sync, media verification, and retention lifecycle.
5. Web admin and executive dashboard with area maps.
6. Field pilot in no-network conditions.
7. Production deployment, training, monitoring, and recovery rehearsal.

## 10. Decisions still requiring stakeholder approval
- Exact tree ID component order, separators, padding, and short-code rules.
- Scope of serial-number uniqueness and whether serial ranges are pre-allocated.
- Whether vendor/sector/sub-sector codes are mandatory components or optional.
- Whether planting year is a calendar year or a configurable planting cohort label.
- Exact tree statuses and required observation/photo policy.
- Offline session expiry and acceptable revocation delay.
- Local retention duration for synced records and photographs.
- Cloud provider, region, backup RPO/RTO, and expected data volumes.
