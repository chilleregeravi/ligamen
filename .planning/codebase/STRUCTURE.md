# Codebase Structure

**Analysis Date:** 2026-03-23

## Directory Layout

```
ligamen/
├── .claude/                    # Claude Code session config (local)
├── .planning/                  # GSD orchestrator planning cache
├── .claude-plugin/             # Claude plugin descriptor directory
│   └── plugin.json             # Plugin metadata
├── docs/                       # User-facing documentation
├── plugins/
│   └── ligamen/                # Main plugin source tree
│       ├── .claude-plugin/     # Plugin config for Claude Code
│       │   └── plugin.json
│       ├── commands/           # MCP slash command descriptors
│       │   ├── map.md          # /ligamen:map — build service graph
│       │   ├── cross-impact.md # /ligamen:cross-impact — trace blast radius
│       │   └── drift.md        # /ligamen:drift — detect version/schema mismatches
│       ├── hooks/              # Claude Code hook configuration
│       │   └── hooks.json      # PostToolUse, PreToolUse, SessionStart definitions
│       ├── lib/                # Bash utility scripts (no .js files here)
│       │   ├── config.sh       # Configuration helpers
│       │   ├── worker-client.sh # Worker startup/communication
│       │   ├── linked-repos.sh # Linked repos discovery
│       │   └── detect.sh       # Project type detection
│       ├── scripts/            # Executable bash scripts for hooks and commands
│       │   ├── format.sh       # Auto-format hook (called by PostToolUse)
│       │   ├── lint.sh         # Auto-lint hook (called by PostToolUse)
│       │   ├── file-guard.sh   # File protection (called by PreToolUse)
│       │   ├── install-deps.sh # Install runtime dependencies
│       │   ├── session-start.sh # Session startup hook
│       │   ├── worker-start.sh # Start background worker daemon
│       │   ├── worker-stop.sh  # Stop worker daemon
│       │   ├── mcp-wrapper.sh  # MCP server launcher (self-healing)
│       │   ├── impact.sh       # Scan orchestration entry point
│       │   ├── drift-*.sh      # Drift detection scripts
│       │   └── drift-common.sh # Shared drift utilities
│       ├── skills/
│       │   └── impact/         # Agent skills for impact analysis
│       ├── worker/             # Background HTTP worker and MCP server (Node.js)
│       │   ├── index.js        # Worker entry point — daemon launcher
│       │   ├── lib/
│       │   │   └── logger.js   # Structured JSON logger with rotation
│       │   ├── db/
│       │   │   ├── database.js # SQLite lifecycle (open, migrate, close)
│       │   │   ├── pool.js     # Per-project DB and QueryEngine pool
│       │   │   ├── query-engine.js # Core graph algorithms (transitive impact, search, upsert)
│       │   │   ├── migrations/
│       │   │   │   ├── 001_initial_schema.js
│       │   │   │   ├── 002_service_type.js
│       │   │   │   ├── 003_exposed_endpoints.js
│       │   │   │   ├── 004_dedup_constraints.js
│       │   │   │   ├── 005_scan_versions.js
│       │   │   │   ├── 006_dedup_repos.js
│       │   │   │   ├── 007_expose_kind.js
│       │   │   │   ├── 008_actors_metadata.js
│       │   │   │   └── 009_confidence_enrichment.js
│       │   │   └── *.test.js   # Database tests
│       │   ├── server/
│       │   │   ├── http.js     # Fastify HTTP server, REST routes, project resolution
│       │   │   ├── chroma.js   # ChromaDB client and semantic search
│       │   │   └── *.test.js   # Server tests
│       │   ├── mcp/
│       │   │   ├── server.js   # MCP server, tool definitions, handlers
│       │   │   └── *.test.js   # MCP tests
│       │   ├── scan/
│       │   │   ├── manager.js  # Scan orchestration, agent invocation
│       │   │   ├── discovery.js # Discovery agent runner (Phase 1)
│       │   │   ├── confirmation.js # Confirmation workflow
│       │   │   ├── findings.js # Findings parser and validator
│       │   │   ├── enrichment.js # Post-scan enrichment pipeline
│       │   │   ├── enrichment/
│       │   │   │   └── auth-db-extractor.js # Auth/DB detection enricher
│       │   │   ├── codeowners.js # CODEOWNERS parsing enricher
│       │   │   └── *.test.js   # Scan tests
│       │   └── ui/             # Interactive graph visualization
│       │       ├── index.html  # Canvas-based graph UI entry point
│       │       ├── graph.js    # UI initialization, project loading
│       │       ├── force-worker.js # Web Worker for D3 force simulation (offscreen)
│       │       ├── modules/
│       │       │   ├── state.js # Global UI state (graph data, filters, selection)
│       │       │   ├── renderer.js # Canvas rendering, node/edge drawing
│       │       │   ├── layout.js # Force-directed layout computation
│       │       │   ├── interactions.js # Click/drag/hover handlers
│       │       │   ├── detail-panel.js # Right panel service details
│       │       │   ├── filter-panel.js # Protocol/layer/boundary filter controls
│       │       │   ├── keyboard.js # Keyboard shortcuts
│       │       │   ├── project-picker.js # Modal project selection
│       │       │   ├── project-switcher.js # Project switcher UI
│       │       │   ├── export.js # PNG export
│       │       │   ├── log-terminal.js # Collapsible log panel
│       │       │   ├── utils.js # UI helpers (distance, string matching, etc.)
│       │       │   └── *.test.js # UI module tests
│       ├── .mcp.json           # MCP server configuration (stdio transport)
│       ├── package.json        # Node dependencies (fastify, better-sqlite3, zod, etc.)
│       ├── package-lock.json   # Locked versions
│       └── runtime-deps.json   # Runtime-only dependencies (for install-deps.sh)
├── tests/                      # Test suites
│   ├── ui/                     # UI tests
│   └── bats/                   # Bash tests
├── .planning/                  # GSD planning documents (generated)
│   └── codebase/               # Codebase analysis outputs
│       ├── ARCHITECTURE.md     # (this file)
│       ├── STRUCTURE.md        # Directory layout and module locations
│       ├── STACK.md            # Technology dependencies
│       ├── INTEGRATIONS.md     # External services
│       ├── CONVENTIONS.md      # Coding style
│       └── TESTING.md          # Test patterns
└── LICENSE, README.md, Makefile
```

## Directory Purposes

**`plugins/ligamen/worker/`:**
- Purpose: Background Node.js daemon and UI server running independently of Claude Code sessions
- Contains: HTTP API, MCP server, database drivers, graph visualization, scan orchestration
- Key files: `worker/index.js` (entry), `worker/db/query-engine.js` (core logic), `worker/server/http.js` (REST API), `worker/mcp/server.js` (MCP tools)

**`plugins/ligamen/worker/db/`:**
- Purpose: Database abstraction layer and graph query algorithms
- Contains: SQLite lifecycle, prepared statement cache, per-project DB pooling, migration runner, transitive impact traversal
- Key files: `database.js` (lifecycle), `query-engine.js` (algorithms), `pool.js` (pooling)

**`plugins/ligamen/worker/scan/`:**
- Purpose: Service discovery and topology enrichment
- Contains: Agent orchestration, findings parsing/validation, enrichment pipeline (CODEOWNERS, auth/DB detection)
- Key files: `manager.js` (orchestration), `findings.js` (parser/validator), `enrichment.js` (enricher registry)

**`plugins/ligamen/worker/ui/`:**
- Purpose: Interactive service dependency graph visualization
- Contains: Canvas rendering, force-directed layout, filter controls, detail panels, keyboard shortcuts
- Key files: `graph.js` (init), `modules/state.js` (state), `modules/renderer.js` (drawing), `modules/layout.js` (physics)

**`plugins/ligamen/scripts/`:**
- Purpose: Executable entry points for hooks and commands
- Contains: Bash scripts for format, lint, file guard, worker lifecycle, drift detection
- Key files: `worker-start.sh` (daemon launch), `mcp-wrapper.sh` (MCP startup), `format.sh` (auto-format hook)

**`plugins/ligamen/commands/`:**
- Purpose: MCP slash command descriptors (Markdown files read by Claude Code)
- Contains: Command help text, usage examples, parameter descriptions
- Key files: `map.md`, `cross-impact.md`, `drift.md`

**`plugins/ligamen/hooks/`:**
- Purpose: Claude Code hook configuration (JSON)
- Contains: PostToolUse, PreToolUse, SessionStart event handlers with matchers
- Key files: `hooks.json`

## Key File Locations

**Entry Points:**
- `plugins/ligamen/worker/index.js`: HTTP worker daemon entry (spawned by `worker-start.sh`)
- `plugins/ligamen/worker/mcp/server.js`: MCP server entry (spawned by `mcp-wrapper.sh`)
- `plugins/ligamen/worker/ui/index.html`: Graph UI (served at `http://localhost:37888`)
- `plugins/ligamen/scripts/worker-start.sh`: Start worker daemon (called by session-start hook)
- `plugins/ligamen/scripts/mcp-wrapper.sh`: Start MCP server (referenced in `.mcp.json`)

**Configuration:**
- `plugins/ligamen/package.json`: Node dependencies and scripts
- `plugins/ligamen/.mcp.json`: MCP server config (stdio transport to `worker/mcp/server.js`)
- `plugins/ligamen/hooks/hooks.json`: Claude Code hook event handlers
- `plugins/ligamen/.claude-plugin/plugin.json`: Plugin metadata

**Core Logic:**
- `plugins/ligamen/worker/db/query-engine.js`: Graph algorithms (transitive impact, search), prepared statement cache, upsert methods
- `plugins/ligamen/worker/scan/manager.js`: Scan orchestration, agent invocation, enrichment pipeline
- `plugins/ligamen/worker/server/http.js`: REST API routes (/graph, /projects, /search, /readiness)
- `plugins/ligamen/worker/mcp/server.js`: MCP tool definitions (impact_query, impact_search, drift_versions, etc.)

**Testing:**
- `plugins/ligamen/worker/**/*.test.js`: Test files co-located with source (using Node.js test runner)
- `tests/bats/`: Bash testing for shell scripts
- `tests/ui/`: UI integration tests

## Naming Conventions

**Files:**
- `.js` files use camelCase: `queryEngine.js`, `forceWorker.js`, `detailPanel.js`
- Migrations use zero-padded numbers: `001_initial_schema.js`, `009_confidence_enrichment.js`
- Test files suffix with `.test.js`: `query-engine.test.js`, `state.test.js`
- Scripts are kebab-case: `worker-start.sh`, `file-guard.sh`, `drift-types.sh`
- Shell utilities in `lib/` are kebab-case: `worker-client.sh`, `linked-repos.sh`

**Directories:**
- camelCase for feature areas: `queryEngine/`, `server/`, `scan/`
- lowercase for plural collections: `migrations/`, `modules/`, `enrichment/`

**Functions:**
- camelCase: `getQueryEngine()`, `createHttpServer()`, `impactQuery()`, `runEnrichmentPass()`
- Prefix functions with verb: `get*`, `create*`, `run*`, `parse*`, `validate*`, `register*`

**Classes:**
- PascalCase: `QueryEngine`, `StmtCache`, `McpServer`

**Constants:**
- UPPER_SNAKE_CASE: `MAX_TRANSITIVE_DEPTH`, `QUERY_TIMEOUT_MS`, `VALID_PROTOCOLS`

## Where to Add New Code

**New Feature (e.g., new graph query type):**
- Primary code: `plugins/ligamen/worker/db/query-engine.js` — add method like `getMetrics()` or `getConnectivityMatrix()`
- Tests: `plugins/ligamen/worker/db/query-engine.test.js` — test the new method with fixtures
- HTTP route: `plugins/ligamen/worker/server/http.js` — add GET/POST handler that calls the query engine method
- MCP tool (optional): `plugins/ligamen/worker/mcp/server.js` — expose as MCP tool if useful for agents

**New UI Module (e.g., side panel, overlay):**
- Implementation: `plugins/ligamen/worker/ui/modules/<feature-name>.js` — export initialization function
- Tests: `plugins/ligamen/worker/ui/modules/<feature-name>.test.js` — unit tests using jsdom
- Integration: `plugins/ligamen/worker/ui/graph.js` — call initialization in main flow
- Styling: Inline `<style>` block in `plugins/ligamen/worker/ui/index.html`

**New Enricher (post-scan processor):**
- Implementation: `plugins/ligamen/worker/scan/enrichment/<enricher-name>.js` — export factory function like `createFooEnricher()`
- Tests: Same directory with `.test.js` suffix
- Registration: `plugins/ligamen/worker/scan/manager.js` — call `registerEnricher("foo-name", createFooEnricher())`

**New Drift Type (version/schema/API check):**
- Implementation: `plugins/ligamen/scripts/drift-<type>.sh` — executable bash script
- Shared utilities: Add to `plugins/ligamen/scripts/drift-common.sh` if reusable
- Command descriptor: `plugins/ligamen/commands/drift.md` — update usage examples

**Utilities & Helpers:**
- Shared JS: `plugins/ligamen/worker/lib/` — general-purpose helpers
- Shared Bash: `plugins/ligamen/lib/` — shell utilities (config, worker-client, etc.)

## Special Directories

**`plugins/ligamen/worker/db/migrations/`:**
- Purpose: Database versioning and schema evolution
- Generated: No (manually written)
- Committed: Yes
- Pattern: Sequential numbered files (001-009), each exports `version` number and `up(db)` function
- Used: Loaded via top-level await in `database.js`, executed on DB open if version exceeds current schema_version

**`plugins/ligamen/worker/ui/modules/`:**
- Purpose: Feature modules for graph UI (logically separated concerns)
- Generated: No
- Committed: Yes
- Pattern: Each module exports initialization functions, manages its own DOM state
- Usage: Imported by `graph.js`, called in initialization sequence

**`.planning/codebase/`:**
- Purpose: Codebase documentation for GSD orchestrator
- Generated: Yes (by GSD mapper agent)
- Committed: Yes (checked in for reference)
- Pattern: ARCHITECTURE.md, STRUCTURE.md, STACK.md, INTEGRATIONS.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**`~/.ligamen/` (external data directory):**
- Purpose: User data (databases, logs, settings)
- Generated: Yes (at runtime)
- Committed: No
- Layout: `~/.ligamen/projects/<hash12>/impact-map.db`, `~/.ligamen/logs/worker.log`, `~/.ligamen/settings.json`, `~/.ligamen/worker.pid`, `~/.ligamen/worker.port`

---

*Structure analysis: 2026-03-23*
