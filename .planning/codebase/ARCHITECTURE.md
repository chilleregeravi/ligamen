# Architecture

**Analysis Date:** 2026-03-23

## Pattern Overview

**Overall:** Modular event-driven service dependency graph platform with agent-driven scanning, REST API workers, and MCP tool exposure.

**Key Characteristics:**
- **Agent-driven scanning:** Claude agents discover and analyze service topology via injected runners
- **Project-agnostic worker:** Single background HTTP worker serves multiple projects via query parameters
- **Per-project SQLite backend:** Deterministic per-repo database sharding using SHA256 hashing
- **Layered data flow:** Scanner → Query Engine → UI/MCP consumers
- **Pluggable enrichment:** Service-discovery findings enriched post-scan by registered enrichers (CODEOWNERS, auth/DB extraction)

## Layers

**Scanner & Agent Execution:**
- Purpose: Discover service topology and connections via Claude agents
- Location: `worker/scan/`
- Contains: Discovery agent runners, findings parsers, enrichment pipelines, confirmation workflows
- Depends on: Logger, agent injection function
- Used by: Scan lifecycle orchestration, skill/command invocation

**Database Access Layer:**
- Purpose: Manage per-project SQLite databases, run migrations, expose schema
- Location: `worker/db/`
- Contains: Better-sqlite3 wrapper, prepared statement cache, query engine, connection pooling
- Depends on: Node builtins, better-sqlite3, crypto (SHA256 hashing)
- Used by: HTTP API, MCP server, worker entry point

**Query Engine:**
- Purpose: Execute specialized graph traversal (transitive impact), search, upsert operations
- Location: `worker/db/query-engine.js`
- Contains: Transitive impact algorithms, FTS5 search, statement caching, ChromaDB semantic fallback
- Depends on: Query database handle, ChromaDB client (optional)
- Used by: HTTP endpoints, MCP tool handlers

**HTTP API Server:**
- Purpose: Expose graph, search, and readiness via REST for UI and external clients
- Location: `worker/server/http.js`
- Contains: Fastify setup, project resolution per request, route handlers, CORS configuration
- Depends on: Query Engine resolution, logger, static file serving
- Used by: Graph UI, external tooling

**MCP Server:**
- Purpose: Expose graph analysis as MCP tools for Claude agents
- Location: `worker/mcp/server.js`
- Contains: Tool definitions (impact_query, impact_search, drift_versions, etc.), database resolution
- Depends on: Query Engine resolution, findings validation schema
- Used by: Claude sessions for impact checking, drift analysis

**Graph UI:**
- Purpose: Interactive visualization of service dependency graph
- Location: `worker/ui/`
- Contains: Canvas-based force-directed layout, interaction handlers, detail panels, filter controls, log terminal
- Depends on: D3 force (CDN), HTTP server for graph data
- Used by: Users for visual exploration

**Plugin Entry Points:**
- Purpose: Hook into Claude Code session lifecycle and tool use
- Location: `scripts/`, `hooks/`, `.claude-plugin/`
- Contains: Shell scripts for format/lint/file-guard/session-start, hook configuration
- Depends on: Shell environment, installed linters/formatters
- Used by: Claude Code runtime

## Data Flow

**Service Discovery & Enrichment Pipeline:**

1. User invokes `/ligamen:map` command (or scan via MCP)
2. `buildScanContext(repoPath)` determines scan mode (full vs. incremental)
3. `runDiscoveryPass(repoPath, template, agentRunner)` executes Claude agent with prompt
4. Agent outputs fenced JSON block with services, connections, schemas
5. `parseAgentOutput(text)` extracts and validates findings against schema
6. **Enrichment loop:** Registered enrichers (`registerEnricher()`) process findings:
   - CODEOWNERS enricher reads CODEOWNERS file, adds ownership metadata
   - Auth/DB enricher detects credentials/databases, adds integration metadata
7. Findings are upserted to database via `QueryEngine.upsert*()` methods
8. Query engine updates FTS5 indices for full-text search

**Graph Query & Visualization:**

1. UI calls `GET /graph?hash=<projectHash>`
2. HTTP server resolves query engine via `getQueryEngine(projectRoot)` or hash lookup
3. `QueryEngine.getGraph()` executes SELECT with joins across services/connections
4. Response includes node list (services), edge list (connections), metadata (boundaries, mismatches)
5. UI constructs force simulation, renders on canvas, wires interactions
6. User clicks node → detail panel populated via cached node data
7. User searches → `QueryEngine.search(keyword)` runs FTS5 query, highlights matching nodes

**Impact Query Traversal:**

1. MCP tool receives `source` and `direction` parameters
2. `impactQuery(qe, source, direction)` starts BFS/DFS from source service
3. Transitive impact uses cycle-detection set to avoid infinite loops
4. Each hop evaluated for breaking change severity (CRITICAL/WARN/INFO)
5. Results collected with relationship chain (path from source to affected service)
6. Returned to Claude for decision-making

**Drift Detection:**

1. Drift commands scan multiple linked repos
2. `driftVersions()` compares package.json versions across repos
3. `driftTypes()` compares TypeScript definitions in schema directories
4. `driftOpenApi()` validates OpenAPI specs against recorded schemas
5. Mismatches flagged with file locations and remediation guidance

**State Management:**

- **Database state:** Single SQLite file per project at `~/.ligamen/projects/<hash12>/impact-map.db`
- **Worker state:** PID/port files in `~/.ligamen/`, logs in `~/.ligamen/logs/`
- **UI state:** In-memory graph data, current selection, filter state (not persisted across page reload)
- **Scan state:** Repo state tracked in `repo_state` table with last_scanned_commit/timestamp

## Key Abstractions

**QueryEngine:**
- Purpose: Abstract SQLite operations and graph algorithms
- Examples: `worker/db/query-engine.js`, methods `getGraph()`, `impactQuery()`, `search()`, `upsertService()`
- Pattern: Single class wrapping a Database handle with prepared statement cache for performance

**StmtCache:**
- Purpose: LRU cache for prepared statements to reduce overhead in hot paths
- Examples: `worker/db/query-engine.js` (lines 42-88)
- Pattern: Map-based LRU with O(1) hit/miss via `has()` and O(n) eviction on capacity overflow

**Enricher Registry:**
- Purpose: Allow pluggable post-scan processors without modifying scan manager
- Examples: `registerEnricher("codeowners", createCodeownersEnricher())`
- Pattern: Module-level registry map, enrichers stored as (name, function) pairs, run sequentially in `runEnrichmentPass()`

**Project Hash Sharding:**
- Purpose: Deterministic per-project DB placement without requiring absolute path configuration
- Examples: `projectHashDir(projectRoot)` used in `worker/db/database.js`, `worker/db/pool.js`, `worker/mcp/server.js`
- Pattern: SHA256 hash of projectRoot to 12-char hex prefix, maps to `~/.ligamen/projects/<hash12>/`

**Per-Request Query Engine Resolution:**
- Purpose: Support multi-project worker with single HTTP instance
- Examples: `getQE(request)` in `worker/server/http.js` reads `?project=` or `?hash=` query param
- Pattern: Query engine pool keyed by projectRoot, lazy-initialized on first access

## Entry Points

**HTTP Worker:**
- Location: `worker/index.js`
- Triggers: Shell invocation via `node worker/index.js --port 37888 --data-dir ~/.ligamen`
- Responsibilities: CLI arg parsing, settings file loading, logger setup, Chroma initialization, HTTP server startup, graceful shutdown

**MCP Server:**
- Location: `worker/mcp/server.js`
- Triggers: MCP launcher reads `.mcp.json` and execs `node worker/mcp/server.js`
- Responsibilities: MCP server lifecycle, tool registration, database resolution per-call, JSON-RPC message handling

**Graph UI:**
- Location: `worker/ui/index.html`, `worker/ui/graph.js`
- Triggers: User navigates to `http://localhost:37888`
- Responsibilities: Project picker, graph loading, force simulation, interaction wiring, keyboard/export handlers

**Scanner Entry:**
- Location: Via `/ligamen:map` command or `impact.sh` script invoked by MCP
- Triggers: User invokes command in Claude Code session
- Responsibilities: Call `scanRepos(repoPaths, options, queryEngine)` with injected agent runner

**Session Hooks:**
- Location: `scripts/format.sh`, `scripts/lint.sh`, `scripts/file-guard.sh`, `scripts/install-deps.sh`
- Triggers: Claude Code fires PostToolUse, PreToolUse, SessionStart events
- Responsibilities: Format/lint edited files, block sensitive file writes, install node deps if needed

## Error Handling

**Strategy:** Graceful degradation with logged context. No unhandled promise rejections; errors surfaced via HTTP status codes or error fields in JSON responses.

**Patterns:**
- **Database errors:** Catch and return 500 with error message to caller. Log with error context (component, stack).
- **Missing query engine:** Return 503 "No map data yet" to signal need for initial scan.
- **Findings validation:** Return validation error object with `{ valid: false, error: string }`. Parse errors don't crash scanner.
- **Agent timeout:** Scan manager catches timeout, marks result as failed, continues to next repo.
- **ChromaDB unavailable:** MCP server falls back to FTS5 search automatically; logs "ChromaDB unavailable — using FTS5 fallback".
- **Stale PID/port files:** Worker startup detects and removes stale PID file before starting new instance.

## Cross-Cutting Concerns

**Logging:** Structured JSON logging via `createLogger()` in `worker/lib/logger.js`. All components instantiate logger with component tag. Logs written to `~/.ligamen/logs/worker.log` with size-based rotation (10 MB per file, keep 3 rotated files). Levels: DEBUG, INFO, WARN, ERROR; filtered by `LIGAMEN_LOG_LEVEL` setting.

**Validation:**
- Findings schema validated by `validateFindings()` in `worker/scan/findings.js` using JSDoc type definitions.
- Project paths validated in MCP server: rejected if path escapes `~/.ligamen/projects/` directory.
- Query parameters sanitized before use (project hash validated as 12-char hex).

**Authentication:** None required for HTTP API (local-only CORS, localhost binding implicit). MCP server runs as direct subprocess of Claude Code (no network exposure). File-based credentials protected by `file-guard.sh` hook (blocks Write/Edit to `.env` files).

---

*Architecture analysis: 2026-03-23*
