# Project Research Summary

**Project:** Ligamen v5.3.0 — Scan Intelligence & Enrichment
**Domain:** Claude Code plugin — post-scan enrichment pipeline, schema surfacing, confidence/evidence persistence, service ownership and auth/DB metadata
**Researched:** 2026-03-21
**Confidence:** HIGH (based on direct codebase inspection plus verified ecosystem patterns)

## Executive Summary

Ligamen v5.3.0 is a subsequent-milestone enrichment layer added to an already-shipping Claude Code plugin. The core scan pipeline (MCP server with 8 tools, SQLite with migrations 001-008, Fastify HTTP server, Canvas graph UI, agent-driven scanning with beginScan/endScan brackets) is fully validated and unchanged. This milestone's goal is to close four specific gaps: (1) confidence and evidence fields that the agent already emits but the DB silently drops, (2) schemas and fields already collected but never displayed in the UI, (3) ownership, auth mechanism, and DB backend metadata that currently has no extraction path, and (4) a quality-gate spin-out. The right approach is an additive post-scan enrichment pass that writes side-car data to the existing `node_metadata` table — never touching the primary scan tables, never triggering scan brackets.

The recommended architecture is a sequential enrichment pass (codeowners.js, auth-db-extractor.js) wired into manager.js between parseAgentOutput() and persistFindings(), with a single Migration 009 that adds `confidence TEXT` and `evidence TEXT` to the `connections` table plus denormalized `owner`, `auth_mechanism`, and `db_backend` columns to `services`. The only new production dependency is `picomatch ^4.0.3` for CODEOWNERS glob matching — everything else is Node.js built-ins and existing packages. Schema visualization uses two new DB tables (`schemas`, `schema_fields`) already implied by the existing schema but not yet wired into the `/graph` API or detail panel.

The critical risk class for this milestone is pipeline completeness: confidence and evidence were validated for years but never persisted; the same pattern threatens to repeat unless each new field is verified end-to-end (agent output — findings.js — upsert — DB column — getGraph() — detail panel) before shipping. A secondary risk is schema data payload size — embedding schemas in the `/graph` response would bloat a 30-node graph from ~10KB to ~200KB and inject schema data into the D3 simulation worker on every tick. The mitigation is strict: schema data must never enter `getGraph()` as per-node data; instead it is attached as a top-level `schemas_by_connection` map.

## Key Findings

### Recommended Stack

The existing stack is unchanged: Node.js >=20 ESM, better-sqlite3 ^12.8.0, Fastify ^5.8.2, zod ^3.25.0, @modelcontextprotocol/sdk ^1.27.1. The only new production dependency is `picomatch ^4.0.3` for CODEOWNERS glob matching (zero dependencies, actively maintained, used by fast-glob/jest/chokidar — already likely an indirect dep; check before adding explicitly). Auth and DB detection require only `fs.readFileSync` + regex — no AST parsing, no new libraries. The enrichment pass orchestration uses a simple `for...of` async loop, not a queue library.

See `.planning/research/STACK.md` for full detail including code-level patterns and alternatives considered.

**Core technologies:**
- `picomatch ^4.0.3`: CODEOWNERS glob matching — zero-dep, CJS imported via `createRequire(import.meta.url)` in ESM context, handles matchBase/dotfiles/double-glob correctly; avoids minimatch v10 ESM chain issue and the abandoned `codeowners-utils` package
- `node:fs` + `node:readline` (built-in): CODEOWNERS file discovery (three-location probe: `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`) and line-by-line parse — ~30 lines of code, no library needed
- `better-sqlite3 ^12.8.0` (existing): Migration 009 adds 2 new tables and 3 new columns to services; no breaking changes to existing queries
- `zod ^3.25.0` (existing): Optionally reuse for enricher result validation; enrichers can also return plain objects

**What NOT to use:**
- `codeowners-utils`: CJS-only, last published 2020 (5 years ago), no ESM export
- `minimatch v10+`: brace-expansion ESM chain breaking issue (GH #257); picomatch is safer with zero deps
- Tree-sitter: native binaries per language grammar (10-15MB each), overkill for regex-level auth detection
- Bull/BullMQ: queue overhead pointless for <10 enrichers per service; adds Redis dep for zero benefit
- `"unknown"` stored in DB: keep DB truthful (NULL = not yet detected); normalize to `"unknown"` string at HTTP layer with `?? 'unknown'`
- Separate worker thread for enrichment: enrichers are I/O-bound (file reads, DB writes), not CPU-bound; same worker process is correct

### Expected Features

See `.planning/research/FEATURES.md` for full dependency graph and prioritization matrix.

**Must have (table stakes — required for v5.3.0 to be complete):**
- Migration 009 — `confidence TEXT` and `evidence TEXT` on `connections`; `owner`, `auth_mechanism`, `db_backend` on `services`; new `schemas` and `schema_fields` tables with indexes
- Persist confidence + evidence — currently validated by findings.js but silently dropped at the upsert step; upsertConnection() must write both columns
- Enrichment pass architecture — `runEnrichmentPass(findings, repoPath, queryEngine)` framework wired into manager.js after parseAgentOutput(); each enricher is an isolated module; any enricher failure must be silent and graceful (try/catch in enricher.js, never abort the scan)
- CODEOWNERS enrichment pass — probe CODEOWNERS file locations; last-match-wins per GitHub spec; write to `node_metadata(view='scan', key='owner')`; denormalize first owner into `services.owner`; handle missing file gracefully
- Auth mechanism extraction — regex over entry-point files and known subdirectories (routes/, middleware/, auth/); per-language signal table covering Python, Node.js, Go, Rust; write `auth_mechanism` and `auth_confidence` to `node_metadata`; denormalize into `services.auth_mechanism`
- DB backend extraction — probe `schema.prisma` first, then `.env`/`docker-compose.yml` DATABASE_URL, then ORM imports; write `db_backend` to `node_metadata`; denormalize into `services.db_backend`
- Schema storage and display — store `schemas[]` from findings into `schemas` table + `schema_fields` join table; include in `/graph` response as `schemas_by_connection` (top-level map, not per-node); render in detail panel with field name/type/required columns
- Agent prompt improvements (source_file/target_file) — update `agent-prompt-common.md` with explicit guidance; null only acceptable for genuinely external targets
- Show "unknown" for missing metadata — normalize at HTTP layer using `?? 'unknown'`; never store `"unknown"` in DB
- Quality-gate spin-out — remove `commands/quality-gate.sh` and `skills/quality-gate.md` from this plugin; fully independent of enrichment work

**Should have (add in v5.3.x patch if time allows):**
- Confidence badge in detail panel — color-coded high/low per connection; requires migration 009 data to be present
- Evidence snippet in detail panel — expandable `<code>` block with the agent-cited code snippet; trigger: first user feedback that "I can't tell if this connection is real"
- Ownership filter in filter panel — filter graph by CODEOWNERS team; trigger: teams with >10 services

**Defer (v6+):**
- Generic `node_metadata` viewer in detail panel — needed when STRIDE/vuln views are being built
- Multi-owner display as tag list — trigger: multi-team ownership patterns surface as user pain
- Per-connection confidence timeline — requires scan version history correlation

### Architecture Approach

The enrichment pipeline slots between `parseAgentOutput()` and `persistFindings()` in manager.js. This pre-persist position lets enrichment annotate the findings object before it hits the DB, avoiding temporal coupling between enrichment and scan bracket cleanup. Enrichment data flows exclusively to `node_metadata` (via a new `upsertNodeMetadata()` method) and to denormalized nullable columns in `services` — it never touches core tables via the primary scan upsert path. The `/graph` API continues the "embed everything at load" pattern established in v2.3, but schema data attaches as a separate `schemas_by_connection` key at the graph level to keep per-node payload size bounded.

See `.planning/research/ARCHITECTURE.md` for full data flow diagrams, component integration points, build order, and anti-pattern analysis.

**Major components and their v5.3.0 changes:**
1. `scan/enrichment/enricher.js` (NEW) — orchestrates enrichment pass; called by manager.js after parseAgentOutput(); receives queryEngine for DB writes; wraps all passes in try/catch; never throws
2. `scan/enrichment/codeowners.js` (NEW) — pure file-system utility; reads CODEOWNERS; returns owner string per service root_path using picomatch; last-match-wins per GitHub spec
3. `scan/enrichment/auth-db-extractor.js` (NEW) — regex-based; scans entry-point and known middleware files; returns `{auth_mechanism, auth_confidence, db_backend}` per service; explicitly excludes test fixtures and example files
4. `db/migrations/009_enrichment.js` (NEW) — ALTER TABLE connections for confidence/evidence; ALTER TABLE services for owner/auth_mechanism/db_backend; CREATE TABLE schemas and schema_fields with indexes
5. `db/query-engine.js` (MODIFIED) — new `upsertNodeMetadata()` method; extend `persistFindings()` to write confidence/evidence; extend `getGraph()` to include schemas_by_connection and pivot node_metadata to per-service fields; add `?? 'unknown'` normalization in http.js
6. `ui/modules/detail-panel.js` (MODIFIED) — schema section, confidence badge per connection, owner/auth/db rows, "unknown" fallbacks, escapeHtml() on all new field renderings
7. `server/http.js` (NOT MODIFIED) — /graph route passes through getGraph(); no route changes needed

**Build order (dependency-driven):**
1. Migration 009 + `upsertNodeMetadata()` — foundation; all other work depends on columns/tables existing
2. `codeowners.js` and `auth-db-extractor.js` — pure utilities; build and test in isolation
3. `enricher.js` — composes utilities; depends on step 2; receives queryEngine from manager.js
4. `manager.js` modification — wire enrichment pass; single try/catch insertion point
5. `persistFindings()` modification — write confidence/evidence; depends on migration 009
6. `getGraph()` modification — include schemas_by_connection, confidence/evidence on edges, enrichment fields on services; depends on steps 1 and 5
7. `detail-panel.js` and `utils.js` — UI-only; depends on step 6; can develop against mock graph payload
8. Quality-gate spin-out — fully independent; no conflicts with steps 1-7

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for full coverage including 10 critical pitfalls, technical debt patterns, integration gotchas, security mistakes, UX pitfalls, recovery strategies, and a "looks done but isn't" verification checklist.

1. **Enrichment stomps primary scan data** — if enrichment triggers a scan bracket (beginScan/endScan), the stale cleanup deletes services not re-confirmed by the enrichment pass. Prevention: enrichment never calls beginScan/endScan; all writes go to `node_metadata` or additive nullable columns; wrap entire enrichment call in try/catch in manager.js so any failure returns original un-enriched findings. Verify: `SELECT COUNT(*) FROM services` must not decrease after an enrichment run.

2. **Confidence and evidence drop at the upsert boundary** — both fields have been validated by findings.js for multiple milestones but `_stmtUpsertConnection` never included them; they silently fall off. Prevention: add both columns in Migration 009 AND update the upsert statement atomically; verify end-to-end with `SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5` returning real rows before shipping.

3. **Schema data in getGraph() bloats response and enters simulation worker** — a 30-node graph with schemas goes from ~10KB to ~200KB; if that data passes to the D3 Web Worker it gets serialized on every simulation tick (60Hz). Prevention: schemas attach as `schemas_by_connection` at graph level, not per-node; simulation worker receives only node IDs and positions; add a payload size assertion to integration tests.

4. **Auth extraction stores credential values** — regex over source files can extract actual JWT tokens, database URLs, and API keys from test fixtures and `.env.example`. Prevention: explicitly exclude `*.test.*`, `*.example`, `*.sample` files; store only mechanism type and pattern name (never the credential value); add a validator that rejects any extracted value matching common credential patterns (length >40 random chars, `Bearer [A-Za-z0-9+/=]{20,}`).

5. **Migration guard try/catch silently drops columns** — the existing fallback pattern catches failed prepare statements but provides no observable signal if a column is missing. Prevention: after Migration 009 runs, verify with `PRAGMA table_info(connections)` that all expected columns are present; if not, throw with a clear message rather than silently falling back.

## Implications for Roadmap

Based on combined research, the build order is strictly dictated by data flow dependencies. Each phase unblocks the next and cannot be safely reordered (except quality-gate which is fully independent throughout).

### Phase 1: Foundation — Migration 009 + Storage Plumbing

**Rationale:** Everything else depends on the DB schema being correct. Migration 009 is additive-only (ALTER TABLE ADD COLUMN for nullable columns; CREATE TABLE for schemas/schema_fields) — the lowest-risk phase. `upsertNodeMetadata()` is a new method with no changes to existing methods. These two items are the prerequisite for all enrichment, confidence/evidence, and schema work.

**Delivers:** DB schema with confidence/evidence columns on connections; owner/auth_mechanism/db_backend on services; schemas and schema_fields tables with indexes; `upsertNodeMetadata()` method in query-engine.js

**Addresses:** Migration 009 (critical table stakes); Pitfalls 2, 3, 9 prevention (pipeline completeness, schema stale cleanup, migration guard)

**Avoids:** Silently dropped confidence/evidence data; schema data having nowhere to persist; try/catch migration guard hiding column omissions; picomatch package should be added to package.json in this phase

**Research flag:** Standard patterns — SQLite ALTER TABLE convention established in 001-008; no additional research needed

### Phase 2: Enrichment Architecture + CODEOWNERS Pass

**Rationale:** The enrichment framework (enricher.js) must exist before any individual enricher can be wired in. CODEOWNERS is the simplest enricher (pure file-system read + picomatch pattern match, no regex fragility) and validates the enricher signature contract and manager.js wiring before adding auth/DB complexity.

**Delivers:** `enricher.js` orchestrator wired into manager.js post-parseAgentOutput(); `codeowners.js` with picomatch glob matching; owner written to node_metadata and services.owner; enrichment is graceful-failure by design (never aborts scan)

**Addresses:** Enrichment pass architecture; CODEOWNERS extraction; ownership string normalization (store canonical GitHub handle formatted as lowercase-hyphenated `owner_key`; reject free-form strings)

**Avoids:** Pitfall 1 (enrichment stomps primary scan data) — enforced by try/catch wrapper and node_metadata-only writes; Pitfall 6 (unstructured ownership strings) — enforced by normalization at extraction time; Pitfall 7 (two-phase scan partial state) — enrichment runs synchronously within the primary scan bracket, not as a separate pass

**Research flag:** Standard patterns — CODEOWNERS format documented by GitHub/GitLab; picomatch API is well-documented; no additional research needed

### Phase 3: Auth/DB Enrichment Pass

**Rationale:** Auth and DB extraction follow the same enricher contract from Phase 2. The complexity is in the regex signal table (per-language patterns for JWT/OAuth2/session/API-key and postgres/mysql/sqlite/mongodb detection). Keeping this as a separate phase isolates auth/DB pattern iteration from the framework.

**Delivers:** `auth-db-extractor.js` with per-language regex signal tables; auth_mechanism and db_backend written to node_metadata and denormalized into services columns; auth_confidence (high/low based on whether pattern found in boundary_entry vs secondary file); credential extraction prevention

**Addresses:** Auth mechanism extraction; DB backend extraction; credential value exclusion via file-scope filtering and value-pattern validator

**Avoids:** Pitfall 4 (auth extraction stores credential values) — prevent by excluding test fixture files and validating that no extracted value matches credential patterns before DB write

**Research flag:** Likely needs post-implementation tuning — regex signal table is per-language and per-framework; real-world testing on diverse repos may reveal missing patterns; plan for a tuning iteration after initial integration tests run on actual repos

### Phase 4: Confidence + Evidence Pipeline Completion

**Rationale:** Migration 009 added the columns (Phase 1); this phase wires the data through persistFindings(). The agent already emits confidence and evidence in validated findings.js — this is only a upsert statement change plus getGraph() SELECT change. Low code volume, high correctness value. Must include end-to-end verification.

**Delivers:** confidence and evidence written by persistFindings(); returned by getGraph() on each connection object; pipeline verified end-to-end with a SELECT assertion (`SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5` must return rows)

**Addresses:** Persist confidence + evidence (critical table-stakes feature that has been dropping silently for multiple milestones)

**Avoids:** Pitfall 2 (confidence never reaches DB) and Pitfall 3 (evidence never reaches DB) — both closed by updating `_stmtUpsertConnection` to include the new columns

**Research flag:** Standard patterns — mechanical change; add two fields to existing upsert; no research needed

### Phase 5: Schema Storage + /graph API Extension

**Rationale:** schemas and schema_fields tables exist after Phase 1. The scan already collects schema data. The gap is that getGraph() does not include it and stale cleanup correctness is unverified. This phase closes both gaps before building any UI on top.

**Delivers:** `schemas_by_connection` in /graph response; stale schema cleanup verified (re-scan removes deleted fields); getGraph() includes owner/auth_mechanism/db_backend pivoted from node_metadata; `?? 'unknown'` normalization in http.js for all enrichment fields; response payload size assertion added to confirm schemas_by_connection does not inflate per-node data

**Addresses:** Schema storage; API extension for all enrichment data; "unknown" normalization at HTTP layer; anti-pattern prevention (schema data stays out of simulation worker)

**Avoids:** Pitfall 5 (stale schema data accumulates across re-scans) — verify scan_version_id on schemas/schema_fields before shipping; Pitfall 10 (schema data in getGraph() bloats response) — schemas attach as top-level map keyed by connection_id, not embedded per-node

**Research flag:** Storage audit required — verify that schemas and schema_fields tables have scan_version_id in migration 001; if missing, add in this phase and test stale cleanup before building the UI

### Phase 6: Detail Panel UI

**Rationale:** All data is now in the graph response. This phase is pure UI: schema section rendering, confidence badge per connection, owner/auth/db rows, "unknown" fallbacks, and escapeHtml() coverage for TypeScript generics and special characters.

**Delivers:** Schema section in detail panel (collapsible, field table with name/type/required); owner/auth/db rows with "unknown" fallback; confidence badge per connection (high=green, low=amber, null=gray); evidence snippet (expandable `<code>` block); `getConfidenceColor()` helper in utils.js

**Addresses:** Schema display in detail panel; confidence badge (P2); evidence snippet (P2); show "unknown" for missing metadata

**Avoids:** Pitfall 10 detail panel concern — escapeHtml() must cover all new field renderings; TypeScript generics (`Array<Record<string, unknown>>`) must render as literal characters in the panel, not as invisible HTML tags

**Research flag:** Standard patterns — detail-panel.js patterns (innerHTML + escapeHtml) are established and well-understood throughout the existing UI codebase; no additional research needed

### Phase 7: Agent Prompt Improvements + Quality-Gate Spin-Out

**Rationale:** Two independent cleanup tasks. Agent prompt improvements for source_file/target_file are low-risk markdown edits with no DB or API changes. Quality-gate spin-out is a removal-only change fully decoupled from enrichment. Grouped here because they share the property of being independent of all other phases.

**Delivers:** agent-prompt-common.md updated with source_file/target_file guidance and examples; null only accepted for genuinely external targets; `commands/quality-gate.sh` and `skills/quality-gate.md` removed from this plugin; README updated to reference the standalone plugin

**Addresses:** Agent prompt improvements (THE-942); Quality-gate spin-out (THE-937)

**Avoids:** Pitfall 8 (quality gate process coupling) — quality gate shell commands must remain pure read-only; if quality gate MCP tools are added later they must use SELECT-only queries and never intersect scan brackets

**Research flag:** Standard patterns — markdown edits and file removal; no research needed

### Phase Ordering Rationale

- **Migration first:** All enrichment, confidence, evidence, and schema work requires the DB schema to exist first; any work done without Migration 009 must later be revisited when schema changes invalidate assumptions
- **Framework before enrichers:** enricher.js must exist and be tested before individual enrichers (codeowners.js, auth-db-extractor.js) can be registered into it; CODEOWNERS validates the framework with simpler logic before auth/DB adds regex complexity
- **Confidence/evidence pipeline after framework:** the data pipeline change is small but benefits from being tested alongside enrichment so both can be verified in the same integration context
- **API before UI:** detail-panel.js reads from `state.graphData` populated from /graph; UI can be developed against a mock graph payload but must be verified against real getGraph() output before shipping
- **Quality-gate and prompt improvements last:** fully decoupled; no reason to block enrichment work on them

### Research Flags

Phases needing attention during planning:
- **Phase 3 (Auth/DB enrichment):** Regex signal table is per-language and per-framework; real-world testing will likely reveal missing patterns; plan for a tuning iteration after initial integration tests; the credential-value exclusion logic must be verified on an actual repo containing `.env.example` before release
- **Phase 5 (Schema storage/API):** Verify whether `schemas` and `schema_fields` tables have `scan_version_id` in migration 001; if missing, stale cleanup will not work and old fields will accumulate silently across re-scans

Phases with well-documented standard patterns (skip research-phase):
- **Phase 1 (Migration 009):** SQLite ALTER TABLE patterns established by 8 prior migrations in this codebase
- **Phase 2 (CODEOWNERS):** GitHub CODEOWNERS format is documented; picomatch API is straightforward; last-match-wins semantics are confirmed by both GitHub and GitLab docs
- **Phase 4 (Confidence/evidence pipeline):** Mechanical change — add two fields to existing upsert statement
- **Phase 6 (Detail panel UI):** detail-panel.js patterns are established across the existing codebase
- **Phase 7 (Prompt improvements / quality-gate):** Markdown edits and removal-only change

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct inspection of existing codebase + npm registry for picomatch; all rejections (codeowners-utils, minimatch, Tree-sitter, Bull) have clear rationale from primary sources |
| Features | HIGH | Features derived from direct codebase inspection of agent-schema.json, findings.js, migrations 001-008, detail-panel.js confirming exactly what exists and what is missing |
| Architecture | HIGH | Build order and component boundaries from direct code reading of query-engine.js, manager.js, http.js, detail-panel.js; existing patterns clearly identified; integration points confirmed |
| Pitfalls | HIGH | Grounded in 8-milestone retrospective documents from this exact codebase, not generic advice; specific symptoms, verification checklists, and recovery strategies included per pitfall |

**Overall confidence:** HIGH

### Gaps to Address

- **Auth/DB regex signal completeness:** The signal table covers Python, Node.js, Go, and Rust. Repos using Ruby (Rails/Devise), Java (Spring Security), PHP (Laravel Sanctum), or Kotlin are not covered. This is acceptable for v5.3.0 given the current supported language set, but enrichers should return `null` (not a false positive) when the language is unrecognized — handle this with an early-return guard in auth-db-extractor.js.

- **Schema stale cleanup verification:** ARCHITECTURE.md assumes schemas/schema_fields have scan_version_id but flags it as needing direct confirmation in migration 001. This must be verified before Phase 5 begins; if the column is absent, add it to Migration 009 and test stale cleanup before building any UI that depends on schema accuracy.

- **picomatch CJS import in ESM context:** picomatch v4.0.3 ships CJS (`"main": "index.js"` without `"type":"module"`). The import pattern `createRequire(import.meta.url)` is validated in STACK.md but should be tested in a minimal ESM file in the existing worker context before the CODEOWNERS enricher ships.

- **Incremental scan enrichment policy:** STACK.md recommends skipping enrichment when `getChangedFiles` returns an empty set. The exact integration point with the incremental scan path in manager.js needs to be confirmed during Phase 2 implementation — the changed-files detection API shape may differ from what research assumed.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `worker/scan/agent-schema.json`, `worker/scan/findings.js`, `worker/db/query-engine.js`, `worker/db/migrations/001-008`, `worker/scan/manager.js`, `worker/ui/modules/detail-panel.js`, `worker/server/http.js` — confirmed current state of all integration points and gaps
- `.planning/RETROSPECTIVE.md` (v2.0, v2.2, v2.3, v3.0 lessons) — grounded all pitfalls in actual project history; not generic advice
- [GitHub CODEOWNERS syntax docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — last-match-wins semantics, owner format, file locations
- [GitLab CODEOWNERS reference](https://docs.gitlab.com/user/project/codeowners/reference/) — cross-platform confirmation of last-pattern-wins semantics
- [github.com/micromatch/picomatch](https://github.com/micromatch/picomatch) — v4.0.3, zero deps, CJS build confirmed

### Secondary (MEDIUM confidence)
- [FastAPI JWT auth docs](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — Python auth regex pattern rationale
- [Django REST Framework auth guide](https://www.django-rest-framework.org/api-guide/authentication/) — Python auth pattern taxonomy
- [actix.rs middleware docs](https://actix.rs/docs/middleware/) — Rust auth pattern rationale
- [npmjs.com/package/codeowners-utils](https://www.npmjs.com/package/codeowners-utils) — rejection rationale confirmed (CJS-only, 5 years unmaintained)
- [Nemesis 2.x enrichment architecture](https://specterops.io/blog/2026/03/10/the-nemesis-2-x-development-guide/) — ELT enrichment pass pattern; side-car write model
- [Grafana SDG panel](https://grafana.com/grafana/plugins/novatec-sdg-panel/) — detail panel UX patterns for dependency graph tools; schema-in-detail-panel (not on graph edges) is the established pattern

### Tertiary (lower confidence — needs validation during implementation)
- [github.com/isaacs/minimatch/issues/257](https://github.com/isaacs/minimatch/issues/257) — minimatch v10 ESM chain issue; may be resolved in newer versions but picomatch is preferred regardless
- Node.js Web Worker postMessage structured clone behavior — documented behavior but not tested in this codebase's specific D3 worker setup; the schema-in-worker concern is sound as a principle; exact performance threshold needs measurement in Phase 5

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
