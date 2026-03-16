# Codebase Concerns

**Analysis Date:** 2026-03-16

## Tech Debt

**Silent Failures in Per-Project Query Resolution:**
- Issue: `getQueryEngineByHash()` and `getQueryEngine()` return `null` on DB not found or errors, with callers silently handling nulls
- Files: `worker/db-pool.js` (lines 44-70, 158-213), `worker/query-engine.js` (line 142), `worker/mcp-server.js` (lines 35-45)
- Impact: Silent failures cascade — requests that should surface "no map data yet" errors get lost in translation, making it hard to debug missing projects
- Fix approach: Add explicit logging to DB resolution failures; consider returning a Result<QueryEngine|Error> type instead of null; surface errors in HTTP layer with 503 status codes

**Inconsistent Null Return Patterns:**
- Issue: Multiple functions return `null` when resources unavailable (DB not found, ChromaDB not available) without distinguishing between "not yet initialized" vs "failed to initialize"
- Files: `worker/db-pool.js`, `worker/mcp-server.js`, `worker/query-engine.js`, `worker/chroma-sync.js`
- Impact: Callers cannot differentiate between "waiting for first scan" and "genuine error"; reduces observability
- Fix approach: Create explicit error codes or enums: `{ status: 'NOT_INITIALIZED' | 'ERROR' | 'UNAVAILABLE', data: ... }`

**Shell Script Path Resolution Fragility:**
- Issue: Scripts in `scripts/*.sh` use multiple fallback patterns for locating libraries (`detect.sh`, `worker-client.sh`), creating brittle path logic
- Files: `scripts/session-start.sh` (lines 40-74), `scripts/format.sh` (lines 18-22), `scripts/lint.sh` (lines 41-46)
- Impact: If `CLAUDE_PLUGIN_ROOT` env var is unset, scripts search relative paths that may not exist in all execution contexts, causing silent failures
- Fix approach: Document the plugin root resolution order; add debug logging when library is not found; create a single shared function for library path resolution

**Lint Output Truncation Without Warning:**
- Issue: Lint output truncated to 30 lines with a summary appended; no explicit "output was large" flag sent to caller
- Files: `scripts/lint.sh` (lines 148-155)
- Impact: Users may not realize they're seeing incomplete linter output, potentially missing critical issues in large files
- Fix approach: Include `"truncated": true` in JSON output; provide a count of omitted lines; link to full output via a stable file location

## Known Issues

**MCP Server stdout Pollution Guard:**
- Issue: `scripts/lint.sh` lines 19-27 checks for `console.log()` in `worker/mcp-server.js` on every lint run; this is a runtime guard for a pattern that should be caught at code review
- Files: `scripts/lint.sh`, `worker/mcp-server.js`
- Trigger: Any `console.log()` statement in mcp-server.js
- Workaround: None — all logging must use `console.error()` instead
- Better fix: Add ESLint rule to forbid `console.log` in MCP server; document in CONVENTIONS.md

**Hardcoded Throttle Duration for Rust Linting:**
- Issue: Cargo clippy is throttled to 30 seconds per project (configurable via `ALLCLEAR_LINT_THROTTLE`)
- Files: `scripts/lint.sh` (lines 74-100)
- Trigger: Multiple rapid Rust file edits will only run clippy once per 30 seconds
- Workaround: Set `ALLCLEAR_LINT_THROTTLE=0` to disable throttling, but impacts performance
- Impact: Users might miss recent clippy warnings if they edit quickly; throttle value lacks data on what's "right"
- Fix approach: Make throttle duration per-workspace and configurable via config file; provide feedback when lint is throttled

**Database Initialization Race on First Access:**
- Issue: Multiple processes opening the same project DB for the first time may attempt migrations simultaneously
- Files: `worker/db.js` (migration preloading), `worker/db-pool.js` (line 58-63)
- Trigger: Two scan requests for same project within seconds, before migrations complete
- Impact: WAL journal contention, potential "database is locked" errors; migrations may run twice
- Workaround: Use `PRAGMA busy_timeout = 5000` (currently set in db-pool.js line 176)
- Fix approach: Add migration lock file; document busy_timeout setting in README

## Security Considerations

**Shell Command Injection in git Operations:**
- Risk: `scan-manager.js` uses `execSync()` with shell argument concatenation via `JSON.stringify(repoPath)`
- Files: `worker/scan-manager.js` (lines 60-72)
- Current mitigation: Arguments are JSON-stringified before insertion, preventing most shell escapes
- Recommendations: Audit all `execSync()` calls; prefer `execFile()` where possible; document the JSON.stringify() safety pattern in code comments

**SQLite VACUUM Path Injection:**
- Risk: `VACUUM INTO '${snapshotPath}'` uses string interpolation without quoting
- Files: `worker/query-engine.js` (line 780), `worker/db.js` (line 258)
- Current mitigation: Snapshot paths are constructed from project hash and timestamps, not user input
- Recommendations: Add `.replace(/'/g, "''")` for SQL escaping (already done in query-engine.js line 780); verify snapshot paths never accept user input

**Process.argv Parsing in Worker:**
- Risk: `worker/index.js` (lines 10-18) parses CLI args directly without validation
- Files: `worker/index.js`, `worker/db.js` (lines 286-287)
- Current mitigation: Only two expected args (`--port`, `--data-dir`); no shell execution from values
- Recommendations: Use a validated argument parser (yargs, minimist) instead of manual parsing; add upper/lower bounds on port number

**Environment Variable Leakage in Logs:**
- Risk: Structured logs to `worker.log` may contain sensitive env var values if application code passes them as extra fields
- Files: `worker/index.js` (lines 52-65)
- Current mitigation: Only standard fields logged (ts, level, msg, pid, port); no automatic env inspection
- Recommendations: Add log sanitization function to strip env var patterns (API_KEY, SECRET, TOKEN); document what not to log

## Performance Bottlenecks

**Synchronous File I/O in Session Start Hook:**
- Problem: `scripts/session-start.sh` reads `allclear.config.json` synchronously on every session start
- Files: `scripts/session-start.sh` (line 54)
- Cause: Hook must complete quickly; async would require non-blocking pattern
- Current: File is small and cached by OS, so minimal impact observed
- Improvement path: Consider caching file mtime hash in `/tmp` to skip re-read if unchanged

**Chroma Vector Search Fallback Chain Overhead:**
- Problem: 3-tier search (ChromaDB → FTS5 → SQL LIKE) creates latency on each search; failures are sequential, not parallel
- Files: `worker/query-engine.js` (lines 59-142)
- Cause: Each tier falls through on failure; network latency to ChromaDB (if remote) blocks FTS5 attempt
- Improvement path: Parallelize ChromaDB and FTS5 queries with a timeout; implement per-query result caching; make ChromaDB health check async and cache availability flag

**Graph Rendering Performance in UI:**
- Problem: Canvas rendering of large graphs (100+ nodes) may stutter with complex force simulation
- Files: `worker/ui/graph.js` (1000+ lines of rendering logic)
- Cause: Force simulation runs in Web Worker, but rendering loop is single-threaded canvas 2D context
- Improvement path: Implement level-of-detail rendering; cache rendered labels; use OffscreenCanvas for future browsers

## Fragile Areas

**Worker Lifecycle Management:**
- Files: `worker/index.js`, `scripts/worker-start.sh`, `scripts/worker-stop.sh`
- Why fragile: PID file is source of truth; if process crashes without cleanup, PID file remains, causing "already running" detection. Port file similarly fragile.
- Safe modification: Always use `pkill` with `-f` flag to terminate by process name; implement health check endpoint to verify process is actually running before trusting PID file
- Test coverage: Basic lifecycle tests exist in `tests/worker-lifecycle.bats`; edge cases around concurrent start attempts not covered

**Query Engine Transitive Impact Traversal:**
- Files: `worker/query-engine.js` (lines 200-300+)
- Why fragile: Complex recursive CTE with cycle detection using path concatenation; depth limit of 10 is hardcoded; circular dependencies can cause exponential path inflation
- Safe modification: Add comprehensive unit tests for cyclic graphs; validate depth limit is appropriate for real-world graphs; log CTE query results for debugging
- Test coverage: Unit tests exist but limited circular dependency scenarios tested

**Config File Merging (allclear.config.json):**
- Files: `scripts/session-start.sh` (line 54), `commands/map.md`, `commands/cross-impact.md`
- Why fragile: Config file parsing is scattered; no schema validation; defaults are implicit in each command
- Safe modification: Centralize config parsing with Zod schema; provide default config factory function; add `allclear.config.json.example` to repo
- Test coverage: No dedicated config parsing tests; relies on integration tests

**Confirmation Flow for Impact:**
- Files: `worker/confirmation-flow.js`
- Why fragile: Filters connected findings by presence of connections; nulls out findings with no connections, creating confusing output
- Safe modification: Add clear "no changes needed" message when all findings filtered out; preserve full finding chain for debugging
- Test coverage: Basic tests exist; edge case of "found service but no connections" may not be fully covered

## Scaling Limits

**SQLite Single-Writer Bottleneck:**
- Current capacity: Single project DB can handle ~1000 services, ~5000 connections before query performance degrades
- Limit: WAL mode mitigates but SQLite is fundamentally single-writer; concurrent scans on same project serialize via busy_timeout
- Scaling path: Migrate to PostgreSQL for high-concurrency scenarios; add read replicas; implement result caching layer

**Chroma Vector Store Memory:**
- Current capacity: In-memory Chroma (embedded mode) holds full dataset in RAM; 10k+ service vectors may cause OOM
- Limit: No pagination/streaming of vector search results
- Scaling path: Use Chroma server mode (separate process); implement result batching; add pruning of old snapshots

**MCP Server Single Instance:**
- Current capacity: Worker process runs one HTTP server on single port (37888 default); all requests queue on Fastify
- Limit: No load balancing; long-running queries block other clients
- Scaling path: Implement worker clustering (multiple processes); add request timeout limits; offload heavy queries to background jobs

## Dependencies at Risk

**@fastify/cors (10.1.0 → 11.2.0):**
- Risk: Major version bump available; may have breaking changes to CORS origin matching
- Impact: Current hardcoded origin regex for localhost dev (line 44 in http-server.js) may break on upgrade
- Migration plan: Review 11.2.0 changelog before upgrade; test with both localhost patterns and production URLs

**@fastify/static (8.3.0 → 9.0.0):**
- Risk: Major version bump; may change how static file routing works
- Impact: UI serving at `/` may break if route registration changes
- Migration plan: Test upgrade locally; verify `/` and `/graph` routes both serve correctly

**zod (3.25.76 → 4.3.6):**
- Risk: Major version bump; API changes expected
- Impact: Schema validation in `worker/findings-schema.js` may need rewrite
- Migration plan: Review Zod v4 migration guide; test all schema validation paths; ensure error messages are still user-friendly

**better-sqlite3 (12.8.0):**
- Risk: Native C++ binding; version mismatches between node versions can cause crashes
- Impact: Worker may fail to start if npm install runs on incompatible Node version
- Mitigation: Current: `"engines": { "node": ">=20.0.0" }` in package.json
- Recommendations: Pin better-sqlite3 to exact version in package-lock.json; document Node version requirements clearly

**chromadb (3.3.3) - Optional Dependency:**
- Risk: Python-based service; no version pinning; installation can fail silently
- Impact: If Chroma install fails, search tier 1 is unavailable but query continues (by design)
- Current mitigation: Fire-and-forget sync; graceful fallback to FTS5
- Recommendations: Document ChromaDB installation separately; provide easy on/off toggle in config

## Test Coverage Gaps

**Shell Script Integration:**
- Untested area: Lint and format hooks under edge cases (very large files, files with special characters, missing linters)
- Files: `scripts/lint.sh`, `scripts/format.sh`
- Risk: Silent failures if linter output exceeds buffer limits or contains binary characters
- Priority: Medium — affects user experience but fallback behavior is safe (exit 0)

**Worker Multi-Project Concurrent Requests:**
- Untested area: Two projects requesting the same DB hash simultaneously via `/impact` endpoint
- Files: `worker/http-server.js`, `worker/db-pool.js`
- Risk: Race condition in pool initialization; both threads may try to migrate simultaneously
- Priority: High — can cause 500 errors on scale

**Graph UI with Large Networks (200+ nodes):**
- Untested area: Rendering performance and interaction responsiveness with realistic 200+ node graphs
- Files: `worker/ui/graph.js`
- Risk: Canvas rendering may stutter; force simulation may timeout; browser may OOM
- Priority: Medium — affects usability but data integrity is safe

**Chroma Initialization Failure Cascade:**
- Untested area: ChromaDB network failure during startup; subsequent search queries should fallback gracefully
- Files: `worker/chroma-sync.js`, `worker/query-engine.js` (search function)
- Risk: If Chroma heartbeat fails at startup, subsequent queries might block or timeout
- Priority: Medium — affects search performance but not data persistence

**Config File Parsing with Invalid JSON:**
- Untested area: `allclear.config.json` exists but contains invalid JSON or malformed impact-map section
- Files: `scripts/session-start.sh` (line 54)
- Risk: jq will silently return empty string; session start continues but config is ignored
- Priority: Low — easy to debug; file can be validated with `jq .` before running

---

*Concerns audit: 2026-03-16*
