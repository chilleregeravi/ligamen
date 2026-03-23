---
phase: 75-validation-hardening
plan: 01
subsystem: testing
tags: [validation, findings, services, warn-and-skip, node-test, tdd]

# Dependency graph
requires: []
provides:
  - VALID_SERVICE_TYPES constant exported from findings.js (["service","library","sdk","infra"])
  - Warn-and-skip logic for service type enum, root_path presence, language presence
  - Invalid services filtered from findings before DB persistence
affects: [scan-pipeline, persistFindings, any caller of validateFindings]

# Tech tracking
tech-stack:
  added: []
  patterns: [warn-and-skip pattern for semantic field validation (contrast with hard-fail for structural)]

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/findings.js
    - plugins/ligamen/worker/scan/findings.test.js

key-decisions:
  - "SVAL-01: Invalid service type/root_path/language use warn-and-skip (not hard-fail) so valid services survive alongside invalid ones"
  - "warnings array initialized before services loop so both services and connections loops push to same array"
  - "Absent type field passes validation; only present-but-invalid type triggers warn-and-skip"

patterns-established:
  - "Warn-and-skip pattern: push to warnings, continue — does not abort validateFindings; hard-fail reserved for structural errors (missing arrays, wrong top-level types)"

requirements-completed: [SVAL-01]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 75 Plan 01: Validation Hardening — Service Field Warn-and-Skip Summary

**VALID_SERVICE_TYPES exported from findings.js with warn-and-skip filtering for invalid type enum, empty root_path, and empty language before findings reach the database**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-22T17:43:32Z
- **Completed:** 2026-03-22T17:45:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Exported `VALID_SERVICE_TYPES = ["service", "library", "sdk", "infra"]` from findings.js
- Refactored services loop to accumulate a `validServices` array using warn-and-skip for semantic violations
- Return spreads obj with `services: validServices` so invalid services never reach persistFindings
- Added 6 new test cases covering SVAL-01 service field validation (type enum, root_path, language, absent type, mixed, constant shape)
- All 38 tests pass (32 pre-existing + 6 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add warn-and-skip test cases (TDD RED)** - `03972a8` (test)
2. **Task 2: Implement warn-and-skip validation (TDD GREEN)** - `7af8a1f` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have two commits — test (RED) then feat (GREEN)_

## Files Created/Modified
- `plugins/ligamen/worker/scan/findings.js` - Added VALID_SERVICE_TYPES export, refactored services loop with warn-and-skip, moved warnings init before services loop, spread return with validServices
- `plugins/ligamen/worker/scan/findings.test.js` - Added VALID_SERVICE_TYPES import and 6 SVAL-01 test cases in describe block

## Decisions Made
- Warn-and-skip (not hard-fail) for type/root_path/language: allows valid services to survive in the same findings object when some services are invalid
- Absent type field is treated as OK (no skip) — matches persistFindings default behavior
- `warnings` array initialization moved from before connections loop to before services loop — same array accumulates both service skip warnings and connection source_file null warnings

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- TDD RED phase: the module-level import of `VALID_SERVICE_TYPES` causes a SyntaxError before any tests run. This is the correct RED state because the implementation does not exist yet. All tests effectively fail, satisfying the RED requirement.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- SVAL-01 complete; findings.js now prevents invalid service data from reaching the database
- Phase 76 (or any downstream phase reading scan output) can rely on validateFindings filtering bad services with warnings
- No blockers

---
*Phase: 75-validation-hardening*
*Completed: 2026-03-22*
