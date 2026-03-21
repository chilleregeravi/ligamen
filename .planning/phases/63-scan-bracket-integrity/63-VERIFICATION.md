---
phase: 63-scan-bracket-integrity
verified: 2026-03-21T00:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 63: Scan Bracket Integrity Verification Report

**Phase Goal:** POST /scan applies beginScan/endScan bracket; legacy NULL scan_version_id rows garbage collected after successful scan
**Verified:** 2026-03-21
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a full scan completes, services/connections from prior scans not touched in the new scan are absent from /graph | VERIFIED | `endScan()` calls `_stmtDeleteStaleConnections` and `_stmtDeleteStaleServices` (non-null scan_version_id != current) after `persistFindings`; plus the new NULL GC step removes legacy rows |
| 2 | If a scan is interrupted or fails, the prior scan's data remains intact — no partial updates visible | VERIFIED | Inner try/catch in `http.js` rethrows on `persistFindings` failure; `endScan` is explicitly NOT called on failure path (comment confirmed in source), leaving prior-scan rows intact |
| 3 | Every POST /scan call stamps services and connections with a real scan_version_id (never null) | VERIFIED | `http.js` line 190: `const scanVersionId = qe.beginScan(repoId)` then line 192: `qe.persistFindings(repoId, findings, commit \|\| null, scanVersionId)` — 4-arg call with non-null ID |
| 4 | Running a full scan on a repo with pre-existing NULL scan_version_id rows leaves no NULL scan_version_id rows in services or connections for that repo | VERIFIED | `_stmtDeleteNullConnections` and `_stmtDeleteNullServices` called in `endScan()` lines 659-660; Test A and Test B both PASS confirming behavior |
| 5 | The /graph response returns only rows belonging to the latest scan bracket — no ghost rows from previous runs | VERIFIED | Combined effect of stale-row deletion (non-null) + NULL GC in `endScan()`; all 27 http.test.js tests pass including `/graph` tests |
| 6 | Rows for OTHER repos are unaffected by a NULL GC run on a given repo | VERIFIED | `_stmtDeleteNullConnections` uses `repo_id = ?` predicate in subquery; `_stmtDeleteNullServices` uses `repo_id = ?`; Test C confirms repo B's NULL rows survive after endScan on repo A |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/ligamen/worker/server/http.js` | POST /scan handler wrapped in beginScan/endScan bracket | VERIFIED | Lines 190-193: `beginScan` called before `persistFindings`, `endScan` called after on success only |
| `plugins/ligamen/worker/server/http.test.js` | Tests proving bracket is applied and scanVersionId passed to persistFindings | VERIFIED | 3 bracket-specific tests: existing test updated with `beginScan`/`endScan` stubs, plus 2 new tests (bracket order verification; endScan-skip-on-failure) |
| `plugins/ligamen/worker/db/query-engine.js` | `endScan()` with additional DELETE for NULL scan_version_id rows after successful bracket close | VERIFIED | `_stmtDeleteNullConnections` and `_stmtDeleteNullServices` declared in constructor (lines 330-337); called in `endScan()` (lines 659-660) |
| `plugins/ligamen/worker/db/query-engine-upsert.test.js` | Tests proving NULL rows are cleaned up after endScan and that other repos are unaffected | VERIFIED | Tests A, B, C present and all PASS |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `http.js POST /scan` | `qe.beginScan(repoId)` | called before persistFindings | WIRED | Line 190: `const scanVersionId = qe.beginScan(repoId)` |
| `http.js POST /scan` | `qe.endScan(repoId, scanVersionId)` | called after persistFindings in success branch | WIRED | Line 193: `qe.endScan(repoId, scanVersionId)` inside inner try, NOT in finally |
| `query-engine.js endScan()` | `DELETE FROM connections WHERE source/target in NULL-scan_version services for repo` | executed after `_stmtDeleteStaleServices` | WIRED | Line 659: `this._stmtDeleteNullConnections.run(repoId, repoId)` with correct SQL using `scan_version_id IS NULL` |
| `query-engine.js endScan()` | `DELETE FROM services WHERE repo_id = ? AND scan_version_id IS NULL` | executed after NULL connection GC | WIRED | Line 660: `this._stmtDeleteNullServices.run(repoId)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| SCAN-01 | 63-01-PLAN.md | POST /scan endpoint uses beginScan/endScan bracket for stale data cleanup (THE-930) | SATISFIED | `beginScan`/`endScan` wired in `http.js`; 2 new tests in `http.test.js`; all 27 tests pass |
| SCAN-02 | 63-02-PLAN.md | Legacy NULL scan_version_id rows cleaned up after successful full scan (THE-931) | SATISFIED | `_stmtDeleteNullConnections`/`_stmtDeleteNullServices` added to `endScan()`; Tests A, B, C all PASS |

Both requirements marked complete in `.planning/REQUIREMENTS.md` (lines 12-13 checked [x]).

### Anti-Patterns Found

None detected.

- No TODO/FIXME/HACK/PLACEHOLDER comments in modified files
- No stub implementations (`return null`, `return {}`, empty handlers)
- `endScan` is NOT called on failure path — this is intentional and tested (not a stub)
- `persistFindings` receives 4 args including `scanVersionId` — not 3-arg stub call

### Human Verification Required

None. All goal-critical behaviors are verifiable programmatically:

- Bracket order (beginScan before persistFindings before endScan): confirmed by grep of `http.js`
- endScan skipped on failure: confirmed by test "POST /scan does not call endScan when persistFindings throws" (PASS)
- NULL GC isolation by repo: confirmed by Test C (PASS)
- All 27 http.test.js tests pass (exit 0)
- All 11 query-engine-upsert tests pass including 3 new NULL GC tests (exit 0)

### Test Run Results

**http.test.js:** 27 tests, 0 failures, 0 skipped

Relevant new tests:
- `POST /scan persists findings and returns 200` — updated to stub beginScan/endScan, PASS
- `POST /scan applies beginScan/endScan bracket with correct scanVersionId` — PASS
- `POST /scan does not call endScan when persistFindings throws` — PASS

**query-engine-upsert.test.js:** 11 tests, 0 failures

New tests:
- `Test A: endScan() removes legacy NULL scan_version_id service for the scanned repo` — PASS
- `Test B: endScan() removes connections referencing NULL scan_version_id services` — PASS
- `Test C: endScan() on repo A does not delete NULL rows for repo B` — PASS

### Commits Verified

All three phase commits exist in git history:

| Commit | Description |
|--------|-------------|
| `8a79893` | feat(63-01): wrap POST /scan in beginScan/endScan bracket |
| `9fd1ca4` | feat(63-02): add NULL scan_version_id GC statements and calls to endScan() |
| `75f3af2` | test(63-02): add NULL GC tests and fix buildDb() migration coverage |

---

_Verified: 2026-03-21_
_Verifier: Claude (gsd-verifier)_
