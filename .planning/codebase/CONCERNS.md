# Codebase Concerns

**Analysis Date:** 2026-03-20

## Tech Debt

**Missing log rotation:**
- Issue: No log file rotation mechanism in place. Worker logs accumulate indefinitely at `~/.ligamen/projects/<hash>/` without cleanup.
- Files: `worker/lib/logger.js`, `worker/index.js`
- Impact: Long-running workers can exhaust disk space over time; no archival strategy.
- Fix approach: Implement log rotation using `logrotate` configuration or a JavaScript log-rolling library that segments logs by size/date.

**Console.log in database script-mode guard:**
- Issue: `worker/db/database.js` (lines 322-337) contains console.log statements used as diagnostic output when running in script mode, not routed through structured logger.
- Files: `worker/db/database.js` (lines 322-337)
- Impact: Debugging output appears in stdout/stderr instead of structured logs; makes production troubleshooting harder.
- Fix approach: Replace console.log with conditional structured logger calls that respect log level configuration.

**getQueryEngineByHash inline migration workaround:**
- Issue: `worker/db/pool.js` (lines 169-188) contains inline migration execution as fallback when opening DBs by hash instead of project root. Safe only after all legacy DBs upgraded to schema v5.
- Files: `worker/db/pool.js#getQueryEngineByHash` (lines 169-188)
- Impact: Adds complexity and creates two migration paths (standard via openDb(), inline via getQueryEngineByHash). Will become obsolete once all DBs are upgraded.
- Fix approach: Remove inline migration block once confirmed all running DBs have been upgraded to schema v5 via standard openDb() path. Add migration 009+ that clears old databases.

**node_metadata table unused:**
- Issue: Migration 008 creates `node_metadata` table for extensible view data (future STRIDE/vulnerability views), but it is never written to or queried.
- Files: `worker/db/migrations/008_actors_metadata.js`
- Impact: Unused table occupies disk space; code path for populating it has not been designed yet.
- Fix approach: Document expected usage in migration file; implement writers when STRIDE/vuln view features are planned.

## Known Bugs

**query-engine-upsert.test.js pre-existing test schema gap:**
- Issue: Test manually runs migrations 001-007 but imports migration 008. Test does not import migration 008 execution, so schema used in test is incomplete.
- Files: `tests/storage/query-engine-upsert.test.js` (lines 53-66)
- Symptoms: Test runs against v7 schema but migration 008 (actors/metadata) is not applied.
- Trigger: When test expects node_metadata or actor_connections tables to exist.
- Workaround: Test currently passes because it doesn't query tables from migration 008; will fail once tests attempt to use those tables.

**impact-flow.bats imports stale module paths:**
- Issue: Integration test file imports from old module paths that don't match current structure (pre-existing from v3.0 restructure).
- Files: `tests/integration/impact-flow.bats` (lines 27-28)
  - Line 27: `import { QueryEngine } from '${PROJECT_ROOT}/worker/query-engine.js'` (should be `worker/db/query-engine.js`)
  - Line 28: `import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js'` (should be `worker/server/chroma.js`)
- Symptoms: Module not found errors when running integration tests.
- Trigger: Executing the test suite.
- Workaround: None; test is non-functional.

**package.json bin entry references non-existent ligamen-init.js:**
- Issue: `package.json` (line 15) defines bin entry `"ligamen-init": "./bin/ligamen-init.js"` but `bin/` directory and `ligamen-init.js` file do not exist.
- Files: `package.json` (line 15), missing `bin/ligamen-init.js`
- Impact: Installation attempts to link non-existent executable; npm/yarn installation may fail or create broken symlink.
- Fix approach: Either implement `bin/ligamen-init.js` as an initialization script or remove the bin entry from package.json if initialization is now handled differently.

## Security Considerations

**Unescaped HTML in search results tier routing:**
- Issue: `worker/db/query-engine.js` (lines 68, 100, 129) writes search tier debug info to stderr via `process.stderr.write()` without escaping, though these are log statements not rendered HTML. However, if stderr is captured and displayed in UI, could leak internal structure information.
- Files: `worker/db/query-engine.js` (lines 68, 100, 129, 141)
- Current mitigation: Tier info written to stderr, not exposed to UI; debug-only information.
- Recommendations: If ever captured in logs displayed to users, sanitize tier names and result counts. Currently acceptable.

**SQL injection via VACUUM INTO snapshot file path:**
- Issue: `worker/db/database.js` (line 290) uses string interpolation in `VACUUM INTO '${snapshotFile}'` without SQL escaping.
- Files: `worker/db/database.js` (line 290)
- Current mitigation: `snapshotFile` is generated internally via path.join() and crypto, never user-supplied.
- Recommendations: Convert to parameterized query if path ever becomes user-controlled. Currently safe but fragile.

**Git command injection in execSync:**
- Issue: `worker/scan/manager.js` (lines 145, 161) uses execSync with JSON.stringify() to quote projectRoot, but other git commands may be vulnerable to shell injection if repo names or paths are user-supplied.
- Files: `worker/scan/manager.js` (lines 145, 161)
- Current mitigation: execSync uses explicit encoding and stdio config; paths are from file system, not directly user input.
- Recommendations: Use `child_process.spawnSync()` with array args instead of execSync for shell-sensitive operations.

## Performance Bottlenecks

**MCP server complexity (700 lines):**
- Problem: `worker/mcp/server.js` is the largest worker module at 700 lines, combining route registration, tool handlers, and error handling for all impact tools.
- Files: `worker/mcp/server.js`
- Cause: Tool handlers (getImpact, getExposed, searchServices, etc.) are inlined; resolveDb routing per request; agent runner injection; schema validation.
- Improvement path: Extract tool handlers into separate modules by concern (impact-tools.js, search-tools.js, schema-tools.js); use factory pattern for route registration.

**Scan manager complexity (360+ lines):**
- Problem: `worker/scan/manager.js` handles agent invocation, repo type detection, file change tracking, and scan context building in single module.
- Files: `worker/scan/manager.js`
- Cause: Multiple concerns bundled: git operations, agent runner injection, logging injection, findings parsing.
- Improvement path: Extract detectRepoType() and getChangedFiles() into dedicated utilities; move agent invocation to separate service layer.

**FTS5 search fallback to LIKE on large datasets:**
- Problem: If ChromaDB is unavailable and FTS5 fails, search falls back to LIKE pattern matching across entire services table.
- Files: `worker/db/query-engine.js` (lines 118-143)
- Cause: Three-tier fallback chain; no indexes on LIKE fallback pattern.
- Improvement path: Add COLLATE NOCASE index on services.name if LIKE is expected to be hit frequently; consider pagination in tier 3.

**Render module handles layout + animation + interaction (350 lines):**
- Problem: `worker/ui/modules/renderer.js` combines canvas rendering, node positioning, edge drawing, and event handling in single module.
- Files: `worker/ui/modules/renderer.js`
- Cause: D3 Canvas requires tight coupling of layout, rendering, and updates.
- Improvement path: Extract node/edge rendering into separate painter objects; separate animation loop from render logic.

## Fragile Areas

**Detail panel library connections parameter mismatch:**
- Files: `worker/ui/modules/detail-panel.js` (line 73, 58)
- Why fragile: `renderLibraryConnections()` accepts three edge parameters (outgoing, incoming, nameById) but `outgoing` is never used in the function body — only `incoming` is used (line 108) to show "Used by" section.
- Safe modification: Before refactoring, verify that outgoing edges are intentionally excluded from library detail views; document why libraries show only incoming (consumers) not outgoing (dependencies).
- Test coverage: `tests/ui/graph-exposes.test.js` should test library detail rendering, but doesn't verify connection parameter usage.

**Database singleton pattern with module-level state:**
- Files: `worker/db/database.js` (lines 27-31), `worker/db/pool.js` (lines 20-21)
- Why fragile: Both modules use module-level singletons (_db in database.js, pool cache in pool.js). Top-level await in database.js for migrations creates initialization order dependency.
- Safe modification: Ensure openDb() is always called before any db operations; tests must import and run migrations explicitly. Multiple projects require separate pool entries by projectRoot key.
- Test coverage: `tests/storage/api-surface.test.js` and `tests/worker/logger.test.js` do not test concurrent project access patterns.

**Graph state management with shared mutable state:**
- Files: `worker/ui/modules/state.js`
- Why fragile: Graph data and filters are shared across all UI modules (detail-panel, interactions, filter-panel, layout). Mutations from one module affect others without explicit dependency tracking.
- Safe modification: Only modify state via explicit update functions; document state mutation order (filter before layout, layout before render). Tests should snapshot state before/after operations.
- Test coverage: No tests exist for state consistency across filter + layout + render sequences.

**ReadOnly database connections attempting WAL pragma:**
- Files: `worker/db/pool.js` (lines 95-110, 236-251)
- Why fragile: Comments warn against setting journal_mode on readonly connections (lines 96, 237), but the code is correct in skipping pragma. However, if future code adds WAL pragma before checking readonly flag, will silently fail.
- Safe modification: Create a helper function `safeOpenReadonly()` that explicitly skips all pragmas; document why readonly cannot use WAL.
- Test coverage: `tests/storage/query-engine-upsert.test.js` does not test readonly connection scenarios.

**ChromaDB availability check without timeout:**
- Files: `worker/server/chroma.js`
- Why fragile: `isChromaAvailable()` may hang if ChromaDB port is listening but not responding (e.g., startup race condition).
- Safe modification: Add timeout to connection check; cache availability result with TTL.
- Test coverage: `worker/server/chroma.test.js` mocks availability but doesn't test timeout scenarios.

## Scaling Limits

**SQLite WAL file growth without cleanup:**
- Current capacity: Database file + WAL journal grow unbounded per project.
- Limit: Once WAL file reaches gigabytes, queries slow down; background checkpoints may block writers.
- Scaling path: Implement periodic `PRAGMA optimize` and `VACUUM` commands; monitor WAL size; archive old map_versions snapshots to external storage.

**In-memory pool cache with no eviction:**
- Current capacity: `pool` Map in `worker/db/pool.js` (line 21) caches QueryEngine instances per projectRoot indefinitely.
- Limit: Worker process memory grows as number of projects increases; no LRU eviction.
- Scaling path: Implement LRU cache with configurable max size; add metrics for pool size; garbage collect unused projects after idle timeout.

**FTS5 virtual table index space:**
- Current capacity: FTS5 tables (services_fts, connections_fts, fields_fts) are unindexed beyond the virtual table structure.
- Limit: Search performance degrades with 10k+ services; no partial indexing or sharding.
- Scaling path: Archive old scan versions; partition FTS5 by repo; implement search result pagination.

**Map version snapshots unlimited retention:**
- Current capacity: `map_versions` table stores unlimited VACUUM snapshots; configured history limit (default 10) but not enforced.
- Limit: Disk usage grows; snapshot cleanup is not implemented.
- Scaling path: Implement cleanup job that deletes old snapshots; enforce history limit in `saveSnapshot()` function.

## Dependencies at Risk

**better-sqlite3 native module rebuild on Node version change:**
- Risk: `better-sqlite3@12.8.0` is a native module; requires rebuild when Node.js version changes.
- Impact: Worker may fail to start if node_modules are not cleaned/rebuilt on version mismatch.
- Current mitigation: `worker/index.js` checks version and warns, but doesn't force rebuild.
- Migration plan: Document Node.js version requirements (currently ^20.0.0); add `npm rebuild` to version-change fallback handler.

**ChromaDB optional dependency not installed by default:**
- Risk: `@chroma-core/default-embed` is optional; if not installed, ChromaDB embeddings will fail silently and fall back to FTS5.
- Impact: Users may not realize semantic search is unavailable; no error logging indicates why.
- Current mitigation: `isChromaAvailable()` gracefully skips ChromaDB if import fails.
- Migration plan: Document ChromaDB setup as optional; add explicit warning logs when falling back from ChromaDB to FTS5 (currently only debug logs).

**Zod schema validation dependency (v3.25.0):**
- Risk: No pinned range; Zod 4.x may introduce breaking changes to validation logic.
- Impact: Auto-upgrade could break scan result validation if schema definition changes.
- Current mitigation: package-lock.json locks version.
- Migration plan: Consider pinning to `^3.25.0` (current major version) and test 4.x upgrade separately.

## Test Coverage Gaps

**Integration test suite non-functional:**
- What's not tested: E2E scan flow from start to finish (`tests/integration/impact-flow.bats`)
- Files: `tests/integration/impact-flow.bats` (stale import paths prevent execution)
- Risk: Full scan-to-query pipeline is never validated; regressions in multi-project scenarios go undetected.
- Priority: High

**Readonly database connection scenarios:**
- What's not tested: listProjects() using readonly connections; search fallback when readonly DB cannot apply pragma
- Files: `worker/db/pool.js#listProjects()` (lines 95-110)
- Risk: Readonly code path is untested; failures are silent (caught and ignored in exception handler)
- Priority: Medium

**Concurrent project access and pool cache behavior:**
- What's not tested: Multiple QueryEngines accessed concurrently for different projects; cache coherency
- Files: `worker/db/pool.js` (cache operations)
- Risk: Race conditions in pool.set() / pool.get() if MCP server receives concurrent requests
- Priority: Medium

**Filter panel + layout + render state consistency:**
- What's not tested: State mutations across all three modules when filters change; verify nodes stay in correct rows/positions
- Files: `worker/ui/modules/filter-panel.js`, `layout.js`, `renderer.js`, `state.js`
- Risk: UI rendering bugs under specific filter/sort sequences
- Priority: Low (UI logic is less critical than data correctness)

**Graph edge case: isolated nodes + external actors:**
- What's not tested: Rendering when graph contains only external actors and no services; mixed actor/service boundaries
- Files: `worker/ui/modules/renderer.js`, `layout.js`
- Risk: Layout algorithm may divide by zero or create invalid node positions
- Priority: Medium

---

*Concerns audit: 2026-03-20*
