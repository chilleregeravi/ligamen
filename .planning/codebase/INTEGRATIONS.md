# External Integrations

**Analysis Date:** 2026-03-16

## APIs & External Services

**Model Context Protocol (MCP):**
- AllClear MCP Server (`worker/mcp-server.js`)
  - SDK: `@modelcontextprotocol/sdk` v1.27.1
  - Transport: Stdio (stdin/stdout communication with Claude Code)
  - Tools: impact_query, impact_changed, impact_graph, impact_search, impact_scan
  - Auth: None (embedded in Claude Code process)

**HTTP Worker API:**
- Internal HTTP server (`worker/http-server.js`) on configurable port
- Endpoints:
  - `GET /api/readiness` — Health check (always 200)
  - `GET /api/version` — Running worker version
  - `GET /projects` — List all projects with DBs
  - `GET /graph?project=/path` — Full service dependency graph
  - `POST /scan?project=/path` — Trigger dependency scan
  - `GET /` — Serve static UI assets from `worker/ui/`

**ChromaDB (Optional Vector Search):**
- Service: External ChromaDB instance (optional)
- Connection: HTTP/HTTPS over network
- Configuration:
  - `ALLCLEAR_CHROMA_MODE` — Enable/disable (empty string = disabled)
  - `ALLCLEAR_CHROMA_HOST` — Host (default: localhost)
  - `ALLCLEAR_CHROMA_PORT` — Port (default: 8000)
  - `ALLCLEAR_CHROMA_SSL` — Use HTTPS (set to 'true' for SSL)
- Client: `chromadb` npm package v3.3.3
- Collection: "allclear-impact" (auto-created)
- Usage: Semantic search on service connections (falls back to FTS5 if unavailable)
- Fire-and-forget sync: `syncFindings()` in `worker/db.js` never blocks persistence
- Failure mode: Non-fatal — ChromaDB outage logs to stderr but never prevents SQLite writes

## Data Storage

**Databases:**
- SQLite 3 (via better-sqlite3)
  - Connection: Local file at `~/.allclear/projects/<sha256_hash>/impact-map.db`
  - Client: better-sqlite3 v12.8.0 (synchronous, native bindings)
  - Mode: WAL (Write-Ahead Logging) enabled
  - Pool: Per-project DB caching in `worker/db-pool.js`

**File Storage:**
- Local filesystem only
  - User data: `~/.allclear/`
  - Snapshots: `~/.allclear/projects/<hash>/snapshots/`
  - Logs: `~/.allclear/logs/`
  - No cloud storage integration

**Caching:**
- In-memory: QueryEngine instances cached per project
- Database cache: SQLite pragma `cache_size = -64000` (64 MB page cache)
- No Redis/Memcached integration

## Authentication & Identity

**Auth Provider:**
- Custom (embedded in Claude Code)
- MCP server communicates via stdio to Claude Code process
- No external auth service required

**Implementation:**
- Claude Code plugin system handles authentication
- AllClear has no user/password management
- All operations inherit Claude Code's environment context

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)

**Logs:**
- Structured JSON logging to `~/.allclear/logs/worker.log`
- Levels: DEBUG, INFO, WARN, ERROR
- Format: `{ ts: ISO8601, level, msg, pid, port, ...extra }`
- Configurable via `ALLCLEAR_LOG_LEVEL` env var or `settings.json`
- stderr output for immediate visibility in console

**Health Checks:**
- Worker readiness: `GET /api/readiness`
- Version checking: `GET /api/version` (detects restart-on-update)
- ChromaDB heartbeat: `client.heartbeat()` on init (one-time check)

## CI/CD & Deployment

**Hosting:**
- Embedded in Claude Code (plugin execution)
- Worker runs as daemon process on user's machine
- No cloud deployment required

**CI Pipeline:**
- None detected in codebase
- Tests run locally via: `npm test` or `make test`
- Shell scripts validated with shellcheck (lint target)
- JSON configs validated with jq (check target)

## Environment Configuration

**Required env vars:**
- None — all have sensible defaults

**Optional env vars (machine-wide):**
- `ALLCLEAR_DATA_DIR` — Override data directory (default: ~/.allclear)
- `ALLCLEAR_WORKER_PORT` — Override worker port (default: 37888)
- `ALLCLEAR_LOG_LEVEL` — Set logging level (DEBUG|INFO|WARN|ERROR)

**Optional env vars (ChromaDB integration):**
- `ALLCLEAR_CHROMA_MODE` — Set to 'local' or empty (default: empty)
- `ALLCLEAR_CHROMA_HOST` — Override host (default: localhost)
- `ALLCLEAR_CHROMA_PORT` — Override port (default: 8000)
- `ALLCLEAR_CHROMA_SSL` — Set to 'true' for HTTPS (default: false)

**Optional env vars (project-specific):**
- `ALLCLEAR_PROJECT_ROOT` — Override project detection for MCP server
- `ALLCLEAR_DB_PATH` — Override database file location

**Secrets location:**
- No secrets stored in AllClear itself
- Plugin installation via Claude Code marketplace
- Configuration in plaintext files (no credentials required)

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Worker exposes REST API (not a webhook consumer)
- Chrome UI can fetch from worker API endpoints
- No external callbacks or event subscriptions

## Git Integration

**Usage:**
- `execSync('git diff ...')` to detect changed files (impact analysis)
- `execSync('git diff --name-only ...')` for file change detection
- Required for `/allclear:cross-impact` skill
- Non-fatal if not in git repo (returns empty changed files)

## External CLI Tools

**Required by hooks/scripts:**
- jq — JSON parsing in shell scripts (worker startup, config loading)
- curl — HTTP requests (worker version checks, readiness polling)
- git — Dependency impact analysis, file change detection
- shellcheck — Linting shell scripts (via Makefile lint target)

---

*Integration audit: 2026-03-16*
