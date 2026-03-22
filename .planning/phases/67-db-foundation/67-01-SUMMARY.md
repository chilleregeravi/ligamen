---
phase: 67-db-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, ddl, upsert, node-metadata]

# Dependency graph
requires: []
provides:
  - Migration 009 adding 7 nullable columns across 4 tables (confidence, evidence on connections; owner, auth_mechanism, db_backend on services; scan_version_id on schemas and fields)
  - QueryEngine.upsertNodeMetadata(serviceId, view, key, value) method with INSERT ON CONFLICT DO UPDATE
  - idx_connections_confidence and idx_schemas_scan_version indexes
affects:
  - 68-ownership-enrichment
  - 69-auth-db-enrichment
  - 70-confidence-scoring
  - 71-schema-enrichment
  - 72-confidence-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Idempotent SQLite column addition via PRAGMA table_info check before ALTER TABLE
    - Backward-compatible prepared statement initialization via try/catch in QueryEngine constructor
    - Enrichment writes to node_metadata with INSERT ON CONFLICT DO UPDATE — no beginScan/endScan

key-files:
  created:
    - plugins/ligamen/worker/db/migrations/009_confidence_enrichment.js
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/migrations.test.js
    - plugins/ligamen/worker/db/query-engine-upsert.test.js

key-decisions:
  - "Migration 009 uses PRAGMA table_info guards for all 7 ALTER TABLE statements — idempotent on any DB state"
  - "upsertNodeMetadata is isolated from scan lifecycle: never calls beginScan/endScan, leaves scan_versions unchanged"
  - "_stmtUpsertNodeMetadata wrapped in try/catch so QueryEngine works on pre-migration-008 databases returning null"

patterns-established:
  - "Idempotent column addition: always check PRAGMA table_info before ALTER TABLE in migrations"
  - "Backward-compat statements: wrap optional-table prepared statements in try/catch, set null on catch, guard method with null check"

requirements-completed: [CONF-01, CONF-02]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 67 Plan 01: DB Foundation Summary

**SQLite migration 009 adding 7 enrichment columns across 4 tables plus QueryEngine.upsertNodeMetadata() for scan-lifecycle-free metadata writes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T10:29:30Z
- **Completed:** 2026-03-22T10:32:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created migration 009 with 7 idempotent nullable column additions (confidence, evidence, owner, auth_mechanism, db_backend, scan_version_id x2) and 2 indexes
- Added QueryEngine._stmtUpsertNodeMetadata prepared statement with backward-compat try/catch pattern
- Added QueryEngine.upsertNodeMetadata() method that inserts/updates node_metadata without touching scan_versions
- Added migration 009 assertions to migrations.test.js (idempotency, all 7 columns, version >= 9)
- Added Test G and Test H to query-engine-upsert.test.js (insert/update/no-scan-bracket, pre-migration-008 null return)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 009 confidence/enrichment columns** - `df6554c` (feat)
2. **Task 2: QueryEngine.upsertNodeMetadata() method** - `63edbf6` (feat)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN), single commit per task._

## Files Created/Modified
- `plugins/ligamen/worker/db/migrations/009_confidence_enrichment.js` - Migration 009 DDL: 7 nullable columns on connections, services, schemas, fields; 2 indexes; idempotent
- `plugins/ligamen/worker/db/query-engine.js` - Added _stmtUpsertNodeMetadata (constructor, try/catch) and upsertNodeMetadata() method
- `plugins/ligamen/worker/db/migrations.test.js` - Appended migration 009 assertions (7 columns, version >= 9, idempotency)
- `plugins/ligamen/worker/db/query-engine-upsert.test.js` - Added Test G and Test H for upsertNodeMetadata behavior

## Decisions Made
- Migration 009 uses PRAGMA table_info guards before each ALTER TABLE — idempotent on databases where migration was partially applied
- upsertNodeMetadata is intentionally isolated from scan lifecycle; enrichment phases write metadata after scan bracket closes
- _stmtUpsertNodeMetadata wrapped in try/catch so QueryEngine constructor does not throw on pre-migration-008 databases; method returns null when table absent

## Deviations from Plan

**1. [Rule 1 - Bug] Test H rewritten to use buildDb() instead of minimal DB**
- **Found during:** Task 2 (upsertNodeMetadata method)
- **Issue:** Plan specified building a minimal DB with only repos/services tables, but QueryEngine constructor prepares statements against connections and other tables — constructor threw SqliteError: no such table: connections
- **Fix:** Changed Test H to use buildDb() (migrations 001-006, no node_metadata) which has all required tables but lacks node_metadata, proving the try/catch fallback works
- **Files modified:** plugins/ligamen/worker/db/query-engine-upsert.test.js
- **Verification:** Test H passes, upsertNodeMetadata returns null as expected
- **Committed in:** 63edbf6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test setup)
**Impact on plan:** Auto-fix corrected the test to match actual QueryEngine constructor requirements. No scope creep.

## Issues Encountered
- None beyond the test setup issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Migration 009 columns are live — phases 68-72 can write to confidence, evidence, owner, auth_mechanism, db_backend, and scan_version_id columns immediately
- upsertNodeMetadata() is available for all enrichment phases to write node_metadata without opening scan brackets
- Phase 71 research flag resolved: schemas and fields now have scan_version_id (added in this migration)

---
*Phase: 67-db-foundation*
*Completed: 2026-03-22*
