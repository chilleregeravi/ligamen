# Codebase Structure

**Analysis Date:** 2026-03-31

## Directory Layout

```
ligamen/
├── .claude/                          # Claude Code local settings
│   └── settings.local.json
├── .claude-plugin/                   # Root marketplace registration
│   └── marketplace.json
├── .planning/                        # GSD planning documents
│   └── codebase/                     # This analysis
├── docs/                             # Project documentation
├── ligamen.config.json               # Root project config (linked-repos, project-name)
├── Makefile                          # Top-level build/test/install targets
├── plugins/
│   └── ligamen/                      # ** THE PLUGIN — all production code lives here **
│       ├── .claude-plugin/
│       │   └── plugin.json           # Plugin metadata (name, version, description)
│       ├── .mcp.json                 # MCP server declaration
│       ├── hooks/
│       │   └── hooks.json            # Claude Code hook event bindings
│       ├── commands/                 # Slash command definitions (markdown prompts)
│       │   ├── cross-impact.md
│       │   ├── drift.md
│       │   └── map.md
│       ├── lib/                      # Shared bash libraries (sourced, not executed)
│       │   ├── config.sh
│       │   ├── detect.sh
│       │   ├── linked-repos.sh
│       │   └── worker-client.sh
│       ├── scripts/                  # Executable bash scripts (hook handlers + utilities)
│       │   ├── format.sh
│       │   ├── lint.sh
│       │   ├── file-guard.sh
│       │   ├── session-start.sh
│       │   ├── install-deps.sh
│       │   ├── worker-start.sh
│       │   ├── worker-stop.sh
│       │   ├── mcp-wrapper.sh
│       │   ├── impact.sh
│       │   ├── drift-common.sh
│       │   ├── drift-versions.sh
│       │   ├── drift-types.sh
│       │   └── drift-openapi.sh
│       ├── skills/                   # Skill modules (future expansion)
│       │   └── impact/
│       ├── worker/                   # Node.js background worker
│       │   ├── index.js              # Worker entry point (daemon bootstrap)
│       │   ├── lib/
│       │   │   └── logger.js         # Structured JSON logger with rotation
│       │   ├── db/                   # Database layer
│       │   │   ├── database.js       # SQLite lifecycle (open, migrate, snapshot)
│       │   │   ├── pool.js           # Per-project DB/QueryEngine pool
│       │   │   ├── query-engine.js   # Read/write query layer (52K, largest file)
│       │   │   └── migrations/       # Schema evolution (001-009)
│       │   ├── server/               # HTTP + ChromaDB servers
│       │   │   ├── http.js           # Fastify REST API
│       │   │   └── chroma.js         # Optional ChromaDB vector sync
│       │   ├── mcp/                  # MCP stdio server
│       │   │   └── server.js         # Tool definitions for Claude Code
│       │   ├── scan/                 # Scan orchestration
│       │   │   ├── manager.js        # Multi-repo scan coordinator
│       │   │   ├── findings.js       # Schema validation for agent output
│       │   │   ├── discovery.js      # Repo discovery and config loading
│       │   │   ├── confirmation.js   # User confirmation flow
│       │   │   ├── enrichment.js     # Post-scan enrichment framework
│       │   │   ├── codeowners.js     # CODEOWNERS enricher
│       │   │   ├── enrichment/
│       │   │   │   └── auth-db-extractor.js  # Auth/DB pattern extractor
│       │   │   ├── agent-prompt-common.md     # Shared agent scan rules
│       │   │   ├── agent-prompt-discovery.md  # Discovery pass prompt
│       │   │   ├── agent-prompt-service.md    # Service repo prompt
│       │   │   ├── agent-prompt-library.md    # Library repo prompt
│       │   │   ├── agent-prompt-infra.md      # Infra repo prompt
│       │   │   └── agent-schema.json          # Findings JSON schema
│       │   └── ui/                   # Browser graph visualization
│       │       ├── index.html        # Main HTML page
│       │       ├── graph.js          # UI entry point
│       │       ├── force-worker.js   # Web worker for force simulation
│       │       └── modules/          # Modular UI components
│       ├── package.json              # Plugin npm manifest
│       ├── runtime-deps.json         # MCP runtime dependency manifest
│       └── package-lock.json
├── tests/                            # All tests (bats + node + UI)
│   ├── *.bats                        # Bats shell script tests
│   ├── bats/                         # Bats framework (git submodule)
│   ├── fixtures/                     # Test fixtures
│   ├── helpers/                      # Test helper scripts
│   ├── test_helper.bash              # Bats test helper loader
│   ├── test_helper/                  # Additional test helpers
│   ├── storage/                      # Node.js DB/query-engine tests
│   ├── ui/                           # UI module tests
│   ├── worker/                       # Worker-specific tests
│   └── integration/                  # Integration tests
└── node_modules/                     # Root-level dev dependencies
```

## Directory Purposes

**`plugins/ligamen/`:**
- Purpose: All production plugin code -- the installable artifact
- Contains: Bash scripts, Node.js worker, commands, hooks configuration
- Key files: `package.json` (version 5.7.0), `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`

**`plugins/ligamen/scripts/`:**
- Purpose: Executable bash scripts invoked by hooks or commands
- Contains: Hook handlers (format, lint, file-guard, session-start), worker lifecycle (start/stop), drift checkers, MCP wrapper
- Key files: `format.sh` (PostToolUse auto-format), `lint.sh` (PostToolUse auto-lint), `file-guard.sh` (PreToolUse protection), `session-start.sh` (SessionStart context injection)

**`plugins/ligamen/lib/`:**
- Purpose: Shared bash libraries sourced by scripts (never executed directly)
- Contains: config.sh (config file loading), detect.sh (project/language detection), linked-repos.sh (repo discovery), worker-client.sh (HTTP client helpers)
- Key files: All four files are leaf libraries; `config.sh` is a guarded singleton, others check `BASH_SOURCE` to prevent direct execution

**`plugins/ligamen/commands/`:**
- Purpose: Markdown prompt files defining `/ligamen:*` slash commands
- Contains: Three command definitions with YAML frontmatter (description, allowed-tools, argument-hint)
- Key files: `map.md` (build service dependency graph), `cross-impact.md` (query impact of changes), `drift.md` (check cross-repo consistency)

**`plugins/ligamen/worker/`:**
- Purpose: Node.js background worker -- HTTP API, MCP server, database, scan orchestration, UI
- Contains: ES module JavaScript files organized by subsystem
- Key files: `index.js` (daemon entry point), `db/query-engine.js` (core query layer, 52K)

**`plugins/ligamen/worker/db/`:**
- Purpose: SQLite database lifecycle, connection pooling, and query engine
- Contains: database.js (open/create/migrate/snapshot), pool.js (per-project cache), query-engine.js (full query API), migrations/ (9 migration files)
- Key files: `query-engine.js` is the single largest file (~52KB) -- all read/write operations for the service map

**`plugins/ligamen/worker/db/migrations/`:**
- Purpose: Incremental SQLite schema evolution
- Contains: 9 migration files (001-009), each exporting `version` (number) and `up(db)` function
- Key files: `001_initial_schema.js` (repos, services, connections, schemas, fields, map_versions, repo_state, FTS5 tables), `008_actors_metadata.js` (actors, actor_connections, node_metadata), `009_confidence_enrichment.js`

**`plugins/ligamen/worker/server/`:**
- Purpose: HTTP REST API and ChromaDB integration
- Contains: http.js (Fastify server with routes), chroma.js (optional vector search sync)
- Key files: `http.js` (all REST endpoints), `chroma.js` (fire-and-forget sync, semantic search)

**`plugins/ligamen/worker/mcp/`:**
- Purpose: MCP (Model Context Protocol) stdio server for Claude Code tool integration
- Contains: server.js (tool definitions, query functions)
- Key files: `server.js` (~55KB) -- defines MCP tools: impact, search, changed, scan; includes pure query functions (`queryImpact`, `queryChanged`)

**`plugins/ligamen/worker/scan/`:**
- Purpose: Agent-based repo scanning, findings parsing, user confirmation, enrichment
- Contains: manager.js (orchestration), findings.js (validation), discovery.js (repo detection), confirmation.js (UX flow), enrichment.js (framework), codeowners.js, enrichment/ (extractors), agent-prompt-*.md (templates)
- Key files: `manager.js` (~30KB, scan lifecycle), `findings.js` (schema enforcement), `agent-prompt-common.md` (shared rules for all agent types)

**`plugins/ligamen/worker/ui/`:**
- Purpose: Browser-based service dependency graph visualization (vanilla JS, no build step)
- Contains: index.html, graph.js (entry point), force-worker.js (web worker), modules/ (18 files)
- Key files: `graph.js` (orchestrates project selection, data loading, rendering), `modules/renderer.js` (canvas-based graph drawing), `modules/layout.js` (force-directed layout computation)

**`plugins/ligamen/worker/ui/modules/`:**
- Purpose: Modular UI components for the graph viewer
- Contains: state.js, renderer.js, layout.js, interactions.js, detail-panel.js, filter-panel.js, log-terminal.js, project-picker.js, project-switcher.js, keyboard.js, export.js, utils.js
- Key files: `renderer.js` (canvas drawing), `detail-panel.js` (service detail sidebar), `layout.js` (force simulation)

**`tests/`:**
- Purpose: All test suites -- shell (bats), Node.js (node:test), UI module tests
- Contains: 16 .bats files for bash scripts, storage/ for DB tests, ui/ for UI module tests, worker/ for worker tests
- Key files: See TESTING.md for detailed patterns

## Key File Locations

**Entry Points:**
- `plugins/ligamen/worker/index.js`: Worker daemon bootstrap (spawned by worker-start.sh)
- `plugins/ligamen/worker/mcp/server.js`: MCP stdio server (exec'd by mcp-wrapper.sh)
- `plugins/ligamen/worker/ui/graph.js`: Browser UI entry point (loaded by index.html)
- `plugins/ligamen/scripts/session-start.sh`: First code to run on every Claude Code session

**Configuration:**
- `plugins/ligamen/hooks/hooks.json`: Hook event bindings (PostToolUse, PreToolUse, SessionStart, UserPromptSubmit)
- `plugins/ligamen/.claude-plugin/plugin.json`: Plugin metadata (name, version)
- `plugins/ligamen/.mcp.json`: MCP server declaration (stdio transport)
- `plugins/ligamen/package.json`: npm manifest with dependencies and version
- `plugins/ligamen/runtime-deps.json`: Separate manifest for MCP runtime dep installation
- `ligamen.config.json`: Project-level config (linked-repos, project-name)
- `.claude-plugin/marketplace.json`: Root marketplace registration

**Core Logic:**
- `plugins/ligamen/worker/db/query-engine.js`: All read/write queries against the service map (~52KB)
- `plugins/ligamen/worker/scan/manager.js`: Scan orchestration -- mode detection, agent invocation, finding persistence (~30KB)
- `plugins/ligamen/worker/mcp/server.js`: MCP tool definitions and query functions (~55KB)
- `plugins/ligamen/worker/server/http.js`: REST API routes (~10KB)
- `plugins/ligamen/worker/db/database.js`: Database lifecycle -- open, migrate, snapshot (~11KB)
- `plugins/ligamen/worker/db/pool.js`: Per-project DB pool and resolution (~8KB)
- `plugins/ligamen/scripts/file-guard.sh`: File protection rules (~7KB)
- `plugins/ligamen/scripts/lint.sh`: Multi-language lint hook (~7KB)

**Testing:**
- `tests/*.bats`: Shell script tests (bats framework)
- `plugins/ligamen/worker/db/*.test.js`: Database and query engine tests (co-located)
- `plugins/ligamen/worker/scan/*.test.js`: Scan module tests (co-located)
- `plugins/ligamen/worker/server/*.test.js`: HTTP server tests (co-located)
- `plugins/ligamen/worker/mcp/*.test.js`: MCP server tests (co-located)
- `plugins/ligamen/worker/ui/modules/*.test.js`: UI module tests (co-located)
- `tests/storage/`: Additional storage/query-engine integration tests

## Naming Conventions

**Files:**
- Bash scripts: `kebab-case.sh` (e.g., `file-guard.sh`, `worker-start.sh`, `drift-versions.sh`)
- Bash libraries: `kebab-case.sh` (e.g., `config.sh`, `linked-repos.sh`)
- Node.js modules: `kebab-case.js` (e.g., `query-engine.js`, `auth-db-extractor.js`)
- Node.js tests: `kebab-case.test.js` co-located with source (e.g., `query-engine-upsert.test.js`)
- Migrations: `NNN_snake_case.js` (e.g., `001_initial_schema.js`, `009_confidence_enrichment.js`)
- Command prompts: `kebab-case.md` (e.g., `cross-impact.md`, `map.md`)
- Agent prompts: `agent-prompt-{type}.md` (e.g., `agent-prompt-service.md`, `agent-prompt-infra.md`)
- Bats tests: `kebab-case.bats` (e.g., `file-guard.bats`, `session-start.bats`)

**Directories:**
- All lowercase, hyphen-separated: `worker/`, `scan/`, `ui/`, `db/`, `mcp/`, `server/`
- Plural for collections: `commands/`, `scripts/`, `hooks/`, `migrations/`, `modules/`, `skills/`

**Exports:**
- Functions: camelCase (e.g., `getQueryEngine`, `parseAgentOutput`, `runEnrichmentPass`)
- Classes: PascalCase (e.g., `QueryEngine`, `StmtCache`)
- Constants: UPPER_SNAKE_CASE (e.g., `VALID_PROTOCOLS`, `MAX_LOW_CONFIDENCE`, `NEEDS_REPROMPT`)

## Where to Add New Code

**New Hook Script:**
- Place the executable bash script in `plugins/ligamen/scripts/`
- Register it in `plugins/ligamen/hooks/hooks.json` under the appropriate event (PostToolUse, PreToolUse, SessionStart, UserPromptSubmit) with a matcher regex and timeout
- Follow the pattern: read stdin JSON, extract fields with jq, output JSON to stdout, always exit 0 (except hard blocks)
- Add bats tests in `tests/{script-name}.bats`

**New Slash Command:**
- Create a markdown file in `plugins/ligamen/commands/`
- Include YAML frontmatter with `description`, `allowed-tools`, and `argument-hint`
- The command name derives from the filename: `foo-bar.md` becomes `/ligamen:foo-bar`

**New Database Migration:**
- Create `plugins/ligamen/worker/db/migrations/0NN_description.js`
- Export `version` (integer, next in sequence) and `up(db)` function
- Use `IF NOT EXISTS` for idempotency
- Add tests as `plugins/ligamen/worker/db/migration-0NN.test.js`

**New Worker REST Endpoint:**
- Add the route in `plugins/ligamen/worker/server/http.js` inside `createHttpServer()`
- Use `getQE(request)` to resolve the per-request QueryEngine
- Follow the pattern: try/catch with 500 error response, httpLog for errors
- Add tests in `plugins/ligamen/worker/server/http.test.js`

**New MCP Tool:**
- Add the tool definition in `plugins/ligamen/worker/mcp/server.js`
- Use Zod for input schema validation
- Use `resolveDb(project)` to get the QueryEngine
- Add tests in `plugins/ligamen/worker/mcp/server.test.js`

**New Scan Enricher:**
- Create the enricher function (receives `ctx` with serviceId, repoPath, db, logger)
- Register it in `plugins/ligamen/worker/scan/manager.js` via `registerEnricher(name, fn)`
- Enricher writes to `node_metadata` table with `view='enrichment'`
- Return `Record<string, string|null>` of key-value pairs
- Add tests alongside the enricher file

**New UI Module:**
- Create the module in `plugins/ligamen/worker/ui/modules/`
- Import and wire it in `plugins/ligamen/worker/ui/graph.js`
- Co-locate tests as `{module-name}.test.js` in the same directory
- No build step -- vanilla ES modules loaded directly by the browser

**New Shared Bash Library:**
- Place in `plugins/ligamen/lib/`
- Include the source guard: `[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file" >&2; exit 1; }`
- Use a double-source guard variable pattern (see `config.sh`)
- Source from scripts via `source "${CLAUDE_PLUGIN_ROOT}/lib/{name}.sh"`

## Special Directories

**`~/.ligamen/` (Runtime Data -- NOT in repo):**
- Purpose: Machine-wide runtime data directory for the worker daemon
- Contains: `worker.pid`, `worker.port`, `settings.json`, `logs/worker.log`, `projects/<hash>/impact-map.db`
- Generated: Yes (created by worker and scripts at runtime)
- Committed: No (lives outside the repo on the user's machine)

**`tests/bats/` (Git Submodule):**
- Purpose: Bats testing framework
- Contains: Bats core framework files
- Generated: No (git submodule)
- Committed: Yes (via .gitmodules)

**`node_modules/` (Root):**
- Purpose: Root-level development dependencies
- Generated: Yes
- Committed: No (.gitignore)

**`plugins/ligamen/node_modules/`:**
- Purpose: Plugin runtime dependencies (better-sqlite3, fastify, chromadb, MCP SDK, zod)
- Generated: Yes (installed by install-deps.sh or mcp-wrapper.sh)
- Committed: No (.gitignore)

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: Yes (by GSD mapping commands)
- Committed: Yes

**`plugins/ligamen/worker/db/migrations/`:**
- Purpose: SQLite schema migration files -- append-only, never modify existing migrations
- Generated: No (hand-written)
- Committed: Yes

---

*Structure analysis: 2026-03-31*
