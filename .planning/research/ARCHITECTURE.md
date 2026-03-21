# Architecture Research

**Domain:** Scan intelligence and enrichment integration into existing Ligamen pipeline
**Researched:** 2026-03-21
**Confidence:** HIGH — based on direct codebase inspection

## Standard Architecture

### Existing System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ /ligamen:map │  │  MCP Tools   │  │  POST /scan  │              │
│  │  (shell cmd) │  │  (8 tools)   │  │ (HTTP route) │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
└─────────┼─────────────────┼─────────────────┼──────────────────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼──────────────────────┐
│  SCAN ORCHESTRATION  (worker/scan/manager.js)                        │
│                                                                      │
│  detectRepoType() -> selectPrompt() -> agentRunner() -> parseOutput()│
│                                                                      │
│  Prompt templates: agent-prompt-{service,library,infra,common}.md   │
│  Schema: agent-schema.json (validated by findings.js)               │
│                                                                      │
│  beginScan(repoId) -> [agent call] -> persistFindings() -> endScan()│
└─────────────────────────────────────────────────────────────────────┘
          │ findings object
          v
┌─────────────────────────────────────────────────────────────────────┐
│  PERSISTENCE  (worker/db/query-engine.js)                            │
│                                                                      │
│  persistFindings() writes to:                                        │
│  - services (name, root_path, language, type, scan_version_id)      │
│  - connections (protocol, method, path, source_file, target_file,   │
│                 crossing, scan_version_id)                           │
│  - schemas (name, role, file) -> fields (name, type, required)      │
│  - exposed_endpoints (method, path, kind, handler)                  │
│  - actors + actor_connections (from crossing='external')            │
│                                                                      │
│  NOTE: confidence and evidence from agent output are currently       │
│  validated by findings.js but DROPPED -- not written to the DB.     │
│  schemas/fields ARE persisted but NOT surfaced in GET /graph.       │
└─────────────────────────────────────────────────────────────────────┘
          │
          v
┌─────────────────────────────────────────────────────────────────────┐
│  QUERY LAYER  (worker/db/query-engine.js)                            │
│                                                                      │
│  getGraph()         -> /graph HTTP response (nodes, edges, actors)  │
│  getService()       -> /service/:name                                │
│  getImpact()        -> /impact                                        │
│  transitiveImpact() -> MCP tool responses                            │
│  detectMismatches() -> embedded in /graph response                  │
│  search()           -> 3-tier: ChromaDB -> FTS5 -> SQL               │
└─────────────────────────────────────────────────────────────────────┘
          │
          v
┌─────────────────────────────────────────────────────────────────────┐
│  HTTP SERVER  (worker/server/http.js)  -- Fastify                    │
│                                                                      │
│  GET  /graph          GET  /service/:name   GET  /impact             │
│  POST /scan           GET  /versions        GET  /projects            │
│  GET  /api/logs       GET  /api/readiness   GET  /api/version        │
└─────────────────────────────────────────────────────────────────────┘
          │
          v
┌─────────────────────────────────────────────────────────────────────┐
│  CANVAS UI  (worker/ui/)                                             │
│                                                                      │
│  graph.js -> state.js -> renderer.js -> canvas                       │
│  detail-panel.js     -- node click panel                             │
│  filter-panel.js     -- protocol/layer/boundary toggles             │
│  interactions.js     -- zoom/pan/click/keyboard                      │
│  layout.js           -- deterministic grid layout                    │
│  project-switcher.js -- per-project DB switching                    │
│  log-terminal.js     -- real-time log polling                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `scan/manager.js` | Orchestrates two-phase scan, injects prompts, calls agent, parses output | Existing — needs enrichment pass added |
| `scan/findings.js` | Validates agent JSON output against schema | Existing — needs new fields (confidence, evidence, auth, db_backend, owner) |
| `scan/agent-schema.json` | Machine-readable schema embedded in agent prompts | Existing — needs source_file/target_file guidance |
| `db/query-engine.js` | All DB reads/writes; `persistFindings()` central write path | Existing — needs confidence/evidence columns, node_metadata writes |
| `db/migrations/` | Sequential schema versioning | Existing — migration 009 needed |
| `server/http.js` | REST API; `/graph` aggregates all node data into one payload | Existing — /graph response needs schema/confidence/owner fields via getGraph() |
| `ui/modules/detail-panel.js` | Renders per-node detail panel from graph data | Existing — needs schema section, confidence badge, owner row |
| `mcp/server.js` | 8 MCP tools for agent-autonomous queries | Existing — MCP responses can pull from enrichment data post-change |

## Recommended Project Structure

```
worker/
├── scan/
│   ├── manager.js              # [MODIFY] add runEnrichmentPass() after parseAgentOutput
│   ├── findings.js             # [MODIFY] accept new optional fields in schema validation
│   ├── agent-schema.json       # [MODIFY] document source_file/target_file guidance (THE-942)
│   ├── enrichment/             # [NEW]
│   │   ├── enricher.js         # [NEW] orchestrates enrichment passes
│   │   ├── codeowners.js       # [NEW] parses CODEOWNERS -> owner per path pattern
│   │   └── auth-db-extractor.js# [NEW] reads source files for auth/db patterns
│   ├── agent-prompt-common.md  # [MODIFY] add source_file/target_file usage guidance
│   └── agent-prompt-service.md # [MODIFY] add source_file/target_file guidance (THE-942)
├── db/
│   ├── query-engine.js         # [MODIFY] persistFindings writes confidence/evidence;
│   │                           #   new upsertNodeMetadata(); getGraph() includes
│   │                           #   schemas_by_connection, owner/auth/db on services
│   └── migrations/
│       └── 009_enrichment.js   # [NEW] adds confidence/evidence to connections
└── ui/
    └── modules/
        ├── detail-panel.js     # [MODIFY] render schema section, confidence badge,
        │                       #   owner/auth/db rows; show "unknown" fallbacks
        └── utils.js            # [MODIFY] add getConfidenceColor() helper
```

### Structure Rationale

- **scan/enrichment/**: Isolated from scan/manager.js to keep the enrichment pass swappable without touching orchestration logic. Each enricher is a standalone function (`matchOwner(repoPath, servicePath)`, `extractAuthAndDb(repoPath, services)`) with no coupling to the DB or agent runner.
- **Migration 009**: Additive-only (ALTER TABLE ADD COLUMN). New columns are nullable with no DEFAULT, consistent with the convention established in migration 005 (`scan_version_id`). Existing rows survive intact.
- **detail-panel.js**: Receives enrichment data already embedded in the `/graph` response — no new API calls needed. Consistent with the "embed exposes in /graph" decision made in v2.3.

## Architectural Patterns

### Pattern 1: Layered Enrichment Pass (Post-Agent, Pre-Persist)

**What:** After `agentRunner()` returns and `parseAgentOutput()` validates findings, a second synchronous pass runs file-system reads (CODEOWNERS, grep for auth/DB patterns) and mutates the findings object before `persistFindings()` is called.

**When to use:** For metadata that requires file-system access but not agent intelligence. CODEOWNERS is a pure text parse. Auth/DB pattern detection is grep-over-source — deterministic, no LLM needed.

**Trade-offs:** Keeps agent prompt simpler (does not ask for ownership, which the agent cannot reliably derive from code). Runs synchronously in the scan bracket — failure must be silent/graceful (enrich-or-skip, never enrich-or-fail-scan).

**Integration point in manager.js:**
```javascript
// After parseAgentOutput(), before persistFindings()
const enriched = runEnrichmentPass(result.findings, repoPath, queryEngine);
queryEngine.persistFindings(repo.id, enriched, currentHead, scanVersionId);
```

**Critical constraint:** `runEnrichmentPass` must never throw. Wrap all enrichment in try/catch and fall back to the original findings. A broken CODEOWNERS file must not abort the scan.

### Pattern 2: node_metadata as Enrichment Sink

**What:** The existing `node_metadata` table (`service_id`, `view`, `key`, `value`, `source`, `updated_at`) is the designed-for home of enrichment data that does not fit the core schema. It was purpose-built in migration 008 for STRIDE, vuln scan, and deployment metadata — ownership, auth mechanism, and DB backend are exactly this pattern.

**When to use:** For metadata that is view-specific and not part of graph layout or mismatch detection. `owner`, `auth_mechanism`, `db_backend` are detail-panel-only fields, not graph topology.

**Trade-offs:** Key/value is flexible but requires the UI to know which keys to expect. Use a fixed set of well-known keys: `view='scan'`, keys `owner`, `auth_mechanism`, `db_backend`. Schemas/fields are NOT candidates for `node_metadata` — they have their own normalized tables already.

**Alternative rejected:** Adding `owner TEXT`, `auth_mechanism TEXT`, `db_backend TEXT` directly to `services`. Simpler for `getGraph()` but incurs migration cost and clutters the services schema. The `node_metadata` table was designed to avoid this. Use it.

### Pattern 3: Confidence/Evidence on Connections Table (New Columns)

**What:** The agent already emits `confidence` and `evidence` per connection (both validated by `findings.js`). These fields are currently dropped in `persistFindings()`. Migration 009 adds `confidence TEXT` and `evidence TEXT` columns to `connections`. `persistFindings()` then writes them.

**When to use:** These belong in `connections` (not `node_metadata`) because they are per-connection facts, not per-service metadata. They are the data behind connection-level confidence badges in the UI.

**Trade-offs:** Small migration (two nullable columns on `connections`). `getGraph()` needs to include them in the connections SELECT query. The detail panel can show a confidence badge and evidence snippet per connection in the outgoing/incoming connection lists.

**Important:** Do NOT add `confidence` to `services` for v5.3.0. Per-service confidence can be added later via `node_metadata`. The detail panel only needs per-connection confidence for meaningful display.

### Pattern 4: Schema/Field Surfacing in /graph Response

**What:** The `schemas` and `fields` tables are already populated by `persistFindings()`. They are not currently included in the `getGraph()` response, so the detail panel never shows them. The data is in the DB — the gap is only in `getGraph()` and `detail-panel.js`.

**When to use:** Now. The only changes needed are a JOIN in `getGraph()` and a schema section in `detail-panel.js`.

**Integration point in getGraph():**
```javascript
// Attach schemas grouped by connection_id
const allSchemaFields = db.prepare(`
  SELECT s.connection_id, s.name, s.role, s.file,
         f.name as field_name, f.type as field_type, f.required
  FROM schemas s
  JOIN fields f ON f.schema_id = s.id
`).all();
// Group by connection_id, return as schemas_by_connection object
```

**Trade-offs:** Schemas are connection-scoped (FK to `connection_id`). The detail panel looks up schemas via the connections to/from the selected node. This is a read-time grouping, not a structural change to the DB schema.

### Pattern 5: "unknown" Fallback for Missing Metadata

**What:** When `node_metadata` has no row for a given `(service_id, view, key)`, the `/graph` response includes the field as `null`. The detail panel renders "unknown" for any null enrichment string. This applies to `owner`, `auth_mechanism`, and `db_backend`.

**When to use:** Always — for any field that comes from enrichment passes that may not have run (first scan without CODEOWNERS, repos where auth pattern detection finds nothing).

**Trade-offs:** The field must always be present in the response (not absent) so the UI can distinguish null from missing. Include all enrichment fields in the `getGraph()` response with `null` as the default.

## Data Flow

### New Feature: Enrichment Pass Flow

```
/ligamen:map invoked
      |
      v
scanRepos() -- for each repo:
      |
      +-- beginScan(repoId)
      |
      +-- detectRepoType() -> selectPrompt()
      |
      +-- agentRunner(prompt, repoPath)    [foreground, sequential]
      |         |
      |         v
      |   parseAgentOutput()    [findings.js -- validates confidence, evidence]
      |         |
      |         v
      |   runEnrichmentPass()   [NEW -- enricher.js]
      |     |
      |     +-- codeowners.js:      read CODEOWNERS, match service paths -> owner string
      |     +-- auth-db-extractor:  grep source files for auth/DB patterns
      |     |
      |     v
      |   enrichedFindings (findings + owner/auth/db annotations per service)
      |         |
      |         v
      +-- persistFindings(repoId, enrichedFindings, commit, scanVersionId)
      |         |
      |         +-- upsertService()            [existing]
      |         +-- upsertConnection()         with confidence + evidence  [MODIFIED]
      |         +-- upsertSchema()             [existing]
      |         +-- upsertField()              [existing]
      |         +-- upsertExposedEndpoint()    [existing]
      |         +-- upsertNodeMetadata()       owner/auth/db per service  [NEW]
      |
      +-- endScan(repoId, scanVersionId)
```

### Updated /graph Response Shape

```
GET /graph?project=/path
      |
      v
getGraph()
  |
  +-- SELECT services + JOIN repos             [existing]
  +-- attach exposes per service               [existing]
  +-- SELECT connections (+ confidence/evidence columns)  [MODIFIED]
  +-- SELECT schemas + JOIN fields             [NEW -- group by connection_id]
  +-- SELECT node_metadata WHERE view='scan'   [NEW -- pivot to per-service fields]
  +-- detectMismatches()                       [existing]
  +-- SELECT actors                            [existing]
  |
  v
{
  services: [
    {
      id, name, language, type, repo_name, exposes, scan_version_id,
      owner: "team-payments" | null,         -- NEW from node_metadata
      auth_mechanism: "jwt" | null,          -- NEW from node_metadata
      db_backend: "postgres" | null          -- NEW from node_metadata
    }
  ],
  connections: [
    {
      id, protocol, method, path, source_file, target_file,
      source, target, scan_version_id,
      confidence: "high" | "low" | null,    -- NEW from connections table
      evidence: "fetch('/api/users')" | null -- NEW from connections table
    }
  ],
  schemas_by_connection: {                   -- NEW
    "<connection_id>": [
      { name, role, file, fields: [{name, type, required}] }
    ]
  },
  mismatches, actors, repos, boundaries, latest_scan_version_id
}
```

### Detail Panel Rendering Flow (Updated)

```
User clicks node
      |
      v
showDetailPanel(node)
      |
      +-- Show: name, type (with color), language, repo_name
      +-- Show: owner row        -- node.owner || "unknown"            [NEW]
      +-- Show: auth_mechanism   -- node.auth_mechanism || "unknown"  [NEW]
      +-- Show: db_backend       -- node.db_backend || "unknown"      [NEW]
      |
      +-- Render connections (outgoing/incoming):
      |     For each connection:
      |       +-- protocol, method, path, source_file/target_file    [existing]
      |       +-- confidence badge (high=green, low=amber, null=gray) [NEW]
      |       +-- evidence snippet (truncated to 80 chars)            [NEW]
      |
      +-- Render schemas section (service type):                      [NEW]
            Look up state.graphData.schemas_by_connection for outgoing connections
            For each schema: name (role), file, field list with types
```

## Scaling Considerations

This is a local CLI tool -- network scale is not the concern. The relevant concern is response payload size as the graph grows.

| Scale | Architecture Adjustment |
|-------|-------------------------|
| 0-50 services | `getGraph()` inline JOIN for schemas is fine -- all data in one response |
| 50-200 services | Schema data in `/graph` may grow large. Consider lazy-loading via `/schemas?connection_id=X` if response exceeds ~500KB |
| 200+ services | Not the current target; `node_metadata` handles extension without schema migrations |

## Anti-Patterns

### Anti-Pattern 1: Adding Enrichment Fields to Agent Prompts

**What people do:** Add `owner`, `auth_mechanism`, `db_backend` to `agent-schema.json` and ask the agent to fill them in.

**Why it's wrong:** The agent hallucinates ownership (it cannot reliably know which team owns a service from code alone). Auth and DB patterns are deterministic from grep -- using an LLM to find `JWT.verify()` or `pg.connect()` is overkill and introduces inconsistency between runs.

**Do this instead:** Run the enrichment pass after agent output using deterministic file-system reads. The agent's responsibility is connection topology. CODEOWNERS parsing and auth/DB grep are the right tools for the remaining metadata.

### Anti-Pattern 2: New HTTP Endpoints Per Enrichment Type

**What people do:** Add `/owner?service=X`, `/schemas?service=X`, `/confidence?connection=Y` as separate API routes.

**Why it's wrong:** Breaks the established "embed everything in /graph" pattern (v2.3 decision). The UI would need multiple async fetches per node click, introducing race conditions and added complexity in `detail-panel.js`.

**Do this instead:** Include all enrichment data in the `/graph` response payload. Only create a separate endpoint if the payload grows unacceptably large (beyond ~500KB, which requires 200+ services with full schema data).

### Anti-Pattern 3: Separate Enrichment Table Instead of node_metadata

**What people do:** Create `service_enrichment (service_id, owner, auth_mechanism, db_backend)` as a new table.

**Why it's wrong:** This is exactly what `node_metadata (service_id, view, key, value)` was purpose-built for in migration 008. Adding a parallel table creates schema fragmentation and doubles migration cost for future enrichment types.

**Do this instead:** Use `node_metadata` with `view='scan'` and well-known keys: `owner`, `auth_mechanism`, `db_backend`. The `upsertNodeMetadata()` method uses `INSERT OR REPLACE` with the existing `UNIQUE(service_id, view, key)` constraint -- fully idempotent across re-scans.

### Anti-Pattern 4: Blocking Scan on CODEOWNERS Parse Failure

**What people do:** Let `codeowners.js` throw if the CODEOWNERS file is malformed or absent, propagating the error up to `scanRepos()`.

**Why it's wrong:** A bad CODEOWNERS file would abort the entire scan, losing all agent findings. The enrichment pass is additive -- it should never be a blocker.

**Do this instead:** Wrap `runEnrichmentPass()` in try/catch in `manager.js`. On any enrichment error, log a WARN and return the original un-enriched findings. The scan succeeds; enrichment data is simply absent for that run.

### Anti-Pattern 5: Confidence on Services Table Instead of node_metadata

**What people do:** Add `confidence TEXT` to the `services` table to store per-service confidence from the agent.

**Why it's wrong:** Per-service confidence is a low-signal field (the agent emits a top-level confidence, not per-service). Clutters the services schema with a column that may go unused. Per-service confidence is not needed for v5.3.0 detail panel rendering.

**Do this instead:** Store per-service confidence in `node_metadata` if it becomes needed later (`view='scan'`, `key='confidence'`). For v5.3.0, only per-connection confidence is required -- that goes in the `connections` table via migration 009.

## Integration Points

### New vs Modified Components

| Component | New/Modified | Change |
|-----------|-------------|--------|
| `scan/enrichment/enricher.js` | NEW | Orchestrates enrichment passes; called by manager.js after parseAgentOutput; receives queryEngine as parameter |
| `scan/enrichment/codeowners.js` | NEW | Parses CODEOWNERS file; returns owner string per service root_path using glob-style pattern matching |
| `scan/enrichment/auth-db-extractor.js` | NEW | Greps source files for auth (JWT/OAuth/session/API-key) and DB (postgres/mysql/mongo/redis) patterns using regex over readFileSync |
| `scan/manager.js` | MODIFIED | Add `runEnrichmentPass()` call between parseAgentOutput and persistFindings; try/catch wraps entire call |
| `scan/findings.js` | MODIFIED | Accept (but not require) `owner`, `auth_mechanism`, `db_backend` on service objects -- unknown fields pass through without error |
| `scan/agent-schema.json` | MODIFIED | Improve `source_file`/`target_file` documentation (THE-942); do NOT add enrichment fields to agent schema |
| `scan/agent-prompt-service.md` | MODIFIED | Add source_file/target_file guidance (THE-942) |
| `db/migrations/009_enrichment.js` | NEW | ALTER TABLE connections ADD COLUMN confidence TEXT; ALTER TABLE connections ADD COLUMN evidence TEXT |
| `db/query-engine.js` | MODIFIED | (1) persistFindings() writes confidence/evidence per connection; (2) new upsertNodeMetadata() method; (3) getGraph() includes schemas_by_connection, confidence/evidence on connections, owner/auth/db pivoted from node_metadata |
| `server/http.js` | NOT MODIFIED | /graph route passes through getGraph() -- no route changes needed |
| `ui/modules/detail-panel.js` | MODIFIED | Add schema section, confidence badge per connection, owner/auth/db rows, "unknown" fallbacks for all null enrichment fields |
| `ui/modules/utils.js` | MODIFIED | Add `getConfidenceColor(level)` helper (high -> green #38a169, low -> amber #d69e2e, null -> gray #718096) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| enricher.js <-> manager.js | Direct function call: `runEnrichmentPass(findings, repoPath, queryEngine)` returns augmented findings | Must be synchronous from manager's perspective; async inside enricher is fine |
| enricher.js <-> codeowners.js | Direct import: `matchOwner(repoPath, servicePath)` returns string or null | CODEOWNERS format: `path/pattern @team`; parse with line-by-line pattern matching |
| enricher.js <-> auth-db-extractor.js | Direct import: `extractAuthAndDb(repoPath, services)` returns `Map<serviceName, {auth_mechanism, db_backend}>` | Uses fs.readFileSync + regex; no shell exec |
| enricher.js <-> node_metadata | Writes via `queryEngine.upsertNodeMetadata(serviceId, view, key, value, source)`; queryEngine must be passed from manager.js | Cannot import queryEngine directly; dependency injection via parameter |
| getGraph() <-> node_metadata table | Direct SQL SELECT pivoting rows into per-service object properties | Use `WHERE view='scan'`; graceful fallback (empty object) if table rows absent |
| detail-panel.js <-> /graph response | detail-panel.js reads `state.graphData` populated from /graph; schemas looked up via `state.graphData.schemas_by_connection[connectionId]` | No new fetches; consistent with existing "single load" pattern |

## Build Order

Dependencies drive this order. Each step unblocks the next:

1. **Migration 009** (`db/migrations/009_enrichment.js`) — Foundation. Adds `confidence` and `evidence` columns to `connections`. No other code changes. Run in isolation; verify with existing DB.

2. **`upsertNodeMetadata()` in query-engine.js** — New write method using the existing `node_metadata` table from migration 008. Low-risk: new method, no changes to existing methods. Can be built alongside migration 009.

3. **`codeowners.js` and `auth-db-extractor.js`** — Pure file-system utilities, no DB dependency. Build and test in isolation with mock repoPath values. These carry the most uncertainty (regex patterns for auth/DB may need iteration after real-world testing).

4. **`enricher.js`** — Composes utilities from step 3. Depends on step 3. Receives `queryEngine` parameter from manager.js to call `upsertNodeMetadata()`. Unit-test by mocking both utility modules.

5. **`manager.js` modification** — Wire `runEnrichmentPass()` into the scan loop. Single insertion point between `parseAgentOutput()` and `persistFindings()`. Wrap in try/catch. Depends on step 4.

6. **`persistFindings()` modification** — Write `confidence` and `evidence` from the validated connection objects. Depends on migration 009 (step 1). The change is: add two fields to the `upsertConnection()` call; the data is already in the findings object.

7. **`getGraph()` modification** — Include `schemas_by_connection`, `confidence`/`evidence` on connections, `owner`/`auth_mechanism`/`db_backend` on services from `node_metadata`. Depends on steps 1 and 2. Must use try/catch for pre-migration-009 DBs (same pattern used for actors in migration 008).

8. **`detail-panel.js` and `utils.js` modification** — UI-only changes. Depend on step 7 (getGraph returning the new fields). Can be developed against a mock `/graph` payload before step 7 is complete.

9. **Quality-gate spin-out (THE-937)** — Independent of all above; touches different files entirely. Can be done in parallel with any of steps 1-8 with no conflicts.

## Sources

- Direct inspection of `plugins/ligamen/worker/` codebase (2026-03-21)
- `worker/db/migrations/001_initial_schema.js` through `008_actors_metadata.js` — schema baseline
- `worker/db/query-engine.js` — `persistFindings()`, `getGraph()`, `QueryEngine` constructor, statement preparation pattern
- `worker/scan/manager.js` — scan bracket pattern, enrichment insertion point
- `worker/scan/findings.js` — validated fields including confidence/evidence currently dropped after validation
- `worker/scan/agent-schema.json` — agent output contract showing confidence/evidence are already in the schema
- `worker/ui/modules/detail-panel.js` — existing panel rendering patterns and escapeHtml() usage
- `worker/server/http.js` — /graph route and single-load payload pattern

---
*Architecture research for: Ligamen v5.3.0 Scan Intelligence & Enrichment*
*Researched: 2026-03-21*
