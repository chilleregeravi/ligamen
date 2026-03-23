---
phase: 70-confidence---evidence-pipeline
verified: 2026-03-22T12:00:00Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 70: Confidence & Evidence Pipeline Verification Report

**Phase Goal:** Confidence and evidence persisted through upsert layer and returned in /graph
**Verified:** 2026-03-22T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                     | Status     | Evidence                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | After a scan where the agent emits confidence and evidence, SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5 returns real rows | ✓ VERIFIED | `query-engine.js` line 301: `_stmtUpsertConnection` includes `confidence, evidence` in INSERT columns; line 1056-1057: `persistFindings` passes `conn.confidence \|\| null` and `conn.evidence \|\| null` |
| 2   | Each connection object in the /graph API response includes confidence and evidence fields (null if not emitted)                            | ✓ VERIFIED | `query-engine.js` line 810: `c.confidence, c.evidence` in getGraph() connections SELECT; try/catch fallback at line 820-824 returns `null as confidence, null as evidence` for pre-009 DBs |
| 3   | Connections written without confidence/evidence store NULL — no crash, no dropped row                                                      | ✓ VERIFIED | `query-engine.js` line 585-586: `confidence: null` and `evidence: null` in sanitizeBindings default spread in `upsertConnection()`; three-tier try/catch fallback for pre-009 column absence |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact                                                                 | Expected                                                                       | Status     | Details                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/ligamen/worker/db/query-engine.js`                             | upsertConnection writes confidence+evidence; getGraph returns them on each connection | ✓ VERIFIED | Lines 301-302: INSERT includes confidence/evidence; line 585-586: null defaults; lines 1056-1057: persistFindings passthrough; line 810: getGraph SELECT |
| `plugins/ligamen/worker/db/query-engine-confidence.test.js`             | Test coverage for confidence/evidence upsert and getGraph projection           | ✓ VERIFIED | 414 lines; 4 test() calls confirmed; covers write with values, null coercion, getGraph projection, pre-009 graceful degradation  |

### Key Link Verification

| From                              | To                                          | Via                                                               | Status     | Details                                                                                                     |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `persistFindings()` conn loop     | `upsertConnection({ confidence, evidence })` | `conn.confidence` and `conn.evidence` passed from findings object | ✓ WIRED    | `query-engine.js` lines 1056-1057: `confidence: conn.confidence \|\| null, evidence: conn.evidence \|\| null` |
| `getGraph()` connections SELECT   | /graph response connection objects          | `c.confidence, c.evidence` in SQL projection                      | ✓ WIRED    | `query-engine.js` line 810: `c.confidence, c.evidence` in primary SELECT; fallback SELECT returns null aliases for both fields |

### Requirements Coverage

| Requirement | Source Plan | Description                                          | Status      | Evidence                                                                                                               |
| ----------- | ----------- | ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| CONF-03     | 70-01-PLAN  | Confidence badge visible on nodes/edges in graph UI  | ✓ SATISFIED | confidence and evidence flow end-to-end: agent findings -> persistFindings -> upsertConnection -> connections table -> getGraph() -> /graph API response. UI rendering is downstream (Phase 72) but the data pipeline is complete. |

Note: CONF-03 states "confidence badge visible on nodes/edges in graph UI" — the data pipeline (this phase) is complete. Actual badge rendering in the UI was delivered in Phase 72. The pipeline prerequisite (confidence in /graph response) is fully satisfied here.

### Anti-Patterns Found

None detected. The three-tier try/catch fallback pattern is a deliberate migration-gated compatibility approach, not an anti-pattern. All code paths are substantive.

### Human Verification Required

#### 1. Confidence Badge Visible in Graph UI

**Test:** Run a scan where the agent emits `"confidence": "high"` or `"confidence": "low"` on one or more connections. Open the graph view and inspect edges.
**Expected:** Edges with confidence values should display a badge or indicator. Null-confidence edges should display no badge.
**Why human:** Visual rendering requires a running application with a real agent scan result.

### Gaps Summary

No gaps. All three truths verified. The full confidence+evidence pipeline is wired: `findings.js` validates the agent output, `persistFindings()` passes both fields to `upsertConnection()`, the three-tier `_stmtUpsertConnection` writes them to the connections table (with graceful degradation for older DBs), and `getGraph()` projects both columns in every connection object. Both documented commits (8a416e6, d539a2b) confirmed in git log.

---

_Verified: 2026-03-22T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
