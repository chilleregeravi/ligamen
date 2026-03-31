# Codebase Concerns

**Analysis Date:** 2026-03-31

## Tech Debt

**MCP Server Monolith (1533 lines):**
- Issue: `plugins/ligamen/worker/mcp/server.js` is a single 1533-line file containing MCP tool definitions, all drift query logic (versions, types, OpenAPI), graph traversal, search, and scan triggering. This violates the separation already applied to `query-engine.js` (which is its own module).
- Files: `plugins/ligamen/worker/mcp/server.js`
- Impact: Difficult to test drift logic independently. Any change to one tool definition risks breaking others. The file re-implements query patterns (graph CTE traversal) that already exist in `QueryEngine`.
- Fix approach: Extract drift query functions (`queryDriftVersions`, `queryDriftTypes`, `queryDriftOpenapi`) into a `worker/mcp/drift.js` module. Extract `queryImpact`, `queryChanged`, `queryGraph`, `querySearch` into `worker/mcp/queries.js`. Keep `server.js` as thin MCP tool registration only.

**Duplicated Graph Traversal Logic:**
- Issue: Recursive CTE graph traversal is implemented twice: once in `QueryEngine` class (`_stmtDownstream`, `_stmtUpstream` in `plugins/ligamen/worker/db/query-engine.js` lines 247-296) and again in `queryImpact()` and `queryGraph()` within `plugins/ligamen/worker/mcp/server.js` (lines 122-432). The two implementations have slightly different column selection, timeout handling, and cycle detection.
- Files: `plugins/ligamen/worker/db/query-engine.js`, `plugins/ligamen/worker/mcp/server.js`
- Impact: Bug fixes or performance improvements must be applied in two places. The MCP server version has a 30-second timeout guard; the QueryEngine version does not.
- Fix approach: Use `QueryEngine.transitiveImpact()` and `QueryEngine.directImpact()` from the MCP server tools, adding timeout support to QueryEngine if needed.

**Deprecated `openDb()` in MCP Server:**
- Issue: `openDb()` in `plugins/ligamen/worker/mcp/server.js` (line 56) is marked `@deprecated` but is still exported for backward compatibility with tests.
- Files: `plugins/ligamen/worker/mcp/server.js`
- Impact: Tests relying on this function may silently use stale behavior.
- Fix approach: Migrate all tests to use `resolveDb()`, then remove `openDb()`.

**Module-level Mutable State for Dependency Injection:**
- Issue: Several modules use module-level mutable variables for dependency injection: `_logger` in `plugins/ligamen/worker/scan/manager.js`, `agentRunner` in the same file, `_searchDb` in `plugins/ligamen/worker/db/query-engine.js`, `_logger` in `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js`, `_chromaAvailable` and `_collection` in `plugins/ligamen/worker/server/chroma.js`. While functional, this creates hidden coupling and ordering requirements.
- Files: `plugins/ligamen/worker/scan/manager.js`, `plugins/ligamen/worker/db/query-engine.js`, `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js`, `plugins/ligamen/worker/server/chroma.js`
- Impact: Test isolation requires calling reset functions (`_resetForTest`, `setScanLogger(null)`, `setSearchDb(null)`) manually. Forgetting to reset causes test-to-test leakage.
- Fix approach: Consider a context/container pattern where scan operations receive their dependencies explicitly rather than via module-level setters.

**Singleton DB Handle in `database.js`:**
- Issue: `plugins/ligamen/worker/db/database.js` uses a module-level `_db` singleton (line 28) that is set on first `openDb()` call and never changed. This conflicts with the pool pattern in `plugins/ligamen/worker/db/pool.js` which opens multiple DBs.
- Files: `plugins/ligamen/worker/db/database.js`, `plugins/ligamen/worker/db/pool.js`
- Impact: The singleton in `database.js` can only serve one project at a time. The pool works around this by calling `openDb(projectRoot)` which returns the cached singleton if already initialized, preventing subsequent projects from opening their own DB through this path.
- Fix approach: Remove the singleton from `database.js`. Make `openDb()` always return a new handle (or deprecate it in favor of pool-only access).

## Known Bugs

**Scan Lock TOCTOU Race Condition:**
- Symptoms: Two concurrent scans could both pass the `existsSync(lockPath)` check before either writes the lock file.
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 486-513, `acquireScanLock`)
- Trigger: Two MCP tool invocations trigger `scanRepos()` at the same moment for the same project.
- Workaround: The filesystem lock approach mitigates most concurrent scans but is not atomic. The `writeFileSync` call (line 506) does not use `O_EXCL` flag for atomic creation.
- Fix: Use `fs.openSync(lockPath, 'wx')` (exclusive create) which fails atomically if the file already exists, eliminating the TOCTOU window.

**Incomplete Scan Bracket on Agent Failure:**
- Symptoms: When `agentRunner` throws after `beginScan()` is called, `endScan()` is never called. The `scan_versions` row has a NULL `completed_at`, and stale services/connections from the previous scan are never cleaned up by this bracket.
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 625-666)
- Trigger: Agent (Claude) throws an error during the deep scan phase (after discovery pass succeeds).
- Workaround: The prior scan data is preserved (by design), but the incomplete bracket accumulates in `scan_versions`.

## Security Considerations

**Command Injection via `commit_range` Parameter:**
- Risk: `queryChanged()` in `plugins/ligamen/worker/mcp/server.js` (line 231) passes the `commit_range` parameter directly into a shell command via template literal interpolation in a call to the child_process module. A malicious MCP client could inject shell commands.
- Files: `plugins/ligamen/worker/mcp/server.js` (line 231)
- Current mitigation: The MCP server runs locally and the `commit_range` parameter comes from Claude (trusted context). Zod schema validates it as a string but does not restrict format.
- Recommendations: Use the array-form of child process execution (e.g., `execFileSync('git', ['diff', '--name-only', commit_range])`) instead of template literal shell interpolation. This prevents shell metacharacter injection. Apply the same fix to `oasdiff` calls on lines 1036 and 1066 where `specA` and `specB` file paths are interpolated into shell commands.

**SQL Injection via VACUUM INTO Path:**
- Risk: `createSnapshot()` in `plugins/ligamen/worker/db/database.js` (line 290) constructs a VACUUM INTO statement with string interpolation for the snapshot path. If the path contains a single quote, the SQL breaks. The query-engine version (line 1280) at least escapes single quotes.
- Files: `plugins/ligamen/worker/db/database.js` (line 290), `plugins/ligamen/worker/db/query-engine.js` (line 1280)
- Current mitigation: `snapshotFile` is derived from `new Date().toISOString()` which never contains single quotes.
- Recommendations: Apply the same `replace(/'/g, "''")` escaping used in `query-engine.js` to `database.js`.

**Dynamic SQL IN Clauses (Safe Pattern):**
- Risk: `queryGraph()` in `plugins/ligamen/worker/mcp/server.js` (lines 360-363, 409-412) constructs IN clauses with dynamically generated placeholder counts and passes values as parameters. This is safe.
- Files: `plugins/ligamen/worker/mcp/server.js`
- Current mitigation: The pattern uses parameterized placeholders (`?`) -- no actual values are interpolated into SQL. The `reachableIds` come from a prior CTE query result (integer IDs).
- Recommendations: No change needed, but document this pattern as intentionally safe to prevent future "fix" attempts.

**HTTP Server Binds to localhost Only:**
- Risk: Low. The HTTP server in `plugins/ligamen/worker/server/http.js` (line 272) binds to `127.0.0.1` only.
- Files: `plugins/ligamen/worker/server/http.js`
- Current mitigation: Binding to localhost prevents remote access. CORS is restricted to `localhost:5173` and `127.0.0.1:*`.
- Recommendations: No authentication is required for the REST API. If the server is ever exposed beyond localhost (e.g., via tunneling), add bearer token auth to the `/scan` POST endpoint.

**POST /scan Has No Authentication:**
- Risk: Any local process can POST to `/scan` and overwrite scan data for any project.
- Files: `plugins/ligamen/worker/server/http.js` (lines 168-205)
- Current mitigation: Server binds to localhost only.
- Recommendations: Add a shared secret or PID-based validation if multi-user environments are supported.

## Performance Bottlenecks

**Synchronous File I/O in Logger:**
- Problem: `plugins/ligamen/worker/lib/logger.js` uses `fs.appendFileSync` (line 64) and `fs.statSync` (line 16) on every log call. During a scan that produces many log lines, this serializes all I/O.
- Files: `plugins/ligamen/worker/lib/logger.js`
- Cause: Synchronous file operations block the event loop. The `rotateIfNeeded()` function calls `fs.statSync` before every write.
- Improvement path: Buffer log lines and flush periodically (e.g., every 100ms or 50 lines). Cache the file size instead of calling `statSync` on every write.

**Full Log File Read on /api/logs:**
- Problem: The `/api/logs` endpoint in `plugins/ligamen/worker/server/http.js` (lines 222-266) reads the entire log file with `fs.readFileSync`, splits all lines, then takes the last 500. For a 10MB log file this reads and parses the full content on each poll.
- Files: `plugins/ligamen/worker/server/http.js` (lines 222-266)
- Cause: No seek/tail optimization. The UI polls this endpoint.
- Improvement path: Use `fs.open` + `fs.read` to seek to the last ~50KB of the file instead of reading the whole thing. Alternatively, maintain an in-memory ring buffer of recent log entries.

**Drift Analysis Reads Source Files Synchronously:**
- Problem: `queryDriftTypes()` in `plugins/ligamen/worker/mcp/server.js` calls `collectFiles()` and `extractTypeNames()` which recursively read all source files (up to depth 4) synchronously for every drift query. For a monorepo with thousands of source files, this blocks the event loop.
- Files: `plugins/ligamen/worker/mcp/server.js` (functions `collectFiles`, `extractTypeNames`, `extractTypeBody`)
- Cause: Synchronous file reads in tight loops with no caching.
- Improvement path: Cache extracted type names per repo + commit hash. Invalidate on scan. The 50-name cap per repo helps, but file traversal is still unbounded.

**DB Pool Never Evicts:**
- Problem: The connection pool in `plugins/ligamen/worker/db/pool.js` caches `QueryEngine` instances forever (line 22, `const pool = new Map()`). There is no eviction policy, max size limit, or idle timeout.
- Files: `plugins/ligamen/worker/db/pool.js`
- Cause: No LRU or TTL eviction implemented.
- Improvement path: Add max pool size (e.g., 20) with LRU eviction. Close evicted DB handles with `db.close()`.

## Fragile Areas

**QueryEngine Constructor with Try/Catch Statement Preparation:**
- Files: `plugins/ligamen/worker/db/query-engine.js` (lines 366-487)
- Why fragile: The constructor uses nested try/catch blocks to prepare statements with different column sets depending on which migrations have run. This means `_stmtUpsertConnection` could be any of three different prepared statements, and `_stmtUpsertActor` / `_stmtUpsertActorConnection` / `_stmtGetActorByName` / `_stmtCheckKnownService` could all be null.
- Safe modification: Always check for null before using actor-related statements. When adding new columns to connections, add another fallback level to the try/catch chain. Add a method like `supportsActors()` and `supportsConfidence()` to make capability checks explicit.
- Test coverage: Good -- migration tests (`migration-004.test.js`, `migration-008.test.js`) verify both pre- and post-migration schemas.

**Agent Output Parsing with 3-Strategy Fallback:**
- Files: `plugins/ligamen/worker/scan/findings.js` (lines 284-326, `parseAgentOutput`)
- Why fragile: The function tries 3 different strategies to extract JSON from raw agent output: fenced code block, raw JSON.parse, and brace-matching substring. Strategy 3 (brace-matching) can match nested objects incorrectly if the agent output contains multiple JSON blocks or prose with curly braces.
- Safe modification: Always test with outputs that contain multiple JSON blocks, prose with braces, and malformed JSON.
- Test coverage: Good -- `findings.test.js` (540 lines) covers all three strategies.

**Scan Lock Path Computation:**
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 447, 483-484)
- Why fragile: `LOCK_DIR` is computed at module load time from `process.env.LIGAMEN_DATA_DIR` (line 447), but `acquireScanLock` re-reads the env var (line 483). If the env var changes between module load and function call, the lock directory is inconsistent.
- Safe modification: Use `LOCK_DIR` consistently instead of re-reading the env var in `acquireScanLock`.
- Test coverage: Lock tests exist in `manager.test.js`.

## Scaling Limits

**SQLite Single-Writer Constraint:**
- Current capacity: One write connection per DB file. The `busy_timeout = 5000` pragma allows reads to wait up to 5 seconds for the writer to finish.
- Limit: If multiple scan operations target the same project DB concurrently (bypassing the file lock), `SQLITE_BUSY` errors will occur after 5 seconds.
- Scaling path: The file-based scan lock (SEC-03) prevents concurrent writes. For higher throughput, consider write-ahead log checkpointing tuning or connection pooling with write serialization.

**Promise.allSettled Fan-out for Multi-Repo Scans:**
- Current capacity: All repos are scanned in parallel via `Promise.allSettled` (line 712 of `plugins/ligamen/worker/scan/manager.js`). Each scan invokes the agent runner, which calls Claude.
- Limit: For a project with 20+ repos, this creates 20+ concurrent agent invocations. Each discovery pass + deep scan pass means 40+ agent calls in flight.
- Scaling path: Add a concurrency limiter (e.g., `p-limit` or manual semaphore) to cap parallel agent invocations at 3-5.

**StmtCache Capacity:**
- Current capacity: 50 prepared statements (line 92 of `plugins/ligamen/worker/db/query-engine.js`).
- Limit: If more than 50 unique SQL queries are issued, the oldest statements are evicted and must be re-prepared. This is unlikely to be a bottleneck since most queries are repeated.
- Scaling path: Increase capacity if profiling shows frequent evictions.

## Dependencies at Risk

**ChromaDB (`chromadb` v3.3.3):**
- Risk: Optional dependency for semantic search. The chromadb npm package is relatively young and its API has changed between v2 and v3 (the code handles v3 response shapes specifically). If ChromaDB server is not running, the system gracefully falls back to FTS5/SQL.
- Impact: Semantic search quality degrades to keyword matching when ChromaDB is unavailable. No data loss risk.
- Migration plan: The 3-tier search fallback (Chroma -> FTS5 -> SQL LIKE) already handles unavailability. No migration needed unless the chromadb package makes breaking changes.

**`@chroma-core/default-embed` (optional dependency):**
- Risk: Listed as an optional dependency. If not installed, ChromaDB embedding may not work.
- Impact: Semantic search unavailable without embeddings. FTS5 fallback activates.
- Migration plan: Already handled by the optional dependency declaration.

**`better-sqlite3` v12.8.0:**
- Risk: Native addon requiring C++ compilation. Breaks on Node.js major version upgrades or when the prebuilt binary is not available for the platform.
- Impact: Complete failure if the native addon cannot load. No SQLite = no data storage.
- Migration plan: Pin to known-good version. Test on target platforms before Node.js major upgrades.

## Missing Critical Features

**No DB Connection Cleanup on Shutdown:**
- Problem: The graceful shutdown handler in `plugins/ligamen/worker/index.js` (lines 88-104) closes the Fastify server and removes PID/port files, but does not close any SQLite database connections in the pool.
- Blocks: Potential for WAL file corruption if the process is killed mid-write.
- Files: `plugins/ligamen/worker/index.js`, `plugins/ligamen/worker/db/pool.js`

**No Health Check for DB Pool:**
- Problem: The DB pool (`plugins/ligamen/worker/db/pool.js`) has no health check mechanism. If a DB file becomes corrupted or locked by an external process, the cached QueryEngine will continue to fail silently.
- Blocks: Stale or broken DB connections are never recovered without restarting the worker.

**No Rate Limiting on HTTP Endpoints:**
- Problem: The HTTP server in `plugins/ligamen/worker/server/http.js` has no rate limiting. A runaway UI poll loop or malicious local process could overwhelm the worker.
- Blocks: Worker stability under load.

## Test Coverage Gaps

**No Tests for UI Modules:**
- What's not tested: `plugins/ligamen/worker/ui/modules/export.js`, `plugins/ligamen/worker/ui/modules/filter-panel.js`, `plugins/ligamen/worker/ui/modules/keyboard.js`, `plugins/ligamen/worker/ui/modules/log-terminal.js`, `plugins/ligamen/worker/ui/modules/project-picker.js`, `plugins/ligamen/worker/ui/modules/project-switcher.js`
- Files: All files listed above
- Risk: UI regression on any change to filter, keyboard, or export logic.
- Priority: Low (UI is browser-rendered, not mission-critical path)

**No Tests for `worker/index.js` Startup Flow:**
- What's not tested: CLI arg parsing, settings.json loading, PID file writing, graceful shutdown handler, ChromaDB initialization
- Files: `plugins/ligamen/worker/index.js`
- Risk: Startup failures or shutdown corruption go undetected.
- Priority: Medium

**No Tests for `worker/db/pool.js` (beyond pool-repo):**
- What's not tested: `getQueryEngineByHash()` with invalid hashes, pool eviction (none exists), `listProjects()` with corrupted DBs
- Files: `plugins/ligamen/worker/db/pool.js`
- Risk: Pool leaks or corrupted DB handles in long-running worker.
- Priority: Medium

**No Tests for `worker/ui/graph.js` and `worker/ui/force-worker.js`:**
- What's not tested: Force-directed graph layout, D3 force simulation
- Files: `plugins/ligamen/worker/ui/graph.js` (286 lines), `plugins/ligamen/worker/ui/force-worker.js`
- Risk: Graph visualization breaks silently.
- Priority: Low

---

*Concerns audit: 2026-03-31*
