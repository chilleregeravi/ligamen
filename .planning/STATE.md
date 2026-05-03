---
gsd_state_version: 1.0
milestone: null
milestone_name: null
status: v0.1.5 shipped (codebase). Awaiting next milestone definition. Hub deploy of arcanon-hub THE-1030 is the one gate to flip the deferred operator e2e walkthroughs to PASS.
stopped_at: v0.1.5 milestone closed via /gsd-complete-milestone — codebase shipped (PR #23, merge commit 525a160), tag created. Hub-side THE-1030 not yet deployed; marketplace publication held back until hub is reachable.
last_updated: "2026-04-30T19:30:00Z"
last_activity: 2026-04-30 -- /gsd-complete-milestone v0.1.5 — milestone archived to .planning/milestones/v0.1.5-* + ROADMAP collapsed + tag created
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-30 after v0.1.5)

**Core value:** Cross-repo service dependency intelligence with zero-leak privacy and a credential model that "just works" on first install — once the hub is reachable.
**Current focus:** v0.1.5 shipped to main. Awaiting arcanon-hub THE-1030 deploy + 3 bundled operator walkthroughs. Marketplace publication held until hub is functional. Next milestone TBD.

## Current Position

Milestone: none active (v0.1.5 archived 2026-04-30)
Phase: none
Status: post-milestone close — ready for `/gsd-new-milestone`

## Performance Metrics

**Velocity:**

- Total plans completed: 233 (v1.0–v5.8.0 + v0.1.0 + v0.1.1 12 + v0.1.2 9 + v0.1.3 14 + v0.1.4 21 + v0.1.5 5)
- Total milestones shipped: 24 (Ligamen v1.0–v5.8.0 + Arcanon v0.1.0..v0.1.5)

## Accumulated Context

### Cross-Milestone Decisions (durable)

- **Single credential triple in `~/.arcanon/config.json`** (apiKey + hubUrl + default_org_id). No multi-cred map. THE-1030 personal-credential model: one key serves all authorized orgs.
- **Mask `$HOME` at egress seams, not in DB.** DB needs absolute paths for git ops; the boundary is the wire, not the store. Single primitive (`maskHomeDeep`) wrapped at every egress seam, single seam per file.
- **CLI exit-code-as-action pattern** (exit 7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel) for slash-command-markdown ↔ Node-CLI re-entry across user prompts. Established Phase 125 cmdLogin; reusable for any future CLI flow needing human-in-the-loop choice.
- **Centralized error-code → message map** (`HUB_ERROR_CODE_MESSAGES` in `client.js`): single `Object.freeze` constant; UI surfaces just print the message. New error codes added in one place.
- **Nested-object additive JSON contract:** when extending a `--json` command output, nest new structured data under a new top-level key rather than spreading flat fields — protects existing consumers.
- **`hub.evidence_mode` defaults to `"full"`** for back-compat; `"hash-only"` and `"none"` are opt-in.
- **Shadow-scan namespace at `$ARCANON_DATA_DIR/projects/<hash>/impact-map-shadow.db`**; atomic promote = backup + swap, WAL sidecars renamed alongside main DB.
- **`/arcanon:view` ships as a pure markdown command** (no Node handler) per dispatch-precedence constraint. Negative regression test guards against future `view: cmdView` in `hub.js HANDLERS`.
- **`ARCANON_TEST_AGENT_RUNNER` env-var stub** in `worker/index.js` is the canonical mechanism for tests that drive scans inside the worker; production never sets it.
- **Live DB reads via fresh better-sqlite3 handle** (NOT through `getQueryEngine` pool) for shadow workflows — going through pool flips `journal_mode` and breaks byte-identity.
- **`evictLiveQueryEngine` clears BOTH the pool.js Map AND the database.js _db singleton** via `_resetDbSingleton` export.
- **Three-value crossing semantics** (external/cross-service/internal) with post-scan reconciliation that downgrades false externals.
- **Externals catalog ships as YAML data**, loader accepts both `entries:` and `externals:` top-level keys, both map and list forms.
- **Pure-bash PreToolUse impact hook** (no Node cold-start). p99 <50ms Linux, ~130ms macOS (BSD fork overhead caveat).

### Blockers/Concerns

- **arcanon-hub THE-1030 deploy outstanding.** v0.1.5 plugin codebase ships expecting the hub to enforce `X-Org-Id` and serve `whoami`. Until that deploys, the hub-half of the product (login round-trip + sync upload) is non-functional. Local features (`/arcanon:map`, `/arcanon:impact`, `/arcanon:list`, `/arcanon:diff`, `/arcanon:export`, `/arcanon:doctor`, `/arcanon:view`) work standalone.
- macOS HOK-06 hook p99 latency caveat — platform constraint carried over from v0.1.1; CI uses threshold=100, not a regression.

## Deferred Items

| Category | Item | Status |
|----------|------|--------|
| uat_gap | v0.1.4 Phase 114: 114-UAT.md (7 pending operator scenarios — cold-start, list, view, doctor x4) | testing — not a release blocker |
| checkpoint_deferred | v0.1.5 Phase 125 / 125-01 Task 4: Manual login walkthrough (8 e2e steps against deployed hub) | pending arcanon-hub THE-1030 deploy |
| checkpoint_deferred | v0.1.5 Phase 125 / 125-02 Task 4: Manual /arcanon:status Identity block + docs read-through | pending arcanon-hub THE-1030 deploy |
| checkpoint_deferred | v0.1.5 Phase 127 / 127-01 Task 4: VER-04 4-step e2e walkthrough (login + status + MCP zero-/Users/ + /arcanon:sync server-side X-Org-Id proof) | pending arcanon-hub THE-1030 deploy |
| follow_up | Mask `data_dir` + `config_file` in cmdStatus (`hub.js:384-385`) — pre-existing v0.1.4 leak, out of v0.1.5 PII charter, suggested next-milestone debt | not started |
| follow_up | Soften marketplace.json description ("syncs to Arcanon Hub" → "with optional sync to Arcanon Hub") until hub is reachable | not started |
| follow_up | Duplicate JSDoc block at `auth.js:174` — orphan from a refactor; trivial cleanup | not started |

The 3 v0.1.5 deferred operator walkthroughs all unblock together when arcanon-hub THE-1030 deploys. Bundle into a single operator session post-deploy, update each phase's SUMMARY with PASS marks.

## Session Continuity

Last session: 2026-04-30T19:30:00Z
Stopped at: /gsd-complete-milestone v0.1.5 — milestone archived, ROADMAP collapsed, REQUIREMENTS.md removed, tag created. Codebase shipped to main (merge commit 525a160 from PR #23).
Resume file: none — pick up via `/gsd-new-milestone` to start the next milestone, or wait for arcanon-hub THE-1030 deploy + run the 3 bundled operator walkthroughs to retire the deferred items.
