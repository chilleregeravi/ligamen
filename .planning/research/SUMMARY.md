# Project Research Summary

**Project:** AllClear v2.2 — Scan Data Integrity
**Domain:** SQLite-backed service dependency graph — idempotent re-scan, stale-row cleanup, cross-repo service identity, cross-project MCP queries
**Researched:** 2026-03-16
**Confidence:** HIGH — all four research areas grounded in direct codebase inspection + official SQLite/MCP docs

## Executive Summary

AllClear v2.2 is a targeted bug-fix and capability milestone for an already-shipped system. The graph UI, agent scanning, MCP server, FTS5 search, snapshot mechanism, and project switcher are all working. The problems being solved are: (1) every re-scan appends duplicate rows rather than replacing them, causing the graph to grow unboundedly and impact queries to fan out incorrectly; (2) the MCP server resolves its database path from `process.cwd()` at startup, so agents working in any repo other than the one the server launched from see empty query results; and (3) there is no enforced naming convention for services across repos, causing the same logical service to appear as multiple unconnected nodes. All three problems have known root causes confirmed by direct codebase inspection.

The recommended approach is to address the data corruption problem first, before adding any new capability. Migration 004 adds the UNIQUE constraint on `(repo_id, name)` that makes idempotent upserts possible, but this migration has a critical dependency ordering requirement: the upsert SQL in `_stmtUpsertService` must switch from `INSERT OR REPLACE` to `INSERT ... ON CONFLICT DO UPDATE` at the same time the constraint is added. If the constraint lands first, the first re-scan after migration wipes all child rows (connections, endpoints, schemas, fields) via `ON DELETE CASCADE`. This constraint-and-upsert change must ship as a single atomic change. The scan version bracket (migration 005 + `beginScan`/`endScan` methods) then builds on the clean upsert to provide stale-row cleanup. The MCP cross-project query feature is fully independent and can be developed in parallel.

The principal risk is the migration itself: production databases already contain duplicate `(repo_id, name)` rows — the exact data the migration must eliminate. A naive `CREATE TABLE ... AS SELECT *` copy fails on the first duplicate encountered. The migration must deduplicate with `SELECT MAX(id) ... GROUP BY repo_id, name` during the copy step, and must rebuild the FTS5 index afterward because row IDs change. Both requirements are well-documented with concrete SQL. A second risk is cross-repo service identity: the existing `_resolveServiceId()` name lookup is unscoped by repo, meaning two repos each containing a service named `api` or `worker` will have their connections merged into phantom edges. This must be addressed with a validation block-list rather than automatic name merging.

## Key Findings

### Recommended Stack

The v2.2 work is entirely within the existing worker stack: `better-sqlite3` 12.8.0 for synchronous SQLite access, `@modelcontextprotocol/sdk` 1.27.1 for the MCP stdio server, and `fastify` 5.8.2 for the HTTP/REST layer. No new dependencies are required. The migration system in `db/database.js` auto-discovers all `*.js` files in `db/migrations/` sorted alphabetically — dropping two new migration files is sufficient to extend the schema on next `openDb()`. The MCP server refactor switches from a module-level DB connection to per-call resolution via the existing `pool.js` module, which already handles multi-project DB caching for the HTTP layer.

**Core technologies:**
- `better-sqlite3` 12.8.0: synchronous SQLite with WAL + FTS5 — the only write path; the target of the UNIQUE constraint change
- `@modelcontextprotocol/sdk` 1.27.1: MCP stdio server — agent-facing interface; needs per-call `resolveDb()` for cross-project support
- `db/pool.js` (existing): project-hash-keyed QueryEngine cache — already used by the HTTP server; MCP server must adopt the same pattern
- `db/migrations/` auto-discovery (existing): drop new migration files and they run automatically; no changes to `database.js` needed

**Critical version requirements:**
- Node.js 20+ (required by `better-sqlite3` 12.x and `fastify` 5.x — already in use)
- SQLite 3.24+ for `ON CONFLICT DO UPDATE` UPSERT syntax (shipped with `better-sqlite3` 12.x — already satisfied)

### Expected Features

The features research is unusually precise because the root causes of all defects were identified in source. This milestone is a repair, not a greenfield build.

**Must have (table stakes — v2.2 core):**
- Migration 004: `UNIQUE(repo_id, name)` on `services` and composite unique on `connections` — foundation for all other fixes; includes dedup step for existing rows and FTS5 rebuild
- `INSERT OR REPLACE` → `INSERT ... ON CONFLICT DO UPDATE` in `_stmtUpsertService` — must ship with migration 004 atomically or cascade-delete wipes child rows
- Scan version bracket: `beginScan(repoId)` / `endScan(repoId, scanVersionId)` — new scan_versions table (migration 005); stale-row DELETE runs atomically after new scan succeeds
- Remove `MAX(id) GROUP BY name` workaround from `getGraph()` — becomes incorrect after migration 004, must be removed
- Agent prompt naming rule: lowercase-hyphenated convention enforced in `agent-prompt-deep.md` — cheapest identity fix; no schema change
- Cross-project MCP queries: optional `project` param on all 5 MCP tools; per-call `resolveDb()` via `pool.js`

**Should have (v2.2.x — after core is confirmed working):**
- Cross-repo canonical service identity: `service_registry` table + normalization function — add when multi-repo name divergence is confirmed in production
- Scan version history panel in graph UI: `GET /versions` endpoint + history dropdown — infrastructure already exists (`map_versions` table, `createSnapshot()`)

**Defer to v2.3+:**
- Diff view between scan versions (services/connections added/removed)
- Config-file service name aliases (`allclear.config.json`) for teams with naming debt

**Anti-features (do not build):**
- Fuzzy service name matching (Levenshtein / embeddings) — false merges are correctness bugs; a merged `user-service`/`users-service` creates phantom impact paths
- Auto-repair of historical connections on identity merge — rewrites audit history; breaks snapshot consistency
- Global shared SQLite DB for all projects — concurrent write from multiple workers causes `SQLITE_BUSY`; per-project isolation is explicit by design
- Automatic incremental scan on every file save — agent scan invokes Claude twice per repo; commit-based incremental scan is already built

### Architecture Approach

All v2.2 changes are contained within `worker/`. No new top-level components are introduced. The changes follow the existing extension patterns: new migration files auto-discovered by `db/database.js`, new QueryEngine methods injected following the same pattern as `upsertRepo`/`persistFindings`, and MCP server switching from module-level DB to per-call resolution using the `pool.js` cache that the HTTP server already uses. The most structurally significant change is the MCP server: it currently opens one DB for its entire lifetime and closes it after each tool call; after v2.2, pool.js owns the connection and callers must stop calling `db.close()`.

**Major components and their v2.2 changes:**

1. `db/migrations/004_dedup_constraints.js` (NEW) — UNIQUE index on `services(repo_id, name)` + `canonical_name` column; dedup step in migration copy; FTS5 rebuild
2. `db/migrations/005_scan_versions.js` (NEW) — `scan_versions` table; nullable `scan_version_id` FK columns on `services` and `connections`
3. `db/query-engine.js` (MODIFIED) — +`beginScan`, +`endScan`; `persistFindings` accepts `scanVersionId`; `getGraph` removes MAX(id) workaround
4. `scan/manager.js` (MODIFIED) — `beginScan` before agent invocation; `endScan` after `persistFindings` on success path only (failure leaves old data intact)
5. `mcp/server.js` (MODIFIED) — `resolveDb()` helper; +`project` param on all 5 tools; stop closing pool-owned connections
6. `db/pool.js` (MODIFIED) — remove inline migration workaround in `getQueryEngineByHash()` lines 178-202 after migration files 004+005 are in place

Unchanged: `db/database.js`, `server/http.js` (already uses pool.js with `?project=` and `?hash=`).

### Critical Pitfalls

1. **`INSERT OR REPLACE` cascade-deletes child rows when UNIQUE constraint is active** — REPLACE is delete-then-reinsert; `ON DELETE CASCADE` fires and wipes connections, endpoints, schemas, fields for every re-scanned service. Switch to `INSERT ... ON CONFLICT(repo_id, name) DO UPDATE SET ...` which updates in-place and preserves the existing `id`. This change must ship in the same PR as migration 004; deploying the migration before the code change causes silent data loss on the first re-scan.

2. **Migration 004 fails on existing databases with duplicate rows** — SQLite's rename-create-copy-drop pattern fails if the source table has duplicates. The copy INSERT fires the new UNIQUE constraint and aborts. The copy step must deduplicate: `SELECT MAX(id), repo_id, name, ... FROM services_old GROUP BY repo_id, name`. Test this migration against a database that already has duplicate rows — not a clean test fixture.

3. **FTS5 index desync after migration** — After the rename-create-copy-drop migration rebuilds the `services` table with new row IDs, the FTS5 shadow index retains stale rowids. Add `INSERT INTO services_fts(services_fts) VALUES('rebuild')` as the final step of migration 004, inside the same migration transaction.

4. **Cross-repo false edges from generic service names** — `_resolveServiceId(name)` does an unscoped lookup across all repos. Two repos with a service named `api`, `worker`, or `server` will have their connections merged into phantom edges. Add a validation block-list in `validateFindings()` that rejects generic names before any identity resolution runs.

5. **MCP server resolves wrong DB from `process.cwd()`** — The MCP server is a long-running process; its CWD reflects where Claude Code was launched, not the repo the agent is querying. All five tool handlers must accept an optional `project` parameter and call `resolveDb(params.project)` per-call. Return a structured error `{ error: "no_scan_data", hint: "Run /allclear:map first" }` when the resolved DB does not exist — never return silent empty results.

## Implications for Roadmap

The dependency graph is clear from research: schema changes precede application code that uses them; the UNIQUE constraint and upsert rewrite ship together; the scan version bracket builds on the dedup foundation; MCP cross-project queries are fully independent. This produces three focused phases.

### Phase 1: Schema Foundation + Upsert Repair

**Rationale:** Everything else depends on the UNIQUE constraint being present and the upsert SQL being correct. These changes also carry the highest risk — if done incorrectly, existing user data is silently corrupted on the first re-scan. Isolating them as Phase 1 enables targeted testing before any other changes land. Migration 004 must be tested against a database seeded with duplicate rows; this is the only way to catch the dedup failure mode.

**Delivers:** Idempotent re-scan with no data corruption. The graph no longer grows unboundedly. The `MAX(id) GROUP BY name` workaround is removed. FTS5 index is rebuilt and correct. Agent prompt enforces lowercase-hyphenated naming to prevent the identity problem from growing.

**Addresses:** Migration 004 (UNIQUE constraints + dedup + FTS5 rebuild), upsert SQL rewrite (`ON CONFLICT DO UPDATE`), remove `getGraph()` workaround, agent prompt naming convention, validation block-list for generic service names

**Avoids:** Pitfall 1 (cascade delete), Pitfall 2 (migration fails on duplicates), Pitfall 3 (FTS5 desync), Pitfall 4 (generic name false edges)

**Research flag:** Standard patterns. SQLite UPSERT syntax and migration dedup are documented in official SQLite docs. Implementation approach is fully specified in ARCHITECTURE.md with working SQL. No additional research needed.

### Phase 2: Scan Version Bracket + Stale-Row Cleanup

**Rationale:** Depends on Phase 1 — the UNIQUE constraint must exist before `scan_version_id` stamping is meaningful. The scan version bracket makes re-scan atomic: new rows carry the new `scan_version_id`; stale rows from prior scans are deleted within the same transaction after the new scan succeeds. Failure at any point leaves old data intact.

**Delivers:** Re-scan replaces the prior scan's data rather than appending. Deleted services and connections are removed from the graph. Partial scan failures leave old data valid and queryable.

**Addresses:** Migration 005 (scan_versions table + FK columns on services and connections), `QueryEngine.beginScan` / `endScan`, modified `persistFindings` (accepts `scanVersionId`), modified `scan/manager.js` (bracket calls)

**Avoids:** Anti-pattern: delete-all-then-reinsert (destroys FK refs mid-transaction); partial write leaving graph in corrupt half-old/half-new state; `scan_version_id NOT NULL` (migration 005 must add nullable column — existing rows have no version ID)

**Research flag:** Standard patterns. Scan version bracket is analogous to Apache Iceberg snapshots and dbt `strategy: check_timestamp`. Implementation fully specified in ARCHITECTURE.md with complete code examples. No additional research needed.

### Phase 3: Cross-Project MCP Queries

**Rationale:** Fully independent of Phases 1 and 2 — no schema changes, no dependency on scan version bracket. Can be developed in parallel with Phase 2 or sequenced after. The change is contained to `mcp/server.js` and adoption of the `pool.js` pattern already used by `server/http.js`.

**Delivers:** Agents working in any repo can query any project's graph by passing `project` (absolute path or 12-char hash) to any of the 5 MCP tools. Falls back to existing `ALLCLEAR_PROJECT_ROOT` / `process.cwd()` behavior when parameter is absent — no breaking change for single-project users.

**Addresses:** Cross-project MCP queries, `mcp/server.js` refactor to per-call `resolveDb()`, `pool.js` inline migration workaround removal, `projectRoot` path traversal validation

**Avoids:** Pitfall 5 (wrong DB from CWD); path traversal security (reject `..` segments; validate path is an existing directory before opening DB); pool connection lifecycle (stop calling `db.close()` in tool handlers after switching to pool.js)

**Research flag:** Standard patterns. The `pool.js` caching pattern is already in use by the HTTP server; extending it to MCP is a mechanical refactor. The DB ownership change (stop closing pool connections) is the only non-obvious element, explicitly documented in ARCHITECTURE.md Anti-Pattern 3. No additional research needed.

### Phase Ordering Rationale

- Phase 1 must precede Phase 2: the scan version bracket stamps rows with `scan_version_id`; without the UNIQUE constraint in place, the bracket adds overhead without the dedup guarantee that makes stale-row DELETE safe. The stale-row `endScan` delete relies on the new scan having replaced (not appended) the previous rows.
- Phase 3 is independent: `mcp/server.js` and `pool.js` share no state with the migration or QueryEngine changes. Can be a parallel workstream or follow Phase 1, depending on developer bandwidth.
- The v2.2.x features (cross-repo canonical identity, scan history UI) must not start until Phase 1 is confirmed working in production — canonical identity depends on the UNIQUE constraint being stable and the naming convention enforcement being in place.

### Research Flags

Phases needing deeper research before implementation:
- **Cross-repo canonical service identity (v2.2.x):** The `service_registry` table design and the query rewrites for impact tools to follow registry IDs rather than service IDs involve non-trivial schema and query changes. Needs a dedicated research pass before implementation starts.
- **Scan version history UI (v2.2.x):** REST endpoint and UI panel are straightforward, but a future diff-between-versions feature (v2.3+) requires a diffing strategy worth researching before committing to a data model.

Phases with standard patterns (skip research-phase):
- **Phase 1 (schema + upsert):** SQLite UPSERT with `ON CONFLICT DO UPDATE`, migration dedup with `GROUP BY MAX(id)`, FTS5 rebuild — all documented in official SQLite docs and confirmed by codebase inspection.
- **Phase 2 (scan version bracket):** Analogous to standard ETL snapshot patterns; implementation fully specified in ARCHITECTURE.md with working code examples.
- **Phase 3 (MCP cross-project):** The `pool.js` pattern is already live in the HTTP server; extending it to MCP is a mechanical refactor with a clear implementation path in ARCHITECTURE.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All v2.2 work uses already-deployed libraries. No new packages. better-sqlite3 12.8.0, @modelcontextprotocol/sdk 1.27.1, fastify 5.8.2 already running in production. |
| Features | HIGH | Root causes confirmed by direct source inspection of `query-engine.js`, `database.js`, `pool.js`, `manager.js`, `mcp/server.js`. Feature scope maps directly to documented tech debt SCAN-01..04 in PROJECT.md. Comparison with GitHub Dependency Graph, Datadog APM, dbt snapshots cross-validates the design. |
| Architecture | HIGH | All affected files identified, all code paths traced. Build order (steps 1-7) in ARCHITECTURE.md is unambiguous. Working code examples provided for all new methods and migration SQL. Integration points documented with before/after patterns. |
| Pitfalls | HIGH | SQLite UPSERT and FTS5 behaviors confirmed against official docs. `INSERT OR REPLACE` + `ON DELETE CASCADE` failure mode confirmed against Dexter's Log (specific SQLite behavior). MCP CWD pitfall confirmed by direct code reading of `mcp/server.js`. |

**Overall confidence:** HIGH

### Gaps to Address

- **Generic service name block-list completeness:** The research recommends blocking `server`, `worker`, `api`, `app`, `main` — but the complete list appropriate for this team's repos is unknown. During Phase 1 implementation, audit actual service names in existing project DBs before finalizing the block-list.
- **Snapshot retention verification:** Research notes that `history-limit` enforcement is coded in `database.js` but flags the need to confirm it is called on every scan path. Verify this during Phase 2 implementation before shipping.
- **MCP `projectRoot` allowed-roots policy:** PITFALLS.md recommends validating `projectRoot` against a set of allowed roots. The exact policy (e.g., "must be under HOME", "must appear in `~/.allclear/projects/`") needs a decision during Phase 3 implementation.
- **pool.js `getQueryEngineByHash` refactor safety:** Lines 178-202 of `pool.js` contain an inline migration workaround for schema v2/v3. Confirm all callers are safe before removing these lines after migration files 004+005 land.
- **`ON DELETE CASCADE` on `connections.source_service_id` / `target_service_id`:** The `endScan` delete order (connections before services) assumes FK cascade may or may not be present. Verify the migration 001 schema to confirm whether cascade is enabled; if not, the multi-step explicit delete in `endScan` is the required approach and must be respected.

## Sources

### Primary (HIGH confidence)

- `worker/db/query-engine.js` — `_stmtUpsertService` (INSERT OR REPLACE), `getGraph()` MAX(id) workaround, `_resolveServiceId` cross-repo lookup, `persistFindings`
- `worker/db/database.js` — migration auto-discovery, `openDb()` lifecycle, FK pragma ordering
- `worker/db/pool.js` — project hash to DB path, pool cache, `listProjects()`, inline migration workaround (lines 178-202)
- `worker/db/migrations/001_initial_schema.js` — confirmed absence of UNIQUE constraint on services; FTS5 trigger definitions
- `worker/db/migrations/002_service_type.js`, `003_exposed_endpoints.js` — current max schema version is 3
- `worker/scan/manager.js` — `scanRepos()` call sites for `upsertRepo`, `persistFindings`, `setRepoState`
- `worker/mcp/server.js` — module-level `dbPath`; local `openDb()`; `db.close()` pattern in tool handlers
- `.planning/PROJECT.md` — SCAN-01..04 tech debt, v2.2 milestone goals
- [SQLite UPSERT official docs](https://sqlite.org/lang_upsert.html) — `ON CONFLICT DO UPDATE` syntax, `excluded.` qualifier, UNIQUE index requirement
- [SQLite ON CONFLICT](https://sqlite.org/lang_conflict.html) — REPLACE semantics (delete-then-reinsert)
- [GitHub Dependency Graph deduplication GA](https://github.blog/changelog/2025-05-05-dependency-graph-deduplication-is-now-generally-available/) — idempotent ingestion pattern cross-validation
- [Anthropic MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — `McpServer` + `StdioServerTransport` patterns
- [code.claude.com/docs/en/plugins](https://code.claude.com/docs/en/plugins) — Plugin structure, SKILL.md format, hooks.json (v1 stack reference)

### Secondary (MEDIUM confidence)

- [Dexter's Log: INSERT OR REPLACE with ON DELETE CASCADE](https://dexterslog.com/posts/insert-on-conflict-replace-with-on-delete-cascade-in-sqlite/) — confirmed cascade-delete failure mode for Pitfall 1
- [Datadog Service Dependencies API](https://docs.datadoghq.com/api/latest/service-dependencies/) — cross-repo service identity patterns
- [Apache Iceberg snapshot versioning](https://medium.com/towards-data-engineering/mastering-snapshot-versioning-in-apache-iceberg-a-deep-dive-5e0200612ce8) — scan version bracket analogy
- [Sling Academy: UNIQUE constraints in SQLite](https://www.slingacademy.com/article/best-practices-for-using-unique-constraints-in-sqlite/) — rename-create-copy-drop migration pattern; pre-existing duplicate failure mode
- [SQLite FTS5 trigger patterns](https://simonh.uk/2021/05/11/sqlite-fts5-triggers/) — correct FTS5 external content table trigger ordering
- [Datadog Security Labs: SQL injection in MCP server](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/) — MCP input validation requirements
- [Airbyte: idempotency in data pipelines](https://airbyte.com/data-engineering-resources/idempotency-in-data-pipelines) — ETL dedup pattern reference

---
*Research completed: 2026-03-16*
*Ready for roadmap: yes*
