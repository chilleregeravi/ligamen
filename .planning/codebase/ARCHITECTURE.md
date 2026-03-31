# Architecture

**Analysis Date:** 2026-03-31

## Pattern Overview

**Overall:** Plugin-based event-driven architecture with a persistent background worker

Ligamen is a Claude Code plugin that provides auto-format, auto-lint, file guards, cross-repo drift detection, and service dependency mapping. It runs as two independent processes:

1. **Hook scripts (bash)** -- invoked synchronously by Claude Code on tool use events (PreToolUse, PostToolUse, SessionStart, UserPromptSubmit)
2. **Background worker (Node.js)** -- a long-running Fastify HTTP server + MCP stdio server that manages per-project SQLite databases, runs agent-based scans, and serves the graph UI

**Key Characteristics:**
- Claude Code plugin contract: hooks.json declares event bindings; `.claude-plugin/plugin.json` declares metadata; `.mcp.json` declares MCP servers
- Project-agnostic worker: a single worker process serves all projects, resolving the correct per-project DB via `?project=` query parameter or hash lookup
- Agent-based scanning: Claude sub-agents scan repos using templated prompts and return structured JSON findings
- Dual search: SQLite FTS5 for keyword search with optional ChromaDB vector search as a non-blocking enhancement
- Every write operation flows through SQLite first; ChromaDB sync is fire-and-forget

## Layers

**Hook Layer (Bash Scripts):**
- Purpose: Respond to Claude Code lifecycle events (file writes, session starts, prompt submissions)
- Location: `plugins/ligamen/scripts/`
- Contains: format.sh, lint.sh, file-guard.sh, session-start.sh, worker-start.sh, worker-stop.sh, install-deps.sh, impact.sh, drift-*.sh, mcp-wrapper.sh
- Depends on: `plugins/ligamen/lib/` (shared bash libraries)
- Used by: Claude Code via `plugins/ligamen/hooks/hooks.json` event bindings

**Shared Library Layer (Bash):**
- Purpose: Reusable bash functions sourced by scripts
- Location: `plugins/ligamen/lib/`
- Contains: config.sh, detect.sh, linked-repos.sh, worker-client.sh
- Depends on: External tools (jq, curl)
- Used by: Hook scripts, drift scripts, command implementations

**Command Layer (Markdown Prompts):**
- Purpose: Define slash commands available to Claude Code users
- Location: `plugins/ligamen/commands/`
- Contains: cross-impact.md, drift.md, map.md
- Depends on: Hook layer scripts, worker HTTP API
- Used by: Claude Code slash command system (`/ligamen:cross-impact`, `/ligamen:drift`, `/ligamen:map`)

**Worker Entry Point:**
- Purpose: Bootstrap the background daemon process
- Location: `plugins/ligamen/worker/index.js`
- Contains: CLI arg parsing, settings loading, PID/port file management, HTTP server creation, signal handling
- Depends on: server/http.js, db/pool.js, server/chroma.js, lib/logger.js, scan/manager.js
- Used by: `plugins/ligamen/scripts/worker-start.sh` (spawns via `nohup node`)

**HTTP Server Layer:**
- Purpose: REST API for graph queries, scan persistence, log viewing, and static UI serving
- Location: `plugins/ligamen/worker/server/http.js`
- Contains: Fastify routes: /api/readiness, /api/version, /projects, /graph, /impact, /service/:name, /scan, /versions, /api/logs
- Depends on: db/pool.js (per-request DB resolution), Fastify, @fastify/cors, @fastify/static
- Used by: worker-client.sh (bash HTTP calls), graph UI (browser fetch), MCP server, command layer

**MCP Server Layer:**
- Purpose: Model Context Protocol server providing structured tools to Claude Code
- Location: `plugins/ligamen/worker/mcp/server.js`
- Contains: MCP tool definitions (impact queries, search, changed-file analysis, scan orchestration)
- Depends on: @modelcontextprotocol/sdk, db/pool.js, db/query-engine.js, server/chroma.js
- Used by: Claude Code MCP integration via `plugins/ligamen/.mcp.json` and `plugins/ligamen/scripts/mcp-wrapper.sh`

**Database Layer:**
- Purpose: Per-project SQLite database lifecycle, migrations, and query engine pool
- Location: `plugins/ligamen/worker/db/`
- Contains: database.js (open/create/migrate), pool.js (per-project caching), query-engine.js (read/write query layer), migrations/ (9 schema versions)
- Depends on: better-sqlite3
- Used by: HTTP server, MCP server, scan manager

**Scan Layer:**
- Purpose: Orchestrate repo scanning via Claude agents, parse findings, enrich metadata
- Location: `plugins/ligamen/worker/scan/`
- Contains: manager.js (scan orchestration), findings.js (schema validation), discovery.js (repo detection), confirmation.js (user confirmation flow), enrichment.js (post-scan enrichment framework), codeowners.js, enrichment/auth-db-extractor.js, agent-prompt-*.md (agent templates)
- Depends on: Database layer (for persistence), agent-prompt templates
- Used by: MCP server (triggers scans), `/ligamen:map` command

**UI Layer:**
- Purpose: Browser-based service dependency graph visualization
- Location: `plugins/ligamen/worker/ui/`
- Contains: index.html, graph.js (entry point), modules/ (state, renderer, layout, interactions, detail-panel, filter-panel, etc.)
- Depends on: Worker HTTP API (/graph, /projects, /api/logs)
- Used by: Users via browser (served by Fastify static file middleware)

## Data Flow

**Hook Invocation (Format/Lint):**

1. Claude Code writes/edits a file, triggering PostToolUse event
2. `hooks.json` routes Write|Edit|MultiEdit to `scripts/format.sh` then `scripts/lint.sh`
3. `format.sh` reads stdin JSON, extracts `tool_input.file_path`, detects language by extension, invokes appropriate formatter (prettier, ruff, rustfmt, gofmt)
4. `lint.sh` reads stdin JSON, extracts file path, detects language, invokes linter (eslint, ruff, clippy, golangci-lint), outputs `systemMessage` JSON to stdout with truncated lint results

**File Guard (PreToolUse):**

1. Claude Code attempts Write|Edit|MultiEdit, triggering PreToolUse event
2. `hooks.json` routes to `scripts/file-guard.sh`
3. file-guard.sh classifies the target file path against block/warn rules:
   - Hard block (exit 2): .env files, .pem/.key, credentials, lock files, vendor directories
   - Soft warn (exit 0 + systemMessage): migration files, generated code, CHANGELOG
   - Allow (exit 0, no output): everything else

**Session Initialization:**

1. Claude Code starts a session, triggering SessionStart hook
2. `install-deps.sh` runs first: checks sentinel file vs runtime-deps.json, installs npm deps if needed
3. `session-start.sh` runs: checks worker version mismatch (restarts if needed), deduplicates via session flag file, auto-starts worker if impact-map config exists, detects project type, outputs `hookSpecificOutput.additionalContext` JSON

**Service Dependency Scan (`/ligamen:map`):**

1. User runs `/ligamen:map`, Claude Code executes `commands/map.md` prompt
2. Command ensures project name in `ligamen.config.json`, starts worker if needed
3. For each linked repo, `scan/manager.js.scanRepos()` determines scan mode (full vs incremental via git diff)
4. Agent runner invokes Claude sub-agent with repo-type-specific prompt (discovery, service, library, or infra template from `scan/agent-prompt-*.md`)
5. `scan/findings.js.parseAgentOutput()` extracts and validates JSON findings from agent response
6. `scan/confirmation.js` groups findings by confidence (HIGH batched, LOW capped at 10), presents to user
7. On confirmation, `db/query-engine.js` persists findings via upsert methods (upsertRepo, upsertService, persistFindings, beginScan/endScan)
8. `scan/enrichment.js.runEnrichmentPass()` runs registered enrichers (CODEOWNERS, auth-db-extractor) to add metadata
9. `db/database.js.syncFindings()` fires ChromaDB sync as fire-and-forget

**Impact Query (MCP/HTTP):**

1. MCP tool call or HTTP GET `/impact?project=...&change=...` arrives
2. `db/pool.js.getQueryEngine()` resolves per-project QueryEngine from cache or opens DB
3. `db/query-engine.js` runs transitive impact traversal (recursive CTE with cycle detection, bounded at depth 7)
4. Results classified as CRITICAL/WARN/INFO, returned as JSON

**State Management:**
- Per-project SQLite databases stored at `~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`
- Worker PID file at `~/.ligamen/worker.pid`, port file at `~/.ligamen/worker.port`
- Session dedup via `/tmp/ligamen_session_<session_id>.initialized` flag files
- Settings at `~/.ligamen/settings.json`
- QueryEngine pool: in-memory `Map<projectRoot, QueryEngine>` (no TTL, lives for worker lifetime)

## Key Abstractions

**QueryEngine:**
- Purpose: Read/write query layer over the Ligamen SQLite schema
- Location: `plugins/ligamen/worker/db/query-engine.js`
- Pattern: Class wrapping better-sqlite3 Database with LRU prepared statement cache (`StmtCache`, capacity 50)
- Capabilities: transitive impact traversal (recursive CTE), FTS5 keyword search, upsert helpers for all domain tables, graph export, breaking change classification (CRITICAL/WARN/INFO), map version snapshots (VACUUM INTO)

**Scan Manager:**
- Purpose: Orchestrate multi-repo scanning with agent invocation
- Location: `plugins/ligamen/worker/scan/manager.js`
- Pattern: Injected agent runner (`setAgentRunner(fn)`) decouples from Claude's Task tool; supports full and incremental scan modes
- Key exports: `scanRepos()`, `buildScanContext()`, `getChangedFiles()`, `runDiscoveryPass()`

**Enrichment Framework:**
- Purpose: Extensible post-scan metadata enrichment
- Location: `plugins/ligamen/worker/scan/enrichment.js`
- Pattern: Registry of enricher functions (`registerEnricher(name, fn)`); each enricher receives context and writes to `node_metadata` table; failures caught and logged, never abort scan

**Migration System:**
- Purpose: Evolve SQLite schema across versions
- Location: `plugins/ligamen/worker/db/database.js` + `plugins/ligamen/worker/db/migrations/`
- Pattern: Top-level await preloads all migration modules at import time; each migration exports `version` (integer) and `up(db)` function; wrapped in transactions for atomicity; tracked in `schema_versions` table

**DB Pool:**
- Purpose: Per-project database resolution and caching
- Location: `plugins/ligamen/worker/db/pool.js`
- Pattern: `Map<projectRoot, QueryEngine>` cache; resolution by project root path, 12-char SHA-256 hash, or repo name search across all DBs

## Entry Points

**Plugin Registration:**
- Location: `plugins/ligamen/.claude-plugin/plugin.json`
- Triggers: Claude Code plugin install/load
- Responsibilities: Declare plugin name, version, metadata

**Hook Event Routing:**
- Location: `plugins/ligamen/hooks/hooks.json`
- Triggers: PostToolUse (Write|Edit|MultiEdit), PreToolUse (Write|Edit|MultiEdit), SessionStart, UserPromptSubmit
- Responsibilities: Route events to bash scripts with timeouts

**Worker Process:**
- Location: `plugins/ligamen/worker/index.js`
- Triggers: `plugins/ligamen/scripts/worker-start.sh` (spawned as nohup daemon)
- Responsibilities: Parse CLI args, create data dir, write PID/port files, initialize logger, optionally connect ChromaDB, start Fastify HTTP server, handle graceful shutdown

**MCP Server:**
- Location: `plugins/ligamen/worker/mcp/server.js`
- Triggers: `plugins/ligamen/scripts/mcp-wrapper.sh` (exec'd by Claude Code MCP system)
- Responsibilities: Expose structured tools over MCP stdio transport (impact queries, search, changed-file analysis, scan orchestration)

**Slash Commands:**
- Location: `plugins/ligamen/commands/map.md`, `plugins/ligamen/commands/cross-impact.md`, `plugins/ligamen/commands/drift.md`
- Triggers: User types `/ligamen:map`, `/ligamen:cross-impact`, `/ligamen:drift` in Claude Code
- Responsibilities: Prompt-driven command execution using bash scripts and worker API

## Error Handling

**Strategy:** Non-blocking by default; hooks always exit 0 (except file-guard hard blocks which exit 2)

**Patterns:**
- All hook scripts use `trap 'exit 0' ERR` to guarantee non-blocking behavior
- Worker HTTP routes catch errors per-route and return structured JSON error responses with 4xx/5xx status codes
- Scan enrichment failures are caught, logged as warnings, and skipped (never abort the scan)
- ChromaDB sync failures are fire-and-forget via `.catch()` (never prevent SQLite persistence)
- Database migrations wrap each migration in a transaction for atomicity
- MCP server uses timeout guards on transitive queries (`setTimeout` + `db.interrupt()` at 30s)
- File guard distinguishes hard blocks (exit 2 + deny JSON) from soft warnings (exit 0 + systemMessage JSON)

## Cross-Cutting Concerns

**Logging:**
- Structured JSON logger at `plugins/ligamen/worker/lib/logger.js`
- Writes to `~/.ligamen/logs/worker.log` with size-based rotation (10 MB, 3 rotated files)
- Log levels: DEBUG, INFO, WARN, ERROR (configurable via `settings.json` key `LIGAMEN_LOG_LEVEL`)
- Logger injected into scan manager (`setScanLogger`), auth-db extractor (`setExtractorLogger`), HTTP server
- UI polls `/api/logs` endpoint for real-time log viewing

**Validation:**
- Scan findings validated by `plugins/ligamen/worker/scan/findings.js` (schema enforcement with typed validators)
- Valid protocols: rest, grpc, kafka, rabbitmq, internal, sdk, k8s, tf, helm
- Valid confidence levels: high, low
- Valid service types: service, library, sdk, infra
- Zod used in MCP server for tool input validation

**Authentication:**
- No authentication on HTTP API (localhost-only binding on 127.0.0.1)
- CORS restricted to localhost dev origins (5173 and 127.0.0.1)
- MCP server runs via stdio transport (inherits Claude Code's process context)

**Configuration Hierarchy:**
1. Environment variables (LIGAMEN_DATA_DIR, LIGAMEN_WORKER_PORT, LIGAMEN_DISABLE_*)
2. `~/.ligamen/settings.json` (machine-wide settings)
3. `ligamen.config.json` in project root (project-specific: linked-repos, impact-map config, boundaries)

---

*Architecture analysis: 2026-03-31*
