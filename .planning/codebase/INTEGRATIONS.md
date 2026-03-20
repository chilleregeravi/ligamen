# External Integrations

**Analysis Date:** 2026-03-20

## APIs & External Services

**Model Context Protocol (MCP):**
- Claude Code IDE - MCP server for integration as a quality-gate plugin
  - SDK: `@modelcontextprotocol/sdk` v1.27.1
  - Transport: Stdio (stdin/stdout) in `worker/mcp/server.js`
  - Tools exposed: impact query, service graph, search, scan
  - Auth: Direct IDE integration (no separate auth)

**D3.js Force Simulation:**
- CDN: https://cdn.jsdelivr.net/npm/d3-force@3/+esm
  - Used in `worker/ui/force-worker.js` for graph layout calculation
  - Loaded dynamically in browser via ES module import

## Data Storage

**Primary Database:**
- SQLite 3 (embedded)
  - Location: `~/.ligamen/projects/<project-hash>/impact-map.db`
  - Client: `better-sqlite3` v12.8.0
  - WAL mode enabled for concurrent access
  - Migrations: `worker/db/migrations/` (001-008 versioned)
  - Schema: services, connections, fields, schemas, actors, scan_versions, dedup

**Vector Search (Optional, Non-blocking):**
- ChromaDB - Optional semantic search enhancement
  - Connection: `worker/server/chroma.js`
  - Config vars: `LIGAMEN_CHROMA_MODE`, `LIGAMEN_CHROMA_HOST`, `LIGAMEN_CHROMA_PORT`, `LIGAMEN_CHROMA_SSL`, `LIGAMEN_CHROMA_API_KEY`, `LIGAMEN_CHROMA_TENANT`, `LIGAMEN_CHROMA_DATABASE`
  - Default: localhost:8000 (if `LIGAMEN_CHROMA_MODE` is set)
  - Fallback: SQLite FTS5 full-text search when unavailable
  - Fire-and-forget sync: `syncFindings()` never blocks or rejects

**File Storage:**
- Local filesystem only
  - Project data: `~/.ligamen/projects/<hash>/`
  - Logs: `~/.ligamen/logs/`
  - Settings: `~/.ligamen/settings.json`

**Caching:**
- In-memory query engine pool in `worker/db/pool.js`
- Per-project QueryEngine cached on first access
  - Cache key: absolute project root path
  - Lifetime: worker process lifetime

## Authentication & Identity

**Auth Provider:**
- None - Ligamen is local-only without remote auth
- Claude Code integration: Direct IDE authentication (handled by Claude Code itself)
- MCP tools: Accessed via Claude Code plugin loader, no separate credentials

## Monitoring & Observability

**Error Tracking:**
- None - No external error tracking service configured
- stderr logging in `worker/db/pool.js` for DB errors
- Structured logging via `worker/lib/logger.js`

**Logs:**
- File-based structured JSON logs in `~/.ligamen/logs/`
- Levels: INFO, DEBUG, ERROR (controlled by `LIGAMEN_LOG_LEVEL`)
- Components: 'worker', 'mcp', 'http', 'scan'
- Exposed via REST endpoint: `GET /api/logs?component=<name>&since=<timestamp>`

## CI/CD & Deployment

**Hosting:**
- Local execution only (no remote deployment)
- Runs as background worker process (daemonized via scripts)
- HTTP server: localhost:37888 (configurable via `LIGAMEN_WORKER_PORT`)

**CI Pipeline:**
- None configured - Local workflow only
- No GitHub Actions or external CI integration
- Shell scripts in `scripts/` for start/stop/integration

## Environment Configuration

**Required Environment Variables:**
- `LIGAMEN_DATA_DIR` - Workspace directory (defaults to ~/.ligamen)
- Optional ChromaDB config if using vector search

**Secrets Location:**
- No external secrets required
- Optional: `LIGAMEN_CHROMA_API_KEY` if ChromaDB requires authentication
- Settings stored in plaintext JSON: `~/.ligamen/settings.json` (user-controlled, local)

## Webhooks & Callbacks

**Incoming:**
- `POST /scan` - Accept findings from Claude Code agent
  - Body: JSON with project root, service info, connections, schemas
  - No authentication required (local only)

**Outgoing:**
- None - Ligamen is query-only, does not push to external services

## HTTP Endpoints

**Server:** Fastify on `localhost:37888` (configurable)

**Public Endpoints:**
- `GET /api/readiness` - Health check (always 200)
- `GET /api/version` - Worker version number
- `GET /projects` - List all indexed projects
- `GET /graph?project=<path>` - Full service graph JSON
- `GET /impact?project=<path>&change=<change>` - Impact analysis for code change
- `GET /service/:name?project=<path>` - Service details
- `GET /versions?project=<path>` - Schema versions
- `GET /api/logs?component=<name>&since=<timestamp>` - Structured logs
- `POST /scan` - Ingest findings from agent
- `GET /` - Static UI (index.html, assets from `worker/ui/`)

**CORS Configuration:**
- Allowed origins: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://127.0.0.1:*` (dev Vite server)

## MCP Tools (Claude Code Integration)

**Server:** `worker/mcp/server.js` (stdio transport)

**Tools Exposed:**
- `query-impact` - Impact analysis for service/endpoint
- `query-service-graph` - Full or filtered graph query
- `search-services` - Full-text search across services
- `scan-and-ingest` - Scan project and ingest findings
- `list-projects` - List indexed projects
- `get-project-details` - Project metadata

**Input Validation:**
- All tools use zod schema validation
- Project parameter accepts: absolute path, 12-char hash, or repo name

---

*Integration audit: 2026-03-20*
