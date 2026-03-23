---
phase: 82-reliability-hardening
plan: 01
subsystem: testing
tags: [json-parsing, file-traversal, security, scan-pipeline]

# Dependency graph
requires:
  - phase: 81-data-integrity-port
    provides: scan pipeline enrichment architecture that auth-db-extractor.js is part of
provides:
  - Multi-strategy JSON extraction from agent output (fenced block, raw JSON, prose-wrapped JSON)
  - Traversal guards for auth-db-extractor (EXCLUDED_DIRS, depth limit, file size cap)
affects: [83-reliability-hardening, any scan pipeline consumer of parseAgentOutput]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-strategy fallback chain for agent output parsing: fenced block → raw JSON.parse → substring extraction"
    - "Traversal guard constants exported for test access (EXCLUDED_DIRS, MAX_TRAVERSAL_DEPTH, MAX_FILE_SIZE)"
    - "statSync size check before readFileSync to prevent unbounded file reads"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/findings.js
    - plugins/ligamen/worker/scan/findings.test.js
    - plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js
    - plugins/ligamen/worker/scan/enrichment/auth-db-extractor.test.js

key-decisions:
  - "parseAgentOutput fallback chain: fenced block regex tried first; if match found with bad JSON, fail immediately (don't try other strategies) — prevents false positives from malformed fenced blocks"
  - "collectScanFiles now walks full repo tree recursively instead of fixed SCAN_DIRS list — catches auth/db in any subdir within depth limit"
  - "MAX_FILE_SIZE guard placed in detectAuth and detectDbFromSources (not collectScanFiles) — files collected but skipped at read time to avoid two stat calls per file"
  - "EXCLUDED_DIRS, MAX_TRAVERSAL_DEPTH, MAX_FILE_SIZE exported for test access per plan spec"

patterns-established:
  - "Deviation Rule 1: Updated 2 existing test assertions in findings.test.js that checked exact error message strings — strings changed when new fallback chain was implemented"

requirements-completed: [REL-01, REL-03]

# Metrics
duration: 15min
completed: 2026-03-22
---

# Phase 82 Plan 01: Reliability Hardening — Agent Output Parsing + Traversal Guards Summary

**3-strategy parseAgentOutput fallback chain (fenced block → raw JSON → substring) and auth-db-extractor traversal guards (EXCLUDED_DIRS, 8-level depth cap, 1MB file size cap)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-22T20:54:20Z
- **Completed:** 2026-03-22T20:58:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- parseAgentOutput now handles agent output in three formats: fenced code block, raw JSON, and prose-wrapped JSON — preventing scan failures from agent format variations
- Malformed output returns a truncated 200-character preview in the error message for diagnostics
- auth-db-extractor now skips node_modules, .git, vendor, dist, build, __pycache__, .venv, venv directories entirely
- auth-db-extractor stops descending at depth 8, preventing unbounded recursion on deep repos
- auth-db-extractor skips files over 1MB before attempting readFileSync, preventing OOM on large generated files

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: parseAgentOutput multi-strategy tests** - `b396b1a` (test)
2. **Task 1 GREEN: Multi-strategy parseAgentOutput implementation** - `87edb9c` (feat)
3. **Task 2 RED: Traversal guard tests** - `79656cd` (test)
4. **Task 2 GREEN: Traversal guards implementation** - `63297a5` (feat)

_Note: TDD tasks have multiple commits (test → feat)_

## Files Created/Modified
- `plugins/ligamen/worker/scan/findings.js` - 3-strategy parseAgentOutput fallback chain replacing single-strategy fenced-only parsing
- `plugins/ligamen/worker/scan/findings.test.js` - 7 new tests in describe("parseAgentOutput multi-strategy"), updated 2 existing error-message assertions
- `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` - EXCLUDED_DIRS, MAX_TRAVERSAL_DEPTH, MAX_FILE_SIZE constants exported; collectSourceFiles rewritten recursive with depth+exclusion guards; collectScanFiles rewritten to walk full repo tree; statSync size guards in detectAuth and detectDbFromSources
- `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.test.js` - 10 new tests covering all traversal guards (constants, excluded dirs, depth limit, file size cap); updated import to include exported constants

## Decisions Made
- parseAgentOutput: if Strategy 1 (fenced block) matches but JSON is invalid, return immediately with parse error — do not attempt strategies 2/3. Rationale: agent explicitly used markdown fencing, so a parse failure on the extracted content is a definitive error.
- collectScanFiles changed from fixed SCAN_DIRS to full recursive walk with guards — aligns with intent to find auth/db signals anywhere in the repo within the depth limit.
- File size guard placed at read time (in detectAuth/detectDbFromSources), not at collection time — avoids double stat call per file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated 2 existing test assertions in findings.test.js**
- **Found during:** Task 1 GREEN (parseAgentOutput implementation)
- **Issue:** Two existing tests asserted exact error message "no JSON block found in agent output". After the multi-strategy implementation, prose-only and empty-string inputs now return "no parseable JSON in agent output (preview: ...)" since strategies 2/3 attempt and fail before the error is generated.
- **Fix:** Changed both assertions to `assert.ok(result.error.includes("no parseable JSON") || result.error.includes("no JSON block"), ...)` — accepts both old and new error formats.
- **Files modified:** plugins/ligamen/worker/scan/findings.test.js
- **Verification:** All 45 tests pass
- **Committed in:** b396b1a (Task 1 RED commit — tests updated before implementation)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug: test assertion mismatch with new behavior)
**Impact on plan:** Necessary to keep test suite accurate. No scope creep.

## Issues Encountered
None — plan executed cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- parseAgentOutput hardened: handles 3 agent output formats, malformed output diagnosed with preview
- auth-db-extractor hardened: traversal bounded by dir exclusion, depth limit, and file size cap
- Ready for Phase 82 Plan 02 (next plan in reliability hardening phase)

---
*Phase: 82-reliability-hardening*
*Completed: 2026-03-22*
