# Architecture

**Analysis Date:** 2026-03-20

## Pattern Overview

**Overall:** Layered plugin architecture with multi-component coordination

**Key Characteristics:**
- Agent-driven service discovery (Claude scans repos, extracts architecture)
- Project-agnostic worker daemon (resolves per-project DBs from request context)
- SQLite + optional ChromaDB for durability and semantic search
- Modular UI rendering (canvas-based force-directed graph with interactive controls)
- MCP server for agent access to impact analysis
- Decoupled components connected via dependency injection

## Layers

**Agent Scanner (Scan Phase):**
- Purpose: Invoke Claude agents to discover services, connections, and breaking changes
- Location: `worker/scan/` — manager orchestration, agent prompt templates, findings validation
- Contains: `manager.js` (repo type detection, git diff, scan context), `findings.js` (schema validation), agent prompt templates (service/library/infra-specific)
- Depends on: QueryEngine (for upsertRepo, beginScan, persistFindings), Logger
- Used by: MCP server, command hooks
- Key abstractions:
  - `scanRepos()` — Sequential agent invocation with scan bracketing (beginScan → agent → persistFindings → endScan)
  - `detectRepoType()` — Heuristic detection (service/library/infra) based on manifest files
  - `buildScanContext()` — Determines scan mode (full/incremental/skip) based on git state
  - `getChangedFiles()` — Git diff wrapper returning {modified, deleted, renamed}

**Database Layer (SQLite + Pool):**
- Purpose: Durable storage and transactional persistence
- Location: `worker/db/` — schema, migrations, query engine, pool management
- Contains:
  - `database.js` — DB lifecycle (openDb, runMigrations, createSnapshot)
  - `pool.js` — Per-project DB caching
  - `query-engine.js` — Read/write queries
  - `migrations/` — 8 versioned schema migrations
- Depends on: better-sqlite3
- Used by: HTTP server, MCP server, scan manager
- Key abstractions:
  - **QueryEngine** — Wraps a DB instance with transitive impact traversal, breaking change classification, FTS5 search, upsert helpers
  - **Migrations** — Version-based schema evolution (repos → services → connections → schemas → fields → map_versions → scan_versions → actors)
  - **Pool** — Per-project DB caching: projectRoot (path) or hash → QueryEngine

**HTTP Server (REST API + Static UI):**
- Purpose: REST endpoint for graph queries and static file serving
- Location: `worker/server/http.js`
- Contains: Fastify instance with CORS, routes for /api/readiness, /api/version, /projects, /graph, /search, /impact, /vulnerabilities, etc.
- Depends on: Fastify, CORS plugin, static file plugin, QueryEngine pool
- Used by: UI client (JavaScript browser)
- Key routes:
  - `GET /api/readiness` — Always 200 (health check)
  - `GET /projects` — List all scanned projects with DBs
  - `GET /graph?project=/path` — Full service dependency graph (nodes, edges, boundaries, mismatches)
  - `GET /search?q=...` — 3-tier search (ChromaDB → FTS5 → SQL)
  - `GET /impact?service=X&direction=downstream` — Transitive impact with breaking changes

**UI Layer (Canvas + Modules):**
- Purpose: Interactive layered graph visualization with filtering and detail inspection
- Location: `worker/ui/` — entry point, modules for layout/rendering/interactions/filtering/details
- Contains:
  - `graph.js` — UI entry point (project selection → data loading → graph rendering → interaction wiring)
  - `modules/` — Layout (deterministic vertical positioning), Renderer (canvas drawing), Interactions (click/drag/pan), State (shared graph state), Filters (protocol/layer/boundary/language), Detail Panel (right-side service info)
  - `force-worker.js` — Web Worker for force simulation (non-blocking physics)
- Depends on: Canvas API, Fetch API, force simulation library
- Used by: HTTP server (serves as static files)
- Key abstractions:
  - **State** — Shared mutable object (nodes, edges, selectedNode, filters, transform)
  - **Layout** — Deterministic layered algorithm: horizontal sections (services/libraries/infra), services ordered vertically
  - **Renderer** — Canvas 2D drawing: edges with arrows, nodes with color/labels, boundaries with boxes, mismatch indicators
  - **Interactions** — Click selection, drag repositioning, pan zooming, filter panel toggling

**MCP Server (Agent Access):**
- Purpose: Expose database queries as tools for other Claude agents
- Location: `worker/mcp/server.js`
- Contains: Tools for impact analysis (queryImpact, searchServices, queryConnections, checkMismatches, describeActors, describeBreakingChanges)
- Depends on: @modelcontextprotocol/sdk, QueryEngine pool
- Used by: Other Claude Code agents
- Key abstractions:
  - **Tool Resolution** — Per-call QueryEngine resolution from project identifier (path/hash/name)
  - **Enrichment** — Add boundary/actor metadata to raw query results
  - **Breaking Change Classification** — CRITICAL (schema mismatch), WARN (existing usage), INFO (new fields)

**Logger (Cross-Cutting):**
- Purpose: Structured logging with component tagging
- Location: `worker/lib/logger.js`
- Contains: `createLogger()` factory, log level filtering (INFO, WARN, ERROR, DEBUG)
- Depends on: Node.js fs for writing to `~/.ligamen/logs/`
- Used by: Worker startup, HTTP server, scan manager, MCP server

## Data Flow

**Scan Flow (Agent → DB → UI):**

1. User runs `/ligamen:map` (Claude Code command hook)
2. Hook invokes `scanRepos()` with project paths
3. For each non-skip repo:
   - `detectRepoType()` determines type (service/library/infra)
   - `buildScanContext()` returns scan mode (full/incremental/skip)
   - `beginScan()` opens scan version bracket (inserts row in scan_versions)
   - Agent invoked with type-specific prompt template (agent-prompt-service.md, etc.)
   - `parseAgentOutput()` extracts and validates findings JSON
   - `persistFindings()` inserts services/connections/schemas/fields via QueryEngine
   - `syncFindings()` optionally syncs to ChromaDB (fire-and-forget)
   - `endScan()` closes bracket, records scan completion
4. QueryEngine writes to SQLite (transactional)
5. UI polls `GET /graph` to load current state
6. Canvas renders nodes + edges + boundaries
7. User filters/selects nodes; interactions highlight impact zones

**Query Flow (UI → HTTP → QueryEngine → DB):**

1. UI calls `fetch('/graph?hash=xyz')`
2. HTTP server resolves hash to QueryEngine
3. QueryEngine calls:
   - `getGraph()` → services, connections, boundaries, mismatches
   - Joins repos, services, connections with boundary map from config
   - Classifies breaking changes (schema mismatches vs. API changes)
4. Response formatted as {nodes, edges, boundaries, mismatches, actors}
5. UI renders canvas and wires interaction handlers

**Search Flow (3-Tier Fallback):**

1. UI calls `fetch('/search?q=user-service')`
2. QueryEngine.search() attempts (in order):
   - Tier 1: ChromaDB semantic search (if enabled and available)
   - Tier 2: FTS5 keyword search on services/connections/fields tables
   - Tier 3: SQL LIKE fallback (if FTS5 unavailable)
3. Results enriched with metadata (boundary, actor, type)
4. UI displays findings with score/type indicators

**Impact Flow (Service → Transitive Dependencies):**

1. MCP tool or HTTP endpoint called with service name + direction
2. QueryEngine.queryImpact() traverses:
   - **Downstream** (who depends on me?): Follow source_service_id → target services, recursively
   - **Upstream** (who do I depend on?): Follow target_service_id → source services, recursively
   - Cycle detection prevents infinite loops
3. For each affected service:
   - Check for breaking changes (schema mismatches, API removals)
   - Classify severity (CRITICAL, WARN, INFO)
   - Collect evidence (file references, method/path changes)
4. Return {service, impact, breaking_changes, evidence}
5. MCP agent or CLI command presents findings

## Key Abstractions

**QueryEngine:**
- Purpose: Encapsulates all DB operations, decouples from better-sqlite3 raw queries
- Examples: `worker/db/query-engine.js`
- Pattern: Class wrapping Database instance with methods for:
  - Impact traversal (queryImpact, getTransitiveDependents, getTransitiveDependencies)
  - Breaking change detection (analyzeSchema, findBreakingChanges)
  - FTS5 search (search with 3-tier fallback)
  - Upsert helpers (upsertService, upsertConnection, upsertSchema, upsertActor)
  - Snapshot creation (createSnapshot, snapshotRetention)

**Scan Bracket:**
- Purpose: Atomically track scan lifecycle (start → persist → end) with version tracking
- Pattern: `beginScan(repoId) → scanVersionId` creates row in scan_versions table
  - `persistFindings(repoId, findings, commit, scanVersionId)` inserts domain data
  - `endScan(repoId, scanVersionId)` marks completion
  - On parse failure: endScan NOT called → prior data remains intact
- Used by: scanRepos() in `worker/scan/manager.js`

**Repo State Tracking:**
- Purpose: Record which commit was last scanned for incremental scan decisions
- Pattern: `repo_state` table (repo_id, last_scanned_commit, last_scanned_at)
  - `getRepoState(repoId)` checks if repo already scanned
  - `buildScanContext()` compares last_scanned_commit with current HEAD
  - If same: mode = "skip" (no scan needed)
  - If different: mode = "incremental", compute git diff

**Findings Validator:**
- Purpose: Validate agent JSON output against schema (services/connections/schemas/fields)
- Pattern: `validateFindings(obj)` returns {valid: true, findings} or {valid: false, error}
  - Validates array fields (services, connections required)
  - Validates enum fields (protocols, confidence, roles)
  - Preserves error context for debugging
- Used by: scanRepos() to decide if parse succeeded

**Pool:**
- Purpose: Cache per-project QueryEngine instances to avoid repeated DB opens
- Pattern: Map<projectRoot → QueryEngine>
  - `getQueryEngine(projectRoot)` returns cached or opens new
  - `getQueryEngineByHash(hash)` reverse lookup by project hash
  - `getQueryEngineByRepo(name)` search by repo name
- Benefit: 1 DB per project, reused across requests

## Entry Points

**Worker Process:**
- Location: `worker/index.js`
- Triggers: `node worker/index.js --port 37888 --data-dir ~/.ligamen`
- Responsibilities:
  1. Parse CLI args (port, data-dir)
  2. Read settings.json for config overrides
  3. Create data/logs directories
  4. Initialize logger
  5. Initialize ChromaDB (if configured)
  6. Create HTTP server with per-project DB resolution
  7. Write PID/PORT files for process tracking
  8. Graceful shutdown on SIGTERM/SIGINT/SIGHUP
- Lifetime: Single instance per machine (managed by Claude Code plugin system)

**HTTP Server:**
- Location: `worker/server/http.js` — createHttpServer()
- Triggers: Called from worker/index.js
- Responsibilities:
  - Register CORS, static files, routes
  - Per-request QueryEngine resolution from ?project= or ?hash=
  - Route dispatch (readiness, projects, graph, search, impact, etc.)
- Lifetime: Runs for duration of worker process

**UI Entry Point:**
- Location: `worker/ui/graph.js` — loadProject()
- Triggers: User opens http://localhost:37888 in browser
- Responsibilities:
  1. Show project picker (list all scanned projects)
  2. On project select:
     - Fetch /graph?hash=xyz
     - Map API response to UI node/edge shape
     - Compute layout (deterministic layering)
     - Create force simulation
     - Render canvas
     - Wire interaction handlers
- Lifetime: Runs for duration of browser session

**MCP Server:**
- Location: `worker/mcp/server.js` — as #!/usr/bin/env node script
- Triggers: Configured in Claude Code .claude/profile.json mcpServers
- Responsibilities:
  1. Resolve LIGAMEN_PROJECT_ROOT / LIGAMEN_DB_PATH
  2. Create QueryEngine instance (readonly)
  3. Register tools: queryImpact, searchServices, queryConnections, checkMismatches, etc.
  4. Per-tool QueryEngine resolution (supports path/hash/name identifiers)
  5. Tool response formatting with metadata enrichment
- Lifetime: One instance per Claude session (stdio transport)

**Scan Manager:**
- Location: `worker/scan/manager.js` — scanRepos()
- Triggers: Called by MCP server /ligamen:map command or test
- Responsibilities:
  1. For each repo: detectRepoType, buildScanContext, beginScan, invoke agent, validateFindings, persistFindings, endScan
  2. Requires injected agentRunner (test mock or MCP server's real Claude invoker)
  3. Requires injected logger (for scan lifecycle events)
  4. Returns ScanResult[] with findings or error per repo
- Lifetime: Async execution during user command, completes or throws

## Error Handling

**Strategy:** Fail gracefully with clear messaging; preserve prior state on errors

**Patterns:**

1. **Scan Parse Failure:** `parseAgentOutput()` validates JSON
   - On invalid: returns {valid: false, error: "reason"}
   - Scan manager logs warning but does NOT call endScan()
   - Prior scan data remains intact
   - User sees: "scan failed — preserving prior data"

2. **ChromaDB Unavailable:** Fire-and-forget with catch
   - syncFindings() called via `.catch()` on sync promise
   - If fails: stderr warning only, never throws to caller
   - SQLite writes already committed
   - Fallback: UI uses FTS5 search

3. **DB Open Failure:** Pool returns null
   - getQueryEngine() returns null if DB doesn't exist or can't open
   - HTTP route checks null, returns 503 + helpful message
   - MCP tool returns error object with recovery guidance

4. **Invalid Request:** HTTP route validation
   - Missing ?project= or ?hash=: return 400 with message
   - Project not found: return 503 with message
   - Query validation: Zod schema catches type errors early

5. **Canvas Rendering:** Defensive defaults
   - Missing canvas DOM: render() no-ops silently
   - Missing graphData: render clears canvas only
   - Animation loops continue despite rendering errors

## Cross-Cutting Concerns

**Logging:**
- Framework: Custom logger (`worker/lib/logger.js`)
- Pattern: `logger.log(level, message, {extra: 'metadata'})`
- Components inject logger via setScanLogger(), http server options.logger, MCP createLogger()
- Levels: INFO, WARN, ERROR, DEBUG (filtered by LIGAMEN_LOG_LEVEL)
- Output: Rotated files in `~/.ligamen/logs/` + stderr for critical errors

**Validation:**
- Findings: Zod schema in `worker/scan/findings.js` (validateFindings)
- Request params: Zod schemas in HTTP routes
- DB mutations: Foreign key constraints enforced by SQLite pragma foreign_keys = ON

**Authentication:**
- UI: None (localhost-only CORS for development)
- MCP: None (stdio transport implicit to Claude session)
- DB: Better-sqlite3 readonly mode for MCP (preventing accidental writes)

**Performance:**
- DB: WAL mode, indexed foreign keys, pragmas (cache_size=64MB, busy_timeout=5s)
- UI: Canvas rendering (not DOM), force simulation in Web Worker, batch updates
- Search: 3-tier fallback avoids redundant queries (Chroma → FTS5 → SQL)
- Pool: Per-project DB caching prevents repeated opens
