# Architecture

**Analysis Date:** 2026-03-16

## Pattern Overview

**Overall:** Event-driven plugin with worker backend and hook-based CLI entry points.

**Key Characteristics:**
- Plugin system: Hooks execute scripts on Claude Code events (PreToolUse, PostToolUse, SessionStart)
- Worker process: Long-running Node.js server managing shared SQLite database and query engine
- Multi-project support: Per-project databases indexed by hashed project root path
- Multi-layer search: ChromaDB (semantic) → FTS5 (keyword) → SQL (direct) fallback chain
- Lazy initialization: Hooks and scripts are lightweight; heavy lifting deferred to worker or on-demand commands

## Layers

**Plugin Layer (Hooks):**
- Purpose: Intercept and route Claude Code events to shell scripts
- Location: `hooks/hooks.json`, `hooks/lint.json`
- Contains: Hook configurations with event matchers and command routes
- Depends on: Nothing (entry point only)
- Used by: Claude Code plugin system

**Hook Scripts (Entry Points):**
- Purpose: Execute lightweight checks/guards on write/edit events
- Location: `scripts/format.sh`, `scripts/lint.sh`, `scripts/file-guard.sh`, `scripts/session-start.sh`
- Contains: Event handling, language detection, tool dispatch
- Depends on: `lib/config.sh`, `lib/detect.sh`, `lib/linked-repos.sh`
- Used by: Plugin hook system

**Skill/Command Scripts (Execution Layer):**
- Purpose: Implement on-demand commands like quality-gate, impact, drift, map, pulse
- Location: `scripts/impact.sh`, `scripts/drift-*.sh`, `scripts/pulse-check.sh`
- Contains: Business logic for cross-repo scanning, version checking, dependency analysis
- Depends on: `lib/config.sh`, `lib/linked-repos.sh`, `lib/worker-client.sh`, HTTP calls to worker
- Used by: Claude Code slash commands (via `/gsd:execute-phase`)

**Shared Libraries:**
- Purpose: Utility functions shared across scripts
- Location: `lib/config.sh`, `lib/detect.sh`, `lib/linked-repos.sh`, `lib/worker-client.sh`
- Contains: Configuration loading, language detection, repo enumeration, worker communication
- Depends on: jq, bash builtins
- Used by: All hook scripts and command scripts

**Worker Process (Data & Query Layer):**
- Purpose: Long-running HTTP/MCP server managing databases and executing complex queries
- Location: `worker/index.js` (entry point)
- Contains: HTTP server, MCP server, database pool, query engine, migration system
- Depends on: Node.js (≥20), better-sqlite3, @modelcontextprotocol/sdk, fastify, zod
- Used by: HTTP requests from scripts, MCP protocol from Claude Code

**HTTP Server (REST API):**
- Purpose: REST interface for graph queries, service lookups, impact analysis
- Location: `worker/http-server.js`
- Routes: `/api/readiness`, `/projects`, `/graph`, `/impact`, `/service/:name`, `/scan`, `/versions`
- Depends on: fastify, query-engine, db-pool
- Used by: Command scripts via HTTP calls

**MCP Server (Claude Integration):**
- Purpose: Model Context Protocol server for Claude Code slash commands
- Location: `worker/mcp-server.js`
- Contains: Tools for querying impact, changes, graph, search, and scan results
- Depends on: @modelcontextprotocol/sdk, database, query engine
- Used by: Claude Code directly (via JSON-RPC over stdio)

**Database Pool (Project Management):**
- Purpose: Cache per-project databases and query engines
- Location: `worker/db-pool.js`
- Caching strategy: `projectRoot → QueryEngine` (Map cache)
- Lazy loading: DB opened on first request, cached for worker lifetime
- Project isolation: Each project has hash-based directory at `~/.allclear/projects/<hash>/impact-map.db`
- Used by: HTTP server, MCP server

**Database Lifecycle (Migration & Initialization):**
- Purpose: Create/migrate SQLite database with schema
- Location: `worker/db.js`
- Top-level await: Migrations preloaded at module load time
- Migrations: Versioned modules in `worker/migrations/` applied sequentially
- Database path: `~/.allclear/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`
- Used by: DB pool on first project access

**Query Engine (Business Logic):**
- Purpose: Execute transitive impact queries, search, and upsert operations
- Location: `worker/query-engine.js`
- Query types: Transitive impact (recursive CTE), direct impact, FTS5 search, ChromaDB semantic search
- State management: Per-instance DB handle, cycle detection in transitive walks
- Used by: HTTP server, MCP server

**Schema & Findings:**
- Purpose: Type validation and persistence of scan results
- Location: `worker/findings-schema.js` (Zod schemas), `worker/migrations/001_initial_schema.js`
- Tables: repos, services, connections, schemas, fields, map_versions, repo_state
- Used by: Scan manager, query engine

**ChromaDB Integration (Vector Search):**
- Purpose: Optional semantic search tier for finding services by description
- Location: `worker/chroma-sync.js`
- Fallback: Disabled if ChromaDB unavailable or connection fails
- Used by: Query engine search layer

**Scan Manager (Repository Discovery):**
- Purpose: Discover services in repos and persist findings to database
- Location: `worker/scan-manager.js`
- Process: Git traversal, file pattern matching, OpenAPI/Dockerfile parsing, upsert to DB
- Used by: Commands (e.g., `/allclear:map`) via HTTP POST `/scan`

## Data Flow

**Hook Execution (PreToolUse):**

1. Claude Code fires PreToolUse event (Write/Edit/MultiEdit)
2. Hook system invokes `scripts/file-guard.sh`
3. Script reads stdin (JSON event), extracts file path
4. Guard checks against blocked patterns (`.env`, `*.lock`, credentials)
5. Exits 0 (pass) or 1 (fail)

**Hook Execution (PostToolUse):**

1. Claude Code fires PostToolUse event (Write/Edit/MultiEdit)
2. Hook system invokes `scripts/format.sh`, then `scripts/lint.sh`
3. Format script dispatches to `prettier`, `ruff`, `rustfmt`, `gofmt` by language
4. Lint script language-detects, runs appropriate linter (`eslint`, `pylint`, etc.)
5. Both exit 0 (always pass; errors logged, not blocked)

**Hook Execution (SessionStart/UserPromptSubmit):**

1. Claude Code fires SessionStart or UserPromptSubmit event
2. Hook system invokes `scripts/session-start.sh`
3. Script detects project type (Python, Node, Go, Rust, etc.) via dependency files
4. Outputs formatted context string for Claude
5. Context passed to Claude in session prompt

**On-Demand Command Flow (e.g., `/allclear:quality-gate`):**

1. User invokes `/allclear:quality-gate` in Claude Code
2. Claude invokes bash script `scripts/quality-gate.sh` (via phase execution)
3. Script loads config, detects language, runs linters, formatters, tests, typechecks
4. Output summarized for Claude

**On-Demand Command Flow (e.g., `/allclear:map`):**

1. User invokes `/allclear:map`
2. Phase execution runs bash script with bash flags and options
3. Script loads linked repos from config, spawns scan-manager on each
4. Scan manager walks repository, discovers services, sends POST to `worker:37888/scan`
5. Worker (HTTP server) routes to query engine, which upserts repos/services/connections into DB
6. Results returned to Claude

**Impact Query Flow:**

1. User asks Claude: "What breaks if I change the auth endpoint?"
2. Claude invokes `/allclear:cross-impact` with changed service/endpoint
3. Script queries `worker:37888/impact?change=auth.login` via HTTP
4. HTTP server resolves query engine for project via `db-pool.getQueryEngine(project)`
5. Query engine executes transitive CTE to find all downstream consumers
6. Results classified (CRITICAL/WARN/INFO) and returned
7. Claude summarizes findings for user

**Graph Visualization Flow:**

1. User opens service map or dependency graph UI
2. Frontend (React) requests `worker:37888/graph?project=/path`
3. HTTP server resolves query engine, calls `qe.getGraph()`
4. Query engine returns serialized graph (nodes: services, edges: connections)
5. Frontend renders with D3 or similar

**State Management:**

- **Plugin state:** None (stateless hooks)
- **Script state:** Config file (`allclear.config.json`) parsed per invocation
- **Worker state:** In-memory database pool + SQLite databases on disk
- **Database state:** Persistent SQLite with WAL mode (Write-Ahead Logging)
- **Session state:** ChromaDB optional; if unavailable, search falls back to FTS5

## Key Abstractions

**QueryEngine:**
- Purpose: Encapsulates all query patterns against SQLite
- Examples: `worker/query-engine.js`
- Pattern: Class wrapping better-sqlite3 Database, exposes query methods (getGraph, getImpact, getService, search)
- Key methods:
  - `getGraph()`: Return all services and connections
  - `getImpact(change, options)`: Find impacted services (transitive or direct)
  - `getService(name)`: Lookup single service details
  - `search(query)`: 3-tier search (ChromaDB → FTS5 → SQL)
  - `upsertRepo/Service/Connection()`: Persist scan findings

**ScanManager:**
- Purpose: Discover services and persist findings to database
- Examples: `worker/scan-manager.js`
- Pattern: Walk filesystem, parse manifests, generate findings, POST to worker HTTP API
- Process: Executes on each linked repo, called by command scripts

**RepoDiscovery:**
- Purpose: Enumerate repositories and find service dependencies
- Examples: `worker/repo-discovery.js`
- Pattern: Git traversal with glob patterns, OpenAPI/Dockerfile detection, manifest parsing

**Shared Library Pattern:**
- Purpose: Sourceable bash utilities with guard against double-source
- Examples: `lib/config.sh`, `lib/linked-repos.sh`
- Pattern: Guard variable (e.g., `_ALLCLEAR_CONFIG_LOADED`), populate global arrays/vars
- Safety: Return 0 on second source to maintain idempotency

## Entry Points

**Plugin Hook (format.sh):**
- Location: `scripts/format.sh`
- Triggers: PostToolUse(Write|Edit|MultiEdit)
- Responsibilities: Read stdin JSON, extract file path, dispatch to language-specific formatter, silently pass
- Exit behavior: Always exits 0

**Plugin Hook (lint.sh):**
- Location: `scripts/lint.sh`
- Triggers: PostToolUse(Write|Edit|MultiEdit)
- Responsibilities: Read stdin JSON, extract file path, detect language, run appropriate linter, report findings to stderr
- Exit behavior: Always exits 0

**Plugin Hook (file-guard.sh):**
- Location: `scripts/file-guard.sh`
- Triggers: PreToolUse(Write|Edit|MultiEdit)
- Responsibilities: Block writes to `.env`, `*.lock`, credentials, keys
- Exit behavior: Exits 1 if blocked, 0 if allowed

**Plugin Hook (session-start.sh):**
- Location: `scripts/session-start.sh`
- Triggers: SessionStart, UserPromptSubmit
- Responsibilities: Detect project type, output context for Claude
- Exit behavior: Always exits 0

**Worker Process (index.js):**
- Location: `worker/index.js`
- Triggers: Manual invocation via `node worker/index.js` or lifecycle script
- Responsibilities: Initialize HTTP server, MCP server, database pool, handle signals (SIGTERM, SIGINT)
- Configuration: Reads `~/.allclear/settings.json` for port, log level, data directory
- Output: Writes PID file and logs to `~/.allclear/logs/worker.log`

**Command Scripts:**
- Location: `scripts/quality-gate.sh`, `scripts/impact.sh`, `scripts/drift-versions.sh`, etc.
- Triggers: Claude Code slash commands
- Responsibilities: Implement on-demand scanning, querying, comparison
- Coordination: Call worker HTTP API or execute local checks

## Error Handling

**Strategy:** Defensive scripting with silent fallbacks and stderr logging.

**Patterns:**

- **Config missing:** Use defaults (e.g., `ALLCLEAR_CONFIG_LINKED_REPOS=()` if no config file)
- **Language detection failure:** Fall back to extension-based heuristic
- **Formatter not installed:** Skip silently (tools are optional dependencies)
- **Worker unavailable:** Skip operations that depend on worker, return empty results
- **Database missing:** Return null from `getQueryEngine()`, HTTP routes respond with 503
- **ChromaDB unavailable:** Seamlessly fall back to FTS5, then SQL
- **Migration failure:** Log to stderr, exit process (data integrity failure)
- **Linter errors:** Report to stderr but exit 0 (non-blocking feedback)

## Cross-Cutting Concerns

**Logging:**
- Hooks: Silent or stderr-only (preserve stdout for MCP)
- Worker: Structured JSON logging to `~/.allclear/logs/worker.log` and stderr
- Scripts: Tab-separated or JSON output to stdout for machine consumption
- Debug: ALLCLEAR_LOG_LEVEL env var (DEBUG, INFO, WARN, ERROR)

**Validation:**
- Configuration: jq for JSON schema validation (warn on malformed, use defaults)
- HTTP requests: Zod schemas for request bodies (POST /scan)
- Database: Foreign key constraints, migrations ensure schema correctness
- Query parameters: HTTP routes validate required params, respond 400 on missing

**Authentication:**
- None: AllClear assumes single-machine, trusted environment
- Isolation: Project databases isolated by file system permissions
- Security: File guard blocks sensitive file writes

**Performance:**
- Database pool caches per-project QueryEngine instances
- FTS5 full-text search (inverted index on services_fts virtual table)
- ChromaDB optional for higher-latency semantic search
- WAL mode enables concurrent reads while writes proceed
- Transitive impact queries use recursive CTE with cycle detection (max depth 10)

---

*Architecture analysis: 2026-03-16*
