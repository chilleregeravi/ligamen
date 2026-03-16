# Technology Stack

**Analysis Date:** 2026-03-16

## Languages

**Primary:**
- JavaScript/Node.js — All runtime code, workers, MCP server
- Shell (Bash) — CLI scripts, hooks, automation (3.2+ compatible)
- SQL (SQLite) — Database queries, migrations

**Secondary:**
- JSON — Configuration, plugin metadata

## Runtime

**Environment:**
- Node.js ≥20.0.0 (required)

**Package Manager:**
- npm (v10+ inferred from lockfile v3)
- Lockfile: `package-lock.json` present (v3.0.0)

## Frameworks

**Core:**
- Fastify 5.8.2 — HTTP server for worker REST API
- @modelcontextprotocol/sdk 1.27.1 — MCP server implementation (StdioServerTransport)

**Database:**
- better-sqlite3 12.8.0 — SQLite3 synchronous bindings
- Includes WAL mode, foreign keys, and transaction support

**Validation:**
- zod 3.25.0 — Schema validation for MCP tool parameters

**Vector Search (Optional):**
- chromadb 3.3.3 — Vector database for semantic search
- @chroma-core/default-embed 1.0.0 (optional) — Default embedding provider

**HTTP Utilities:**
- @fastify/cors 10.0.0 — CORS middleware for Fastify
- @fastify/static 8.0.0 — Static file serving (UI assets)

## Key Dependencies

**Critical:**
- better-sqlite3 12.8.0 — Synchronous SQLite access, required for transactional integrity in impact map persistence. Uses native bindings.
- @modelcontextprotocol/sdk 1.27.1 — Enables MCP server interface for Claude Code integration. Exports McpServer and StdioServerTransport.
- fastify 5.8.2 — HTTP server for worker REST API. Handles readiness checks, graph queries, static UI serving.

**Infrastructure:**
- chromadb 3.3.3 — Optional vector database for semantic search across connections. Fire-and-forget sync (non-blocking). Fallback to FTS5 if unavailable.
- zod 3.25.0 — Runtime type validation for MCP tool parameters (service names, depth, direction, etc.).

## Configuration

**Environment:**
- `ALLCLEAR_DATA_DIR` — User data directory (default: `~/.allclear`)
- `ALLCLEAR_WORKER_PORT` — Port for HTTP worker (default: 37888)
- `ALLCLEAR_LOG_LEVEL` — Worker logging level (DEBUG|INFO|WARN|ERROR)
- `ALLCLEAR_CHROMA_MODE` — Enable ChromaDB integration (empty to disable)
- `ALLCLEAR_CHROMA_HOST` — ChromaDB host (default: localhost)
- `ALLCLEAR_CHROMA_PORT` — ChromaDB port (default: 8000)
- `ALLCLEAR_CHROMA_SSL` — Use HTTPS for ChromaDB (set to 'true')
- `ALLCLEAR_PROJECT_ROOT` — Override project detection for MCP server
- `ALLCLEAR_DB_PATH` — Override database file path
- `CLAUDE_PLUGIN_ROOT` — Plugin directory (set by Claude Code)

**Build:**
- No build step — ships as ES modules (type: "module" in package.json)
- Unit tests via Node's built-in `--test` flag

**Config Files:**
- `allclear.config.json` — Project-level config (linked repos, impact-map history limit, worker port)
- `~/.allclear/settings.json` — Machine-wide settings (worker port, ChromaDB config, log level)

## Platform Requirements

**Development:**
- Node.js ≥20.0.0
- macOS, Linux, or Windows (bash 3.2+ compatible)
- jq (for shell scripts that parse JSON)
- curl (for version checking in worker startup)
- git (for impact analysis, diff operations)

**Production:**
- Node.js ≥20.0.0
- SQLite3 (built into better-sqlite3)
- Optional: ChromaDB running separately (e.g., Docker container)
- Claude Code plugin system

## Database

**SQLite Schema:**
- Location: `~/.allclear/projects/<sha256_hash>/impact-map.db`
- WAL mode enabled for concurrent reads
- Tables:
  - `schema_versions` — Migration tracking
  - `repos` — Repository metadata
  - `services` — Service definitions (name, root_path, language)
  - `connections` — Service dependencies (source_service_id, target_service_id, protocol, method, path)
  - `map_versions` — Snapshot history with timestamps
  - `connections_fts` (optional) — FTS5 full-text search index
- Migrations: Located in `worker/migrations/` directory (001_initial_schema.js, etc.)

## Storage & Snapshots

**Database Snapshots:**
- Location: `~/.allclear/projects/<hash>/snapshots/`
- Format: SQLite database files (atomic VACUUM INTO)
- Retention: Configurable via `allclear.config.json` "impact-map": { "history-limit": N } (default: 10)

**Worker State Files:**
- `~/.allclear/worker.pid` — Running worker process ID
- `~/.allclear/worker.port` — Listening port
- `~/.allclear/logs/worker.log` — Structured JSON logs

## Node.js Built-in APIs Used

- `node:fs` — File I/O (migrations, snapshots, logs)
- `node:path` — Path resolution
- `node:os` — Home directory detection
- `node:crypto` — SHA256 hashing for project directories
- `node:child_process` — Executing external commands (execSync for git diffs)
- `node:url` — ESM URL utilities (fileURLToPath, pathToFileURL)

---

*Stack analysis: 2026-03-16*
