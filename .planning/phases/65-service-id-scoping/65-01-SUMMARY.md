---
phase: 65-service-id-scoping
plan: 01
subsystem: database
tags: [better-sqlite3, query-engine, service-id, cross-repo, collision]

# Dependency graph
requires:
  - phase: 63-scan-bracket-integrity
    provides: scanVersionId threaded into persistFindings and services table
provides:
  - _resolveServiceId scoped by repoId with same-repo preference and ambiguity warning
  - Three new tests covering cross-repo collision, unambiguous cross-repo ref, and ambiguity warning
affects: [66-agent-interaction-fixes, any future phase touching service resolution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Same-repo-first resolution: prefer repo-scoped DB lookup before global fallback"
    - "Ambiguity warning pattern: warn on multiple matches, return first — never silently wrong"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/query-engine-upsert.test.js

key-decisions:
  - "Use inline this._db.prepare().get()/.all() inside _resolveServiceId — called rarely (once per cross-repo edge), no caching needed"
  - "repoId = null default preserves backward compatibility for any callers not passing the second arg"
  - "Ambiguity warning uses console.warn (stderr) not console.error — informational, not fatal"

patterns-established:
  - "Service resolution: same-repo exact match first, then global single-match (no warning), then global multi-match (warn + first)"

requirements-completed: [SVCR-01]

# Metrics
duration: 10min
completed: 2026-03-21
---

# Phase 65 Plan 01: Service ID Scoping Summary

**Cross-repo service ID collision fixed: _resolveServiceId now scopes by repoId with same-repo preference and console.warn on ambiguous global matches**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-21T20:00:00Z
- **Completed:** 2026-03-21T20:10:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `_resolveServiceId(name, repoId = null)` now prefers the same-repo service when repoId is provided, eliminating the bug where two repos with identically-named services would collide on whichever row was inserted first
- Global fallback correctly handles unambiguous cross-repo references (single global match, no warning) and ambiguous ones (multiple global matches, console.warn to stderr)
- Both call sites in `persistFindings()` updated to pass `repoId` as the second argument
- Three new tests (D, E, F) appended to `query-engine-upsert.test.js` covering same-repo preference, unambiguous cross-repo resolution, and ambiguity warning — all 11 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Scope _resolveServiceId by repoId with ambiguity warning** - `4c4bbb8` (feat)
2. **Task 2: Add collision and ambiguity warning tests** - `594fcf2` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `plugins/ligamen/worker/db/query-engine.js` - `_resolveServiceId` signature extended, body rewritten with 3-step resolution logic, both persistFindings call sites updated
- `plugins/ligamen/worker/db/query-engine-upsert.test.js` - Tests D/E/F appended covering cross-repo collision scenarios

## Decisions Made

- Used inline `this._db.prepare()` calls (not constructor-cached statements) — `_resolveServiceId` is called at most once per cross-repo connection edge, so caching provides no measurable benefit and avoids constructor complexity
- `repoId = null` default keeps the method backward-compatible with any existing callers that don't yet pass the second argument
- Ambiguity warning goes to `console.warn` (not `console.error`) — it is actionable guidance, not a fatal error; the scan continues with the first match

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 65 plan 01 complete; the service ID collision bug (THE-932 / SVCR-01) is resolved
- Phase 66 (agent interaction fixes) can proceed — no dependencies on this phase's output

---
*Phase: 65-service-id-scoping*
*Completed: 2026-03-21*

## Self-Check: PASSED

- query-engine.js: FOUND
- query-engine-upsert.test.js: FOUND
- 65-01-SUMMARY.md: FOUND
- Commit 4c4bbb8: FOUND
- Commit 594fcf2: FOUND
