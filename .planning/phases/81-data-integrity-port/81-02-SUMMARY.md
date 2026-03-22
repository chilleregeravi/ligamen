---
phase: 81-data-integrity-port
plan: 02
subsystem: testing
tags: [node-metadata, view-names, worker, session-start, version-check]

# Dependency graph
requires:
  - phase: 80-security-hardening
    provides: Hardened resolveDb, SEC-01 path traversal fix
provides:
  - KEY_TO_VIEW mapping in enrichment test seedMeta helper routing keys to canonical views
  - Corrected 'scan' -> 'ownership' view in graph test inline INSERT
  - Version mismatch detection and worker restart in session-start.sh
affects: [testing, session-start, worker-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - KEY_TO_VIEW object maps metadata keys to canonical view names (ownership/security/infra/enrichment)
    - Version mismatch check uses /api/version curl + jq before falling through to status line

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine-mcp-enrichment.test.js
    - plugins/ligamen/worker/db/query-engine-graph.test.js
    - plugins/ligamen/scripts/session-start.sh

key-decisions:
  - "KEY_TO_VIEW in seedMeta ensures test inserts use the same view names production queries filter on"
  - "Version mismatch detection placed in 'worker already running' branch so it only fires when a worker is live"

patterns-established:
  - "Pattern 1: Route metadata keys through KEY_TO_VIEW before inserting in test helpers"
  - "Pattern 2: Check /api/version before assuming running worker matches installed plugin version"

requirements-completed: [DINT-03, DINT-04]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 81 Plan 02: Data Integrity Port (DINT-03 + DINT-04) Summary

**Ported canonical view name fixes and worker version mismatch restart logic from plugin cache to source repo, ensuring test inserts use ownership/security/infra views and session-start.sh restarts stale workers.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T20:43:00Z
- **Completed:** 2026-03-22T20:48:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `KEY_TO_VIEW` constant + view derivation logic in `seedMeta` helper so test inserts route to canonical views (ownership/security/infra) matching production query filters
- Fixed hardcoded `"scan"` view to `"ownership"` in graph test inline INSERT (line 304)
- Added INTG-02 version mismatch detection block in session-start.sh: reads installed version from package.json, curls /api/version, restarts worker if versions differ

## Task Commits

Each task was committed atomically:

1. **Task 1: Port DINT-03 view name fixes to enrichment + graph test files** - `7507cb1` (fix)
2. **Task 2: Port DINT-04 version mismatch restart to session-start.sh** - `54befbe` (fix)

## Files Created/Modified
- `plugins/ligamen/worker/db/query-engine-mcp-enrichment.test.js` - Added KEY_TO_VIEW map and canonical view derivation in seedMeta helper
- `plugins/ligamen/worker/db/query-engine-graph.test.js` - Changed inline INSERT view from "scan" to "ownership"
- `plugins/ligamen/scripts/session-start.sh` - Added INTG-02 version mismatch detection and worker restart logic

## Decisions Made
- KEY_TO_VIEW is defined at module level adjacent to seedMeta so the mapping is visible and maintainable alongside the helper it governs.
- Version mismatch check placed only in the "worker already running" else-branch — avoids redundant check when worker is freshly started.

## Deviations from Plan

None - plan executed exactly as written. Both files matched their cache counterparts exactly after edits. Tests passed with 0 failures.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DINT-03 and DINT-04 are complete; remaining data integrity requirements (if any) in Phase 81 can proceed.
- Test suite for enrichment and graph query engine both green.

---
*Phase: 81-data-integrity-port*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: plugins/ligamen/worker/db/query-engine-mcp-enrichment.test.js
- FOUND: plugins/ligamen/worker/db/query-engine-graph.test.js
- FOUND: plugins/ligamen/scripts/session-start.sh
- FOUND: .planning/phases/81-data-integrity-port/81-02-SUMMARY.md
- FOUND: commit 7507cb1 (Task 1)
- FOUND: commit 54befbe (Task 2)
