# Feature Research

**Domain:** Developer tool — scan data integrity for a local service dependency graph (SQLite-backed, agent-scanned)
**Researched:** 2026-03-16
**Confidence:** HIGH (patterns verified against SQLite official docs, codebase inspection, and established dependency-tool design)

> **Scope note:** This document covers v2.2 features only. All v2.0/v2.1 capabilities (graph UI,
> agent scanning, MCP tools, FTS5 search, snapshot mechanism, project switcher, log terminal) are
> already shipped and are **dependencies**, not targets. Features below fix or extend existing
> infrastructure — they must not break it.

---

## Current State of the Codebase (Evidence Base)

These are confirmed facts from reading the source, not assumptions:

| Problem | Where it lives | Root cause |
|---------|---------------|------------|
| Duplicate service rows on re-scan | `services` table has no UNIQUE constraint on `(repo_id, name)` | INSERT OR REPLACE in `upsertService` inserts a new row instead of updating the existing one because `INSERT OR REPLACE` on a table with only `PRIMARY KEY` as the unique index assigns a new `id` |
| `getGraph()` dedup workaround | `query-engine.js` line 547: `WHERE s.id IN (SELECT MAX(id) FROM services GROUP BY name)` | Symptom-fix only — connections still reference old service IDs; impact queries on old IDs return no results |
| No cross-repo identity | Each repo scan produces its own service rows; if `auth-service` appears in repo A's scan and is referenced by repo B's scan, they get separate IDs with no link | No global name registry or canonical service identity table |
| MCP server locked to one project | `resolveDbPath()` in `mcp/server.js` uses `process.cwd()` at startup; agents in other repos see empty results | DB path is resolved once at process start; no per-call project switching |
| Agent naming variability | `agent-prompt-deep.md` says "service name" but gives no normalization rule; agent can emit "auth-service", "AuthService", "auth_service" for the same logical service | Prompt does not enforce a canonical naming convention |
| Scan versioning orphan cleanup | `createSnapshot()` in `database.js` retains N versions but the connections/services of the *previous* scan are never pruned — they accumulate | Re-scan appends; no "replace this repo's scan data" transaction |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any re-scannable dependency tool must have. Without these, re-scanning actively harms
data quality — which is worse than no re-scan at all.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| Idempotent re-scan (upsert by identity key) | Every ETL tool, SBOM generator, and dependency tracker treats re-ingestion as "replace not append." GitHub Dependency Graph deduplication (GA May 2025) is the same pattern. Without it, each scan adds phantom rows, impact queries fan out incorrectly, and the graph grows unboundedly. | MEDIUM | Requires adding UNIQUE constraint `(repo_id, name)` on `services` and `(source_service_id, target_service_id, protocol, method, path)` on `connections` — delivered as a new migration |
| Stale-row cleanup after re-scan | Re-scanning a repo should remove services and connections that no longer exist in that repo. Without cleanup, deleted services linger as ghost nodes. Tools like dbt snapshots and Iceberg handle this with explicit "replace partition" semantics. | MEDIUM | Depends on idempotent upsert (above); requires a DELETE WHERE repo_id = ? AND id NOT IN (just-upserted IDs) within the same transaction |
| Schema migration for new constraints | Users who already have a database must have the UNIQUE constraints applied via a migration, not require a database wipe. The existing migration system (`schema_versions` table, numbered files in `db/migrations/`) handles this. | LOW | Existing migration infrastructure; add `004_scan_integrity.js` |
| Scan transaction atomicity | All writes for a single repo scan (upsert services + delete stale + upsert connections + delete stale connections + update repo_state) must succeed or fail together. A partial write leaves the graph in a corrupt half-old/half-new state. | LOW | `better-sqlite3` supports synchronous transactions; wrap `persistFindings()` in `db.transaction()` |

### Differentiators (Competitive Advantage)

Features that go beyond the table stakes and provide meaningful additional value for multi-repo workflows.

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| Cross-repo canonical service identity | When service "payments" is scanned from repo A and referenced by repo B, they should resolve to the same graph node. Tools like Datadog APM and ServiceNow CMDB use a "canonical name registry" pattern: a `service_registry` table keyed on normalized service name; foreign-keyed from `services`. This enables a single graph node with multiple repo sources. | HIGH | Requires schema change: `service_registry (id, canonical_name)` + FK from `services.registry_id`; impact queries must follow registry IDs, not service IDs; requires normalization function (lowercase, strip hyphens/underscores) |
| Agent naming convention enforcement | Instruct the deep-scan agent to emit service names in a specific normalized form (e.g., lowercase-hyphenated: `auth-service`, not `AuthService`). This is the cheapest form of canonical identity — prevents divergence before it reaches the DB. | LOW | Requires adding a naming rule section to `agent-prompt-deep.md`; no schema change needed; prevents the cross-repo identity problem from growing |
| Cross-project MCP queries (any working directory) | MCP tools currently resolve the DB path from `process.cwd()` at startup. Agents working in any repo should be able to query the full graph regardless of which project they launched from. Pattern: read `~/.allclear/projects/` directory, enumerate available project DBs, accept optional `project` parameter on each tool call, or merge all project DBs into a unified query. | MEDIUM | MCP server changes only; no schema change; risk of opening multiple SQLite files simultaneously (mitigated by read-only mode + per-call open/close already in place) |
| Scan version history browsable in UI | The `map_versions` table and `createSnapshot()` function already exist. The UI has no way to view or restore a previous version. Exposing this as a "History" panel or dropdown in the graph UI closes the loop. | MEDIUM | Depends on existing `map_versions` table and `VACUUM INTO` snapshot mechanism; requires a new REST endpoint `GET /versions` and UI component |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fuzzy service name matching (Levenshtein / embedding similarity) | "auth-service" and "auth_service" should merge automatically | Fuzzy matching introduces false merges (e.g., "user-service" and "users-service" are different services). In a dependency graph, a false merge is a correctness bug, not a cosmetic one — it creates phantom impact paths. Embedding-based matching requires ChromaDB to be running, which is optional. | Enforce exact normalized form via agent prompt; require explicit `allclear.config.json` override for known aliases. Correctness over convenience. |
| Auto-repair of historical connections on identity merge | "When I merge two service identities, rewrite all old connection rows to point to the new canonical ID" | This retroactively rewrites audit history. Snapshots become inconsistent with the live DB. Connection rows that were accurate at scan time become misleading. | Re-scan after a rename to generate correct data; the new scan replaces old rows via the upsert mechanism |
| Global shared SQLite database (single file for all projects) | "One query to see all projects" | SQLite under concurrent write from multiple workers (one per project) without WAL lock coordination causes `SQLITE_BUSY` errors. Per-project isolation is an explicit design decision for this reason. AllClear PROJECT.md: "per-project DB isolation via hash of project root." | Cross-project MCP queries that open each project DB read-only and merge results in memory — no shared write DB needed |
| Automatic incremental scan on every file save | "Scan should run whenever I save a file" | The two-phase agent scan is expensive (invokes Claude twice per repo). Triggering it on every save would saturate the agent runner and degrade Claude Code performance. | Commit-based incremental scan (already built in `buildScanContext()`): scan only when HEAD changes; user-triggered with `/allclear:map` |
| Schema drift alerts (notify when agent output format changes) | "Tell me when the agent started returning different field names" | This requires version-pinning the agent prompt output schema and comparing it on every scan — significant validation overhead for a problem that is solved by simply keeping the prompt stable and using Zod schema validation on findings (already exists in `findings.js`) | `parseAgentOutput()` in `findings.js` already validates against a schema; a parse failure is surfaced as a scan error |

---

## Feature Dependencies

```
[Migration 004: UNIQUE constraints on services(repo_id, name) and connections(...)]
    └──required by──> [Idempotent upsert (INSERT OR REPLACE works correctly)]
    └──required by──> [Stale-row cleanup (safe to DELETE WHERE id NOT IN)]

[Idempotent upsert]
    └──required by──> [Scan transaction atomicity (wrap in db.transaction())]
    └──required by──> [Stale-row cleanup (must know which IDs were just written)]

[Stale-row cleanup]
    └──enhances──> [Cross-repo canonical service identity (no stale ghost nodes to confuse merge)]

[Agent naming convention enforcement (prompt change)]
    └──reduces need for──> [Cross-repo canonical service identity (fewer divergent names reach DB)]
    └──does NOT replace──> [Cross-repo canonical service identity (runtime enforcement still needed)]

[Cross-repo canonical service identity]
    └──required by──> [Impact queries across repo boundaries (MCP tools work correctly)]
    └──conflicts with──> [Fuzzy name matching (anti-feature — choose one approach)]

[Existing map_versions + VACUUM INTO (v2.0 shipped)]
    └──required by──> [Scan version history UI (GET /versions endpoint + UI component)]

[Existing per-project DB isolation]
    └──required by──> [Cross-project MCP queries (enumerate project DBs, open read-only per call)]
```

### Dependency Notes

- **Migration 004 is the critical foundation**: Every other table-stakes feature depends on the UNIQUE constraints it adds. It must ship first and handle the case where users already have duplicate rows (migrate with dedup step: keep MAX(id) per group, delete rest, then add constraint).
- **Stale-row cleanup must be atomic with upsert**: If cleanup runs separately from upsert, a crash between them leaves the graph in a half-pruned state. Both must be in the same `db.transaction()`.
- **Agent prompt naming convention is cheap and should ship alongside Migration 004**: It prevents the identity problem from growing while the schema fix cleans up existing data.
- **Cross-repo identity is independent of the MCP cross-project query feature**: Identity is about merging the same service seen from different repos into one node. Cross-project queries are about querying different project databases from any working directory. They solve different problems and can ship independently.
- **Scan version history UI depends only on existing infrastructure**: The `map_versions` table, `createSnapshot()`, and the REST server already exist. This is a new endpoint + UI widget with no schema changes needed.

---

## MVP Definition (v2.2)

### Launch With (v2.2 core — fixes the stated bugs)

Minimum for the milestone to deliver its stated goal: "Fix data duplication from re-scanning and
cross-repo conflicts. Add scan versioning and cross-project MCP queries."

- [ ] Migration 004: UNIQUE constraints on `services(repo_id, name)` and `connections(source_service_id, target_service_id, protocol, method, path)` — with dedup step for existing rows — the foundation everything else stands on
- [ ] Idempotent `persistFindings()` wrapped in `db.transaction()` with stale-row DELETE — re-scan replaces, not appends
- [ ] Remove `MAX(id) GROUP BY name` workaround from `getGraph()` — the workaround becomes incorrect after constraint is added
- [ ] Agent prompt naming rule: lowercase-hyphenated convention enforced in `agent-prompt-deep.md` — cheapest identity fix
- [ ] Cross-project MCP queries: MCP tools accept optional `project_root` parameter; fall back to enumerating all known project DBs when none specified — agents in any repo see the full graph

### Add After Validation (v2.2.x)

Features to add once core dedup and MCP cross-project queries are confirmed working.

- [ ] Cross-repo canonical service identity: `service_registry` table + normalization function — add when multiple repos with overlapping service names are confirmed working and divergence reappears
- [ ] Scan version history panel in graph UI: `GET /versions` endpoint + history dropdown — add when users ask "what changed since yesterday?"

### Future Consideration (v2.3+)

- [ ] Diff view between scan versions (which services/connections were added/removed) — add when history browsing is shipped and users want to understand changes
- [ ] Config-file service name aliases (`allclear.config.json` `"service-aliases": {"AuthService": "auth-service"}`) — add if teams with legacy naming need a migration path without re-scanning

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Migration 004: UNIQUE constraints + dedup | HIGH — fixes root cause of all duplication bugs | MEDIUM — migration must handle existing duped rows safely | P1 — foundation |
| Idempotent persistFindings + stale-row cleanup | HIGH — re-scan no longer corrupts the graph | MEDIUM — transaction wrapping + DELETE WHERE id NOT IN | P1 — table stakes |
| Remove MAX(id) workaround from getGraph() | HIGH — workaround breaks after constraint is added | LOW — delete ~5 lines, replace with direct query | P1 — required cleanup |
| Agent prompt naming convention | HIGH — prevents divergence at source | LOW — add one section to agent-prompt-deep.md | P1 — cheap, immediate value |
| Cross-project MCP queries | HIGH — agents in any repo see the full graph | MEDIUM — enumerate project DBs, add optional param to tools | P1 — stated milestone goal |
| Cross-repo canonical service identity | MEDIUM — needed only when services appear in multiple repos | HIGH — schema change + query rewrites + normalization | P2 — add after P1 confirms benefit |
| Scan version history UI | MEDIUM — adds browsability to already-captured snapshots | MEDIUM — new REST endpoint + UI panel | P2 — infrastructure already exists |
| Config-file service name aliases | LOW — only needed for teams with established naming debt | LOW — config parsing + alias table | P3 — future |

**Priority key:**
- P1: Required to meet the v2.2 milestone goal
- P2: Should add once P1 is stable and confirmed correct
- P3: Future consideration

---

## Competitor Feature Analysis

How established tools handle each of the four research questions.

| Problem | GitHub Dependency Graph | Datadog APM Service Map | dbt Snapshots | AllClear v2.2 approach |
|---------|------------------------|------------------------|---------------|------------------------|
| Idempotent ingestion | Deduplication GA May 2025 — each submission replaces the previous for that manifest+SHA | Traces replace previous state per service+env; no accumulation | `strategy: check_timestamp` — replaces changed rows, keeps unchanged | `INSERT OR REPLACE` on UNIQUE `(repo_id, name)`; DELETE stale within transaction |
| Service identity across repos | Repository-scoped packages; cross-repo links via package name match (exact string) | Global service registry keyed on `service` tag string (must be consistent across all instrumented code) | N/A (single repo scope) | Agent-enforced naming convention (lowercase-hyphenated) + optional `service_registry` canonical identity table |
| Scan versioning / history | Dependency graph snapshot per commit SHA; history via git log | No history — live state only | Immutable snapshots with `dbt snapshot`; configurable retention | `map_versions` table + VACUUM INTO snapshot files; configurable `history-limit` in `allclear.config.json` |
| Cross-project querying | GitHub-scoped; cross-org via API with org token | Global APM — all envs in one query; filter by env | dbt project-scoped | MCP tools accept `project_root` param; enumerate `~/.allclear/projects/` DBs read-only and merge results in memory |

---

## Sources

- SQLite `INSERT OR REPLACE` / UPSERT — [sqlite.org/lang_upsert.html](https://sqlite.org/lang_upsert.html) — HIGH confidence (official docs)
- SQLite ON CONFLICT clause — [sqlite.org/lang_conflict.html](https://sqlite.org/lang_conflict.html) — HIGH confidence (official docs)
- GitHub Dependency Graph Deduplication GA — [github.blog/changelog/2025-05-05](https://github.blog/changelog/2025-05-05-dependency-graph-deduplication-is-now-generally-available/) — HIGH confidence (official changelog)
- Datadog Service Dependencies API — [docs.datadoghq.com/api/latest/service-dependencies](https://docs.datadoghq.com/api/latest/service-dependencies/) — HIGH confidence (official docs)
- Idempotency in data pipelines — [airbyte.com/data-engineering-resources/idempotency-in-data-pipelines](https://airbyte.com/data-engineering-resources/idempotency-in-data-pipelines) — MEDIUM confidence (industry reference)
- Apache Iceberg snapshot versioning — [medium.com/towards-data-engineering — Iceberg snapshots](https://medium.com/towards-data-engineering/mastering-snapshot-versioning-in-apache-iceberg-a-deep-dive-5e0200612ce8) — MEDIUM confidence (tutorial, pattern reference)
- Codebase inspection: `worker/db/query-engine.js`, `worker/db/database.js`, `worker/db/migrations/001_initial_schema.js`, `worker/mcp/server.js`, `worker/scan/manager.js` — HIGH confidence (source of truth for current state)

---
*Feature research for: AllClear v2.2 — Scan Data Integrity*
*Researched: 2026-03-16*
