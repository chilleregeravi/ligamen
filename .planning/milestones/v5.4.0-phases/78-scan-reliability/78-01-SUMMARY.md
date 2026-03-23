---
phase: 78-scan-reliability
plan: 01
subsystem: scan
tags: [Promise.allSettled, parallel, retry, agentRunner, scan-orchestration]

# Dependency graph
requires:
  - phase: 76-discovery-phase-wiring
    provides: runDiscoveryPass wired into scanRepos — parallel refactor preserves discovery pass before beginScan
  - phase: 74-scan-bug-fixes
    provides: persistFindings, beginScan, endScan bracket pattern — sequential DB write order preserved
provides:
  - Parallel agentRunner fan-out via Promise.allSettled in scanRepos
  - Retry-once on agentRunner throw with named WARN log on double failure
  - skipped: true result field for retry-exhausted repos
  - Parse failures do NOT trigger retry (existing behavior preserved)
affects: [79-any-future-scan-phase, performance-testing, scan-orchestration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase scan: Phase A parallel agentRunner calls via Promise.allSettled, Phase B sequential DB writes"
    - "Retry-once pattern: try/catch wrapping agentRunner with inner try/catch for retry on second throw"
    - "scanOneRepo() helper encapsulates per-repo logic — clean separation from orchestration"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/manager.test.js

key-decisions:
  - "SREL-01: agentRunner calls parallelized via Promise.allSettled — reduces scan time from sum-of-all-repos to slowest-single-repo"
  - "Retry-once applies ONLY to agentRunner throw, never to parse failures (valid === false) — existing parse-failure behavior preserved"
  - "DB writes (persistFindings, endScan, enrichment) remain sequential — SQLite/better-sqlite3 gets SQLITE_BUSY if parallelized"
  - "On double failure (retry exhausted): skipped: true result, WARN log with repoName, bracket stays open (prior data preserved)"

patterns-established:
  - "Two-phase scanRepos: Phase A = Promise.allSettled fan-out, Phase B = sequential for...of DB writes"
  - "Internal _writeDb flag in agent result objects distinguishes success results (needing Phase B) from skip/error results"

requirements-completed: [SREL-01]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 78 Plan 01: Scan Reliability — Parallel Fan-out with Retry-once Summary

**scanRepos refactored from sequential for...of to Promise.allSettled parallel fan-out with retry-once per repo and named WARN on double failure**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T18:03:02Z
- **Completed:** 2026-03-22T18:07:13Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments
- scanRepos now dispatches all agentRunner calls in parallel via Promise.allSettled — scan time drops from sum-of-all-repos to approximately slowest-single-repo
- Retry-once logic added: agentRunner throw triggers one retry; on second throw, repo is skipped with a WARN log naming the repo (repoName in extra)
- Parse failures (parseAgentOutput returns valid: false) do NOT trigger retry — existing behavior preserved
- DB writes (persistFindings, endScan, enrichment) remain strictly sequential — SQLite safety preserved
- All 49 tests pass (44 original + 4 new retry/skip tests + 1 renamed parallel fan-out test)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add parallel scan and retry tests to manager.test.js** - `59ea319` (test — RED phase)
2. **Task 2: Refactor scanRepos to parallel fan-out with retry-once** - `9b50c7f` (feat — GREEN phase)

**Plan metadata:** (docs commit follows)

_Note: TDD task — test commit first (RED), then implementation commit (GREEN)_

## Files Created/Modified
- `plugins/ligamen/worker/scan/manager.js` - Refactored scanRepos to two-phase pattern: Promise.allSettled fan-out + sequential DB writes; added scanOneRepo() helper with retry-once logic
- `plugins/ligamen/worker/scan/manager.test.js` - Renamed sequential test to parallel fan-out; added 4 new retry/skip tests in "scanRepos — retry-once on agentRunner failure" describe block

## Decisions Made
- scanOneRepo() internal helper carries `_writeDb: true` flag on success results so Phase B knows to write to DB — avoids re-checking result shape in Phase B loop
- Defensive handling of Promise.allSettled `rejected` entries (scanOneRepo catches all throws, but a rejected entry is treated as a skip result)
- The renamed test "agents run via Promise.allSettled — parallel fan-out" now asserts `order.length === 2` instead of strict ordering `["svc-a", "svc-b"]`

## Deviations from Plan

None - plan executed exactly as written.

One adaptation noted: the plan's interface comment mentioned `promptDeep` (from Phase 76's context), but the actual manager.js in the repo uses type-specific prompts (`promptService`/`promptLibrary`/`promptInfra`). The refactor preserved the actual behavior — no behavioral change, just adapting to actual code state.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Parallel scan orchestration in place — ready for further reliability work (78-02 already complete)
- Retry/skip behavior is fully tested; WARN log surface is clean for operator monitoring

---
*Phase: 78-scan-reliability*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: plugins/ligamen/worker/scan/manager.js
- FOUND: plugins/ligamen/worker/scan/manager.test.js
- FOUND: .planning/phases/78-scan-reliability/78-01-SUMMARY.md
- FOUND: commit 59ea319 (test RED phase)
- FOUND: commit 9b50c7f (feat GREEN phase)
