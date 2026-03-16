# Codebase Structure

**Analysis Date:** 2026-03-16

## Directory Layout

```
allclear/
├── bin/                        # CLI entry point
│   └── allclear-init.js        # [Empty - reserved for future]
├── commands/                   # Command documentation (auto-generated from scripts)
│   ├── cross-impact.md         # Impact analysis docs
│   ├── deploy-verify.md        # Deployment verification docs
│   ├── drift.md                # Dependency drift detection docs
│   ├── map.md                  # Service discovery/mapping docs
│   ├── pulse.md                # Kubernetes health check docs
│   └── quality-gate.md         # Quality gate docs
├── docs/                       # User-facing documentation
│   ├── architecture.md         # System architecture overview
│   ├── commands.md             # Command reference
│   ├── configuration.md        # Config file and env var reference
│   ├── development.md          # Development guide
│   ├── hooks.md                # Hook specification
│   └── service-map.md          # Service map features
├── hooks/                      # Plugin hook configuration
│   ├── hooks.json              # Main hook config (PostToolUse, PreToolUse, SessionStart)
│   └── lint.json               # Lint-specific config overrides
├── lib/                        # Shared bash libraries (sourceable)
│   ├── config.sh               # Load allclear.config.json, populate ALLCLEAR_CONFIG_LINKED_REPOS
│   ├── detect.sh               # Language detection by file path or extension
│   ├── linked-repos.sh         # Enumerate linked repositories
│   └── worker-client.sh        # HTTP client for worker communication
├── plugins/                    # Symbolic links to external plugins
│   └── allclear@               # Symlink to current project (for local dev)
├── scripts/                    # Hook scripts and command implementations
│   ├── format.sh               # PostToolUse: auto-format (prettier, ruff, rustfmt, gofmt)
│   ├── lint.sh                 # PostToolUse: auto-lint (eslint, pylint, golangci-lint)
│   ├── file-guard.sh           # PreToolUse: block writes to .env, *.lock, credentials
│   ├── session-start.sh        # SessionStart: detect project type, output context
│   ├── quality-gate.sh         # Command: run all linters, formatters, tests, typechecks
│   ├── impact.sh               # Command: cross-repo reference scanning
│   ├── drift-common.sh         # Utility: shared drift detection functions
│   ├── drift-types.sh          # Command: check TypeScript type compatibility across repos
│   ├── drift-versions.sh       # Command: check dependency version alignment
│   ├── drift-openapi.sh        # Command: check OpenAPI schema compatibility
│   ├── pulse-check.sh          # Command: Kubernetes service health check
│   ├── worker-start.sh         # Lifecycle: start worker process
│   ├── worker-stop.sh          # Lifecycle: stop worker process
│   └── worker-status.sh        # Lifecycle: check worker status
├── worker/                     # Node.js backend: database, HTTP/MCP servers
│   ├── index.js                # Entry point: initialize HTTP and MCP servers
│   ├── http-server.js          # Fastify REST API server
│   ├── mcp-server.js           # Model Context Protocol server (Claude integration)
│   ├── db.js                   # Database lifecycle: open, migrate, initialize
│   ├── db-pool.js              # Per-project database and query engine pool
│   ├── query-engine.js         # Business logic: graph, impact, search queries
│   ├── findings-schema.js      # Zod schemas for scan findings validation
│   ├── scan-manager.js         # Repository discovery and findings persistence
│   ├── repo-discovery.js       # Git traversal and service detection
│   ├── chroma-sync.js          # ChromaDB vector database integration (optional)
│   ├── confirmation-flow.js    # User confirmation dialog flow
│   ├── migrations/             # Database schema migrations (versioned)
│   │   ├── 001_initial_schema.js     # Create 7 domain tables, FTS5 indexes
│   │   ├── 002_service_type.js       # Add service type column
│   │   └── 003_exposed_endpoints.js  # Add exposed endpoint tracking
│   ├── ui/                     # Frontend assets (React SPA)
│   │   ├── index.html          # Entry point
│   │   ├── graph.js            # D3 graph visualization
│   │   └── force-worker.js     # Service force layout simulation
│   ├── agent-prompt.md         # Agent system prompt for discovery
│   ├── agent-prompt-discovery.md # Discovery-specific prompt template
│   ├── *.test.js               # Test files (co-located with source)
│   └── migrations.test.js      # Migration test suite
├── skills/                     # Skill definitions (metadata only)
│   ├── quality-gate/
│   │   └── SKILL.md            # Quality gate skill metadata
│   └── impact/
│       └── SKILL.md            # Impact skill metadata
├── tests/                      # Test infrastructure
│   ├── helpers/                # Shared test utilities
│   ├── fixtures/               # Test data (config examples, test repos)
│   ├── integration/            # Integration tests
│   ├── storage/                # Storage/database tests
│   ├── test_helper/            # BATS framework helpers
│   ├── bats/                   # BATS framework (vendored)
│   ├── *.bats                  # Hook/script tests (bash)
│   └── **/*.test.js            # Node.js tests (Jest/Node native)
├── .claude-plugin/             # Plugin metadata
│   └── plugin.json             # Plugin name, version, description
├── .planning/                  # Project planning documents
│   ├── codebase/               # This directory (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   ├── milestones/             # Phase implementation plans
│   ├── phases/                 # Current/active phase documentation
│   └── designs/                # Design documents
├── .gitignore                  # Git ignore patterns
├── .gitattributes              # Git line ending rules
├── .gitmodules                 # Submodule configurations (BATS, test helpers)
├── README.md                   # Project overview and quick start
├── Makefile                    # Build and install targets
├── allclear.config.json.example # Example configuration template
├── package.json                # Node.js project metadata and dependencies
├── package-lock.json           # Dependency lock file
├── LICENSE                     # Apache 2.0 license
└── scripts/                    # [Duplicate listing for clarity]
```

## Directory Purposes

**bin/:**
- Purpose: Executable CLI entry points
- Contains: Node.js scripts with shebang
- Key files: `allclear-init.js` (currently reserved, not implemented)

**commands/:**
- Purpose: Auto-generated documentation for each command
- Contains: Markdown files describing command usage
- Key files: One .md per command (quality-gate, impact, map, drift, pulse, deploy-verify)

**docs/:**
- Purpose: User-facing documentation
- Contains: Markdown guides for users and developers
- Key files: `architecture.md` (overview), `configuration.md` (config reference), `development.md` (dev setup)

**hooks/:**
- Purpose: Plugin hook configurations
- Contains: JSON files mapping Claude Code events to script paths
- Key files: `hooks.json` (main config), `lint.json` (lint overrides)

**lib/:**
- Purpose: Shared bash libraries (sourceable, not executable)
- Contains: Reusable shell functions with guards against double-source
- Key files:
  - `config.sh` — Load config, populate ALLCLEAR_CONFIG_LINKED_REPOS
  - `detect.sh` — Language detection by path pattern
  - `linked-repos.sh` — Enumerate repos from config
  - `worker-client.sh` — HTTP helper functions for worker communication

**plugins/:**
- Purpose: Symlinks to external plugin installations
- Contains: Symbolic links (one per plugin)
- Key files: `allclear@` symlink to current project (for local development)

**scripts/:**
- Purpose: Executable hook scripts and command implementations
- Contains: Bash scripts dispatched by hooks or commands
- Key files:
  - **Hooks (PostToolUse):** `format.sh`, `lint.sh`
  - **Hooks (PreToolUse):** `file-guard.sh`
  - **Hooks (SessionStart):** `session-start.sh`
  - **Commands:** `quality-gate.sh`, `impact.sh`, `drift-*.sh`, `pulse-check.sh`
  - **Lifecycle:** `worker-start.sh`, `worker-stop.sh`, `worker-status.sh`

**worker/:**
- Purpose: Long-running Node.js backend (HTTP + MCP servers)
- Contains: Database, query engine, scanning, and API implementations
- Key files:
  - **Entry:** `index.js` (parse CLI args, start servers)
  - **APIs:** `http-server.js` (REST), `mcp-server.js` (Claude integration)
  - **Data:** `db.js` (lifecycle), `db-pool.js` (caching), `query-engine.js` (queries)
  - **Scanning:** `scan-manager.js`, `repo-discovery.js`
  - **Migrations:** `migrations/*.js` (schema changes)
  - **Tests:** `*.test.js` (co-located, run with `node --test`)

**worker/ui/:**
- Purpose: Frontend assets for service map visualization
- Contains: HTML, JavaScript (D3 graph, force layout)
- Key files: `index.html` (entry), `graph.js` (visualization), `force-worker.js` (simulation)

**worker/migrations/:**
- Purpose: Database schema evolution
- Contains: Versioned migration modules
- Key files:
  - `001_initial_schema.js` — Create 7 domain tables, FTS5 virtual tables
  - `002_service_type.js` — Add service type tracking
  - `003_exposed_endpoints.js` — Add endpoint metadata
- Pattern: Each migration has `version` (number) and `up(db)` function

**skills/:**
- Purpose: Skill metadata (non-executable)
- Contains: SKILL.md metadata files describing each skill
- Key files: One directory per skill (quality-gate, impact) with SKILL.md

**tests/:**
- Purpose: Test infrastructure and fixtures
- Contains: BATS shell tests, Node.js tests, fixtures, helpers
- Key files:
  - `format.bats`, `lint.bats`, `session-start.bats` — Hook tests
  - `**/*.test.js` — Node.js unit tests (better-sqlite3, query engine)
  - `fixtures/` — Test data (config examples, fake repos)

**.claude-plugin/:**
- Purpose: Plugin metadata for Claude Code
- Contains: JSON manifest file
- Key files: `plugin.json` (name, version, description)

**.planning/:**
- Purpose: Project planning and design documents
- Contains: Architecture docs, phase plans, milestones
- Key files: `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md` (this directory)

## Key File Locations

**Entry Points:**

- **Plugin Hook (format):** `scripts/format.sh` — Dispatched on PostToolUse(Write|Edit|MultiEdit)
- **Plugin Hook (lint):** `scripts/lint.sh` — Dispatched on PostToolUse(Write|Edit|MultiEdit)
- **Plugin Hook (guard):** `scripts/file-guard.sh` — Dispatched on PreToolUse(Write|Edit|MultiEdit)
- **Plugin Hook (session):** `scripts/session-start.sh` — Dispatched on SessionStart, UserPromptSubmit
- **Worker startup:** `worker/index.js` — Node.js process entry point
- **MCP server:** `worker/mcp-server.js` — Claude integration
- **HTTP server:** `worker/http-server.js` — REST API

**Configuration:**

- **Plugin config:** `hooks/hooks.json` (main), `hooks/lint.json` (lint overrides)
- **AllClear config:** `allclear.config.json` (user, optional)
- **Worker settings:** `~/.allclear/settings.json` (machine-level, optional)
- **Example config:** `allclear.config.json.example`

**Core Logic:**

- **Config loading:** `lib/config.sh`
- **Language detection:** `lib/detect.sh`
- **Repo enumeration:** `lib/linked-repos.sh`
- **Worker communication:** `lib/worker-client.sh`
- **Query engine:** `worker/query-engine.js`
- **Database:** `worker/db.js`, `worker/db-pool.js`

**Testing:**

- **Hook tests:** `tests/*.bats` (bash tests)
- **Worker tests:** `worker/*.test.js` (Node.js tests)
- **Test fixtures:** `tests/fixtures/`
- **Test helpers:** `tests/helpers/`, `tests/test_helper/`

**Documentation:**

- **Architecture:** `docs/architecture.md`
- **Configuration:** `docs/configuration.md`
- **Commands:** `docs/commands.md`
- **Hooks:** `docs/hooks.md`
- **Development:** `docs/development.md`

## Naming Conventions

**Files:**

- **Shell scripts:** kebab-case (e.g., `file-guard.sh`, `drift-versions.sh`)
- **Node.js modules:** camelCase (e.g., `queryEngine.js`, `scanManager.js`)
- **Test files:** Original name + `.test.js` or `.bats` (e.g., `query-engine.test.js`)
- **Config files:** JSON with kebab-case keys (e.g., `allclear.config.json`)
- **Migrations:** Three-digit version + underscore + description (e.g., `001_initial_schema.js`)

**Directories:**

- **Source:** kebab-case (e.g., `quality-gate`, `service-map`)
- **Tests:** plural (e.g., `tests/`, `worker/`)
- **Modules:** descriptive, singular (e.g., `lib/`, `bin/`, `plugins/`)

**Shell functions/variables:**

- **Private functions:** Prefixed with `_` (e.g., `_ALLCLEAR_CONFIG_LOADED`)
- **Public variables:** UPPERCASE with ALLCLEAR_ prefix (e.g., `ALLCLEAR_CONFIG_LINKED_REPOS`)
- **Local variables:** lowercase (e.g., `FILE`, `LANG`, `PLUGIN_ROOT`)

**Node.js exports:**

- **Functions:** camelCase (e.g., `openDb()`, `getQueryEngine()`)
- **Classes:** PascalCase (e.g., `QueryEngine`, `ScanManager`)
- **Constants:** UPPERCASE (e.g., `LEVELS`, `PORT_FILE`)

## Where to Add New Code

**New Hook:**

1. Create script: `scripts/new-hook.sh`
2. Source shared libs at top: `source "${PLUGIN_ROOT}/lib/config.sh"`
3. Add hook config to `hooks/hooks.json` under appropriate event (PostToolUse, PreToolUse, etc.)
4. Add tests: `tests/new-hook.bats`

**New Command/Skill:**

1. Create script: `scripts/new-command.sh`
2. Implement business logic (link checking, scanning, querying)
3. Call worker HTTP API if needed: `curl http://127.0.0.1:37888/api/...`
4. Output results to stdout (tab-separated or JSON)
5. Add documentation: `commands/new-command.md`
6. Add tests: `tests/new-command.bats` or `tests/integration/new-command.test.js`

**New Worker Endpoint (REST):**

1. Add route to `worker/http-server.js` in the routes section
2. Route handler should: extract `?project=` param, resolve query engine via `getQE(request)`
3. Return JSON via `reply.send({})`
4. Add tests: `worker/http-server.test.js`

**New Worker Query (MCP Tool):**

1. Add tool definition to `worker/mcp-server.js` in `McpServer` initialization
2. Implement query function (e.g., `async function queryCustom(db, params) { ... }`)
3. Tool handler invokes query function and returns result
4. Add tests: `worker/mcp-server.test.js`

**New Database Table:**

1. Create migration: `worker/migrations/NNN_description.js`
2. Export `version` (number) and `up(db)` function
3. Use `CREATE TABLE IF NOT EXISTS` for idempotency
4. Apply FTS5 indexes if full-text search needed
5. Run migrations via `db.js` (automatic on module load)

**New Shared Library Function:**

1. Add to appropriate file in `lib/` (or create new file if needed)
2. Prefix private vars with `_`, use UPPERCASE for exported vars
3. Add source guard at top: `if [[ -n "${_LOADED:-}" ]]; then return 0; fi`
4. Prevent double-source: `_LOADED=1`
5. Document function signature in header comments

**New Shared Library (File):**

1. Create `lib/my-lib.sh`
2. Add guard at top: `if [[ -n "${_MY_LIB_LOADED:-}" ]]; then return 0; fi; _MY_LIB_LOADED=1`
3. Keep functions pure and side-effect minimal
4. Source only from other lib/ files or bash builtins (leaf node pattern)
5. Document usage in header

## Special Directories

**~/.allclear/ (Runtime):**
- Purpose: Machine-wide data directory
- Generated: Yes (auto-created on first run)
- Committed: No (user-local, not in git)
- Contents:
  - `projects/` — Per-project DBs (hashed directories)
  - `settings.json` — User settings (port, log level, ChromaDB config)
  - `logs/` — Worker logs (worker.log)
  - `worker.pid`, `worker.port` — Process metadata

**node_modules/ (Vendored):**
- Purpose: Node.js package dependencies
- Generated: Yes (via `npm install`)
- Committed: No (git ignored)
- Key packages: better-sqlite3, @modelcontextprotocol/sdk, fastify, zod, chromadb

**tests/bats/ (Vendored):**
- Purpose: BATS framework for bash testing
- Generated: No (git submodule)
- Committed: As submodule reference only
- Note: Included via `.gitmodules`, checked out with `git submodule update --init`

**tests/test_helper/ (Vendored):**
- Purpose: BATS assertion and support libraries
- Generated: No (git submodules)
- Committed: As submodule references only
- Contains: bats-assert, bats-support (checked out via `git submodule update`)

**worker/ui/ (Frontend):**
- Purpose: Single-page app for service map visualization
- Generated: Yes (index.html is served by HTTP server)
- Committed: Yes (static HTML/JS)
- Served by: `worker/http-server.js` via fastify-static

**docs/ (Documentation):**
- Purpose: User-facing reference and guides
- Generated: No (hand-written)
- Committed: Yes (in git)
- Note: Not auto-generated; maintain manually

---

*Structure analysis: 2026-03-16*
