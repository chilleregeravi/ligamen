---
gsd_state_version: 1.0
milestone: v0.1.5
milestone_name: Identity & Privacy
status: Phases 123-124 complete (PII masking + hub auth core; 12 REQs closed; all 7 risk mitigations green). Doctor check 8 regression caught and fixed inline (orgIdRequired:false opt-out). Advancing to Phase 125 (login & status UX).
stopped_at: Phase 124 complete; advancing to Phase 125
last_updated: "2026-04-28T19:45:00.000Z"
last_activity: 2026-04-28
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 5
  completed_plans: 2
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-27)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** v0.1.5 — Identity & Privacy (THE-1029 hub auth + THE-1031 PII masking)

## Current Position

Phase: 125 (Login & Status UX) — not started
Plan: —
Status: Phases 123-124 complete (8 + 7 commits; PII-01..07 + AUTH-01..05 mitigations green; doctor check 8 regression fix `e107463`). Advancing to Phase 125 (login flow + status Identity block + error-code parser + docs).
Last activity: 2026-04-28 — Phase 124 finalized inline after executor stalled; node 820/821, doctor.bats 12/12.

## Performance Metrics

**Velocity:**

- Total plans completed: 228 (v1.0–v5.8.0 + v0.1.0 + v0.1.1 12 + v0.1.2 9 + v0.1.3 14 + v0.1.4 21)
- Total milestones shipped: 23 (Ligamen v1.0–v5.8.0 + Arcanon v0.1.0 + v0.1.1 + v0.1.2 + v0.1.3 + v0.1.4)

## Accumulated Context

### Cross-Milestone Decisions (durable)

- **Single credential triple in `~/.arcanon/config.json`** (apiKey + hubUrl + default_org_id). No multi-cred map. THE-1030 personal-credential model: one key serves all authorized orgs.
- **`hub.evidence_mode` defaults to `"full"` for back-compat.** `"hash-only"` and `"none"` are opt-in.
- **Shadow-scan namespace at `$ARCANON_DATA_DIR/projects/<hash>/impact-map-shadow.db`** (sibling of `impact-map.db`). Atomic promote = backup + swap, WAL sidecars renamed alongside main DB.
- **`/arcanon:view` ships as a pure markdown command** (no Node handler) per dispatch-precedence constraint. Negative regression test guards against future contributors adding `view: cmdView` to `hub.js HANDLERS`.
- **`ARCANON_TEST_AGENT_RUNNER` env-var stub** in `worker/index.js` is the canonical mechanism for tests that drive scans inside the worker; production never sets it.
- **Live DB reads via fresh better-sqlite3 handle** (NOT through `getQueryEngine` pool) for shadow workflows — going through pool flips `journal_mode` and breaks byte-identity.
- **`evictLiveQueryEngine` clears BOTH the pool.js Map AND the database.js _db singleton** via `_resetDbSingleton` export.
- **Three-value crossing semantics** (external/cross-service/internal) with post-scan reconciliation that downgrades false externals.
- **Externals catalog ships as YAML data**, loader accepts both `entries:` and `externals:` top-level keys, both map and list forms.
- **Pure-bash PreToolUse impact hook** (no Node cold-start). p99 <50ms Linux, ~130ms macOS (BSD fork overhead caveat).

### v0.1.5 Decisions (in-flight, pending validation)

- **Auto-default-org via `whoami` at login** — forcing user to type a UUID is hostile; hub knows which orgs the key is authorized for.
- **Mask `$HOME` at egress seams, not in DB** — DB needs absolute paths for git operations; masking-at-egress preserves runtime correctness while closing the third-party leak (MCP → Anthropic).
- **THE-1029 ships only after hub-side THE-1030 lands** — brief upload outage between merges accepted (nothing has shipped publicly).
- **Phase 123 (PII) ordered first** — independent of hub-side THE-1030; ships even if the hub PR slips. Phases 124-127 sequenced behind the hub deploy.
- **AUTH-01 + AUTH-03 + AUTH-05 land in one phase (124)** — coupled signature/contract block per predecessor-audit C1+X1; AUTH-02 included in same phase since AUTH-06 depends on it.
- **`hasCredentials()` semantics in C2** — to be decided at Phase 124 plan-phase: option (a) tolerate missing org_id and defer throw to upload time, OR option (b) tighten and surface a manager.js WARN when auto-sync gates off. Plan-phase picks one explicitly.
- **AUTH-08 server error JSON shape** — coordinate at Phase 125 plan-phase with arcanon-hub THE-1030 owner; expected RFC 7807 `{type, title, status, detail, code}`.
- **PII-04 logger seam** — single masking edit at `worker/lib/logger.js:42–68` between `Object.assign` and `JSON.stringify`; NOT 30 call-site edits.
- **PII-03 routes** — REQUIREMENTS.md mentions `/api/repos`; the actual surface is `GET /projects` plus `repos[].path` arrays nested inside `/api/scan-freshness` and `/graph` response bodies. Plan must target the correct routes.

### Pending Todos

Phase 124 (Hub Auth Core) is next — gated on arcanon-hub THE-1030 deploy.

### Blockers/Concerns

- **THE-1029 hard-blocked by arcanon-hub THE-1030** (server-side personal-credential rewrite + `whoami` endpoint + `X-Org-Id` enforcement). Coordinate merge order so the hub PR lands first. Phase 123 (PII) is independent and can ship before the hub deploy lands.
- macOS HOK-06 hook p99 latency caveat — platform constraint carried over from v0.1.1; CI uses threshold=100, not a regression.

## Deferred Items

Carried forward from v0.1.4 close (2026-04-27):

| Category | Item | Status |
|----------|------|--------|
| uat_gap | Phase 114: 114-UAT.md (7 pending operator scenarios — cold-start, list, view, doctor x4) | testing |

These are operator-facing manual scenarios — phase 114 automated VERIFICATION.md is `passed` (31/31 bats green); the UAT is the operator's own "feels-right" gate, not a release blocker. Run them in a real terminal at your convenience and update `114-UAT.md` results in place.

## Session Continuity

Last session: 2026-04-28T15:55:00.000Z
Stopped at: Phase 123 (PII Path Masking) complete (commit c9b3527 SUMMARY); next is Phase 124 (Hub Auth Core), gated on arcanon-hub THE-1030 deploy
Resume file: .planning/phases/123-pii-path-masking/123-SUMMARY.md → .planning/ROADMAP.md (Phase 124 details)
