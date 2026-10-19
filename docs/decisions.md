# Implementation decisions and open questions

This records how the Phase 1 build implements the [architecture](../README.md#documents) and where it
deliberately leaves a decision to stakeholders. Section numbers refer to the architecture document.

## Open questions (architecture §14) and how the build handles them

None of these is hard-coded. Each is a setting an administrator chooses, with the seed data showing
one example. **Confirm them before go-live.**

| # | Question | How the system handles it | Where to set it |
|---|---|---|---|
| 1 | ID component order, separators, short codes, padding | Fully configurable, versioned per project. Short codes are 1–16 letters/digits, stored upper-case. | Web → Project → Tree ID format |
| 2 | Serial uniqueness scope and range allocation | Scheme chooses any combination of project / planting year / vendor / sector / sub-sector (or global). Optional pre-allocated ranges per officer are enforced on device and server. | Tree ID format; Serial ranges tab |
| 2b | Scope in which the *full* physical ID is unique | Chosen explicitly when a project is created (`GLOBAL` or `PROJECT`); no default, cannot change later. | New project form |
| 3 | Vendor / sector / sub-sector in the ID | Each component can be included, required or optional. | Tree ID format |
| 4 | Calendar year vs named cohort | Planting-year labels are free text (`2026`, `WET26`); dates optional. Never inferred from registration time. | Project → Planting years |
| 5 | Statuses and observation/photo requirements | Admin-defined statuses with `terminal`, `replaceable` and `photo required` flags. The seed uses the PRD's suggested six. | Species, statuses & vendors |
| 6 | Offline session duration and revocation | `OFFLINE_SESSION_DAYS` (default 7). Access tokens 15 min, rotating refresh tokens 30 days. Deactivation, role/password changes and device revocation end sessions at the next online contact; an offline device locks when its window expires. | Backend environment |
| 7 | Local cache duration and photo retention | Photos are offloaded as soon as they are verified (never before). Synced-record pruning is implemented (`TreeDao.pruneSynced`) but not scheduled until a retention period is agreed. | Android |
| 8 | Cloud provider, region, RPO/RTO, volumes | Not chosen. The backend needs only PostgreSQL + PostGIS, S3-compatible storage and environment variables, so it runs on any managed provider. | See operations.md |

## Notable design choices

**Duplicates are kept, not rejected.** Partial unique indexes (`WHERE record_state = 'ACTIVE'`)
enforce uniqueness of the normalised physical ID and serial within their scope keys. A colliding
submission is inserted with `record_state = 'CONFLICT'`, keeping its observations and photos, and a
`conflict_records` row is opened for review (§5.3). Administrators resolve it from the web portal with
an audited decision; the outcome reaches devices through the change feed.

**Server re-assembles every ID.** The device sends the serial, the code values it used, and the full
ID the officer confirmed. The server assembles the ID itself and rejects mismatches (`ID_MISMATCH`).
Code values from the device are accepted even if an administrator has since changed a code, because
the label already printed is the ground truth; the snapshot records whether each value still matches
the current code. The same assembly rules run on both sides, checked by shared test vectors
(`spec/tree-id-test-vectors.json`).

**Change feed ordering.** `change_log` rows are written by triggers. Every write transaction takes a
transaction-scoped advisory lock first, so sequence numbers become visible in commit order and a
cursor never skips a change that commits late. This serialises writes, which is fine at Phase 1
volumes; revisit (e.g. logical decoding) if write throughput becomes a bottleneck.

**Sync order: records before photos.** The architecture lists media upload before metadata. Here,
metadata is pushed first, because the server can only confirm the tree/observation association
(deletion condition 3) once those records exist. Photos are uploaded in the same sync cycle right after.

**Optimistic concurrency without false conflicts.** Unsent edits to one tree are merged into a single
outbox operation that keeps the base revision the officer started from. Edits to a tree not yet
accepted by the server are queued as updates against revision 1 and always follow the create.

**Shared devices.** A different officer cannot sign in while the device holds another officer's unsynced
records, so records are never submitted under the wrong identity.

**Maps.** The web portal and the Android app draw sector/sub-sector boundaries and reference points
from the database; nothing ever draws individual tree positions. A basemap appears only when a licensed
style URL is configured (`VITE_MAP_STYLE_URL`, `-PtmsMapStyleUrl`). Offline basemap download for
assigned areas depends on the chosen map-data licence and is not implemented yet.

## Not in this build

- Production infrastructure (provider choice, IaC, secrets service wiring, alert rules). The code
  exposes `/api/v1/health` and `/api/v1/health/metrics` for monitoring.
- Offline basemap tile download (needs licensed data, see above).
- Encryption of the Android database at rest beyond Android's file-based encryption; session tokens
  are Keystore-encrypted. Add SQLCipher if the risk assessment requires it.
- Field acceptance testing on target devices (architecture §13) and restore rehearsals.
