# Project Research Summary

**Project:** AllClear — Claude Code Plugin (v2.0 Service Dependency Intelligence)
**Domain:** Claude Code plugin — quality gates, cross-repo checks, auto-format/lint hooks, and service dependency graph intelligence
**Researched:** 2026-03-15
**Confidence:** HIGH

## Executive Summary

AllClear v2.0 is a Claude Code plugin that evolves from v1.0 shell-based quality gates and hooks into a full service dependency intelligence layer for multi-repo polyglot teams. The v2.0 milestone centers on a locally-running Node.js worker process that builds and maintains a SQLite-backed dependency graph by spawning Claude agents to scan linked repos, then exposes that graph via a stdio MCP server (for agent-autonomous impact checking) and a D3.js web UI (for human visualization). The recommended approach is to layer the new capabilities directly onto the existing plugin structure — `worker/` alongside existing `scripts/`, `hooks/`, and `commands/` — with the worker acting as the shared service that all new commands and MCP tools delegate to.

The key architectural insight is that the worker must be the first thing built. Every v2.0 capability — MCP tools, graph visualization, incremental scanning, impact queries — is only reachable through the worker. This makes Phase 1 (storage foundation: SQLite schema and query engine) and Phase 2 (worker lifecycle: PID file management, readiness probes) the critical path. Everything else parallelizes once those two phases are solid. Agent-based scanning with no tree-sitter or external parsers is the primary differentiator over competitors like CodeLogic and Augment Code, and a user-confirmation hard gate before any SQLite write is the trust mechanism that makes probabilistic agent findings safe to act on.

The top risks are operational rather than architectural: worker process orphaning (no PID file), MCP stdout pollution (protocol corruption), ChromaDB hard failures (must be fully async), and agent hallucinations entering the graph unchecked (confirmation UX must group by confidence to prevent rubber-stamping). All are preventable by building the right primitives first. The one confirmed external limitation is that background subagents cannot access MCP tools (Claude Code issue #13254) — agent scanning must run in the foreground.

## Key Findings

### Recommended Stack

The plugin continues to use the official Claude Code plugin format: `plugin.json` in `.claude-plugin/`, skills in `skills/<name>/SKILL.md`, and hooks configured via `hooks/hooks.json`. Shell and jq remain the right runtime for hooks and wrapper scripts; bats-core 1.13.0 remains the test framework. The v2.0 additions raise the Node.js minimum to 20+ (driven by `better-sqlite3` 12.x and Fastify 5.x).

**Core technologies:**
- `better-sqlite3` 12.8.0 — synchronous SQLite with WAL + FTS5; single connection, single thread eliminates WAL checkpoint starvation
- `fastify` 5.8.2 — HTTP server for REST API and static D3 UI; 2.4x faster than Express; built-in schema validation; requires Node.js 20+
- `@modelcontextprotocol/sdk` 1.27.1 — official Anthropic TypeScript SDK; `McpServer` + `StdioServerTransport` is the canonical stdio MCP server pattern
- `d3` 7.9.0 — force-directed graph visualization as a static single-file HTML page; no build step; Canvas renderer required for graphs above 30 nodes
- `chromadb` 3.3.3 — optional vector search client (v3 is a complete rewrite; 70% smaller than v2); three-tier fallback chain: ChromaDB → FTS5 → direct SQL
- `${CLAUDE_PLUGIN_ROOT}` — mandatory runtime path variable for all hook and script references; hardcoded paths break after plugin cache installation

**Critical version requirements:**
- Node.js 20+ is the v2.0 minimum (better-sqlite3 12.x and Fastify 5.x both require it; v1.0 required 18+)
- Claude Code 1.0.33+ for plugin system support
- `skills/` format only for new skills — `commands/` is legacy and does not support autonomous invocation

### Expected Features

AllClear v2.0 features are well-defined by the internal design document (`cross-impact-v2.md`). The feature dependency tree is clear: the worker is the load-bearing foundation; the SQLite schema must be stable before any scanning; the user confirmation gate is a hard constraint, not a toggle.

**Must have (table stakes for v2.0 launch):**
- Worker process with HTTP server — all other v2.0 features are unreachable without it
- Stable SQLite schema before scanning begins — `repos`, `services`, `connections`, `schemas`, `fields`, `map_versions`, `repo_state` tables
- Agent-based scanning via `/allclear:map` — primary user-facing build flow; no external parser dependencies
- User confirmation gate (hard, not optional) — ALL findings presented before any SQLite write, regardless of agent confidence
- Incremental scanning (git diff since `last_scanned_commit`) — full re-scans are too slow for daily use; this is required at launch
- Transitive impact traversal — blast radius is the core value; direct-only impact is insufficient
- Breaking change classification (CRITICAL/WARN/INFO) — removed endpoints vs additive changes require different severity
- `/allclear:cross-impact` redesign — uses worker graph queries when map exists; falls back to legacy grep scan when absent
- D3 web UI (basic force-directed graph) — required for users to validate the dependency map visually
- MCP server with `impact_query` and `impact_changed` tools — enables agents to check impact autonomously

**Should have (competitive differentiators):**
- Protocol-aware connections: REST, gRPC, Kafka/RabbitMQ events, internal SDK — models the actual dependency, not just "service calls service"
- Field-level schema tracking — discovers schemas from code regardless of whether an OpenAPI spec exists
- Map versioning with snapshot history — SQLite file copy to `.allclear/snapshots/`; enables graph diff queries
- ChromaDB optional semantic search — FTS5 keyword search misses "find services handling authentication"; semantic finds them
- Mono-repo and multi-repo unified model — services are the graph nodes; `repos` is just a container

**Defer to v2.x (post-validation):**
- `impact_graph` and `impact_search` MCP tools
- D3 UI enhancements (protocol filtering, zoom, node detail pane)
- Snapshot comparison UI (visual graph diff)
- Graph export in JSON or dot format
- ChromaDB cloud mode

**Anti-features to explicitly reject:**
- Auto-persist findings without user review — agent findings are probabilistic; unreviewed data corrupts blast radius calculations
- Automatic re-scan on every file save — hooks fire synchronously; a slow hook blocks Claude Code
- OpenAPI spec parsing as primary scanner — misses gRPC, internal SDKs, event producers; creates a false "complete" graph
- Real-time WebSocket graph streaming — HTTP polling with `Last-Modified` is sufficient; WebSocket adds complexity for no gain

### Architecture Approach

The v2.0 architecture adds a Worker Layer (Node.js process) and MCP Layer (stdio server) to the existing plugin structure, while keeping the existing Event Layer (hooks) and Support Layer (shell libs) unchanged. The worker runs as a project-scoped background daemon managed by PID file; the MCP server runs as a stdio subprocess spawned by Claude Code via `.mcp.json`. Both share the same SQLite connection and query engine within a single Node.js process. The database and all worker state live in `.allclear/` in the user's project repo, not in the plugin cache (which is immutable after installation).

**Major components:**
1. `worker/db.js` — SQLite connection with WAL mode, FTS5 indexes, schema migrations; the foundation for everything
2. `worker/query-engine.js` — all SQLite read/write queries; recursive CTE graph traversal with cycle detection; breaking change classification
3. `worker/mcp-server.js` — stdio MCP server; 5 tools; reads from query engine; logs to stderr only (stdout is protocol-exclusive)
4. `worker/http-server.js` — Fastify REST API and static D3 UI; `/graph`, `/impact`, `/scan`, `/scan/confirm`, `/health`, `/versions`
5. `worker/scan-manager.js` — spawns Claude agents into linked repos; collects findings; drives grouped user confirmation flow
6. `scripts/worker-start.sh` and `worker-stop.sh` — PID file lifecycle management with stale-PID detection and readiness probe
7. `lib/worker-client.sh` — shared bash HTTP client (`worker_running()`, `worker_call()`); all commands source this
8. `commands/map.md` (new) and `commands/cross-impact.md` (modified) — thin user-facing orchestration shells

**Build order is architecturally constrained:**
Phase A (storage) → Phase C (MCP) and Phase D (HTTP) in parallel → Phase E (scan manager) → Phase F (commands) → Phase G (session hook)

### Critical Pitfalls

1. **Worker process orphaning** — Always write PID to `.allclear/worker.pid` on spawn; use `kill -0 $PID` to distinguish stale from live PIDs before starting a second worker. Missing this causes EADDRINUSE errors and split-brain SQLite access. Address in worker foundation phase.

2. **Shell-to-Node.js race condition** — Never send HTTP requests immediately after spawning the worker. Implement a readiness probe: poll `GET /health` with 20 retries at 250ms intervals. The `/health` route must be registered as the very first Fastify route, before any DB initialization. Address in worker foundation phase.

3. **MCP stdout pollution** — The MCP stdio transport uses stdout exclusively for JSON-RPC. A single `console.log()` corrupts the entire MCP session silently — tools appear registered but never return results. All logging in `mcp-server.js` must go to stderr. Add a CI lint rule to catch `console.log` in mcp-server.js. Address at MCP server phase start.

4. **Transitive graph traversal cycles** — Any cycle in the service graph (mutual auth, callback patterns) will infinite-loop a naive recursive CTE. Use SQLite recursive CTE with visited-set pattern and a depth cap (default 5, max 10). Test with a deliberately cyclic graph. Address in query engine phase.

5. **ChromaDB hard failure blocking SQLite writes** — If ChromaDB sync is in the same code path as SQLite persistence, a ChromaDB outage silently prevents all scan findings from being saved. Always write SQLite first, confirm success, then fire ChromaDB sync asynchronously with `.catch()`. Address at ChromaDB integration phase.

6. **Confirmation fatigue causing rubber-stamping** — Presenting 50+ individual findings for confirmation causes users to approve everything without reading, defeating the validation purpose. Group by confidence: HIGH = single batch confirm; MEDIUM = per-repo confirm; LOW = individual questions. Cap LOW confidence findings at 10 per scan. Address in map command UX design before implementation.

7. **Background subagents cannot access MCP tools** — Confirmed Claude Code issue #13254. Agents spawned with `run_in_background: true` do not inherit MCP tool access. Scan manager must run agents sequentially in the foreground. Validate in first agent scan prototype before building the full scan pipeline.

## Implications for Roadmap

Based on the combined research, the build order is architecturally constrained. The storage foundation and worker lifecycle are the critical path that unlocks all subsequent work.

### Phase 1: Storage Foundation

**Rationale:** Every v2.0 feature depends on the SQLite schema being stable. Schema migrations after agents have written data are painful and risky. This phase has no dependencies on any other phase and must come first.
**Delivers:** `worker/db.js` (schema, WAL mode, FTS5 indexes, migrations), `worker/query-engine.js` (all queries including recursive CTE transitive traversal with cycle detection and depth cap), test suite exercising the query engine directly
**Addresses features:** SQLite schema stability, transitive impact traversal, breaking change classification, incremental scan via `repo_state` table
**Avoids pitfalls:** WAL file growth (set `journal_size_limit` and `busy_timeout` on first open — not patchable later), recursive CTE cycles (depth cap and visited-set from day one), snapshot corruption (use `VACUUM INTO` not `cp`)

### Phase 2: Worker Lifecycle

**Rationale:** The worker process shell scripts have no Node.js code dependencies and unblock all subsequent phases that need a running worker. The readiness probe pattern must be established here and reused by all later phases.
**Delivers:** `scripts/worker-start.sh`, `scripts/worker-stop.sh`, `lib/worker-client.sh`, PID file management with stale-PID detection, readiness probe (`wait_for_worker()`), port file pattern (`.allclear/worker.port`), per-project port configuration
**Addresses features:** Worker process start/stop management, port-per-project configuration
**Avoids pitfalls:** Worker orphaning (PID file plus `kill -0` check), shell-to-Node.js race condition (readiness probe built here), port conflicts from multiple simultaneous projects

### Phase 3: MCP Server

**Rationale:** Depends only on Phase 1 (query engine). Can be built in parallel with Phase 4. MCP tools provide agent-autonomous impact checking — the most strategically important v2.0 capability. Establishing the stderr-only logging convention early prevents protocol corruption from ever entering the codebase.
**Delivers:** `worker/mcp-server.js` (5 MCP tools), `.mcp.json` plugin registration, graceful behavior when DB does not yet exist
**Addresses features:** MCP server for agent use, `impact_query` and `impact_changed` at launch
**Avoids pitfalls:** MCP stdout pollution (stderr-only log wrapper before any tool handler code), graceful DB-absent startup (tools return empty results, not errors)

### Phase 4: HTTP Server and Web UI

**Rationale:** Depends only on Phase 1 (query engine). Can be built in parallel with Phase 3. The graph visualization is required for users to validate the dependency map. The Canvas rendering decision must be made before writing any graph code — retrofitting Canvas onto an SVG implementation requires a full rewrite.
**Delivers:** `worker/http-server.js` (Fastify REST routes), `worker/web/index.html` and `graph.js` (D3 Canvas-based force-directed graph with Web Worker simulation), `GET /health` registered first
**Addresses features:** D3 web UI (basic force-directed graph), `/allclear:map --view` shortcut
**Avoids pitfalls:** D3 performance at scale (Canvas plus Web Worker from the start; SVG freezes above 30 nodes), `GET /health` as the very first route so the readiness probe from Phase 2 can detect it

### Phase 5: Scan Manager

**Rationale:** Depends on Phases 1 and 4 (needs HTTP API to receive POST /scan). This is the highest-risk phase — agent hallucination, confirmation fatigue, and background agent MCP limitations all live here. Validate agent MCP access in the first prototype before building the full pipeline.
**Delivers:** `worker/scan-manager.js` (foreground agent orchestration, confidence scoring), grouped confirmation UX (HIGH batch / MEDIUM per-repo / LOW individual, cap 10 LOW per scan), snapshot creation after confirmed writes, incremental scan via `repo_state` and `git diff --name-status`
**Addresses features:** Agent-based scanning, user confirmation gate (hard), incremental scanning, map versioning, stale connection cleanup for deleted/renamed files
**Avoids pitfalls:** Background agents without MCP access (foreground-only agent spawning), agent hallucination (confidence levels, literal-string-only prompt instructions, file-existence secondary validation), confirmation fatigue (grouped UX), snapshot bloat (auto-gitignore `.allclear/`, 10-snapshot retention default), incremental scan missing renames (`--name-status` not `--name-only`)

### Phase 6: Command Layer

**Rationale:** Commands are thin orchestration shells over the worker API. Depends on all prior phases. Building commands last also prevents premature commitment to command UX before worker behavior is fully understood.
**Delivers:** `commands/map.md` (new: repo discovery → scan → confirm → persist → browser open), `commands/cross-impact.md` (modified: worker-aware plus legacy grep fallback), first-run MCP registration instructions after first successful map build
**Addresses features:** `/allclear:map`, `/allclear:cross-impact` redesign, graceful fallback to grep when map absent
**Avoids pitfalls:** Graceful degradation ensures v2.0 upgrade does not break users who have not yet run `/allclear:map`

### Phase 7: Session Hook Integration

**Rationale:** A lightweight modification to an existing hook; intentionally last to keep risk isolated. Depends on Phase 2 (worker-start.sh).
**Delivers:** Modified `scripts/session-start.sh` (conditional worker auto-start when `impact-map` section present in config, one-line worker health status in session context)
**Addresses features:** Worker auto-start on session open, session context showing impact commands available
**Avoids pitfalls:** Blocking hook startup (fire worker in background; hook exits immediately; first command polls readiness via Phase 2 probe)

### Phase 8: End-to-End Tests and ChromaDB Integration

**Rationale:** ChromaDB is optional acceleration and must not block any earlier phase. End-to-end tests validate the complete scan → query → impact flow after all components are integrated.
**Delivers:** `worker/chroma-sync.js` (async, non-blocking, graceful skip), complete bats integration test suite, manual smoke test documentation for the full map-build-to-D3-UI flow
**Addresses features:** ChromaDB optional semantic search, three-tier fallback chain validation, worker localhost-only binding security check
**Avoids pitfalls:** ChromaDB hard failure (fully async with `.catch()`, health-check flag on startup), ChromaDB desync is non-fatal (FTS5 fallback always works)

### Phase Ordering Rationale

- **Storage before scanning:** The SQLite schema is the data model contract. Agents write to it; commands read from it; the MCP server exposes it. Any schema change after real data is written requires a migration. Locking in the schema in Phase 1 removes this risk for all subsequent phases.
- **Worker lifecycle before worker code:** The PID file and readiness probe patterns are needed by every phase that starts or communicates with the worker. Building these as a foundation in Phase 2 means all subsequent phases use proven utilities rather than each reinventing the pattern.
- **MCP and HTTP in parallel (Phases 3 and 4):** Both depend only on the query engine and are architecturally independent. Separating them enforces the clean boundary between the stdio MCP transport and the TCP HTTP server.
- **Scan manager after HTTP:** The scan manager posts findings to the HTTP API (`POST /scan/confirm`). It needs a working HTTP server to write through.
- **Commands after scan manager:** Commands are thin; they add value only when the underlying worker pipeline is tested and solid.
- **ChromaDB last:** Optional feature. Its absence must not block any prior phase. Its failure mode (graceful skip) is tested explicitly in Phase 8 rather than assumed.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Scan Manager):** Agent scanning prompts and findings schema require iteration — hallucination rate is unknown until tested on real repos. Plan for a research-and-iterate loop on the agent prompt template. The Claude SDK direct approach for controlled parallelism was identified but not fully designed.
- **Phase 3 (MCP Server):** The `.mcp.json` plugin registration convention and MCP tool description length limits warrant re-verification against Claude Code docs at implementation time; the MCP spec evolves.
- **Phase 4 (D3 Web UI):** Canvas hit detection for node click/hover without DOM elements requires custom point-in-circle math on `mousemove`. Warrants a spike before committing to the full UI implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Storage Foundation):** SQLite WAL mode, FTS5, and better-sqlite3 are fully documented with code examples in the stack research.
- **Phase 2 (Worker Lifecycle):** PID file management and readiness probe are established shell patterns with direct code examples in the architecture research.
- **Phase 6 (Command Layer):** Command markdown files follow the existing AllClear pattern; the worker client library provides the abstraction.
- **Phase 7 (Session Hook):** Small modification to an existing hook; pattern is fully documented in the architecture research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Primary sources: official Claude Code docs, verified installed plugins in local cache, GitHub releases for exact versions. Node.js 20+ minimum is hard (better-sqlite3 12.x and Fastify 5.x both require it). |
| Features | HIGH | Design document (`cross-impact-v2.md`) is the primary source. Competitor analysis confirms differentiators. Feature dependency tree is well-understood with no ambiguous ordering. |
| Architecture | HIGH | Based on official Claude Code plugin docs, direct v1.0 codebase inspection, and verified MCP server patterns. Build order is architecturally constrained with a clear critical path. |
| Pitfalls | HIGH | Most pitfalls backed by official SQLite docs, confirmed Claude Code GitHub issues, MCP spec, and 2025 D3 performance benchmarks. Background agent MCP limitation is confirmed via issue #13254. |

**Overall confidence:** HIGH

### Gaps to Address

- **Agent hallucination rate in practice:** Research cites 27%+ inaccuracy in automated dependency extraction (ScienceDirect 2025). The actual rate for AllClear's agent-based approach is unknown until tested on real repos. Build confidence-level reporting into the agent prompt from day one and plan for prompt iteration during Phase 5.
- **MCP tool context window impact:** Tool description verbosity can consume significant context window. Keep tool descriptions lean and validate against a real Claude Code session during Phase 3 before finalizing descriptions.
- **Agent scan parallelism approach:** Sequential foreground scanning is the safe default (avoids background MCP limitation). For large multi-repo setups (10+ repos), scan latency may be unacceptable. The Claude SDK direct approach for controlled parallelism was noted but not fully designed — flag for Phase 5 design.
- **Snapshot VACUUM INTO performance:** `VACUUM INTO` is correct for consistent snapshots but slower than `cp`. For large databases, this may add noticeable latency. Benchmark with representative data during Phase 5.

## Sources

### Primary (HIGH confidence)
- `https://code.claude.com/docs/en/plugins` — Plugin structure, SKILL.md format, hooks.json location, --plugin-dir flag
- `https://code.claude.com/docs/en/plugins-reference` — Complete manifest schema, component paths, hook event types, CLI commands
- `https://code.claude.com/docs/en/hooks` — Hook stdin JSON format, stdout fields, exit code semantics, blocking vs non-blocking
- `https://code.claude.com/docs/en/plugin-marketplaces` — marketplace.json schema, distribution patterns
- `https://github.com/WiseLibs/better-sqlite3/releases` — v12.8.0 (2026-03-13), Node.js 20+ required, SQLite 3.51.3 bundled
- `https://github.com/fastify/fastify/releases` — Fastify 5.8.2, Node.js 20+ required
- `https://github.com/modelcontextprotocol/typescript-sdk/releases` — @modelcontextprotocol/sdk v1.27.1 current
- `https://d3js.org/getting-started` — D3 v7.9.0 current stable, ESM import pattern
- `https://www.trychroma.com/changelog/js-client-v3` — chromadb v3 rewrite, v3.3.3 current
- `https://sqlite.org/wal.html` — WAL checkpoint starvation, WAL growth, reader snapshot behavior
- `https://github.com/anthropics/claude-code/issues/13254` — Confirmed: background subagents cannot access MCP tools
- `.planning/designs/cross-impact-v2.md` — AllClear v2.0 primary design document (internal)
- `~/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/` — Direct inspection of production plugin (PID patterns, SessionStart hooks, SKILL.md format)

### Secondary (MEDIUM confidence)
- `https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/` — StdioServerTransport pattern confirmed
- `https://github.com/CodeLogicIncEngineering/codelogic-mcp-server` — Competitor MCP tool interface (direct inspection)
- `https://sqlite.org/forum/info/a188951b80292831794256a5c29f20f64f718d98ed0218bf44b51dd5907f1c39` — Real-world WAL growth scenarios
- `https://github.com/chroma-core/chroma/issues/346` — ChromaDB connection reliability failure modes
- D3 force simulation performance: Canvas vs SVG vs WebGL thresholds (2025 benchmarks)
- `https://www.sciencedirect.com/article/pii/S0950584925001934` — 27%+ inaccuracy in automated dependency extraction
- `https://www.nngroup.com/articles/confirmation-dialog/` — Confirmation fatigue and overuse consequences

---
*Research completed: 2026-03-15*
*Ready for roadmap: yes*
