# Technology Stack

**Analysis Date:** 2026-03-20

## Languages

**Primary:**
- JavaScript/Node.js 20.0+ - Runtime, CLI, worker, MCP server, all entry points
- JavaScript (Browser) - UI visualization in `worker/ui/`

## Runtime

**Environment:**
- Node.js >=20.0.0 (required)
- ES modules (native import/export syntax throughout)

**Package Manager:**
- npm - lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Fastify 5.8.2 - HTTP server framework in `worker/server/http.js`
- @modelcontextprotocol/sdk 1.27.1 - MCP server in `worker/mcp/server.js` for Claude Code integration

**Database:**
- better-sqlite3 12.8.0 - SQLite3 client in `worker/db/pool.js`, `worker/db/database.js`
  - WAL mode enabled via `db.pragma("journal_mode = WAL")`
  - Migrations system in `worker/db/migrations/`

**Vector Search (Optional):**
- chromadb 3.3.3 - Vector database integration in `worker/server/chroma.js`
- @chroma-core/default-embed 1.0.0 - Optional embedding provider (optional dependency)

**Validation:**
- zod 3.25.0 - Schema validation in `worker/mcp/server.js` for tool inputs

**Middleware:**
- @fastify/cors 10.0.0 - CORS support in `worker/server/http.js`
- @fastify/static 8.0.0 - Static file serving in `worker/server/http.js`

**Testing:**
- Node.js built-in test runner (node:test module)
- node:assert/strict - Assertions in test files like `worker/db/query-engine.test.js`
- BATS framework - Shell/integration testing in `tests/bats/`

**Build/Dev:**
- D3.js (d3-force@3) - Force-directed graph layout in `worker/ui/force-worker.js` (loaded from CDN: https://cdn.jsdelivr.net/npm/d3-force@3/+esm)

## Key Dependencies

**Critical:**
- better-sqlite3 12.8.0 - Persistent data storage for impact maps (SQLite DB at `~/.ligamen/projects/<hash>/impact-map.db`)
- @modelcontextprotocol/sdk 1.27.1 - Communication with Claude Code (stdio-based MCP protocol)
- Fastify 5.8.2 - HTTP REST API server for graph visualization and scan operations

**Infrastructure:**
- chromadb 3.3.3 - Optional semantic search backend (non-blocking, falls back to SQLite FTS5 if unavailable)

## Configuration

**Environment Variables:**
- `LIGAMEN_DATA_DIR` - Default: `~/.ligamen` (user home directory)
- `LIGAMEN_LOG_LEVEL` - Log verbosity (INFO default, read from `settings.json`)
- `LIGAMEN_WORKER_PORT` - HTTP server port override (37888 default, read from `settings.json`)
- `LIGAMEN_PROJECT_ROOT` - Project path for MCP server context (cwd default)
- `LIGAMEN_DB_PATH` - Direct SQLite DB path (computed from project hash if not set)
- `LIGAMEN_CHROMA_MODE` - Enable ChromaDB: "local" or empty (default)
- `LIGAMEN_CHROMA_HOST` - ChromaDB hostname (localhost default)
- `LIGAMEN_CHROMA_PORT` - ChromaDB port (8000 default)
- `LIGAMEN_CHROMA_SSL` - Use HTTPS for ChromaDB (true/false)
- `LIGAMEN_CHROMA_API_KEY` - ChromaDB API key if required
- `LIGAMEN_CHROMA_TENANT` - ChromaDB tenant name (default_tenant default)
- `LIGAMEN_CHROMA_DATABASE` - ChromaDB database name (default_database default)

**Configuration Files:**
- `settings.json` - Loaded from `$LIGAMEN_DATA_DIR/settings.json` at worker startup
- `ligamen.config.json` - Example provided in `ligamen.config.json.example` (linked-repos configuration)
- `.mcp.json` - MCP server configuration (currently empty in `/.mcp.json`)

**Build Configuration:**
- No build step required - pure ES modules, no compilation

## Platform Requirements

**Development:**
- Node.js 20.0+
- SQLite3 system library (for better-sqlite3 native binding compilation)
- POSIX shell (bash/zsh) for scripts in `scripts/`

**Production:**
- Node.js 20.0+ runtime
- ~100MB disk for `.ligamen/` data directory (per project DB + logs)
- Optional: ChromaDB instance (separate process, non-blocking if unavailable)

**Data Storage:**
- SQLite database at `~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`
- Logs written to `~/.ligamen/logs/`
- Worker PID/PORT files at `~/.ligamen/worker.pid`, `~/.ligamen/worker.port`

---

*Stack analysis: 2026-03-20*
