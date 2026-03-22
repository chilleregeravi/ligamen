---
phase: 81-data-integrity-port
plan: "01"
subsystem: query-engine
tags: [data-integrity, sqlite, upsert, fk-cleanup, regression-tests]
dependency_graph:
  requires: []
  provides: [DINT-01-fix, DINT-02-fix]
  affects: [plugins/ligamen/worker/db/query-engine.js, plugins/ligamen/worker/db/query-engine-upsert.test.js]
tech_stack:
  added: []
  patterns: [SELECT-after-upsert, schema-cleanup-before-delete]
key_files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/query-engine-upsert.test.js
decisions:
  - "DINT-02: upsertRepo queries SELECT id FROM repos WHERE path after run() — lastInsertRowid is 0 on ON CONFLICT UPDATE"
  - "DINT-01: endScan schema pre-cleanup uses scan_version_id = ? only (no OR IS NULL) so NULL-versioned connection schemas are deleted before the connections themselves"
metrics:
  duration: "~10 min"
  completed: "2026-03-22"
  tasks_completed: 2
  files_modified: 2
---

# Phase 81 Plan 01: Data Integrity Port Summary

Port DINT-01 (endScan FK cleanup) and DINT-02 (upsertRepo ID return) fixes plus regression tests from the plugin cache to the source repo.

## What Was Built

Both bug fixes validated in the plugin cache at `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/` were ported byte-for-byte to the source repo.

**DINT-02 (upsertRepo ID):** `upsertRepo()` previously returned `result.lastInsertRowid` which is `0` when `ON CONFLICT` triggers an `UPDATE` (no insert). The fix drops the `result` variable and follows the upsert with `SELECT id FROM repos WHERE path = ?` to always return the correct row id.

**DINT-01 (endScan FK cleanup):** `endScan()` schema pre-cleanup used `WHERE scan_version_id = ? OR scan_version_id IS NULL` to determine which connections to keep. This was wrong — NULL-versioned connections are about to be deleted, so their schemas must also be deleted first. The fix changes both subqueries to `WHERE scan_version_id = ?` only and updates the comment block accordingly.

**Regression tests:**
- **Test 6**: verifies `upsertRepo` returns correct id on both insert and `ON CONFLICT UPDATE`, and that `beginScan` succeeds with the returned id
- **Test B2**: verifies `endScan` deletes schemas referencing NULL-versioned connections without throwing `SQLITE_CONSTRAINT_FOREIGNKEY`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Port DINT-01 endScan FK fix + DINT-02 upsertRepo ID fix | f6088f4 | plugins/ligamen/worker/db/query-engine.js |
| 2 | Port Test 6 (upsertRepo ID) + Test B2 (endScan FK) | 76d0304 | plugins/ligamen/worker/db/query-engine-upsert.test.js |

## Verification

- `diff query-engine.js cache/query-engine.js` — no output (identical)
- `diff query-engine-upsert.test.js cache/query-engine-upsert.test.js` — no output (identical)
- `node --test worker/db/query-engine-upsert.test.js` — 1 suite, 0 failures, all 15 console PASSes

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `plugins/ligamen/worker/db/query-engine.js` — modified and committed f6088f4
- [x] `plugins/ligamen/worker/db/query-engine-upsert.test.js` — modified and committed 76d0304
- [x] Both diffs against cache are empty
- [x] All tests pass (0 failures)
