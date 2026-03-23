---
phase: 71-schema-storage---api-extension
plan: 01
subsystem: api
tags: [sqlite, better-sqlite3, query-engine, getGraph, schemas, node_metadata, enrichment]

requires:
  - phase: 70-confidence---evidence-pipeline
    provides: confidence/evidence columns on connections table (migration 009)
  - phase: 69-auth---db-extraction
    provides: node_metadata table with view='scan' enrichment data (migration 008)
  - phase: 68-enrichment-architecture---codeowners
    provides: node_metadata table schema

provides:
  - getGraph() returns schemas_by_connection top-level map keyed by connection_id string
  - getGraph() returns owner/auth_mechanism/db_backend on each service (null when absent)
  - getGraph() returns confidence/evidence on each connection (null on pre-migration-009 DBs)
  - endScan() deletes orphaned schema/field rows when stale connections are removed
  - Test file with 6 tests covering all enrichment paths and stale cleanup

affects:
  - Phase 72 (UI/frontend if any schema visualization is added)
  - Any consumer of /graph HTTP response

tech-stack:
  added: []
  patterns:
    - schemas_by_connection top-level map in getGraph() — never embedded per-node (prevents D3 worker bloat)
    - Schema/field cleanup runs BEFORE stale connection delete in endScan() to avoid FK violation
    - Try/catch graceful fallback for each migration tier (schemas, node_metadata, confidence/evidence)

key-files:
  created:
    - plugins/ligamen/worker/db/query-engine-graph.test.js
  modified:
    - plugins/ligamen/worker/db/query-engine.js

key-decisions:
  - "Schema/field cleanup in endScan() moved BEFORE stale connection delete — FK constraint requires child row deletion first"
  - "Fallback connections SELECT in getGraph() now returns null as confidence, null as evidence for type consistency"
  - "schemas_by_connection built in JS via schemaMap (Map keyed by schema_id) to correctly group fields per schema"

patterns-established:
  - "Try/catch around schema queries in getGraph() — same pattern as actors and exposes blocks"
  - "Stale child cleanup runs before parent cleanup in endScan() (fields → schemas → connections → services order)"

requirements-completed: [SCHEMA-02, OWN-02]

duration: 5min
completed: 2026-03-22
---

# Phase 71 Plan 01: Schema Storage & API Extension Summary

**getGraph() extended with schemas_by_connection map, per-service owner/auth_mechanism/db_backend from node_metadata, and per-connection confidence/evidence; endScan() now cleans up orphaned schema rows before deleting stale connections**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T11:01:02Z
- **Completed:** 2026-03-22T11:05:27Z
- **Tasks:** 2 (TDD)
- **Files modified:** 2

## Accomplishments
- getGraph() now surfaces all enrichment data: schemas keyed by connection, owner/auth/db fields on services, confidence/evidence on connections
- endScan() stale cleanup correctly deletes schema and field rows before removing the connections they reference
- 6 tests pass covering all enrichment paths, graceful fallback on pre-migration DBs, and stale schema cleanup

## Task Commits

Each task was committed atomically:

1. **Tasks 1 & 2: getGraph() extension + test file** - `4c08c21` (feat)

**Plan metadata:** TBD (docs commit)

## Files Created/Modified
- `plugins/ligamen/worker/db/query-engine.js` - Added schemas_by_connection, owner/auth_mechanism/db_backend enrichment, fixed fallback SELECT, refactored endScan() cleanup order
- `plugins/ligamen/worker/db/query-engine-graph.test.js` - 6 tests for getGraph() extended response and endScan() stale cleanup

## Decisions Made
- FK violation was discovered during TDD: schemas table has a foreign key referencing connections with no CASCADE DELETE. endScan() was deleting connections while schemas still referenced them. Fixed by moving schema/field cleanup BEFORE the stale connection delete (Rule 1 - Bug).
- The Phase 70 fallback connections SELECT was missing `null as confidence, null as evidence` projections, causing `undefined` instead of `null` on pre-migration-009 DBs. Fixed as part of this plan (Rule 1 - Bug).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FK violation in endScan() — schemas cleanup must run before connection delete**
- **Found during:** Task 2 (Test 6 — stale schema cleanup)
- **Issue:** `_stmtDeleteStaleConnections` ran before schema rows were deleted; with `foreign_keys = ON`, the connection DELETE threw SQLITE_CONSTRAINT_FOREIGNKEY
- **Fix:** Moved schema/field cleanup to run before stale connection delete. Added pre-computed subquery to identify connections-about-to-be-deleted, then deleted their schemas and fields first
- **Files modified:** plugins/ligamen/worker/db/query-engine.js
- **Verification:** Test 6 passes; actor tests unaffected
- **Committed in:** 4c08c21

**2. [Rule 1 - Bug] Fallback connections SELECT missing null projections for confidence/evidence**
- **Found during:** Task 1/Test 4 (pre-migration-009 fallback)
- **Issue:** Phase 70 fallback query omitted `null as confidence, null as evidence`, returning `undefined` instead of `null`
- **Fix:** Added `null as confidence, null as evidence` to fallback SELECT
- **Files modified:** plugins/ligamen/worker/db/query-engine.js
- **Verification:** Test 4 passes
- **Committed in:** 4c08c21

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary for correctness; no scope creep.

## Issues Encountered
- Migration file was named `009_confidence_enrichment.js` not `009_confidence_evidence.js` — fixed in test file before commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- /graph HTTP response now includes schemas_by_connection, enrichment fields, and confidence/evidence
- Ready for Phase 72 (UI visualization of schemas if planned)
- endScan() stale cleanup is correct and tested

---
*Phase: 71-schema-storage---api-extension*
*Completed: 2026-03-22*
