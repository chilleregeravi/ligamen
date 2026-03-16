# Architecture Research

**Domain:** AllClear v2.2 — Scan Data Integrity: upsert dedup, scan versioning, identity merging, cross-project MCP queries
**Researched:** 2026-03-16
**Confidence:** HIGH — based on direct codebase inspection of all affected modules

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Server (stdio)                               │
│  impact_query  impact_changed  impact_graph  impact_search  impact_scan │
│                                                                         │
│  TODAY: dbPath resolved once at module load from CWD/env var            │
│  v2.2:  +project param on all tools; per-call resolveDb() via pool.js   │
├─────────────────────────────────────────────────────────────────────────┤
│                     HTTP Worker (server/http.js)                        │
│  POST /scan    GET /graph    GET /projects   GET /search                │
│  Already multi-project: ?project= and ?hash= resolution via pool.js    │
│  No changes needed in v2.2                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                     scan/manager.js  (scanRepos)                        │
│  upsertRepo → buildScanContext → agentRunner → parseAgentOutput         │
│                                                                         │
│  TODAY: persistFindings called directly after parse                     │
│  v2.2:  +beginScan before agent call; +endScan after persistFindings    │
├─────────────────────────────────────────────────────────────────────────┤
│                     db/pool.js  (getQueryEngine)                        │
│  projectRoot → hash → ~/.allclear/projects/{hash}/impact-map.db         │
│  getQueryEngine(root)  getQueryEngineByHash(hash)  listProjects()       │
│  No schema changes; minor: remove inline migration workaround           │
├─────────────────────────────────────────────────────────────────────────┤
│                  db/query-engine.js  (QueryEngine)                      │
│  upsertRepo  upsertService  upsertConnection  persistFindings           │
│  getGraph    detectMismatches  transitiveImpact  search                 │
│                                                                         │
│  v2.2 additions:                                                        │
│    beginScan(repoId) → scan_version_id                                  │
│    endScan(repoId, scanVersionId) → delete stale rows                   │
│    upsertService gains UNIQUE(repo_id, name) enforcement via migration  │
│    getGraph: remove MAX(id) GROUP BY name workaround                    │
├─────────────────────────────────────────────────────────────────────────┤
│                  db/database.js  (openDb / runMigrations)               │
│  Auto-discovers *.js from db/migrations/, runs in version order         │
│                                                                         │
│  Existing:                                                              │
│    001_initial_schema.js    (schema v1)                                 │
│    002_service_type.js      (schema v2)                                 │
│    003_exposed_endpoints.js (schema v3)                                 │
│  New:                                                                   │
│    004_dedup_constraints.js (schema v4) — UNIQUE index + canonical_name │
│    005_scan_versions.js     (schema v5) — scan_versions table + FK cols │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status in v2.2 |
|-----------|----------------|----------------|
| `migrations/004_dedup_constraints.js` | Add UNIQUE(repo_id, name) index on services; add canonical_name TEXT column | NEW |
| `migrations/005_scan_versions.js` | Add scan_versions table; add scan_version_id FK columns on services and connections | NEW |
| `QueryEngine.beginScan(repoId)` | Insert a scan_versions row, return its ID for use as a bracket | NEW |
| `QueryEngine.endScan(repoId, scanVersionId)` | Mark scan complete; DELETE services/connections from prior scan versions for this repo | NEW |
| `QueryEngine.upsertService` | INSERT OR REPLACE — behavior unchanged, but UNIQUE constraint (migration 004) now enforces dedup at DB layer | MODIFIED |
| `QueryEngine.persistFindings` | Accept scanVersionId param; stamp services + connections with it | MODIFIED |
| `QueryEngine.getGraph` | Remove MAX(id) GROUP BY name workaround after migration 004 guarantees uniqueness | MODIFIED |
| `scan/manager.js scanRepos` | Call beginScan before agent invocation; call endScan after persistFindings | MODIFIED |
| `mcp/server.js` | Replace module-level dbPath constant with per-call resolveDb(project); add optional project param to all 5 tools | MODIFIED |
| `pool.js getQueryEngineByHash` | Remove inline migration workaround (lines 178-202) — migration files now cover those versions | MODIFIED |

---

## Recommended Project Structure

```
worker/
├── db/
│   ├── database.js                     # unchanged — auto-discovers migrations
│   ├── pool.js                         # minor: remove inline migration workaround
│   ├── query-engine.js                 # +beginScan, +endScan, modified persistFindings + getGraph
│   └── migrations/
│       ├── 001_initial_schema.js       # unchanged
│       ├── 002_service_type.js         # unchanged
│       ├── 003_exposed_endpoints.js    # unchanged
│       ├── 004_dedup_constraints.js    # NEW: UNIQUE(repo_id, name) + canonical_name
│       └── 005_scan_versions.js        # NEW: scan_versions table + scan_version_id FKs
├── scan/
│   └── manager.js                      # +beginScan/endScan calls in scanRepos()
└── mcp/
    └── server.js                       # +project param on tools; resolveDb() via pool.js
```

### Structure Rationale

- **migrations/**: database.js auto-discovers all *.js files sorted alphabetically. Adding 004 and 005 requires zero changes to database.js — drop the files and they run automatically on next openDb().
- **QueryEngine is the only write path**: scan/manager.js delegates all writes to QueryEngine methods already. beginScan/endScan follow the same injection pattern as upsertRepo/persistFindings — fully testable with mock QueryEngine.
- **MCP server switches from module-level DB to per-call**: today the MCP server opens one DB for its lifetime (resolved from CWD/env). With project param support, it must open per-call from pool.js (which caches connections). This is already the pattern used by the five tool handlers (`const db = openDb(); ... db.close()`).

---

## Architectural Patterns

### Pattern 1: Scan Version Bracket

**What:** Before each scan, create a `scan_versions` row and capture its ID. Pass that ID down through `persistFindings` to stamp every service and connection row written. After the scan succeeds, call `endScan` which marks the version complete and deletes any services/connections for this repo that carry an older `scan_version_id`. If the scan fails, `endScan` is never called — no cleanup of old rows occurs, old data remains valid.

**When to use:** Every execution of `scanRepos()` for every repo, regardless of scan mode (full or incremental). Skip mode (`ctx.mode === 'skip'`) bypasses the whole agent path and should not call beginScan.

**Trade-offs:** Adds two DB round-trips per repo per scan. Insignificant compared to agent invocation time (10s–300s). The delete in endScan cascades through connections referencing deleted services — requires `ON DELETE CASCADE` on `connections.source_service_id` and `connections.target_service_id` FKs, or explicit multi-step deletion.

**Example:**
```javascript
// QueryEngine additions
beginScan(repoId) {
  const result = this._db.prepare(
    'INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)'
  ).run(repoId, new Date().toISOString());
  return result.lastInsertRowid;
}

endScan(repoId, scanVersionId) {
  this._db.prepare(
    'UPDATE scan_versions SET completed_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), scanVersionId);

  // Delete connections referencing stale services first (FK constraint order)
  this._db.prepare(`
    DELETE FROM connections
    WHERE source_service_id IN (
      SELECT id FROM services WHERE repo_id = ? AND scan_version_id != ?
    ) OR target_service_id IN (
      SELECT id FROM services WHERE repo_id = ? AND scan_version_id != ?
    )
  `).run(repoId, scanVersionId, repoId, scanVersionId);

  // Now delete stale service rows
  this._db.prepare(
    'DELETE FROM services WHERE repo_id = ? AND scan_version_id != ?'
  ).run(repoId, scanVersionId);
}

// scan/manager.js scanRepos() — modified loop body
const scanVersionId = queryEngine.beginScan(repo.id);
// ... existing: agent invocation + parseAgentOutput ...
queryEngine.persistFindings(repo.id, result.findings, currentHead, scanVersionId);
queryEngine.endScan(repo.id, scanVersionId);  // only on success
```

### Pattern 2: UNIQUE Constraint Upsert for Dedup

**What:** Migration 004 adds a `UNIQUE(repo_id, name)` index to the `services` table. The existing `INSERT OR REPLACE` statement in `QueryEngine._stmtUpsertService` then becomes a true dedup upsert — a second scan of the same repo replaces the existing service row rather than inserting a new duplicate.

**When to use:** This is a passive change — no application code changes in QueryEngine are needed beyond migration 004. The `INSERT OR REPLACE` already handles it. However, `INSERT OR REPLACE` deletes the old row and inserts a new one (changing `rowid`/`id`). This is fine because `persistFindings` collects fresh IDs from each upsert and uses them for all FK relationships within the same transaction.

**Trade-offs:** Old connections referencing the deleted service row's ID must be cleaned up before the new row is inserted. The scan version bracket (Pattern 1) handles this: `endScan` deletes stale connections before deleting stale services. Within a single scan, the `serviceIdMap` in `persistFindings` captures the new IDs immediately after each upsert.

**Example:**
```javascript
// migrations/004_dedup_constraints.js
export const version = 4;
export function up(db) {
  db.exec(`
    ALTER TABLE services ADD COLUMN canonical_name TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_service_repo_name
      ON services(repo_id, name);
  `);
}
```

After migration 004, `getGraph()` can drop the `WHERE s.id IN (SELECT MAX(id) FROM services GROUP BY name)` workaround — duplicates no longer exist.

### Pattern 3: MCP Multi-Project Resolution

**What:** Replace the module-level `dbPath` constant and single-open `openDb()` in `mcp/server.js` with a per-call `resolveDb(project)` helper. The `project` parameter (optional, on all five tools) accepts an absolute filesystem path to any repo or a 12-char project hash. When absent, falls back to `ALLCLEAR_PROJECT_ROOT` env var, then `process.cwd()` — identical to current behavior.

**When to use:** All five MCP tool handlers call `resolveDb(params.project)` instead of the module-level `openDb()`. Pool caching in `pool.js` prevents repeated SQLite open overhead across tool calls for the same project.

**Trade-offs:** The MCP server currently opens a single DB once and keeps it for its lifetime. After this change, it opens a connection per tool call (then closes it). Pool caching makes this cheap for repeated calls to the same project, but the first call to a new project incurs a full `openDb()` including migration run. For the MCP use case (agent queries), this is acceptable — query latency dominates.

**Example:**
```javascript
// mcp/server.js additions
import { getQueryEngine, getQueryEngineByHash } from '../db/pool.js';

function resolveDb(project) {
  if (!project) {
    const root = process.env.ALLCLEAR_PROJECT_ROOT || process.cwd();
    return getQueryEngine(root)?._db ?? null;
  }
  if (project.startsWith('/')) {
    return getQueryEngine(project)?._db ?? null;
  }
  // Assume 12-char hash
  return getQueryEngineByHash(project)?._db ?? null;
}

// Updated tool handler signature — example:
server.tool(
  'impact_query',
  '...',
  {
    service: z.string(),
    project: z.string().optional().describe(
      'Absolute path to project root or 12-char project hash. ' +
      'Defaults to ALLCLEAR_PROJECT_ROOT or cwd.'
    ),
    // ... existing params unchanged
  },
  async (params) => {
    const db = resolveDb(params.project);
    const result = await queryImpact(db, params);
    // Note: do NOT close db here — pool.js owns the connection lifetime
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);
```

Note: the current pattern calls `db.close()` after each tool invocation. With pool.js ownership, this must stop — pool.js caches the open connection for reuse. The existing `openDb()` in mcp/server.js opens a fresh `new Database(dbPath, { readonly: true })` each time, so closing it was safe. Pool-managed connections must not be closed by callers.

### Pattern 4: Canonical Name for Cross-Repo Identity

**What:** Services with the same logical name in different repos get a shared `canonical_name`. When `_resolveServiceId(name)` fails to find an exact match in the current repo's services, it falls back to a lookup by `canonical_name`. This allows connections to cross repo boundaries when names are consistent.

**When to use:** Migration 004 adds the `canonical_name` column. It defaults to `NULL`. The agent prompt can be updated to emit a `canonical_name` field in its JSON output. If absent, `canonical_name` stays `NULL` and the existing name-based lookup is the only path.

**Trade-offs:** Naming consistency is a social/process problem, not purely a technical one. Canonical name is a low-overhead hook for future improvement. For v2.2, the agent prompt should be updated to emit service names consistently (using directory basename as the hint, which `scan/manager.js` already does via `serviceHint = basename(repoPath)`). Do not over-engineer this: start with name-match dedup, add canonical_name as a future extension.

---

## Data Flow

### Scan Flow (v2.2 changes highlighted)

```
scanRepos(repoPaths, options, queryEngine)
    │
    ├── qe.upsertRepo(repoData)              repos row, unchanged
    ├── buildScanContext(...)                 mode: full|incremental|skip, unchanged
    │
    ├── [SKIP mode] → continue               no scan needed, unchanged
    │
    ├── [NEW] scanVersionId = qe.beginScan(repo.id)
    │                                        INSERT INTO scan_versions
    │                                        returns scanVersionId
    │
    ├── agentRunner(interpolatedPrompt, repoPath)    unchanged
    ├── parseAgentOutput(rawResponse)               unchanged
    │
    ├── [on parse failure] → results.push(error)
    │         endScan is NOT called — old data preserved
    │
    ├── currentHead = getCurrentHead(repoPath)       unchanged
    │
    ├── qe.persistFindings(repoId, findings, currentHead, scanVersionId)
    │       ├── upsertService({ ..., scan_version_id: scanVersionId })
    │       │     └── UNIQUE(repo_id, name) fires
    │       │         INSERT OR REPLACE: same (repo, name) → replaces old row
    │       │         new row gets new id; serviceIdMap captures it immediately
    │       ├── upsertConnection({ ..., scan_version_id: scanVersionId })
    │       ├── upsertSchema / upsertField / exposed_endpoints   unchanged
    │       └── setRepoState(repoId, currentHead)                unchanged
    │
    └── [NEW] qe.endScan(repo.id, scanVersionId)
              ├── UPDATE scan_versions SET completed_at = now
              ├── DELETE FROM connections WHERE source/target in stale services
              └── DELETE FROM services WHERE repo_id = ? AND scan_version_id != ?
```

### MCP Query Flow (v2.2 changes highlighted)

```
Agent calls impact_query { service: "auth-service", project: "/workspace/api-gateway" }
    │
    ├── resolveDb("/workspace/api-gateway")
    │       └── getQueryEngine("/workspace/api-gateway")     pool.js
    │               ├── pool cache hit → return cached QueryEngine immediately
    │               └── pool cache miss → openDb(root) → migrations run → new QueryEngine
    │                                                    → cache it → return
    │
    ├── queryImpact(qe._db, { service: "auth-service", ... })
    │       └── SELECT id FROM services WHERE name = 'auth-service'
    │           SELECT ... FROM connections ...
    │
    └── return { results: [...] }
         // db is NOT closed — pool owns the connection
```

### Cross-Repo Connection Resolution (within persistFindings)

```
Agent output: connections[{ source: "api-gateway", target: "auth-service" }]
    │
    ├── serviceIdMap has "api-gateway" → sourceId = serviceIdMap.get("api-gateway")
    │
    ├── serviceIdMap does NOT have "auth-service" (it's in a different repo)
    │
    └── _resolveServiceId("auth-service")
            ├── SELECT id FROM services WHERE name = 'auth-service'   PRIMARY
            │   → finds the auth-service row (different repo_id, same DB)
            │   → returns its id
            │
            └── [future] SELECT id FROM services WHERE canonical_name = 'auth-service'
                → fallback if name lookup fails
```

### Key Data Flows

1. **Dedup on re-scan:** UNIQUE(repo_id, name) + INSERT OR REPLACE means the second scan of any repo replaces service rows in-place rather than appending duplicates. The scan version bracket ensures only current-scan rows survive — stale rows from the previous scan are deleted atomically after the new scan completes.

2. **Cross-project MCP query:** Agent passes `project` param (absolute path to any repo). MCP server calls `getQueryEngine(project)` from pool.js, which hashes the path, opens the correct per-project SQLite DB (running any pending migrations), and returns the cached QueryEngine. Each project's DB is queried independently — no shared DB required.

3. **Orphan connection prevention:** `endScan` deletes connections referencing stale service rows before deleting the service rows themselves, respecting FK constraints. The delete order is critical: connections first, then services.

---

## Integration Points

### New vs Modified: Summary Table

| File | New or Modified | What Changes |
|------|-----------------|--------------|
| `worker/db/migrations/004_dedup_constraints.js` | NEW | UNIQUE(repo_id, name) index; canonical_name column |
| `worker/db/migrations/005_scan_versions.js` | NEW | scan_versions table; scan_version_id columns on services + connections |
| `worker/db/query-engine.js` | MODIFIED | +beginScan, +endScan; persistFindings accepts scanVersionId; getGraph removes workaround |
| `worker/scan/manager.js` | MODIFIED | beginScan call before agent; endScan call after persistFindings |
| `worker/mcp/server.js` | MODIFIED | resolveDb() helper; +project param on all 5 tools; stop closing pool-owned connections |
| `worker/db/pool.js` | MODIFIED | Remove inline migration workaround in getQueryEngineByHash (lines 178-202) |
| `worker/db/database.js` | UNCHANGED | Auto-discovers migrations; no code changes needed |
| `worker/server/http.js` | UNCHANGED | Already uses pool.js with ?project= and ?hash= |

### Component Boundaries

| Boundary | Communication Pattern | Notes |
|----------|-----------------------|-------|
| scan/manager.js → QueryEngine | Direct method calls: beginScan, persistFindings, endScan | scanVersionId flows as a local variable — no state stored in manager |
| mcp/server.js → pool.js | Import getQueryEngine, getQueryEngineByHash | MCP server currently uses its own DB open logic; must switch to pool.js |
| pool.js → database.js | pool.js calls openDb(projectRoot) | Already the pattern for getQueryEngine(); getQueryEngineByHash() has an inline workaround to remove after migration files cover those versions |
| QueryEngine._stmtUpsertService → services table | INSERT OR REPLACE; UNIQUE constraint fires on migration 004 | No application code change; the SQL statement is already correct |
| QueryEngine.endScan → connections, services | Multi-step DELETE; connections before services | FK ordering matters; must delete connections referencing stale services first |

### MCP Server DB Ownership Change

This is the most structurally significant change. Today:

```javascript
// mcp/server.js (current) — module-level, one DB for lifetime
const dbPath = process.env.ALLCLEAR_DB_PATH || resolveDbPath(...);
export function openDb() {
  return new Database(dbPath, { readonly: true });
}
// each tool: const db = openDb(); ... db.close();
```

After v2.2:

```javascript
// mcp/server.js (v2.2) — per-call, pool-managed
import { getQueryEngine, getQueryEngineByHash } from '../db/pool.js';
function resolveDb(project) { ... }
// each tool: const db = resolveDb(params.project);
// NO db.close() — pool owns the connection
```

The local `openDb()` export in mcp/server.js is used by tests. These tests must be updated to use the new resolveDb() pattern or mock pool.js.

---

## Build Order

Build order is driven by dependency: schema changes must land before application code that uses them; the workaround removal in getGraph() must happen after migration 004 is active.

```
Step 1 — migrations/004_dedup_constraints.js (NEW FILE)
  UNIQUE(repo_id, name) index on services
  canonical_name TEXT column (nullable, no default)
  Benefit immediately: upsertService dedup works at DB layer
  Dependency: none

Step 2 — migrations/005_scan_versions.js (NEW FILE)
  scan_versions table: id, repo_id, started_at, completed_at
  ALTER services ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id)
  ALTER connections ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id)
  Dependency: step 1 should land first (same migration run is fine)

Step 3 — QueryEngine.beginScan / endScan (MODIFIED query-engine.js)
  New prepared statements for scan_versions INSERT/UPDATE
  Multi-step DELETE in endScan (connections then services)
  persistFindings accepts optional scanVersionId param (backward-compatible: NULL if not passed)
  Dependency: step 2 (scan_versions table must exist)

Step 4 — QueryEngine.getGraph: remove MAX(id) GROUP BY workaround (MODIFIED query-engine.js)
  Remove WHERE s.id IN (SELECT MAX(id) FROM services GROUP BY name) from getGraph()
  Dependency: step 1 (UNIQUE constraint guarantees no duplicates)
  Can combine with step 3

Step 5 — scan/manager.js: bracket beginScan/endScan (MODIFIED scan/manager.js)
  Add scanVersionId = qe.beginScan(repo.id) before agent call
  Pass scanVersionId to qe.persistFindings(...)
  Add qe.endScan(repo.id, scanVersionId) after persistFindings on success path
  Dependency: step 3

Step 6 — mcp/server.js: project param + resolveDb() (MODIFIED mcp/server.js)
  Add import of getQueryEngine, getQueryEngineByHash from pool.js
  Replace module-level dbPath/openDb() with resolveDb(project)
  Add optional project param to all 5 tool schemas
  Remove db.close() calls in tool handlers
  Update/mock tests that used the local openDb() export
  Dependency: none (independent of steps 1-5; can be done in parallel)

Step 7 — pool.js: remove inline migration workaround (MODIFIED pool.js)
  Remove lines 178-202 from getQueryEngineByHash() (v2, v3 inline migration checks)
  Replace with openDb() via projectRoot resolution or trust that migrations auto-run
  Dependency: steps 1 + 2 migration files exist and cover those schema versions
```

Steps 1-2 can be a single PR (both migration files). Steps 3-4-5 can be a single PR (QueryEngine + scan/manager). Step 6 can be a separate PR in parallel. Step 7 is cleanup after all migration files are merged.

---

## Anti-Patterns

### Anti-Pattern 1: Deleting All Rows Before Re-Insert

**What people do:** `DELETE FROM services WHERE repo_id = ?` before each scan, then re-insert everything from the agent output.

**Why it's wrong:** Destroys FK references from connections mid-transaction. If the agent fails after deletion but before re-insert, the DB is empty for that repo. Visible gap in the graph during scan execution. Also means old data is unavailable if the new scan produces worse output (agent hallucination, partial parse).

**Do this instead:** Scan version bracket — new rows carry the new `scan_version_id`; old rows survive until `endScan` confirms the scan succeeded. Old data remains queryable during the scan.

### Anti-Pattern 2: MAX(id) GROUP BY name as Permanent Fix

**What people do:** Keep the `WHERE s.id IN (SELECT MAX(id) FROM services GROUP BY name)` in `getGraph()` permanently as the dedup mechanism.

**Why it's wrong:** It hides symptoms without fixing the root cause. Connections table still references the lower-id (stale) service rows — those connections are invisible in the graph even though they exist in the DB. FTS5 index also contains all duplicates, making search results noisy.

**Do this instead:** Migration 004 UNIQUE constraint + scan version bracket. Once migration 004 runs, there are no duplicates to hide. Remove the GROUP BY workaround from getGraph().

### Anti-Pattern 3: Closing Pool-Managed Connections in MCP Tool Handlers

**What people do:** Keep `if (db) db.close()` after each MCP tool call after switching to pool.js.

**Why it's wrong:** Pool.js caches the open connection keyed by projectRoot. Closing it invalidates the cache entry, so the next tool call for the same project incurs a full openDb() + migrations run again. Also, the next call may fail if the DB is in the process of closing.

**Do this instead:** Do not close pool-managed connections. Pool.js owns the connection lifetime for the worker process. The MCP server process only closes connections on SIGTERM (which terminates the process anyway).

### Anti-Pattern 4: Inline Migration Logic in pool.js

**What people do:** Add schema version checks directly in `getQueryEngineByHash()` (this already exists as a workaround — lines 178-202 of pool.js handle v2 and v3 inline).

**Why it's wrong:** Migration logic is duplicated. When new migrations land (004, 005), pool.js needs manual updates too. This is the exact situation that caused the workaround: `openDb()` via `getQueryEngine()` runs migrations automatically, but `getQueryEngineByHash()` opened the DB directly and skipped the migration system.

**Do this instead:** After migration files 004 and 005 exist, remove the inline workaround. `getQueryEngineByHash()` should open via a path that triggers `runMigrations()`, or call `openDb()` with a fake projectRoot derived from the hash path.

### Anti-Pattern 5: scan_version_id as Required Column

**What people do:** Add `scan_version_id NOT NULL` to services and connections in migration 005.

**Why it's wrong:** Existing rows in already-deployed databases have no `scan_version_id`. Making it NOT NULL with no default causes migration to fail on existing DBs. Making it NOT NULL with DEFAULT 0 is also wrong — 0 is not a valid scan_versions.id.

**Do this instead:** Add `scan_version_id INTEGER REFERENCES scan_versions(id)` as nullable (no NOT NULL, no DEFAULT). Existing rows get NULL. The scan version bracket only stamps rows it creates. `endScan` targets rows `WHERE scan_version_id != ?` which correctly leaves NULL rows (from pre-v2.2 data) alone until the next full scan replaces them.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-20 repos, <1000 services per repo | Current per-project SQLite; no adjustments needed |
| 20-100 repos | listProjects() opens all DBs at startup; add in-memory project index cache with 60s TTL |
| 100+ repos | endScan DELETE across large services tables; batch delete in chunks of 500 rows if needed |

### Scaling Priorities

1. **First bottleneck:** `endScan` DELETE of stale connections + services. For typical repos (<500 services), this is a millisecond operation. For repos with thousands of services (e.g., a monorepo), consider wrapping in a transaction and batching.
2. **Second bottleneck:** `getQueryEngineByHash` opening DB without pool cache for MCP tool calls across many projects. Pool caching handles repeated calls; first call per project takes ~50ms for migrations check. Acceptable for agent query latency.

---

## Sources

- `worker/db/database.js` — migration auto-discovery system, openDb lifecycle (source code, HIGH confidence)
- `worker/db/pool.js` — projectHashDir, pool cache, listProjects, inline migration workaround to remove (source code, HIGH confidence)
- `worker/db/query-engine.js` — upsertService (INSERT OR REPLACE), persistFindings, getGraph MAX(id) workaround, _resolveServiceId cross-repo lookup (source code, HIGH confidence)
- `worker/db/migrations/001_initial_schema.js` — services table without UNIQUE constraint; confirmed absence of constraint (source code, HIGH confidence)
- `worker/db/migrations/002_service_type.js`, `003_exposed_endpoints.js` — current max schema version is 3 (source code, HIGH confidence)
- `worker/scan/manager.js` — scanRepos call sites for upsertRepo, persistFindings, setRepoState (source code, HIGH confidence)
- `worker/mcp/server.js` — module-level dbPath constant; local openDb(); db.close() pattern in tool handlers (source code, HIGH confidence)
- `.planning/PROJECT.md` — known tech debt SCAN-01..04, v2.2 milestone goals (source code, HIGH confidence)

---
*Architecture research for: AllClear v2.2 Scan Data Integrity*
*Researched: 2026-03-16*
