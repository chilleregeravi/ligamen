# Codebase Concerns

**Analysis Date:** 2026-03-23

## SQL Injection Risk (High Priority)

**VACUUM INTO with String Interpolation:**
- Issue: `VACUUM INTO '${snapshotFile}'` uses string interpolation to construct SQL
- Files: `plugins/ligamen/worker/db/database.js:290`
- Impact: If `snapshotFile` contains quotes, path traversal, or special characters, SQL injection is possible
- Fix approach: Use parameterized path handling or validate `snapshotFile` strictly before interpolation. The snapshot filename is derived from timestamp and controlled internally, but defensive parsing recommended

**Timestamp-based File Naming Lacks Uniqueness Guard:**
- Issue: Snapshot filenames use `toISOString().replace(/[:.]/g, "-")` which can produce duplicates on sub-second re-execution
- Files: `plugins/ligamen/worker/db/database.js:281-285`
- Impact: Two snapshots created within the same second will have identical filenames, causing the second to overwrite the first silently
- Fix approach: Add millisecond precision separator or use UUID suffix; add collision detection before VACUUM INTO

## Type Safety & Assertions

**Loose Type Annotations (any types):**
- Issue: ChromaDB collection handle typed as `@type {any | null}` without proper interface definition
- Files: `plugins/ligamen/worker/server/chroma.js` (ChromaDB collection)
- Impact: Loss of IDE autocomplete and type checking for ChromaDB operations; harder to catch API changes
- Fix approach: Define explicit ChromaDB collection interface from upstream SDK or use `unknown` with explicit type narrowing

**Unvalidated Empty Catch Blocks (49 instances):**
- Issue: 49 try-catch blocks across the codebase use `catch { /* ignore */ }` or `catch (_) { }` without logging or error tracking
- Files: `plugins/ligamen/worker/scan/manager.js`, `plugins/ligamen/worker/db/database.js`, `plugins/ligamen/worker/db/query-engine.js`, and others
- Impact: Silent failures make debugging difficult; legitimate errors are hidden; security issues (e.g., file permission denials) go unnoticed
- Fix approach: Replace empty catches with selective error handling — either log at WARN level or explicitly document why silence is safe (e.g., "optional config file absent")

**NodeId Type Coercion Issue:**
- Issue: `if (!nodeId && nodeId !== 0) return;` in detail-panel click handler relies on JavaScript truthiness to detect 0
- Files: `plugins/ligamen/worker/ui/modules/detail-panel.js:37`
- Impact: If `nodeId` is `undefined` or `null`, the check works, but the pattern is fragile for TypeScript adoption
- Fix approach: Use explicit comparison: `if (nodeId == null || isNaN(nodeId))`

## Performance Bottlenecks

**LRU Prepared Statement Cache Underutilized:**
- Issue: StmtCache defined with capacity=50 but only 12 unique SQL queries appear in production code
- Files: `plugins/ligamen/worker/db/query-engine.js:42-92`
- Impact: Minimal performance gain from caching; overhead of LRU management with minimal statements queued
- Fix approach: Profile actual query patterns; consider increasing capacity if queries exceed 50 or shrinking to 20 with documented rationale

**Sequential DB Writes After Parallel Scan:**
- Issue: Phase A runs parallel agent invocations (Promise.allSettled), but Phase B performs sequential DB writes and enrichment
- Files: `plugins/ligamen/worker/scan/manager.js:728-765`
- Impact: With 10+ repos, Phase B serializes on a single SQLite handle (better-sqlite3 blocks on SQLITE_BUSY); wall-clock time dominated by sequential writes
- Fix approach: Consider write batching or async enrichment queue; document the SQLite concurrency constraint explicitly in code comments

**File Traversal Without Size Safeguards (Auth/DB Extractor):**
- Issue: `MAX_FILE_SIZE = 1_048_576` (1MB) cap exists, but directory traversal with `MAX_TRAVERSAL_DEPTH = 8` can still scan thousands of files
- Files: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js:26-27`
- Impact: On large repos (e.g., monorepos with 50k files), extractor can consume significant CPU/memory during traversal
- Fix approach: Add file count limit per service; add timeout guard; profile on real monorepos before scaling

## Error Handling Gaps

**Chroma Sync Fire-and-Forget without Metrics:**
- Issue: `syncFindings().catch()` writes to stderr only; no structured logging, no retry, no metrics
- Files: `plugins/ligamen/worker/db/database.js:246-248` and `plugins/ligamen/worker/server/chroma.js:175-177`
- Impact: ChromaDB sync failures are invisible to monitoring; users never know if semantic search is stale
- Fix approach: Log sync failures to structured logger with `level: WARN`; emit metrics (counter/histogram) for sync latency and error rate

**Retry Logic Hardcoded to Once:**
- Issue: Agent runner retries on throw exactly once, then gives up (lines 655-668 in manager.js)
- Files: `plugins/ligamen/worker/scan/manager.js:655-668`
- Impact: Transient network blips cause scan abort; no exponential backoff or jitter; scan lock remains open leaving stale lock files on failure
- Fix approach: Implement configurable retry policy (exponential backoff, max retries); ensure scan lock is released even on final failure

**Graph Loading Silent Failure:**
- Issue: `loadProject()` catches fetch errors but only sets a message to "Cannot reach server" with no logging
- Files: `plugins/ligamen/worker/ui/graph.js:40-45`
- Impact: Users see generic message; no visibility into whether it's network, CORS, or server error
- Fix approach: Parse fetch error details; emit console.error with full error stack; consider retry UI for transient failures

## Fragile Areas

**Scan Bracket State Machine:**
- Issue: `beginScan()` opens bracket, but if agent fails after retry, bracket is never closed (by design: "prior data preserved")
- Files: `plugins/ligamen/worker/scan/manager.js:660-666`
- Impact: Stale open bracket can accumulate if scan is aborted; no TTL on open brackets; manual cleanup required
- Fix approach: Add metadata to scan_versions (started_at, is_open) and auto-close brackets older than 24h via maintenance job

**CODEOWNERS Regex Matching Complexity:**
- Issue: CODEOWNERS patterns support wildcards and double-asterisks, but extractor must convert Git patterns to regex
- Files: `plugins/ligamen/worker/scan/codeowners.js:119-124` (SBUG-03 documented)
- Impact: Edge cases in pattern matching (e.g., escaped spaces, negations) may fail silently; ownership not extracted when patterns are non-standard
- Fix approach: Add comprehensive test suite for CODEOWNERS pattern conversion; consider using a dedicated CODEOWNERS parser library

**Actor Dedup Logic Relies on Exact Name Match:**
- Issue: Graph UI dedup filter removes actor node if `actor.name === service.name` (case-sensitive exact match)
- Files: `plugins/ligamen/worker/ui/modules/renderer.js:70-80` (defense-in-depth per Phase 78)
- Impact: If service name is "stripe" and actor is "Stripe", they won't deduplicate; typos cause false actor nodes
- Fix approach: Use case-insensitive comparison + semantic similarity threshold; document this as defensive layer, not primary dedup

## Test Coverage Gaps

**UI Canvas Rendering Not Tested:**
- Issue: `renderer.js` (463 lines) has no unit tests for canvas drawing logic, node positioning, or edge bundling
- Files: `plugins/ligamen/worker/ui/modules/renderer.js`
- Risk: Canvas rendering bugs (malformed edges, clipped labels, layout issues) discovered only in manual testing
- Priority: Medium — visual bugs don't affect correctness, but impact UX
- Fix approach: Add browser-based tests using canvas mock or headless Playwright tests

**MCP Server Auth/ACL Not Tested:**
- Issue: `resolveDb()` performs security check `if (!normalized.startsWith(baseDir + path.sep))` but no unit test covers path traversal attempts
- Files: `plugins/ligamen/worker/mcp/server.js:82-88`
- Risk: Path traversal bug could escape ~/.ligamen/projects and access arbitrary DBs
- Priority: High — security-critical
- Fix approach: Add unit tests with crafted malicious paths (e.g., `../../../`, `..%2f..%2f`, symlinks)

**Concurrent Scan Lock Race Condition Not Tested:**
- Issue: Lock file cleanup in `acquireScanLock()` checks `isProcessRunning(pid)` but doesn't handle PID reuse on Linux
- Files: `plugins/ligamen/worker/scan/manager.js:486-503`
- Risk: After 32-bit PID wraps, a stale lock with an old PID might be deleted, allowing concurrent scans
- Priority: Low on modern Linux (PIDs rarely wrap in practice), but possible on embedded systems
- Fix approach: Use OS-specific locking primitives (fcntl on Unix, LockFileEx on Windows) instead of pid-based locks

**Discovery Agent Fallback Empty Context Not Tested:**
- Issue: `runDiscoveryPass()` returns `{}` on failure, and deep scan proceeds with empty context
- Files: `plugins/ligamen/worker/scan/manager.js:413-426`
- Risk: Discovery failures are silent; no test verifies that scans succeed with empty discovery context
- Priority: Medium — affects reliability but not correctness
- Fix approach: Add test for discovery failure; verify deep scan produces findings with fallback

## Scaling Limits

**Shannon Entropy Calculation O(n log n) in Loop:**
- Issue: `shannonEntropy()` called per extracted string; entropy recalculation not memoized
- Files: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js:63-74`
- Impact: On a service with 1000 extracted values, entropy computed 1000 times; each computation is O(charset), so ~O(1000 * charset)
- Limit: Acceptable for current scale, but problematic if values scale to 10k+
- Scaling path: Cache entropy results in a Set; consider probabilistic sampling for very large services

**Graph Node/Edge Count No Upper Bound:**
- Issue: `renderServiceMeta()` and detail panel render without pagination or lazy loading
- Files: `plugins/ligamen/worker/ui/modules/detail-panel.js:48-71`
- Impact: Rendering 1000-node graph with 10k connections can freeze the browser tab
- Limit: Known issue for large enterprises (100+ services); UI becomes unusable
- Scaling path: Implement virtual scrolling for connection lists; add pagination to schema field tables; implement server-side filtering

**ChromaDB Embedding Sync Blocks on Large Findings:**
- Issue: `syncFindings()` uploads entire findings set to ChromaDB; no batching or streaming
- Files: `plugins/ligamen/worker/server/chroma.js:120-185`
- Impact: Syncing 5000+ services in a single call can timeout or consume all available memory
- Limit: Scale tested up to ~1000 services; unclear beyond that
- Scaling path: Batch service uploads (100 at a time); add progress callback; consider streaming API

## Missing Critical Features

**No Scan Incremental Resume:**
- Problem: If scan crashes mid-way, no mechanism to resume from failure point — user must restart full scan
- Blocks: Scanning 100+ repos with individual failures becomes painful
- Priority: Medium for large codebases

**No Version Conflict Detection:**
- Problem: If two scans of same repo produce conflicting connection sets, no alert or merge strategy
- Blocks: Concurrent scans (even with lock) can produce divergent results if agents have different outputs
- Priority: Low — lock prevents concurrency, but design weakness noted

## Dependencies at Risk

**better-sqlite3 Platform-Specific:**
- Risk: `better-sqlite3` is a native module; npm install requires build tools (python, C++ compiler)
- Impact: `npm install` fails on environments without build tools (Docker scratch images, Alpine, Windows without VS Build Tools)
- Migration plan: Add pre-built binaries via `better-sqlite3-prebuilt` or switch to `sql.js` for pure JS (at performance cost)

**chromadb Optional with Silent Failure:**
- Risk: ChromaDB listed as optional dependency; if not installed, `import { ChromaClient }` throws at runtime
- Impact: Feature silently disabled, but users may expect semantic search to work
- Fix approach: Explicitly catch import error; provide clear startup message when ChromaDB unavailable

**Zod Version Mismatch Risk:**
- Risk: Package requires `zod ^3.25.0` but v4 exists with breaking changes
- Impact: If user installs globally with conflicting Zod version, agent prompts may fail validation
- Fix approach: Pin to exact version (e.g., `3.25.0`) or test against v4 explicitly

## Security Considerations

**Auth/DB Extractor Regex Entropy Check Bypassable:**
- Risk: `ENTROPY_REJECT_THRESHOLD = 4.0` blocks high-entropy strings, but attacker can craft strings with carefully controlled entropy (e.g., repeating chars)
- Files: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js:76`
- Current mitigation: Additional `CREDENTIAL_REJECT` patterns catch common secret formats (JWT, Bearer tokens, connection strings)
- Recommendations: Add length limits (reject if > 40 chars AND entropy > 3.5); add fuzzy signature detection for known secret formats (AWS keys, GitHub tokens, etc.)

**No Rate Limiting on MCP Search:**
- Risk: `/ligamen:search` can be called without throttling; large repos with 10k+ services could cause CPU spike
- Files: `plugins/ligamen/worker/mcp/server.js` (search tool handler)
- Current mitigation: FTS5 is fast, but no upper bound on result set size
- Recommendations: Add max_results parameter (default 100); add timeout guard (30s); log slow queries

**Snapshot File Permissions Not Explicitly Set:**
- Risk: `createSnapshot()` creates VACUUM INTO files with default umask; if umask is world-readable, DB copies are world-readable
- Files: `plugins/ligamen/worker/db/database.js:290`
- Current mitigation: None — relies on system umask
- Recommendations: Explicitly chmod snapshot files to 0600 after creation; document in config

---

*Concerns audit: 2026-03-23*
