# Codebase Structure

**Analysis Date:** 2026-03-20

## Directory Layout

```
ligamen/
├── worker/                 # Main worker daemon (Node.js + SQLite + UI + MCP)
│   ├── index.js            # Entry point: CLI parsing, logger init, HTTP server startup, graceful shutdown
│   ├── db/                 # SQLite database layer
│   │   ├── database.js     # DB lifecycle: openDb, runMigrations, createSnapshot
│   │   ├── pool.js         # Per-project QueryEngine cache (projectRoot → DB)
│   │   ├── query-engine.js # QueryEngine class: impact traversal, search, upsert, snapshot
│   │   └── migrations/     # Versioned schema migrations (001-008)
│   ├── server/             # HTTP server layer
│   │   ├── http.js         # Fastify HTTP server, REST routes
│   │   └── chroma.js       # ChromaDB sync (optional semantic search)
│   ├── scan/               # Agent-driven service discovery
│   │   ├── manager.js      # scanRepos orchestration, repo type detection, git diff
│   │   ├── findings.js     # Findings schema validation
│   │   ├── discovery.js    # Service discovery heuristics
│   │   └── agent-prompt-*.md # Prompt templates for service/library/infra
│   ├── ui/                 # Browser-based graph visualization
│   │   ├── graph.js        # UI entry point: project loading, data mapping, layout, rendering
│   │   ├── force-worker.js # Web Worker for force-directed layout (non-blocking physics)
│   │   ├── index.html      # Static HTML shell
│   │   ├── index.css       # Styles for UI
│   │   └── modules/        # UI components (modular architecture)
│   │       ├── state.js    # Shared graph state object
│   │       ├── layout.js   # Deterministic layered positioning algorithm
│   │       ├── renderer.js # Canvas 2D drawing (edges, nodes, labels, boundaries)
│   │       ├── interactions.js # Click/drag/pan handlers
│   │       ├── detail-panel.js # Right-side service inspection panel
│   │       ├── filter-panel.js # Protocol/layer/boundary/language filters
│   │       ├── project-picker.js # Project selection modal
│   │       ├── project-switcher.js # Switch between loaded projects
│   │       ├── log-terminal.js # Server log display
│   │       └── utils.js    # Shared drawing utilities
│   ├── mcp/                # MCP server for agent access
│   │   └── server.js       # MCP tool definitions: queryImpact, searchServices, etc.
│   └── lib/                # Shared utilities
│       └── logger.js       # Structured logger factory
├── commands/               # Claude Code command hooks (CLI entry points)
│   └── *.md                # Command documentation (quality-gate, map, cross-impact, etc.)
├── hooks/                  # Claude Code lifecycle hooks
│   ├── hooks.json          # Hook definitions (format, lint, guard, session)
│   └── *.js                # Hook implementations
├── lib/                    # Root-level shared utilities
│   └── *.js                # Utility modules
├── scripts/                # Development and deployment scripts
│   └── *.sh                # Build, test, release scripts
├── skills/                 # Claude Code skills
│   ├── quality-gate/       # Quality gate skill definitions
│   └── impact/             # Impact analysis skill definitions
├── tests/                  # Test suites
│   ├── storage/            # SQLite query-engine and migration tests
│   ├── ui/                 # Canvas rendering tests
│   ├── worker/             # Logger and scan manager tests
│   ├── integration/        # End-to-end scenario tests
│   └── fixtures/           # Test data (config, drift repos, etc.)
├── docs/                   # Documentation
│   ├── hooks.md            # Hook specifications
│   ├── commands.md         # Command usage
│   ├── service-map.md      # Dependency graph concepts
│   ├── configuration.md    # Config file reference
│   ├── architecture.md     # High-level system design
│   └── development.md      # Contributing guide
├── .planning/              # GSD planning directory
│   ├── codebase/           # Codebase analysis documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   ├── designs/            # Design documents for features
│   ├── milestones/         # Milestone phase definitions
│   └── research/           # Research and spike notes
├── .claude-plugin/         # Claude Code plugin configuration
│   └── plugin.json         # Plugin manifest
├── package.json            # Root package manifest
├── ligamen.config.json.example # Example project config
└── README.md               # User-facing documentation
```

## Directory Purposes

**worker/:**
- Purpose: Main daemon process (single instance per machine)
- Contains: All backend logic, HTTP server, database, UI static files, MCP server
- Key files: `index.js` (startup), `db/query-engine.js` (domain queries), `server/http.js` (routes), `scan/manager.js` (agent orchestration)

**worker/db/:**
- Purpose: SQLite database layer with migrations and query engine
- Contains:
  - `database.js` — DB lifecycle (open, migrate, snapshot)
  - `pool.js` — Per-project DB caching
  - `query-engine.js` — All domain queries (impact, search, upsert, snapshot)
  - `migrations/` — 8 versioned SQL schema migrations
- Key patterns: Top-level await for migration preloading, transaction-wrapped migrations, idempotent schema SQL

**worker/server/:**
- Purpose: HTTP REST API and static file serving
- Contains:
  - `http.js` — Fastify server with routes for graph, search, impact, vulnerabilities, etc.
  - `chroma.js` — ChromaDB integration for optional semantic search
- Key patterns: Per-request QueryEngine resolution, CORS for localhost, fire-and-forget ChromaDB sync

**worker/scan/:**
- Purpose: Agent-driven service discovery orchestration
- Contains:
  - `manager.js` — Main scanRepos entry point with repo type detection and scan bracketing
  - `findings.js` — Findings schema validation (validateFindings, parseAgentOutput)
  - `discovery.js` — Service detection heuristics (unused in current version)
  - `confirmation.js` — Breaking change confirmation (unused in current version)
  - `agent-prompt-*.md` — Prompts for service/library/infra/deep scanning
- Key patterns: Sequential agent invocation (never Promise.all), scan bracketing for atomicity, injected agentRunner for testing

**worker/ui/:**
- Purpose: Browser-based interactive graph visualization
- Contains:
  - `graph.js` — Entry point and project loading orchestration
  - `modules/` — Modular UI components (state, layout, renderer, interactions, filters, details)
  - `force-worker.js` — Web Worker for force-directed physics (non-blocking)
  - `index.html`, `index.css` — Static assets
- Key patterns: Canvas 2D rendering (not DOM), shared state object, module-based separation of concerns, Web Worker for simulation

**worker/mcp/:**
- Purpose: MCP server for Claude agent access to impact analysis
- Contains: `server.js` — Tool registration and request handling
- Key patterns: Stdio transport, per-call QueryEngine resolution, result enrichment with boundaries/actors

**worker/lib/:**
- Purpose: Shared utilities used by multiple worker components
- Contains: `logger.js` — Structured logger factory
- Key patterns: Dependency injection for logger setup

**commands/:**
- Purpose: Claude Code command definitions (CLI entry points)
- Contains: Markdown files documenting each command (quality-gate, map, cross-impact, drift, pulse, deploy-verify)
- Key files: Each file is a command name (e.g., `map.md` → `/ligamen:map`)

**hooks/:**
- Purpose: Claude Code lifecycle hooks (auto-execution on events)
- Contains: `hooks.json` (hook registration) + `.js` implementations
- Key files: Format hook, lint hook, file guard hook, session context hook

**lib/:**
- Purpose: Root-level shared utilities
- Contains: CLI wrappers, config readers, git utilities

**scripts/:**
- Purpose: Development and deployment automation
- Contains: Build, test, release, and packaging scripts

**skills/:**
- Purpose: Claude Code skill definitions
- Contains: quality-gate/, impact/ directories with skill manifests

**tests/:**
- Purpose: Test suites
- Contains:
  - `storage/` — QueryEngine and migration tests (better-sqlite3)
  - `ui/` — Canvas rendering tests (graph layout, node positioning)
  - `worker/` — Logger, scan manager, agent parsing tests
  - `integration/` — End-to-end scenarios
  - `fixtures/` — Test data (configs, repos, etc.)
- Key patterns: No external test framework (Node.js --test), fixtures in subdirs

**docs/:**
- Purpose: User and developer documentation
- Contains: Hook specs, command usage, service map concepts, configuration reference, architecture overview, development guide

**.planning/:**
- Purpose: GSD planning and analysis documents
- Contains:
  - `codebase/` — Codebase analysis (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md)
  - `designs/` — Design documents for features
  - `milestones/` — Milestone phase definitions
  - `research/` — Research and spike notes

## Key File Locations

**Entry Points:**
- `worker/index.js`: Worker process startup (port, data-dir parsing, logger init, HTTP server creation)
- `worker/ui/graph.js`: UI browser entry point (project selection, graph loading, rendering)
- `worker/mcp/server.js`: MCP server entry point (tool registration, request handling)
- `commands/*.md`: Claude Code command definitions (invoked as `/ligamen:command-name`)
- `hooks/hooks.json`: Hook registration (format, lint, guard, session)

**Configuration:**
- `package.json`: Root dependencies and scripts
- `ligamen.config.json.example`: Example project config (linked-repos, boundaries)
- `~/.ligamen/settings.json`: Machine-specific settings (worker port, log level, ChromaDB)
- `worker/db/migrations/*.js`: Database schema versions

**Core Logic:**
- `worker/db/query-engine.js`: Domain query implementation (impact, search, upsert, snapshot)
- `worker/scan/manager.js`: Service discovery orchestration
- `worker/server/http.js`: REST API routes and request handling
- `worker/ui/modules/renderer.js`: Canvas drawing logic
- `worker/ui/modules/layout.js`: Deterministic graph positioning

**Testing:**
- `tests/storage/*.test.js`: QueryEngine and migration tests
- `tests/ui/*.test.js`: Canvas rendering and graph layout tests
- `tests/worker/*.test.js`: Logger, scan manager, agent parsing tests
- `tests/integration/`: End-to-end scenario tests
- `tests/fixtures/`: Test data (config, repos, etc.)

## Naming Conventions

**Files:**
- Module files: lowercase with hyphens (e.g., `query-engine.js`, `force-worker.js`)
- Migration files: numbered with version (e.g., `001_initial_schema.js`)
- Test files: same name as module + `.test.js` suffix (e.g., `query-engine.test.js`)
- Markdown docs: lowercase with hyphens (e.g., `service-map.md`)

**Directories:**
- Package/feature dirs: lowercase plural (e.g., `migrations/`, `modules/`)
- Sub-features: lowercase with hyphens (e.g., `query-engine/`)

**Functions/Methods:**
- camelCase (e.g., `openDb`, `createSnapshot`, `queryImpact`)
- Underscore prefix for internal/private (e.g., `_logger`, `_searchDb`)
- Verb-first naming (e.g., `getQueryEngine`, `buildScanContext`, `validateFindings`)

**Variables:**
- camelCase for instances (e.g., `queryEngine`, `repoState`, `graphData`)
- UPPERCASE for constants (e.g., `NODE_RADIUS`, `PROTOCOL_COLORS`, `VALID_PROTOCOLS`)
- Underscore prefix for module-level singletons (e.g., `_db`, `_logger`)

**Types/Classes:**
- PascalCase (e.g., `QueryEngine`, `Database`, `Fastify`)

## Where to Add New Code

**New Feature (Graph Enhancement):**
- Primary code: `worker/ui/modules/` (new module or extend existing)
- HTTP API: `worker/server/http.js` (new route if data layer needed)
- Database: `worker/db/query-engine.js` (new query method if needed)
- Tests: `tests/ui/*.test.js` or `tests/storage/*.test.js`
- Example: Adding "deployment status" overlay
  - New file: `worker/ui/modules/deployment-overlay.js`
  - Route: `worker/server/http.js` new GET /deployments endpoint
  - Query: `worker/db/query-engine.js` new getDeploymentStatus() method
  - Test: `tests/ui/deployment-overlay.test.js`

**New Query/Analysis Feature:**
- Primary code: `worker/db/query-engine.js` (new public method)
- HTTP route: `worker/server/http.js` (new GET /analyze endpoint if exposing to UI)
- MCP tool: `worker/mcp/server.js` (new tool if for agents)
- Tests: `tests/storage/query-engine*.test.js`
- Example: Adding "vulnerability checker"
  - Method: `QueryEngine.prototype.findVulnerabilities(serviceName)`
  - Route: `fastify.get('/vulnerabilities', ...)`
  - Tool: Register vulnerabilitiesCheck() in MCP server
  - Test: `tests/storage/query-engine-vulnerabilities.test.js`

**New Agent Prompt/Scanning Logic:**
- Prompt template: `worker/scan/agent-prompt-custom.md`
- Orchestration: Extend `worker/scan/manager.js` detectRepoType() and scanRepos()
- Validation: Update `worker/scan/findings.js` validateFindings() if schema changes
- Tests: `tests/worker/scan-manager.test.js`
- Example: Adding Python-specific scanning
  - File: `worker/scan/agent-prompt-python.md`
  - Detection: Add `.py` file check to detectRepoType()
  - Selection: Add condition in scanRepos() to pick python prompt
  - Test: Extend scan-manager tests with Python repo fixtures

**New Database Table/Migration:**
- File: `worker/db/migrations/NNN_description.js` (increment version number)
- Update: `worker/db/database.js` loadMigrationsAsync() will auto-discover
- Query methods: Add to `worker/db/query-engine.js`
- Tests: `tests/storage/migration-NNN.test.js`
- Example: Adding "deployment history"
  - Migration: `009_deployment_history.js`
  - CREATE TABLE deployments (id, service_id, timestamp, status, commit)
  - QueryEngine methods: insertDeployment, getDeploymentHistory, etc.
  - Tests: Verify migration order, rollback behavior, query accuracy

**New Hook (Auto-execution):**
- Definition: Add entry to `hooks/hooks.json`
- Implementation: New file in `hooks/*.js`
- Tests: Extend hook tests
- Example: Adding "auto-security-scan"
  - hooks.json: Add hook definition with trigger (e.g., before commit)
  - hooks/security-scan.js: Implementation with security checks
  - Test: Verify hook fires and blocks unsafe commits

**New HTTP Route:**
- Location: `worker/server/http.js` (add fastify.get/post/etc.)
- QueryEngine dependency: Call options.resolveQueryEngine(request) to get QE
- Response format: Consistent with existing routes (error handling, status codes)
- CORS: Already enabled for localhost
- Tests: `tests/storage/*.test.js` covers underlying QueryEngine; HTTP routing tested via integration tests

**New UI Module:**
- Primary code: `worker/ui/modules/new-module.js` (export functions called by graph.js or other modules)
- State management: Add properties to `state` object in `modules/state.js`
- Wiring: Call module functions from `worker/ui/graph.js` during loadProject()
- Tests: `tests/ui/*.test.js` with canvas mocking
- Example: Adding "service metrics sidebar"
  - File: `worker/ui/modules/metrics-sidebar.js` (export showMetrics, updateMetrics)
  - State: Add `state.metricsVisible`, `state.selectedServiceMetrics`
  - Wiring: Call `showMetrics(state)` from graph.js after rendering
  - Route: `worker/server/http.js` new GET /metrics?service=X endpoint
  - Test: Canvas rendering with sidebar present/absent

## Special Directories

**worker/db/migrations/:**
- Purpose: Versioned database schema evolution
- Generated: No (hand-written SQL)
- Committed: Yes (part of source control)
- Pattern: Each file exports {version: N, up: (db) => {}} function
- Load order: Version number order (001, 002, 003, etc.)
- Safety: All SQL uses IF NOT EXISTS for idempotency

**worker/ui/ (static files):**
- Purpose: Browser-served assets (HTML, CSS, JavaScript)
- Generated: No (hand-written)
- Committed: Yes
- Serving: Via fastifyStatic plugin in http.js
- Build: No build step (vanilla JavaScript, no bundler)

**tests/fixtures/:**
- Purpose: Test data (configs, mock repos, etc.)
- Generated: Mostly manual, some created by tests
- Committed: Yes (fixtures needed for reproducibility)
- Contents: Config examples, git repos with sample code, expected outputs
- Example paths:
  - `tests/fixtures/config/ligamen.config.json` — example config
  - `tests/fixtures/drift/repo-a/` — test repo for drift analysis
  - `tests/fixtures/config/` — various test configs

**~/.ligamen/ (runtime data directory):**
- Purpose: User data directory (outside repo)
- Generated: Yes (created by worker/index.js)
- Committed: No (user-specific, contains sensitive data)
- Contents:
  - `settings.json` — User configuration (WORKER_PORT, LOG_LEVEL, ChromaDB)
  - `projects/` — Per-project database files
  - `logs/` — Timestamped log files
  - `worker.pid` — Process ID (cleanup on startup)
  - `worker.port` — Port number (for port tracking)

**.planning/codebase/:**
- Purpose: Codebase analysis documents (generated by GSD tooling)
- Generated: Yes (by codebase-mapper agent)
- Committed: Yes
- Contents:
  - ARCHITECTURE.md — Pattern, layers, data flow, abstractions, entry points
  - STRUCTURE.md — Directory layout, key locations, naming conventions, guidelines
  - CONVENTIONS.md — Coding style, imports, error handling, comments
  - TESTING.md — Framework, patterns, coverage, common test structures
  - STACK.md — Languages, runtimes, frameworks, dependencies
  - INTEGRATIONS.md — External services, databases, APIs
  - CONCERNS.md — Technical debt, security risks, performance bottlenecks
