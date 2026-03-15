# Architecture Research

**Domain:** Claude Code plugin — v2.0 Service Dependency Intelligence integration
**Researched:** 2026-03-15
**Confidence:** HIGH — based on official Claude Code plugin documentation, existing v1.0 codebase inspection, and verified MCP server patterns

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          AllClear Plugin Root                              │
├───────────────────────────────────────────────────────────────────────────┤
│  User Layer (invoked by user or auto-triggered by Claude)                  │
│                                                                            │
│  ┌──────────────────┐  ┌────────────────────────────┐                     │
│  │ commands/        │  │ commands/                   │                     │
│  │ cross-impact.md  │  │ map.md  (NEW)               │                     │
│  │ (MODIFIED)       │  │                             │                     │
│  └──────────────────┘  └────────────────────────────┘                     │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  MCP Layer (auto-started by Claude Code, available to ALL agents)          │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  .mcp.json  (NEW)                                                 │     │
│  │                                                                   │     │
│  │  allclear-impact → worker/mcp-server.js  (stdio transport)       │     │
│  │                                                                   │     │
│  │  Tools: impact_query | impact_scan | impact_changed              │     │
│  │         impact_graph | impact_search                             │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  Event Layer (lifecycle hooks — unchanged from v1.0)                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  hooks/hooks.json                                                 │     │
│  │                                                                   │     │
│  │  PreToolUse  → file-guard.sh                                     │     │
│  │  PostToolUse → format.sh, lint.sh                                │     │
│  │  SessionStart→ session-start.sh  (MODIFIED: checks worker state) │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  Worker Layer (Node.js process, localhost, project-scoped)                 │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  worker/  (NEW)                                                   │     │
│  │                                                                   │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │     │
│  │  │ http-server  │  │ mcp-server   │  │ scan-manager         │   │     │
│  │  │ (D3 UI +     │  │ (stdio, MCP  │  │ (spawns agents per   │   │     │
│  │  │  REST API)   │  │  protocol)   │  │  linked repo)        │   │     │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │     │
│  │  ┌──────────────┐  ┌──────────────┐                             │     │
│  │  │ query-engine │  │ chroma-sync  │                             │     │
│  │  │ (SQLite +    │  │ (optional,   │                             │     │
│  │  │  FTS5)       │  │  async)      │                             │     │
│  │  └──────────────┘  └──────────────┘                             │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  Support Layer (shared shell libraries — v1.0, unchanged)                  │
│                                                                            │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────────┐      │
│  │ lib/config.sh │  │ lib/detect.sh │  │ lib/linked-repos.sh      │      │
│  └───────────────┘  └───────────────┘  └──────────────────────────┘      │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  Storage Layer (project-local, inside consuming repo)                      │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  .allclear/  (lives in the repo where /allclear:map was run)     │     │
│  │                                                                   │     │
│  │  impact-map.db        (SQLite + WAL mode + FTS5)                 │     │
│  │  worker.pid           (PID file for worker lifecycle)            │     │
│  │  worker.port          (port file: actual bound port)             │     │
│  │  snapshots/           (SQLite snapshots for map versioning)      │     │
│  └──────────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New or Modified |
|-----------|----------------|-----------------|
| `commands/map.md` | New command: orchestrates repo discovery, agent scanning, user confirmation, and persistence | NEW |
| `commands/cross-impact.md` | Modified: checks for worker + map data first; falls back to legacy grep scan if absent | MODIFIED |
| `.mcp.json` | Registers the AllClear MCP server (`worker/mcp-server.js`) so all Claude Code agents get impact tools automatically | NEW |
| `worker/mcp-server.js` | Standalone Node.js stdio MCP server; reads from SQLite via query engine; surfaces 5 MCP tools | NEW |
| `worker/http-server.js` | Express HTTP server on configured port; serves D3 web UI and REST API (`/graph`, `/impact`, `/service/:name`, `/scan`, `/versions`) | NEW |
| `worker/scan-manager.js` | Spawns Claude agents into each linked repo for scanning; collects and validates findings; writes confirmed results to SQLite | NEW |
| `worker/query-engine.js` | All SQLite queries: recursive CTE graph traversal, FTS5 full-text search, breaking change detection | NEW |
| `worker/db.js` | SQLite connection pool with WAL mode + FTS5 indexes; handles schema migration and snapshots | NEW |
| `worker/chroma-sync.js` | Optional async ChromaDB sync; gracefully skips if ChromaDB unavailable | NEW |
| `worker/web/` | Static D3.js graph UI assets served by http-server.js | NEW |
| `scripts/worker-start.sh` | Shell wrapper: reads config, checks if worker already running (via PID file), starts Node.js worker if not | NEW |
| `scripts/worker-stop.sh` | Shell wrapper: reads PID file, kills worker process, removes `.allclear/worker.pid` | NEW |
| `scripts/session-start.sh` | Modified: after existing context injection, check if `impact-map` section in config and auto-start worker | MODIFIED |
| `.allclear/impact-map.db` | SQLite primary storage for all scan data (lives in the consuming project repo, not the plugin) | NEW (project-side) |
| `.allclear/worker.pid` | PID of the running worker process; used by scripts to detect and stop the worker | NEW (project-side) |
| `.allclear/worker.port` | Port the worker is currently listening on; written at startup, read by commands | NEW (project-side) |
| `lib/worker-client.sh` | Bash library: reads `.allclear/worker.port`, provides `worker_call()` helper for HTTP requests from shell commands | NEW |
| `allclear.config.json` | Extended with `impact-map` section (`port`, `history`, `chroma`); presence of section triggers worker auto-start | MODIFIED (schema) |

---

## Recommended Project Structure (v2.0 additions)

```
allclear/
├── .claude-plugin/
│   └── plugin.json                   # Plugin manifest (unchanged)
│
├── .mcp.json                         # NEW: MCP server registration
│
├── commands/
│   ├── cross-impact.md               # MODIFIED: worker-aware + legacy fallback
│   ├── deploy-verify.md              # unchanged
│   ├── drift.md                      # unchanged
│   ├── map.md                        # NEW: /allclear:map command
│   ├── pulse.md                      # unchanged
│   └── quality-gate.md               # unchanged
│
├── worker/                           # NEW: Node.js worker process
│   ├── index.js                      # Entry point: starts http-server + optionally mcp-server
│   ├── http-server.js                # Express HTTP + D3 UI serving
│   ├── mcp-server.js                 # MCP stdio server (separate entry from HTTP)
│   ├── scan-manager.js               # Agent spawning + findings collection
│   ├── query-engine.js               # SQLite queries + FTS5 + breaking change detection
│   ├── db.js                         # Database connection, WAL mode, schema, migrations
│   ├── chroma-sync.js                # Optional ChromaDB sync
│   └── web/                          # D3.js graph UI static assets
│       ├── index.html
│       ├── graph.js
│       └── styles.css
│
├── hooks/
│   └── hooks.json                    # unchanged
│
├── scripts/
│   ├── drift-common.sh               # unchanged
│   ├── drift-openapi.sh              # unchanged
│   ├── drift-types.sh                # unchanged
│   ├── drift-versions.sh             # unchanged
│   ├── file-guard.sh                 # unchanged
│   ├── format.sh                     # unchanged
│   ├── impact.sh                     # unchanged (legacy grep fallback)
│   ├── lint.sh                       # unchanged
│   ├── pulse-check.sh                # unchanged
│   ├── session-start.sh              # MODIFIED: worker auto-start check
│   ├── worker-start.sh               # NEW: start Node.js worker
│   └── worker-stop.sh                # NEW: stop Node.js worker
│
├── lib/
│   ├── config.sh                     # unchanged
│   ├── detect.sh                     # unchanged
│   ├── linked-repos.sh               # unchanged
│   └── worker-client.sh              # NEW: bash HTTP client for worker API
│
├── skills/
│   └── quality-gate/
│       └── SKILL.md                  # unchanged
│
├── tests/
│   ├── (existing bats tests)
│   ├── worker-start.bats             # NEW
│   ├── worker-stop.bats              # NEW
│   └── worker-client.bats            # NEW
│
├── bin/
│   └── allclear-init.js              # unchanged (no Node.js server dep at install time)
│
├── package.json                      # MODIFIED: add worker dependencies
├── allclear.config.json.example      # MODIFIED: add impact-map section example
├── LICENSE
└── README.md
```

### Structure Rationale

- **worker/ at root:** Keeps all Node.js worker code in one directory, cleanly separated from shell-based scripts/. The MCP server entry (`mcp-server.js`) and HTTP server entry (`http-server.js`) are separate entry points because they have different lifecycles — MCP server is stdio (one process per Claude Code invocation), HTTP server is long-lived daemon.
- **.mcp.json at root:** Official Claude Code convention. Auto-discovered by Claude Code when plugin loads. Registers the MCP server so it auto-starts with the plugin, making impact tools available to all agents without any user action.
- **worker/web/ inside worker/:** Static D3.js assets are served by the HTTP server. Keeping them co-located with the server code that serves them avoids path confusion and makes the worker directory self-contained.
- **scripts/worker-start.sh and worker-stop.sh:** Shell wrappers (not Node.js scripts) for lifecycle management because: (1) session-start.sh is already shell and needs to trigger worker start; (2) `commands/*.md` reference shell scripts for consistency; (3) PID file management is natural in shell.
- **.allclear/ in the consuming repo:** The database and worker state live where the user's project lives, not in the plugin cache. The plugin cache is immutable after installation. Worker state is per-project, so it belongs in the project.
- **lib/worker-client.sh:** Shell commands need a consistent way to call the worker API without reimplementing HTTP logic. A shared bash library keeps this DRY and testable.

---

## Architectural Patterns

### Pattern 1: MCP Server as stdio Subprocess (Plugin-Registered)

**What:** The `.mcp.json` file registers `worker/mcp-server.js` as a stdio MCP server. Claude Code spawns it as a child process when the plugin loads. The server communicates via stdin/stdout using the MCP JSON-RPC protocol. It reads from the SQLite database and exposes 5 tools to all Claude agents in the session.

**When to use:** For capabilities that all Claude agents (not just the user-invoked commands) should have access to automatically. Impact analysis is exactly this use case — any agent making changes should be able to check impact without the user invoking a command.

**Trade-offs:** MCP server must never write to stdout for anything other than MCP protocol messages. Logging must go to stderr or a log file. The server starts with every Claude Code session when the plugin is enabled, so it must start quickly and fail gracefully if `.allclear/impact-map.db` does not exist.

**Configuration in `.mcp.json`:**
```json
{
  "mcpServers": {
    "allclear-impact": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp-server.js"],
      "env": {
        "ALLCLEAR_DB_PATH": ".allclear/impact-map.db"
      }
    }
  }
}
```

**Key constraint:** `ALLCLEAR_DB_PATH` must be relative to the working directory (the user's project), not the plugin root. The MCP server reads the DB from the project being worked on, not from the plugin itself.

### Pattern 2: HTTP Worker as Shell-Managed Daemon (PID File)

**What:** The Node.js HTTP server (`worker/http-server.js`) runs as a background daemon, started and stopped by shell scripts using a PID file in `.allclear/worker.pid`. The shell command reads the PID file to check if the worker is running before starting a new instance.

**When to use:** For long-lived state (SQLite writes, ChromaDB sync, web UI serving) that needs to persist across multiple command invocations within a working session. The worker is project-scoped — one worker per project, not one per Claude Code session.

**Trade-offs:** PID files can go stale if the process crashes. Worker start scripts must handle stale PIDs by checking if the PID is actually alive (`kill -0 $PID`) before deciding the worker is running.

**Worker start pattern (`scripts/worker-start.sh`):**
```bash
#!/usr/bin/env bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB_DIR=".allclear"
PID_FILE="${DB_DIR}/worker.pid"
PORT_FILE="${DB_DIR}/worker.port"

mkdir -p "$DB_DIR"

# Check for live worker (stale PID guard)
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    exit 0  # already running
  fi
  rm -f "$PID_FILE"  # stale PID
fi

# Read port from config (default 37888)
PORT=$(jq -r '."impact-map".port // 37888' allclear.config.json 2>/dev/null || echo 37888)

# Start worker in background
node "${PLUGIN_ROOT}/worker/http-server.js" \
  --port "$PORT" \
  --db "${DB_DIR}/impact-map.db" \
  --port-file "$PORT_FILE" \
  >/dev/null 2>&1 &
echo $! > "$PID_FILE"
```

### Pattern 3: Command-to-Worker Communication via Shell HTTP Client

**What:** Shell-based commands (`commands/*.md`) need to query the worker API. Rather than embedding curl calls in every command markdown file, a shared bash library (`lib/worker-client.sh`) provides `worker_call()` and `worker_running()` helpers. Commands source this library via shell injection.

**When to use:** Any command that needs to check worker status or query the impact map.

**Trade-offs:** Adds a curl dependency for shell commands (curl is universally available). Abstracts port discovery (reads `.allclear/worker.port`) from individual commands.

**Library pattern (`lib/worker-client.sh`):**
```bash
worker_running() {
  local port_file=".allclear/worker.port"
  [[ -f "$port_file" ]] || return 1
  local port; port=$(cat "$port_file")
  curl -s --max-time 1 "http://localhost:${port}/health" >/dev/null 2>&1
}

worker_call() {
  local endpoint="$1"; shift
  local port; port=$(cat ".allclear/worker.port" 2>/dev/null) || return 1
  curl -sf --max-time 5 "http://localhost:${port}${endpoint}" "$@"
}
```

### Pattern 4: SessionStart Hook with Conditional Worker Auto-Start

**What:** The existing `session-start.sh` hook is modified to detect the `impact-map` section in `allclear.config.json`. If present and the worker is not already running, it starts the worker as a background process before injecting session context. The hook must remain non-blocking (exit 0 always, 10s timeout constraint).

**When to use:** Auto-start on session open when the user has opted in to impact intelligence (presence of `impact-map` section in config = opt-in signal per design doc).

**Trade-offs:** Worker startup adds latency to `session-start.sh`. Mitigation: start the worker in background (`node ... &`), don't wait for it to be ready. The hook's job is to fire the worker, not confirm it started. The first command that needs the worker checks health before calling the API.

**Modified section in `session-start.sh`:**
```bash
# Auto-start worker if impact-map section present in config
if jq -e '."impact-map"' allclear.config.json >/dev/null 2>&1; then
  bash "${PLUGIN_ROOT}/scripts/worker-start.sh" 2>/dev/null || true
  CONTEXT="${CONTEXT} Impact map available: /allclear:cross-impact, /allclear:map."
fi
```

### Pattern 5: Graceful Degradation in cross-impact.md

**What:** The redesigned `cross-impact` command checks three conditions in sequence: (1) is the worker running? (2) does the impact map have data? The command falls back to legacy grep-based scan if the worker is absent, and suggests `/allclear:map` if the worker is running but no data exists.

**When to use:** Required for the v2.0 design's graceful degradation table (see design doc).

**Trade-offs:** More complex command logic, but essential for backwards compatibility — users who have v2.0 installed but haven't run `/allclear:map` yet must not experience a broken cross-impact command.

---

## Data Flow

### Map Build Flow (`/allclear:map`)

```
User invokes /allclear:map
    |
    v
commands/map.md: read config, discover linked repos, present to user
    |
    v
User confirms repo list → saved to allclear.config.json
    |
    v
map.md: ensure worker running → bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
    |
    v
map.md: POST /scan to worker HTTP API → scan-manager.js
    |
    v
scan-manager.js: spawns Claude agents into each linked repo
    |
    v
Agents analyze codebase → return findings (services, connections, schemas)
    |
    v
map.md: receives findings, presents ALL to user for confirmation
    |
    v
User confirms → map.md: POST /scan/confirm to worker with confirmed findings
    |
    v
db.js: snapshot existing DB (if history=true) → write new findings to SQLite
    |
    v
chroma-sync.js: async vector sync (if ChromaDB available) — does not block response
    |
    v
map.md: open browser to http://localhost:PORT for D3 graph UI
```

### MCP Impact Query Flow (agent-invoked)

```
Claude agent decides to check impact before making a change
    |
    v
Agent calls MCP tool: impact_changed (or impact_query)
    |
    v
mcp-server.js receives tool call via stdio MCP protocol
    |
    v
query-engine.js: reads .allclear/impact-map.db via better-sqlite3
    |
    v
Recursive CTE query: walks connection graph transitively
    |
    v
Results classified: CRITICAL (removed endpoint) / WARN (schema change) / INFO (additive)
    |
    v
mcp-server.js: returns structured result to agent via MCP protocol
    |
    v
Agent incorporates impact assessment into its response
```

### Worker Lifecycle Flow

```
Claude Code session starts
    |
    v
hooks/hooks.json: fires session-start.sh
    |
    v
session-start.sh: detects impact-map in allclear.config.json?
    |-- No  → skip worker start, no change to context
    |-- Yes → scripts/worker-start.sh (background, non-blocking)
                |
                v
              Check .allclear/worker.pid — stale? alive?
                |-- Alive → exit 0 (already running)
                |-- Absent/stale → start Node.js, write PID + port files
    |
    v
session-start.sh: includes impact commands in context string
    |
    v
Worker runs until: session ends, user runs worker-stop, process killed
```

### D3 Web UI Asset Serving

```
User runs /allclear:map --view (or first map build completes)
    |
    v
map.md: verify worker running + map data exists
    |
    v
map.md: open browser → http://localhost:PORT/
    |
    v
http-server.js: serves worker/web/index.html as static file
    |
    v
Browser loads D3.js, calls GET /graph to fetch dependency data
    |
    v
http-server.js: routes /graph to query-engine.js → SQLite query
    |
    v
Returns JSON graph: {nodes: [...services], edges: [...connections]}
    |
    v
D3.js renders interactive force-directed graph
```

---

## Integration Points

### New Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `commands/map.md` → `scripts/worker-start.sh` | Shell script invocation via Bash tool | Command ensures worker running before scan |
| `commands/map.md` → worker HTTP API | `curl` via `lib/worker-client.sh` helper | POST /scan, POST /scan/confirm, GET /versions |
| `commands/cross-impact.md` → `lib/worker-client.sh` | Shell source | worker_running() and worker_call() helpers |
| `commands/cross-impact.md` → `scripts/impact.sh` | Shell script invocation (fallback only) | Legacy grep scan when no worker/map |
| `.mcp.json` → `worker/mcp-server.js` | Claude Code spawns as stdio MCP subprocess | Auto-starts with plugin; communicates via MCP protocol |
| `scripts/session-start.sh` → `scripts/worker-start.sh` | Shell script invocation | Auto-start trigger; non-blocking (background) |
| `worker/mcp-server.js` → `worker/query-engine.js` | Direct Node.js module import | Same process; no IPC needed |
| `worker/http-server.js` → `worker/query-engine.js` | Direct Node.js module import | Same process |
| `worker/query-engine.js` → SQLite | `better-sqlite3` synchronous API | WAL mode enabled; FTS5 virtual tables for search |
| `worker/chroma-sync.js` → ChromaDB | HTTP client to `localhost:8000` (or configured host) | Async, non-blocking; absence = graceful skip |
| Worker process → `.allclear/impact-map.db` | File system (project repo) | DB lives in project, not plugin cache |
| Worker process → `.allclear/worker.pid` | File system | Written at start; read by worker-start.sh for dedup |
| Worker process → `.allclear/worker.port` | File system | Written at startup; read by lib/worker-client.sh |

### Modified Existing Boundaries

| Boundary | What Changes | Why |
|----------|-------------|-----|
| `hooks/hooks.json` → `scripts/session-start.sh` | session-start.sh adds worker auto-start | Worker must start early; session hook is the right trigger |
| `commands/cross-impact.md` → `scripts/impact.sh` | No longer primary path; becomes fallback | v2.0 uses worker API; grep remains for graceful degradation |
| `allclear.config.json` schema | Add `impact-map` section | Worker config (port, history, ChromaDB settings) |
| `package.json` | Add Node.js worker dependencies | `better-sqlite3`, `express`, `@modelcontextprotocol/sdk` |

### External Service Integrations

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| ChromaDB | HTTP client from `worker/chroma-sync.js` to configured host:port | Optional; skip gracefully if not available; never block on it |
| SQLite | `better-sqlite3` embedded in worker process | No separate process; DB file lives in project repo |
| Claude agents (scan) | `scan-manager.js` spawns agents into each linked repo | Agent-based scanning; no external tools (tree-sitter, etc.) |
| D3.js (web UI) | Bundled static assets in `worker/web/` | No CDN; fully offline; served by HTTP worker |

---

## Build Order (v2.0 Phases)

Dependencies determine phase ordering. The MCP server must be buildable and testable independently of the HTTP server and scan manager.

```
Phase A — Storage Foundation (no dependencies):
  worker/db.js                ← SQLite schema, WAL mode, FTS5 indexes, migrations
  worker/query-engine.js      ← All read/write queries; depends only on db.js
  (Tests: query accuracy, recursive CTEs, FTS5 search)

Phase B — Worker Lifecycle (depends on: shell scripts, PID/port file pattern):
  scripts/worker-start.sh     ← Start daemon, write PID + port files
  scripts/worker-stop.sh      ← Stop daemon, clean up PID + port files
  lib/worker-client.sh        ← Shell HTTP client helpers
  (Tests: start/stop/stale-PID/already-running cases)

Phase C — MCP Server (depends on Phase A):
  worker/mcp-server.js        ← stdio MCP server; 5 tools; reads from query-engine
  .mcp.json                   ← Plugin registration for Claude Code
  (Tests: MCP tool responses, no-DB graceful fallback)

Phase D — HTTP Server + Web UI (depends on Phase A):
  worker/http-server.js       ← Express routes: /graph, /impact, /service, /scan, /versions
  worker/web/                 ← D3.js UI static assets
  (Tests: REST API response shapes, D3 data contract)

Phase E — Scan Manager (depends on Phase A, D):
  worker/scan-manager.js      ← Agent orchestration, findings collection
  worker/chroma-sync.js       ← Optional async ChromaDB sync
  (Tests: mock agent responses, confirm/reject flow, snapshot creation)

Phase F — Command Layer (depends on Phases B, C, D, E):
  commands/map.md             ← /allclear:map: discovery → scan → confirm → persist → UI
  commands/cross-impact.md    ← MODIFIED: worker-aware + legacy fallback path
  (Tests: command flows with mocked worker API)

Phase G — Session Hook Integration (depends on Phase B):
  scripts/session-start.sh    ← MODIFIED: add worker auto-start conditional
  (Tests: session hook with/without impact-map in config)

Phase H — End-to-End Tests (depends on all phases):
  Bats integration tests for complete scan + query flow
  Manual smoke test: /allclear:map on real repo, verify D3 UI
```

**Critical path:** Phase A (storage) → Phase C (MCP server) → Phase F (commands). Everything else can be built in parallel once Phase A is done.

---

## Anti-Patterns

### Anti-Pattern 1: Running the Worker Inside a Hook Script

**What people do:** Start the Node.js worker process as a synchronous child in `session-start.sh` and wait for it to be ready.

**Why it's wrong:** Hooks have a hard 10-second timeout. Node.js + SQLite startup (especially on first run with schema creation) can exceed this. A blocking hook start will time out and fail, leaving the worker not started and producing a confusing error in the session.

**Do this instead:** Fire `node worker/http-server.js ... &` (background) from the hook. Write the PID file immediately. The first command that needs the worker calls `worker_running()` from `lib/worker-client.sh`, which polls with a short timeout (e.g., 3 retries at 500ms) to wait for the worker to be actually ready before calling the API.

### Anti-Pattern 2: Putting the SQLite DB in the Plugin Cache

**What people do:** Use `${CLAUDE_PLUGIN_ROOT}/.allclear/impact-map.db` for the database path.

**Why it's wrong:** The plugin cache is immutable after installation. Writes will fail with a permission error or silently be lost on plugin update. Worse, the DB would be shared across all projects using the plugin, which breaks the per-project design.

**Do this instead:** The DB always lives in `.allclear/` relative to the project's working directory (the repo where `/allclear:map` was invoked). The MCP server receives `ALLCLEAR_DB_PATH` as an environment variable resolved from the project CWD at startup time.

### Anti-Pattern 3: MCP Server Writing to stdout for Logging

**What people do:** Add `console.log()` debug statements in `mcp-server.js` for troubleshooting.

**Why it's wrong:** The MCP stdio transport uses stdout exclusively for JSON-RPC messages. Any non-MCP output on stdout corrupts the protocol, causing Claude Code to silently drop the connection or produce JSON parse errors.

**Do this instead:** All logging in `mcp-server.js` must go to stderr: `console.error()`. Use a log level flag controlled by an environment variable (e.g., `ALLCLEAR_MCP_DEBUG=1`). The HTTP server has no such constraint and can log freely.

### Anti-Pattern 4: One Port Hardcoded for All Projects

**What people do:** Hardcode port 37888 everywhere and skip the `worker.port` file.

**Why it's wrong:** If a user is running two projects simultaneously (common for multi-repo work), both workers bind to the same port. The second worker silently fails to start, and commands in that project hit the wrong worker's data.

**Do this instead:** Port is configured per-project in `allclear.config.json` (default 37888 but overridable). The worker writes its actual bound port to `.allclear/worker.port` at startup. All shell commands read this file for the port, not the config. This also handles port collision: if 37888 is taken, the worker can try the next port and write that to the port file.

### Anti-Pattern 5: Blocking the Scan on ChromaDB Availability

**What people do:** Make the scan flow synchronous: scan → write SQLite → sync ChromaDB → return success.

**Why it's wrong:** ChromaDB sync is slow and optional. Making `/allclear:map` wait for ChromaDB makes the common case (ChromaDB not running) feel broken. The design doc is explicit that SQLite is the source of truth.

**Do this instead:** ChromaDB sync is always async. After confirmed findings are written to SQLite, fire `chroma-sync.js` in the background. The map command returns success immediately after SQLite write. ChromaDB sync completion is not reported unless there's an error.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 2-5 linked repos | Default configuration works; single SQLite file; single worker per project |
| 5-15 linked repos | Incremental scan (git diff) becomes important; full re-scan is slow; FTS5 search adequate |
| 15-50 repos (large monorepo) | ChromaDB vector search strongly recommended for semantic queries; SQLite FTS5 may struggle with very large graphs; consider SQLite WAL checkpoint interval tuning |
| Multiple simultaneous projects | Each project has its own `.allclear/` dir and worker on its own port; no sharing between projects |

### Scaling Priorities

1. **First bottleneck:** Full scan latency. Scanning 10+ repos with agent-based analysis is slow. Incremental scan (Phase A: check `repo_state` table for last scanned commit) must be working before the product is usable for large setups.
2. **Second bottleneck:** Graph query performance on large maps. Recursive CTEs with hundreds of services and thousands of connections can be slow. Ensure indexes on `connections.source_service_id`, `connections.target_service_id`, and `services.name` are created in Phase A.

---

## Sources

- Claude Code Plugins Reference (official): https://code.claude.com/docs/en/plugins-reference
- MCP server plugin registration (official docs, `.mcp.json` convention): https://code.claude.com/docs/en/plugins-reference#mcp-servers
- Claude Code MCP documentation: https://code.claude.com/docs/en/mcp
- MCP Build Server guide: https://modelcontextprotocol.io/docs/develop/build-server
- better-sqlite3 WAL mode and concurrency: https://github.com/WiseLibs/better-sqlite3
- SQLite WAL documentation: https://sqlite.org/wal.html
- ChromaDB client-server mode: https://docs.trychroma.com/docs/run-chroma/client-server
- AllClear v2.0 design document: `.planning/designs/cross-impact-v2.md`
- AllClear v1.0 codebase (inspected directly): `scripts/`, `hooks/`, `lib/`, `commands/`

---
*Architecture research for: AllClear v2.0 Service Dependency Intelligence integration*
*Researched: 2026-03-15*
