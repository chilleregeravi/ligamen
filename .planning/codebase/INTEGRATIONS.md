# External Integrations

**Analysis Date:** 2026-03-23

## APIs & External Services

**Claude Code Integration:**
- Model Context Protocol (MCP) - Stdio transport for exposing Ligamen tools
  - SDK: `@modelcontextprotocol/sdk@1.27.1`
  - Location: `worker/mcp/server.js` (tool definitions)
  - Tools: impact analysis, drift detection, semantic search, OpenAPI breaking changes

**Git Integration:**
- Local git commands via `child_process.execFileSync()`
- Operations: diff detection, file history, branch tracking, log queries
- Location: `worker/scan/manager.js` (getChangedFiles, incremental scan logic)

## Data Storage

**Databases:**
- SQLite 3 (primary)
  - Binding: better-sqlite3 12.8.0
  - Connection: Per-project at `~/.ligamen/projects/<hash>/impact-map.db`
  - Client: `QueryEngine` class in `worker/db/query-engine.js`
  - WAL mode enabled for concurrent access
  - Migrations: 9 schema versions in `worker/db/migrations/`

**Vector Database (Optional):**
- ChromaDB 3.3.3 (semantic search enhancement)
  - Connection modes: local or remote (configurable via env)
  - Collection: "ligamen-impact" (embeddings for findings)
  - Graceful degradation: Falls back to SQLite FTS5 if unavailable
  - Status: Non-blocking initialization; availability checked once at startup

**File Storage:**
- Local filesystem only
  - Logs: `~/.ligamen/logs/worker.log` (rotated, max 10 MB per file)
  - Projects: `~/.ligamen/projects/` (per-hash directories)
  - Settings: `~/.ligamen/settings.json` (worker configuration)

**Caching:**
- In-memory pool: Map-based QueryEngine cache in `worker/db/pool.js`
  - Key: absolute project path
  - Value: QueryEngine instance (holds open DB connection)
  - Lifecycle: Worker lifetime (cleared on shutdown)

## Authentication & Identity

**Auth Provider:**
- None for internal APIs
- Claude Code provides session authentication via MCP transport
- No external identity provider required

**Authorization:**
- File path security: Project path must resolve within `~/.ligamen/projects/` (path escape prevention in `worker/mcp/server.js`)
- Read-only database access: SQLite databases opened in read-only mode (`readonly: true` in `worker/mcp/server.js`)

## Monitoring & Observability

**Error Tracking:**
- None (no external service)

**Logs:**
- Structured JSON logging with levels: DEBUG, INFO, WARN, ERROR
- Writer: Custom logger in `worker/lib/logger.js`
- Format: `{ts, level, msg, pid, component, port, ...extra}`
- Rotation: Size-based (10 MB threshold), keeps 3 rotated files (.1, .2, .3)
- Output: `~/.ligamen/logs/worker.log`
- Components: worker, http, mcp, scan

**Diagnostics:**
- Health check endpoint: `GET /api/readiness` (always returns 200)
- Version endpoint: `GET /api/version` (returns worker version)

## CI/CD & Deployment

**Hosting:**
- Claude Code plugin ecosystem
- Runs as background worker process on developer machine

**CI Pipeline:**
- None detected (Makefile targets: test, lint, check, install, uninstall, dev)

**Plugin Manifest:**
- Location: `plugins/ligamen/.claude-plugin/plugin.json`
- Registered in Claude marketplace (name: @ligamen/cli)
- Hooks: PostToolUse, PreToolUse, SessionStart, UserPromptSubmit

## Environment Configuration

**Required env vars for worker startup:**
- `LIGAMEN_DATA_DIR` (default: `~/.ligamen`) - Base data directory
- `LIGAMEN_LOG_LEVEL` (read from settings.json) - DEBUG|INFO|WARN|ERROR
- `LIGAMEN_WORKER_PORT` (read from settings.json, default: 37888) - HTTP server port

**ChromaDB env vars** (optional):
- `LIGAMEN_CHROMA_MODE` - 'local' or empty (enables/disables)
- `LIGAMEN_CHROMA_HOST` - default: localhost
- `LIGAMEN_CHROMA_PORT` - default: 8000
- `LIGAMEN_CHROMA_SSL` - 'true' for HTTPS
- `LIGAMEN_CHROMA_API_KEY` - API key if required
- `LIGAMEN_CHROMA_TENANT` - default: default_tenant
- `LIGAMEN_CHROMA_DATABASE` - default: default_database

**Database env vars** (overrides):
- `LIGAMEN_DB_PATH` - Override computed database path
- `LIGAMEN_PROJECT_ROOT` - Override current working directory as project root

**Secrets location:**
- Settings: `~/.ligamen/settings.json` (not committed, contains LIGAMEN_* vars)
- No .env files or external secret management detected

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- None detected

## Plugin Hook System

**Post-processing Hooks** (after Write/Edit):
- Format: `scripts/format.sh` (timeout: 10s)
- Lint: `scripts/lint.sh` (timeout: 10s)

**Pre-processing Hooks** (before Write/Edit):
- File Guard: `scripts/file-guard.sh` (timeout: 10s)

**Session Hooks:**
- Install Dependencies: `scripts/install-deps.sh` (timeout: 120s) - SessionStart
- Session Start: `scripts/session-start.sh` (timeout: 10s) - SessionStart + UserPromptSubmit

## GraphQL/REST APIs

**REST Endpoints** (internal to HTTP server):
- `GET /api/readiness` - Health check
- `GET /api/version` - Worker version
- `GET /projects` - List all projects with databases
- `GET /graph?project=/path` - Full service dependency graph (JSON)
- `GET /search?q=query&project=/path` - Semantic search results
- `GET /impact?service=name&project=/path` - Impact analysis
- `GET /affected?file=path&project=/path` - Affected services
- Multiple drift detection endpoints for OpenAPI, database schema, etc.
- All endpoints optional: respond with error if no project DB loaded

**CORS:**
- Configured for localhost development: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://127.0.0.1:*`

## MCP Tool Definitions

**Location:** `worker/mcp/server.js` (exported as tools)

**Tool categories:**
- Impact analysis (transitive dependency traversal, max depth 7, timeout 30s)
- Schema drift detection (OpenAPI breaking changes via oasdiff)
- Semantic search (optional ChromaDB, fallback to FTS5)
- Database enrichment (auth sources, external dependencies)

---

*Integration audit: 2026-03-23*
