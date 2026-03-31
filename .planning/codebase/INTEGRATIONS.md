# External Integrations

**Analysis Date:** 2026-03-31

## APIs & External Services

**Claude Code Plugin System:**
- Ligamen is a Claude Code plugin registered via `plugins/ligamen/.claude-plugin/marketplace.json`
- Plugin manifest: `plugins/ligamen/.claude-plugin/plugin.json`
- Hook system: `plugins/ligamen/hooks/hooks.json` defines 4 hook events:
  - `PostToolUse` (Write|Edit|MultiEdit) — auto-format + auto-lint
  - `PreToolUse` (Write|Edit|MultiEdit) — file guard
  - `SessionStart` — dependency install + session context injection
  - `UserPromptSubmit` — session context injection (fallback for upstream bug #10373)
- Slash commands: `plugins/ligamen/commands/map.md`, `cross-impact.md`, `drift.md`
- Skills: `plugins/ligamen/skills/impact/SKILL.md`

**Model Context Protocol (MCP):**
- SDK: `@modelcontextprotocol/sdk` ^1.27.1
- Transport: stdio (configured in `plugins/ligamen/.mcp.json`, launched via `plugins/ligamen/scripts/mcp-wrapper.sh`)
- Server: `plugins/ligamen/worker/mcp/server.js`
- Exposed tools:
  - `impact_query` — query impact of a specific service/endpoint change
  - `impact_changed` — impact analysis based on git-changed files
  - `impact_graph` — full dependency graph retrieval
  - `impact_search` — semantic search across service graph (ChromaDB or FTS5 fallback)
  - `impact_scan` — trigger repo scanning
  - `drift_versions` — cross-repo dependency version drift detection
  - `drift_types` — shared type definition drift detection
  - `drift_openapi` — OpenAPI spec breaking change detection
- Query engine resolution: accepts absolute path, 12-char hex hash, repo name, or falls back to env/cwd
- Transitive impact traversal: max depth 7 (`MAX_TRANSITIVE_DEPTH`), timeout 30s (`QUERY_TIMEOUT_MS`)

**Git Integration:**
- Local git commands via `execFileSync()` in `plugins/ligamen/worker/scan/manager.js`
- Operations: `git diff` (changed file detection), `git log` (commit history), `git rev-parse` (branch tracking)
- Used for incremental scanning: only re-scans files changed since last commit
- Drift scripts use git for cross-repo comparison: `plugins/ligamen/scripts/drift-versions.sh`, `drift-types.sh`, `drift-openapi.sh`

**CDN (D3 Force):**
- D3 Force v3 loaded at runtime via ESM CDN: `https://cdn.jsdelivr.net/npm/d3-force@3/+esm`
- Used in the Web Worker for graph physics simulation (`plugins/ligamen/worker/ui/force-worker.js`)
- No local installation; requires internet access for first graph UI load (cached by browser thereafter)

## Data Storage

**Databases:**
- SQLite 3 (primary, embedded via better-sqlite3)
  - Binding: `better-sqlite3` ^12.8.0
  - Location: `~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`
  - Client: `QueryEngine` class in `plugins/ligamen/worker/db/query-engine.js`
  - Pool: `plugins/ligamen/worker/db/pool.js` (Map-based cache, keyed by project root)
  - Database lifecycle: `plugins/ligamen/worker/db/database.js` (openDb, runMigrations)
  - Pragmas: WAL mode, foreign keys ON, synchronous NORMAL, 64MB cache, 5s busy timeout
  - Migrations: 9 versions in `plugins/ligamen/worker/db/migrations/` (001 through 009)
  - FTS5: full-text search virtual tables for services, connections, and fields
  - Snapshots: VACUUM INTO for atomic copies, stored in `snapshots/` subdirectory
  - Prepared statement cache: LRU cache (capacity 50) in `StmtCache` class (`plugins/ligamen/worker/db/query-engine.js`)

**Vector Database (Optional):**
- ChromaDB v3.3.3
  - Client: `plugins/ligamen/worker/server/chroma.js`
  - Collection name: `ligamen-impact`
  - Initialization: non-blocking at worker startup (controlled by `LIGAMEN_CHROMA_MODE` setting in `~/.ligamen/settings.json`)
  - Health check: `client.heartbeat()` on init
  - Operations:
    - `syncFindings()` — fire-and-forget upsert of services and endpoints with enriched metadata (boundary names, actor names)
    - `chromaSearch()` — semantic search; throws on unavailable to trigger FTS5 fallback
  - Configuration via `~/.ligamen/settings.json`:
    - `LIGAMEN_CHROMA_MODE` — "local" to enable
    - `LIGAMEN_CHROMA_HOST` — host (default: localhost)
    - `LIGAMEN_CHROMA_PORT` — port (default: 8000)
    - `LIGAMEN_CHROMA_SSL` — "true" for HTTPS
    - `LIGAMEN_CHROMA_API_KEY` — Bearer token auth
    - `LIGAMEN_CHROMA_TENANT` — tenant (default: default_tenant)
    - `LIGAMEN_CHROMA_DATABASE` — database (default: default_database)
  - Failure mode: ChromaDB outage never prevents SQLite persistence; all sync is fire-and-forget

**File Storage:**
- Local filesystem only
  - Logs: `~/.ligamen/logs/worker.log` (structured JSON, 10MB rotation, 3 rotated files)
  - PID tracking: `~/.ligamen/worker.pid`, `~/.ligamen/worker.port`
  - Settings: `~/.ligamen/settings.json`
  - Per-project DBs: `~/.ligamen/projects/<hash>/impact-map.db`

**Caching:**
- In-memory QueryEngine pool in `plugins/ligamen/worker/db/pool.js`
  - Cache key: absolute project path (or `__hash__<hash>` for hash-based lookups)
  - Cache value: `QueryEngine` instance with open DB connection
  - Lifetime: worker process lifetime (cleared on shutdown)
  - Lookup methods: by project root path, by 12-char SHA-256 hash, by repo name (scans all DBs)

## Authentication & Identity

**Auth Provider:**
- None required for internal APIs (worker binds to `127.0.0.1` only)
- Claude Code provides session context via MCP stdio transport
- ChromaDB connection supports optional Bearer token auth via `LIGAMEN_CHROMA_API_KEY`

**Security Controls:**
- Worker HTTP server binds to `127.0.0.1` only (no network exposure) — `plugins/ligamen/worker/server/http.js` line 272
- MCP server database access: read-only mode for query operations (`readonly: true` in `plugins/ligamen/worker/mcp/server.js`)
- File guard blocks writes to sensitive files: `.env`, `.env.*`, `*.pem`, `*.key`, `*credentials*`, `*secret*`, `*.lock`, `package-lock.json`, `node_modules/`, `.venv/`, `target/` (`plugins/ligamen/scripts/file-guard.sh`)

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)

**Logging:**
- Structured JSON logging via `plugins/ligamen/worker/lib/logger.js`
- Format: `{"ts": "ISO8601", "level": "INFO|WARN|ERROR|DEBUG", "msg": "...", "pid": N, "port": N, "component": "worker|http|mcp|scan", ...extra}`
- Output: `~/.ligamen/logs/worker.log`
- Rotation: size-based at 10MB threshold, keeps 3 rotated files (.1, .2, .3)
- Log viewing: `GET /api/logs?component=&since=` endpoint serves parsed log lines to UI
- Component tags: `worker`, `http`, `mcp`, `scan` — used for filtering

**Health Checks:**
- `GET /api/readiness` — always returns `{"status": "ok"}` (worker liveness)
- `GET /api/version` — returns `{"version": "5.7.0"}` (version mismatch detection for auto-restart)
- Worker status check: `plugins/ligamen/lib/worker-client.sh` `worker_running()` uses curl to `/api/readiness`

## CI/CD & Deployment

**Hosting:**
- Fully local; runs as a background daemon on developer machines
- Distributed as a Claude Code plugin via marketplace

**CI Pipeline:**
- No GitHub Actions or external CI detected
- Local CI via Makefile targets:
  - `make test` — runs BATS tests (`tests/*.bats`)
  - `make lint` — ShellCheck on `plugins/ligamen/scripts/*.sh` and `plugins/ligamen/lib/*.sh`
  - `make check` — validates `plugin.json` and `hooks.json` with jq
  - `make install` / `make uninstall` — plugin registration
  - `make dev` — launch Claude Code with plugin loaded (no install)

**Deployment:**
- Plugin installation: `claude plugin marketplace add <url>` then `claude plugin install ligamen@ligamen --scope user`
- Dependency installation: automated at session start via `plugins/ligamen/scripts/install-deps.sh` (npm install with diff-based idempotency)
- Worker auto-start: triggered by `plugins/ligamen/scripts/session-start.sh` when `ligamen.config.json` has `impact-map` key
- Version mismatch auto-restart: both `plugins/ligamen/scripts/worker-start.sh` and `plugins/ligamen/scripts/session-start.sh` check installed vs running version and restart if mismatched

## REST API Endpoints

**Worker HTTP Server (`plugins/ligamen/worker/server/http.js`, default port 37888):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/readiness` | Health check (always 200) |
| GET | `/api/version` | Worker version from package.json |
| GET | `/api/logs` | Filtered log lines for UI polling (`?component=`, `?since=`) |
| GET | `/projects` | List all projects with DBs (hash, path, service/repo counts) |
| GET | `/graph` | Full service dependency graph (`?project=` or `?hash=`) |
| GET | `/impact` | Impact analysis for a change (`?change=`, `?project=`) |
| GET | `/service/:name` | Service details by name (`?project=`) |
| GET | `/versions` | Map version history (`?project=`) |
| POST | `/scan` | Persist scan findings (body: `repo_path`, `findings`, `commit`, `project`) |

**CORS Policy:**
- Origins: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://127.0.0.1:*` (regex)

**Static Files:**
- Served from `plugins/ligamen/worker/ui/` at `/` prefix

## Agent Scanning System

**Scan orchestration:** `plugins/ligamen/worker/scan/manager.js`
- Injected agent runner pattern (decouples from Claude's Task tool)
- Modes: `full` (all files), `incremental` (only git-changed files), `incremental-noop` (no changes)
- Discovery pass: `plugins/ligamen/worker/scan/discovery.js` — identifies repos from `ligamen.config.json` linked-repos + parent directory scan
- Findings parser: `plugins/ligamen/worker/scan/findings.js` — extracts fenced JSON from agent output, validates schema
- Enrichment pipeline: `plugins/ligamen/worker/scan/enrichment.js` (registry pattern)
  - CODEOWNERS enricher: `plugins/ligamen/worker/scan/codeowners.js`
  - Auth/DB extractor: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` — file-system-based detection of auth mechanisms and database backends
- Confirmation step: `plugins/ligamen/worker/scan/confirmation.js`
- Agent output schema: `plugins/ligamen/worker/scan/agent-schema.json`

## Environment Configuration

**Required env vars (set by Claude Code plugin system):**
- `CLAUDE_PLUGIN_ROOT` — base path for plugin files
- `CLAUDE_PLUGIN_DATA` — persistent data directory for plugin

**Optional env vars (user-configurable):**
- See STACK.md "Environment Variables" section for complete list

**Settings files:**
- `~/.ligamen/settings.json` — machine-wide settings (worker port, log level, ChromaDB config)
- `ligamen.config.json` — per-project (linked repos, boundaries, impact-map settings)

**Secrets:**
- ChromaDB API key stored in `~/.ligamen/settings.json` (key: `LIGAMEN_CHROMA_API_KEY`)
- No `.env` files used by Ligamen itself
- No external secret management service

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-03-31*
