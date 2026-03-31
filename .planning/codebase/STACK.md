# Technology Stack

**Analysis Date:** 2026-03-31

## Languages

**Primary:**
- JavaScript (ES Modules, `"type": "module"`) — worker server, MCP server, database layer, scan engine, graph UI, query engine (`plugins/ligamen/worker/**/*.js`)
- Bash (targets macOS bash 3.2 compat — avoids `mapfile`, uses `while read` loops) — plugin hooks, CLI scripts, drift checkers, file guard, format/lint dispatchers, worker lifecycle (`plugins/ligamen/scripts/*.sh`, `plugins/ligamen/lib/*.sh`)

**Secondary:**
- HTML/CSS — single-page graph UI (`plugins/ligamen/worker/ui/index.html`)
- JSON — configuration files, Claude Code plugin manifests, hook definitions (`ligamen.config.json`, `plugins/ligamen/.claude-plugin/plugin.json`)

## Runtime

**Environment:**
- Node.js >= 20.0.0 (declared in `plugins/ligamen/package.json` `engines` field)
- Bash (POSIX-compatible; avoids `mapfile` for macOS 3.2 compat per `plugins/ligamen/lib/config.sh`)

**Package Manager:**
- npm (used with `--omit=dev --no-fund --no-audit --package-lock=false` in install scripts)
- Lockfile: intentionally absent (`--package-lock=false` flag in `plugins/ligamen/scripts/install-deps.sh`)

## Frameworks

**Core:**
- Fastify ^5.8.2 — HTTP server for background worker REST API (`plugins/ligamen/worker/server/http.js`)
- @modelcontextprotocol/sdk ^1.27.1 — MCP server exposing tools to Claude Code sessions (`plugins/ligamen/worker/mcp/server.js`)

**Testing:**
- BATS (Bash Automated Testing System) — shell script tests, vendored as git submodule at `tests/bats/`, test files at `tests/*.bats` (16 test files)
- bats-assert — assertion helpers (git submodule at `tests/test_helper/bats-assert/`)
- bats-support — support library (git submodule at `tests/test_helper/bats-support/`)
- Node.js built-in test runner (`node --test`) — JavaScript unit tests (`plugins/ligamen/worker/**/*.test.js`)
- Node.js built-in assertions (`node:assert/strict`) — assertion library for JS tests

**Build/Dev:**
- Make — build orchestration (`Makefile` with targets: test, lint, check, install, uninstall, dev)
- ShellCheck — bash linting (invoked via `make lint`)
- jq — JSON validation of `plugin.json` and `hooks.json` (invoked via `make check`)
- Prettier — code formatter for JS/TS/JSON/YAML (invoked by `plugins/ligamen/scripts/format.sh`)
- ESLint — JS/TS linter (invoked by `plugins/ligamen/scripts/lint.sh`)

## Key Dependencies

**Critical (from `plugins/ligamen/package.json`):**
- `better-sqlite3` ^12.8.0 — embedded SQLite database with native bindings. WAL mode, 64MB page cache, 5s busy timeout, migration system, per-project DB pooling (`plugins/ligamen/worker/db/database.js`, `plugins/ligamen/worker/db/pool.js`)
- `fastify` ^5.8.2 — HTTP server for worker REST API (`plugins/ligamen/worker/server/http.js`)
- `@modelcontextprotocol/sdk` ^1.27.1 — MCP protocol implementation; uses `McpServer` and `StdioServerTransport` classes (`plugins/ligamen/worker/mcp/server.js`)
- `zod` ^3.25.0 — runtime schema validation for MCP tool parameter definitions (`plugins/ligamen/worker/mcp/server.js`)
- `chromadb` ^3.3.3 — optional vector database client for semantic search; collection name `ligamen-impact` (`plugins/ligamen/worker/server/chroma.js`)
- `picomatch` ^4.0.3 — glob pattern matching (used in CODEOWNERS parsing, `plugins/ligamen/worker/scan/codeowners.js`)

**Infrastructure:**
- `@fastify/cors` ^10.0.0 — CORS middleware for localhost dev access to worker API (`plugins/ligamen/worker/server/http.js`)
- `@fastify/static` ^8.0.0 — static file serving for graph UI from `plugins/ligamen/worker/ui/` (`plugins/ligamen/worker/server/http.js`)

**Optional:**
- `@chroma-core/default-embed` ^1.0.0 — ChromaDB default embedding function (listed in `optionalDependencies`)

**Runtime Dependencies (`plugins/ligamen/runtime-deps.json`):**
- Subset of main dependencies installed into `CLAUDE_PLUGIN_DATA` at session start via `plugins/ligamen/scripts/install-deps.sh`
- Mirrors: `@modelcontextprotocol/sdk`, `better-sqlite3`, `fastify`, `@fastify/cors`, `@fastify/static`, `chromadb`, `zod`
- Diff-based idempotency: skips install if `runtime-deps.json` matches sentinel file

**Frontend (CDN-loaded, no build step):**
- D3 Force v3 — graph physics simulation loaded via ESM CDN in Web Worker (`plugins/ligamen/worker/ui/force-worker.js`: `https://cdn.jsdelivr.net/npm/d3-force@3/+esm`)

## External Tool Dependencies

**Required (checked at runtime by shell scripts):**
- `jq` — JSON parsing in all shell scripts (guard: exits 0 silently if missing)
- `curl` — HTTP client for worker communication (`plugins/ligamen/lib/worker-client.sh`)
- `npm` — dependency installation (`plugins/ligamen/scripts/install-deps.sh`)
- `node` — worker and MCP server execution
- `git` — repo scanning, diff detection, changed file enumeration (`plugins/ligamen/worker/scan/manager.js`)

**Optional (format dispatchers in `plugins/ligamen/scripts/format.sh`):**
- Python: `ruff format` or `black`
- Rust: `rustfmt`
- TypeScript/JavaScript: `prettier` or local `./node_modules/.bin/prettier` or `eslint --fix`
- Go: `gofmt`
- JSON/YAML: `prettier`

**Optional (lint dispatchers in `plugins/ligamen/scripts/lint.sh`):**
- Python: `ruff check`
- Rust: `cargo clippy` (throttled at 30s intervals via `LIGAMEN_LINT_THROTTLE`)
- TypeScript/JavaScript: `eslint` (resolution: local > npm bin > global)
- Go: `golangci-lint`

## Configuration

**Environment Variables:**
- `LIGAMEN_DATA_DIR` — override data directory (default: `~/.ligamen`)
- `LIGAMEN_WORKER_PORT` — override worker port (default: 37888)
- `LIGAMEN_LOG_LEVEL` — log verbosity: DEBUG, INFO, WARN, ERROR (default: INFO)
- `LIGAMEN_DB_PATH` — override computed database path (MCP server only)
- `LIGAMEN_PROJECT_ROOT` — override cwd as project root (MCP server only)
- `LIGAMEN_DISABLE_FORMAT` — set to "1" to disable auto-format hook
- `LIGAMEN_DISABLE_LINT` — set to any non-empty value to disable auto-lint hook
- `LIGAMEN_DISABLE_GUARD` — set to "1" to disable file guard hook
- `LIGAMEN_DISABLE_SESSION_START` — set to any non-empty value to disable session context injection
- `LIGAMEN_EXTRA_BLOCKED` — colon-separated glob patterns for additional file guard blocks
- `LIGAMEN_LINT_THROTTLE` — seconds between Rust clippy runs (default: 30)
- `LIGAMEN_CHROMA_MODE` — "local" to enable ChromaDB (empty = disabled)
- `LIGAMEN_CHROMA_HOST` — ChromaDB host (default: localhost)
- `LIGAMEN_CHROMA_PORT` — ChromaDB port (default: 8000)
- `LIGAMEN_CHROMA_SSL` — "true" for HTTPS
- `LIGAMEN_CHROMA_API_KEY` — ChromaDB auth token
- `LIGAMEN_CHROMA_TENANT` — ChromaDB tenant (default: default_tenant)
- `LIGAMEN_CHROMA_DATABASE` — ChromaDB database (default: default_database)
- `CLAUDE_PLUGIN_ROOT` — set by Claude Code plugin system; base path for plugin files
- `CLAUDE_PLUGIN_DATA` — set by Claude Code plugin system; persistent data directory

**Settings Files:**
- `~/.ligamen/settings.json` — machine-level settings (log level, worker port, ChromaDB config)
- `ligamen.config.json` — per-project config (linked repos, boundaries, impact-map settings)

**Plugin Manifests:**
- `plugins/ligamen/.claude-plugin/plugin.json` — Claude Code plugin metadata (v5.7.0)
- `plugins/ligamen/.claude-plugin/marketplace.json` — marketplace registration manifest
- `plugins/ligamen/hooks/hooks.json` — hook definitions (PostToolUse, PreToolUse, SessionStart, UserPromptSubmit)

## Data Storage Layout

**Per-machine:**
- `~/.ligamen/` — root data directory
- `~/.ligamen/settings.json` — machine settings
- `~/.ligamen/worker.pid` — background worker PID file
- `~/.ligamen/worker.port` — background worker port file
- `~/.ligamen/logs/worker.log` — structured JSON log (10MB rotation, 3 rotated files max)

**Per-project:**
- `~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db` — SQLite database
- `~/.ligamen/projects/<hash>/snapshots/` — VACUUM INTO snapshots

**SQLite Schema Migrations (9 as of v5.7.0):**
- `plugins/ligamen/worker/db/migrations/001_initial_schema.js` through `009_confidence_enrichment.js`
- Domain tables: repos, services, connections, schemas, fields, map_versions, repo_state
- FTS5 virtual tables: connections_fts, services_fts, fields_fts (with sync triggers)
- Later migrations add: service type, exposed_endpoints, dedup constraints, scan_versions, expose_kind, actors/actor_connections/node_metadata, confidence/enrichment columns

## Module System

- All JavaScript uses ES Modules (`"type": "module"` in `plugins/ligamen/package.json`)
- Top-level `await` used in `plugins/ligamen/worker/db/database.js` for migration preloading
- Web Worker in UI uses ESM imports from CDN (`plugins/ligamen/worker/ui/force-worker.js`)
- No build step, no transpilation, no bundler — all source files run directly

## Platform Requirements

**Development:**
- macOS or Linux (bash scripts use POSIX compat; `realpath -m` has macOS fallback)
- Node.js >= 20
- jq, curl, npm, git
- ShellCheck (for `make lint`)
- BATS (vendored in `tests/bats/`)

**Production (as Claude Code plugin):**
- Node.js >= 20 (for worker + MCP server)
- jq (for JSON parsing in hooks)
- curl (for worker HTTP communication)
- npm (for one-time dependency installation at session start)
- No Docker, no cloud services required (fully local)

## Entrypoints

**Worker Process:**
- `plugins/ligamen/worker/index.js` — main HTTP server daemon (spawned by `plugins/ligamen/scripts/worker-start.sh` via `nohup node`)
- Listens on `127.0.0.1:37888` (configurable)

**MCP Server:**
- `plugins/ligamen/worker/mcp/server.js` — standalone MCP server (stdio transport)
- Launched by `plugins/ligamen/scripts/mcp-wrapper.sh` (self-healing: installs deps if missing)

**Slash Commands:**
- `plugins/ligamen/commands/map.md` — `/ligamen:map`
- `plugins/ligamen/commands/cross-impact.md` — `/ligamen:cross-impact`
- `plugins/ligamen/commands/drift.md` — `/ligamen:drift`

**Version:** 5.7.0 | **License:** AGPL-3.0-only

---

*Stack analysis: 2026-03-31*
