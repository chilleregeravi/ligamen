# Technology Stack

**Analysis Date:** 2026-03-23

## Languages

**Primary:**
- JavaScript (ES modules) - Core runtime for worker, MCP server, HTTP server, UI backend
- Node.js built-ins - `node:fs`, `node:path`, `node:os`, `node:crypto`, `node:child_process`, `node:test`, `node:assert/strict`

**Secondary:**
- Shell Script (Bash) - Plugin hooks (format, lint, file-guard, session-start)
- JSON - Configuration, plugin manifest, hooks definition

## Runtime

**Environment:**
- Node.js 20.0.0 or later (`engines.node >= 20.0.0` in `package.json`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Fastify 5.8.2 - HTTP server framework for REST API and static file serving
- @modelcontextprotocol/sdk 1.27.1 - MCP server framework for Claude integration (stdio transport)

**Testing:**
- Node built-in test runner (`node:test`) - Units tests for storage, HTTP server, MCP server, UI modules
- Node built-in assertions (`node:assert/strict`) - Assertion library

**Build/Dev:**
- Makefile - Build orchestration (test, lint, check, install, dev targets)
- shellcheck - Shell script linting

## Key Dependencies

**Critical:**
- better-sqlite3 12.8.0 - SQLite database binding for impact-map.db (project dependency graph storage)
- @fastify/cors 10.0.0 - CORS middleware for HTTP server (localhost dev support)
- @fastify/static 8.0.0 - Static file serving for UI (`worker/ui/` directory)
- zod 3.25.0 - Schema validation and data parsing (API request/response schemas)
- chromadb 3.3.3 - Vector database client for semantic search (optional, non-blocking)

**Infrastructure:**
- picomatch 4.0.3 - Glob pattern matching for CODEOWNERS file parsing (CJS require-wrapped in ESM)

## Configuration

**Environment:**
- Data directory: `LIGAMEN_DATA_DIR` (default: `~/.ligamen`)
- Worker port: `LIGAMEN_WORKER_PORT` (default: 37888, set from settings.json)
- Log level: `LIGAMEN_LOG_LEVEL` (default: INFO, from settings.json)
- Database path: `LIGAMEN_DB_PATH` (optional override, resolves from project root hash)
- Project root: `LIGAMEN_PROJECT_ROOT` (default: cwd)

**ChromaDB Configuration** (optional):
- `LIGAMEN_CHROMA_MODE` - 'local' to enable, empty/absent to disable (skip connection)
- `LIGAMEN_CHROMA_HOST` - ChromaDB host (default: localhost)
- `LIGAMEN_CHROMA_PORT` - ChromaDB port (default: 8000)
- `LIGAMEN_CHROMA_SSL` - 'true' to use HTTPS
- `LIGAMEN_CHROMA_API_KEY` - API key for ChromaDB auth
- `LIGAMEN_CHROMA_TENANT` - ChromaDB tenant (default: default_tenant)
- `LIGAMEN_CHROMA_DATABASE` - ChromaDB database (default: default_database)

**Build:**
- `ligamen.config.json` - Plugin configuration (linked-repos, impact-map history, project-name)
- `plugin.json` (`.claude-plugin/`) - Claude marketplace metadata
- `hooks.json` - Plugin hook definitions (PostToolUse, PreToolUse, SessionStart, UserPromptSubmit)

## Storage & Persistence

**Database:**
- SQLite 3 with WAL mode (`pragma journal_mode = WAL`)
- Per-project storage: `~/.ligamen/projects/<sha256(projectRoot)[:12]>/impact-map.db`
- Schema migrations in `worker/db/migrations/` (9 migrations as of v5.6.0)
- Includes tables for: findings, dependencies, services, exposed endpoints, type info, actors metadata, confidence scores

**Vector Database** (optional):
- ChromaDB for semantic search queries (fallback to SQLite FTS5 if unavailable)

**Log Files:**
- `~/.ligamen/logs/worker.log` - Structured logs with rotation (max 10 MB per file, keep 3 rotated files)

## Platform Requirements

**Development:**
- Node.js >= 20.0.0
- Bash shell (for plugin scripts)
- Git (for repo scanning and diff operations)
- oasdiff (optional, for OpenAPI spec comparison)
- ShellCheck (for linting)

**Production:**
- Node.js >= 20.0.0 (runtime)
- Claude Code editor with plugin support
- ~200MB+ disk space for per-project databases (based on codebase size)
- ChromaDB 3.3.3+ (optional, for semantic search enhancement)

## Entrypoints

**CLI Initialization:**
- `bin/ligamen-init.js` - Plugin initialization binary (registered in package.json)

**Worker Processes:**
- `worker/index.js` - Main HTTP server + MCP server orchestrator
- `worker/mcp/server.js` - MCP server exposing tools to Claude Code
- Worker listens on port 37888 by default (configurable)

## Security & Signing

**License:**
- AGPL-3.0-only

---

*Stack analysis: 2026-03-23*
