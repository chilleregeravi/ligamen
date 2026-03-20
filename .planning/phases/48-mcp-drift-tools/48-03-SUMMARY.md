---
phase: 48-mcp-drift-tools
plan: 03
subsystem: api
tags: [mcp, drift, openapi, oasdiff, sqlite, better-sqlite3, nodejs-test, tdd]

# Dependency graph
requires:
  - phase: 48-mcp-drift-tools (plan 01-02)
    provides: getDriftRepos, collectFiles, server.js with drift_versions + drift_types tools, server-drift.test.js with Plan 01+02 tests
provides:
  - queryDriftOpenapi function exported from worker/mcp/server.js
  - server.tool('drift_openapi') registered in MCP manifest
  - OPENAPI_CANDIDATES const + findOpenApiSpec() helper in server.js
  - compareOpenApiSpecs() with graceful oasdiff degradation in server.js
  - 6 queryDriftOpenapi tests appended to worker/mcp/server-drift.test.js
affects: [48-mcp-drift-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "oasdiff shell-out pattern: execSync with 5s timeout, which oasdiff check, graceful degradation to INFO finding when absent"
    - "OpenAPI spec discovery: OPENAPI_CANDIDATES fast path then collectFiles maxdepth-3 recursive fallback"
    - "Pairwise vs hub-and-spoke: N<=5 all pairs O(N^2), N>5 compare each against first repo O(N)"
    - "tool_available boolean field in return shape indicates oasdiff presence"

key-files:
  created: []
  modified:
    - worker/mcp/server.js
    - worker/mcp/server-drift.test.js

key-decisions:
  - "Use hub-and-spoke (not pairwise) for N>5 repos with specs — limits oasdiff execSync calls to N-1 instead of N*(N-1)/2"
  - "5-second timeout on oasdiff execSync prevents MCP server hangs per research Pitfall 3"
  - "oasdiff unavailability returns INFO finding (not error/crash) with message 'Install oasdiff for full OpenAPI comparison'"
  - "tool_available boolean in return shape allows agents to distinguish no-specs vs no-oasdiff scenarios"

patterns-established:
  - "compareOpenApiSpecs() nested try/catch: outer catches missing oasdiff, inner catches timeout/non-zero-exit"
  - "findOpenApiSpec() checks OPENAPI_CANDIDATES first (fast), then falls back to collectFiles maxdepth-3"

requirements-completed: [MCP-03]

# Metrics
duration: 17min
completed: 2026-03-20
---

# Phase 48 Plan 03: MCP Drift OpenAPI Tool Summary

**OpenAPI spec drift detection via oasdiff shell-out with pairwise/hub-and-spoke comparison, graceful degradation when oasdiff is absent, and tool_available field in return shape**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-20T19:27:46Z
- **Completed:** 2026-03-20T19:44:53Z
- **Tasks:** 2 (TDD RED + TDD GREEN)
- **Files modified:** 2

## Accomplishments

- Added `queryDriftOpenapi` export to server.js with full pairwise/hub-and-spoke comparison strategy ported from scripts/drift-openapi.sh
- Registered `drift_openapi` as the third drift MCP tool alongside drift_versions and drift_types
- Implemented graceful degradation: when oasdiff is not installed, returns INFO finding instead of crashing
- Added `tool_available` boolean field so agents can distinguish "no specs found" from "oasdiff not installed"
- All 6 queryDriftOpenapi tests pass; all 19 drift tool tests pass (7 versions + 6 types + 6 openapi)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing drift_openapi tests (TDD RED)** - `2583169` (test)
2. **Task 2: Implement queryDriftOpenapi and register drift_openapi tool (TDD GREEN)** - `fe43ccc` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks had 2 commits — test RED then implementation GREEN_

## Files Created/Modified

- `worker/mcp/server.js` - Added OPENAPI_CANDIDATES, findOpenApiSpec(), compareOpenApiSpecs(), queryDriftOpenapi(), and drift_openapi server.tool() registration
- `worker/mcp/server-drift.test.js` - Added queryDriftOpenapi to import, MINIMAL_OPENAPI_SPEC fixture, 6 queryDriftOpenapi tests

## Decisions Made

- Used hub-and-spoke for N>5 repos with specs — prevents O(N^2) oasdiff calls for large codebases
- 5-second timeout on oasdiff execSync prevents MCP server from hanging on slow/large spec files
- `tool_available` boolean field enables agents to take different actions based on oasdiff availability

## Deviations from Plan

None - plan executed exactly as written. Plan 02's collectFiles, detectRepoLanguage, queryDriftTypes, and drift_types tool were already present in server.js (added by a prior session), so no blocking prerequisite needed to be added.

## Issues Encountered

- The test runner hung when run without a timeout (30-60s) due to the MCP server's `await server.connect(transport)` at module-level. The tests all pass when run with `timeout 60 node --test ...`. This is a pre-existing behavior in the test setup, not introduced by this plan.

## Next Phase Readiness

- All three drift tools (drift_versions, drift_types, drift_openapi) are now registered and tested
- Phase 48 implementation complete — all MCP drift tools shipped
- No blockers for subsequent phases

---
*Phase: 48-mcp-drift-tools*
*Completed: 2026-03-20*

## Self-Check: PASSED

- worker/mcp/server.js: FOUND
- worker/mcp/server-drift.test.js: FOUND
- .planning/phases/48-mcp-drift-tools/48-03-SUMMARY.md: FOUND
- Commit 2583169 (test RED): FOUND
- Commit fe43ccc (feat GREEN): FOUND
- queryDriftOpenapi export in server.js: FOUND
