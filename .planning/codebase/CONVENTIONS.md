# Coding Conventions

**Analysis Date:** 2026-03-23

## Naming Patterns

**Files:**
- All lowercase with hyphens for multi-word names: `query-engine.js`, `auth-db-extractor.js`
- Test files use `.test.js` suffix (not `.spec.js`): `manager.test.js`, `http.test.js`
- Shell scripts use `.sh` extension: `config.sh`, `detect.sh`

**Functions:**
- camelCase for all functions: `createHttpServer`, `getChangedFiles`, `buildScanContext`, `sanitizeBindings`
- Private/internal functions prefix with underscore: `_hasServiceEntryPoint`, `_sortServicesForBoundaries`, `_onConnTargetClick`
- Higher-order functions (factories, setup) use verb-noun pattern: `createHttpServer`, `makeServer`, `createLogger`

**Variables:**
- camelCase for all variables: `queryEngine`, `repoPath`, `graphData`, `activeProtocols`
- Constants in camelCase (not UPPER_CASE): `NODE_RADIUS`, `LABEL_MAX_CHARS`, `COLORS`, `PROTOCOL_COLORS`
- State object properties use camelCase: `graphData`, `selectedNodeId`, `blastNodeId`, `isDragging`
- Temporary/loop variables: standard short names (`i`, `col`, `row`, `dir`, `file`)

**Types:**
- JSDoc typedef declarations for complex types: `@typedef {{ name: string, root_path: string, ... }} Service`
- Type references in JSDoc: `@type {Object}`, `@type {number|null}`, `@type {Set<number>}`

**Database/Schema:**
- snake_case for SQL column names: `source_service_id`, `target_service_id`, `root_path`, `auth_mechanism`
- camelCase for JavaScript object properties mapping from DB: `sourceName`, `targetName`, `confidence`

## Code Style

**Formatting:**
- No explicit formatter configured (no .eslintrc, .prettierrc found)
- Consistent 2-space indentation observed throughout
- Lines generally under 100 characters (observed in http.js, layout.js, detail-panel.js)
- No semicolons policy observed in many files

**Linting:**
- No ESLint or Prettier config files detected
- Code follows implicit conventions only (consistency via team practice)

## Import Organization

**Order:**
1. Node.js builtins: `import { test } from "node:test"`, `import fs from "node:fs"`
2. Third-party packages: `import Database from "better-sqlite3"`, `import { z } from "zod"`
3. Relative imports: `import { state } from "./state.js"`, `import { getQueryEngine } from "../db/pool.js"`

**Path Aliases:**
- No path aliases detected (`tsconfig.json`, path mappings not used)
- Relative imports use explicit `../` or `./`: `../db/pool.js`, `./modules/state.js`

**File extensions:**
- All imports include `.js` extension (required for ES modules): `import { state } from "./state.js"`

## Error Handling

**Patterns:**
- Throw Error for programmer errors: `throw new Error("agentRunner not initialized — call setAgentRunner first")`
- Throw descriptive error messages with context: `throw new Error("Scan already in progress for this project (PID ${lock.pid}, started ${lock.startedAt})")`
- Catch and log errors, then re-throw or handle gracefully:
  ```javascript
  try {
    const result = await chromaSearch(query, limit);
  } catch (err) {
    process.stderr.write("[search] chroma failed: " + err.message + "\n");
    // fall back to next tier
  }
  ```
- Lock files validated with try-catch on JSON parse, corrupted locks removed silently

**Assertions:**
- Node.js strict assertions used in tests: `import assert from "node:assert/strict"`
- `assert.equal()`, `assert.ok()`, `assert.strictEqual()` for test verification
- No assertion library (no chai, no jest expect)

## Logging

**Framework:**
- Structured logger with `createLogger()` in `worker/lib/logger.js`
- Logger signature: `{ log(level, msg, extra = {}) }`
- Log levels: `INFO`, `WARN`, `ERROR`, `DEBUG`

**Patterns:**
- Scan lifecycle events logged with context: `slog('INFO', 'scan started', { repoPath, mode: ctx.mode })`
- HTTP layer logs: `httpLog('ERROR', err.message, { route: '/projects', stack: err.stack })`
- Silent no-op when logger not injected: `if (_logger) _logger.log(...)`
- Structured data as third parameter: `log(level, msg, { component: 'http', extra: {} })`

**Stderr/stdout:**
- Direct `process.stderr.write()` for search tier fallback logging
- JSON log lines (one per line) written to `logs/worker.log`

## Comments

**When to Comment:**
- Block comments for major sections (with visual separators): `// ───────────────────────────────────`
- Inline comments for non-obvious logic, constraints, workarounds
- Implementation notes from tickets/PRs: `// SREL-01`, `// OWN-01`, `// AUTHDB-02`
- No comments on obvious code

**JSDoc/TSDoc:**
- Full JSDoc for all exported functions with `@param`, `@returns`, `@throws`
- Type annotations with `@type`, `@typedef` (zero TypeScript, pure JavaScript + JSDoc)
- Example:
  ```javascript
  /**
   * Create and start a Fastify HTTP server exposing the query engine over REST.
   *
   * @param {object|null} queryEngine - Static query engine (for tests). Null in production.
   * @param {object} options - Server options
   * @param {number} [options.port=37888] - Port to bind
   * @returns {Promise<FastifyInstance>}
   */
  export async function createHttpServer(queryEngine, options = {}) { ... }
  ```
- Complex types documented with `@typedef`: `@typedef {{ id: number, name: string }} Service`

## Function Design

**Size:**
- Small functions preferred; largest observed is ~1700 lines but mostly test setup
- Core logic functions typically 50-200 lines
- Test helper functions 10-50 lines

**Parameters:**
- Positional params for required args, options object for optional config
- Pattern: `function(required1, required2, options = {})`
- Options destructured inside when needed: `const { limit = 20, skipChroma = false } = options`

**Return Values:**
- Explicit returns with meaningful values (no silent undefined)
- Objects with `{ valid: true, findings: ... }` or `{ valid: false, error: "..." }` for validation results
- Generators and async functions used where appropriate: `async function scanRepos(...)`

**Callbacks/Higher-order:**
- Agent runner injected via `setAgentRunner(fn)` to decouple from MCP tools
- Logger injected via `setScanLogger(logger)` for optional structured logging
- Enrichers registered via `registerEnricher(name, fn)` for extensibility

## Module Design

**Exports:**
- Named exports for all functions: `export function getQueryEngine(...)`
- Named exports for constants: `export const NODE_RADIUS = 18`
- No default exports observed
- Module-level state in private variables: `let _logger = null`, `let _db = null`

**Barrel Files:**
- No index.js or barrel files detected
- Direct imports from specific modules: `import { state } from "./modules/state.js"`

**Singletons:**
- Database instance cached in `_db` variable, returned via `getDb()` and `openDb()`
- Logger instance injected, cached in `_logger`
- Query engine instance per project in `pool.js` mapping

## Transaction & Atomicity Patterns

**Database Transactions:**
- SQLite transactions wrapped via `db.transaction(() => { ... })()`
- Used for atomic multi-statement operations: migrations, scan writes
- Example: `db.transaction(() => { migration.up(db); db.prepare(...).run(...); })()`

**Lock Management:**
- File-based locks for scan coordination: `./ligamen-lock-{hash}.json`
- Lock contains `{ pid, startedAt }`
- Stale lock detection (PID gone → remove and retry)
- Error thrown if lock held by active process

## Testing Patterns (related to conventions)

**Module injection for testability:**
- `setAgentRunner(fn)` allows tests to inject mock agent
- `setScanLogger(logger)` allows tests to suppress logging
- `setSearchDb(db)` for standalone search tests
- This pattern reduces need for mocking/stubbing libraries

---

*Convention analysis: 2026-03-23*
