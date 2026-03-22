---
phase: 74-scan-bug-fixes
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, query-engine, codeowners, enrichment, actors]

requires:
  - phase: 73-query-engine-metadata-views
    provides: actors table, actor_connections table, node_metadata table (migration 008)

provides:
  - Known-service guard in persistFindings prevents phantom actor hexagons (SBUG-01)
  - CODEOWNERS enricher correctly separates absolute repo root from relative service root_path (SBUG-03)
  - repoAbsPath field in enricher context contract

affects:
  - phase 76 (depends on 74 bug fixes being present)
  - any future enricher that needs to probe filesystem at repo root

tech-stack:
  added: []
  patterns:
    - "Guard prepared statements in constructor try/catch alongside sibling statements for backward compat with pre-migration DBs"
    - "Enricher ctx carries both repoPath (relative, for pattern matching) and repoAbsPath (absolute, for filesystem probing)"
    - "TDD: add test for known-service guard, verify existing actor tests reflect corrected behavior"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/query-engine-actors.test.js
    - plugins/ligamen/worker/scan/enrichment.js
    - plugins/ligamen/worker/scan/codeowners.js
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/codeowners.test.js

key-decisions:
  - "SBUG-01: guard uses prepared statement _stmtCheckKnownService (not inline prepare) to avoid per-call overhead"
  - "SBUG-01: tests 2-7 updated to reflect corrected behavior; tests 6-7 seed actors directly via SQL to test getGraph"
  - "SBUG-03: repoAbsPath uses ?? null default so existing enricher tests without the field continue to work"
  - "SBUG-03: codeowners.js uses ctx.repoAbsPath ?? ctx.repoPath fallback for backward compat"

patterns-established:
  - "Pattern: Enricher ctx has two path fields — repoPath (relative, pattern matching) and repoAbsPath (absolute, filesystem probe)"
  - "Pattern: Known-service guard before actor upsert — SELECT id FROM services WHERE name = ? before _stmtUpsertActor.run()"

requirements-completed: [SBUG-01, SBUG-03]

duration: 15min
completed: 2026-03-22
---

# Phase 74 Plan 01: Scan Bug Fixes (SBUG-01, SBUG-03) Summary

**Known-service guard eliminates phantom actor hexagons in persistFindings; CODEOWNERS enricher now probes repo root via repoAbsPath and matches patterns against relative service root_path**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-22T17:44:00Z
- **Completed:** 2026-03-22T17:48:48Z
- **Tasks:** 2 (each TDD: RED commit + GREEN commit)
- **Files modified:** 6

## Accomplishments

- SBUG-01: `_stmtCheckKnownService` prepared statement added to QueryEngine constructor; `persistFindings` wraps actor upsert in known-service guard — if target name exists in `services` table, no actor row is created
- SBUG-03: `runEnrichmentPass` accepts optional `repoAbsPath` 4th parameter; enricher ctx now carries `repoAbsPath` alongside `repoPath`; `codeowners.js` calls `parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath)` for file probe and `findOwners(entries, ctx.repoPath)` for pattern matching
- All 8 actor tests and all 19 codeowners tests pass

## Task Commits

Each task was committed atomically using TDD (RED then GREEN):

1. **Task 1 RED: SBUG-01 failing test** - `0a134cf` (test)
2. **Task 1 GREEN: SBUG-01 known-service guard** - `1704263` (feat)
3. **Task 2 RED: SBUG-03 failing tests** - `e485b67` (test)
4. **Task 2 GREEN: SBUG-03 enricher path fix** - `560a2fc` (feat)

## Files Created/Modified

- `plugins/ligamen/worker/db/query-engine.js` - Added `_stmtCheckKnownService` prepared statement; added known-service guard in `persistFindings` actor creation block
- `plugins/ligamen/worker/db/query-engine-actors.test.js` - Added Test 8 (SBUG-01 guard); updated Tests 2-7 to reflect corrected behavior (known-service targets skip actor creation; Tests 6-7 now seed actors directly)
- `plugins/ligamen/worker/scan/enrichment.js` - `runEnrichmentPass` accepts 4th param `repoAbsPath`; ctx includes `repoAbsPath: repoAbsPath ?? null`
- `plugins/ligamen/worker/scan/codeowners.js` - `createCodeownersEnricher` uses `ctx.repoAbsPath ?? ctx.repoPath` for file probe; `ctx.repoPath` for `findOwners` pattern matching
- `plugins/ligamen/worker/scan/manager.js` - `runEnrichmentPass` call passes `repoPath` as 4th argument
- `plugins/ligamen/worker/scan/codeowners.test.js` - Added SBUG-03 describe block with 2 new tests

## Decisions Made

- **Tests 2-7 updated (not preserved):** The original tests 2-7 tested old buggy behavior (actor created for any external target, even known services). With the SBUG-01 guard, these tests needed updating. Tests 2-5 now assert the corrected behavior (no actor for known services). Tests 6-7 seed actors directly via SQL to continue testing `getGraph` actor functionality independently of `persistFindings`.
- **`_stmtCheckKnownService` in constructor:** Per research pitfall guidance, prepared the known-service check statement once in the constructor (not inline in the connection loop) to avoid per-call overhead.
- **`repoAbsPath ?? null` default:** Keeps existing enricher callers and tests backward-compatible — no breaking change to the enricher ctx contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated tests 2-7 to reflect corrected behavior rather than preserving buggy expectations**

- **Found during:** Task 1 GREEN phase
- **Issue:** Existing tests 2-7 expected actor rows to be created for targets that ARE in the services table. With the SBUG-01 guard in place, this is now correctly prevented. The tests were encoding the old buggy behavior.
- **Fix:** Tests 2, 4 updated to assert no-actor (guard fires correctly). Tests 3, 5 restructured to test actor_connection and upsert semantics directly via SQL (bypassing persistFindings FK dependency). Tests 6, 7 restructured to seed actors directly via SQL to continue testing getGraph actor output.
- **Files modified:** `plugins/ligamen/worker/db/query-engine-actors.test.js`
- **Verification:** All 8 tests pass after restructuring
- **Committed in:** `1704263` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test expectations encoding old behavior)
**Impact on plan:** Required fix — tests must assert correct behavior, not buggy behavior. No scope creep.

## Issues Encountered

None — both bugs were precisely located and fixes were surgical.

## Next Phase Readiness

- SBUG-01 and SBUG-03 fixes are committed and tested
- Phase 76 (which depends on Phase 74) can now proceed
- Phase 75 (validation) can continue in parallel

## Self-Check: PASSED

- All modified source files exist on disk
- All task commits verified: 0a134cf, 1704263, e485b67, 560a2fc
- Key acceptance criteria verified: _stmtCheckKnownService, knownService guard, repoAbsPath in enrichment.js and codeowners.js, repoPath passed in manager.js

---
*Phase: 74-scan-bug-fixes*
*Completed: 2026-03-22*
