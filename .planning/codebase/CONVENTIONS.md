# Coding Conventions

**Analysis Date:** 2026-03-20

## Naming Patterns

**Files:**
- All lowercase with hyphens: `query-engine.js`, `detail-panel.js`, `worker-client.sh`
- Test files: `[module-name].test.js` or `[module-name].bats`
- Bash scripts: `.sh` extension
- Directories: lowercase with hyphens (`ui/modules`, `test_helper`)

**Functions:**
- camelCase for all functions: `openDb()`, `hitTest()`, `fetchImpact()`, `makeQE()`, `renderInfraConnections()`
- Module-scoped private functions with underscore prefix (occasionally): `_canvas`, `_tooltip`, `_db`, `_migrations`
- Named event handlers use `on` prefix: `onMouseMove()`, `onMouseDown()`, `onMouseUp()`, `onClick()`

**Variables:**
- camelCase for all local variables: `nodeId`, `selectedNodeId`, `blastNodeId`, `graphData`, `positions`
- SCREAMING_SNAKE_CASE for module-level constants: `NODE_RADIUS`, `LABEL_MAX_CHARS`, `NODE_TYPE_COLORS`
- Semantic prefixes for state flags: `isDragging`, `isPanning`, `dragStarted`, `mismatchesOnly`, `hideIsolated`

**Types/Interfaces:**
- No TypeScript in codebase — uses plain JavaScript with JSDoc type annotations
- JSDoc format: `@param {type} name`, `@returns {type}`, `@throws {Error}`

## Code Style

**Formatting:**
- No dedicated formatter configured (no ESLint or Prettier config found)
- Implicit conventions observed:
  - 2-space indentation (consistent throughout)
  - Double quotes for strings: `"string"` preferred (mixed with single quotes in patterns)
  - Semicolons used consistently at end of statements
  - No trailing commas in objects/arrays

**Linting:**
- No ESLint or Prettier config files present (`.eslintrc*`, `.prettierrc*`)
- `.prettierignore` file exists but primarily excludes vendored code and build artifacts
- Style consistency maintained through careful code review

## Import Organization

**Order:**
1. Node built-ins first: `import fs from "fs"`, `import { describe, it } from "node:test"`
2. Third-party libraries: `import Database from "better-sqlite3"`, `import assert from "node:assert/strict"`
3. Relative imports from project: `import { state } from "./state.js"`, `import { QueryEngine } from "../../worker/db/query-engine.js"`
4. Path structure: relative paths use `../` for parent navigation

**Path Aliases:**
- No aliases configured — all imports use relative or absolute node paths
- Consistent use of `fileURLToPath()` and `import.meta.url` for resolving `__dirname` in ES modules

**Module Organization:**
- Functions exported individually: `export function openDb()`, `export function getDb()`
- Constants exported individually: `export const state = {...}`, `export const NODE_RADIUS = 18`
- No default exports; all exports are named

## Error Handling

**Patterns:**
- Try-catch blocks in async operations: `fetchImpact()` wraps fetch in try-catch, returns empty Set on error
- Silent failures with fallback values (common in UI): `state.blastCache[nodeName] = new Set()` on error
- Process.stderr.write() for logging errors: `process.stderr.write("[search] chroma failed, falling back to FTS5: " + err.message + "\n")`
- Throw new Error() for precondition failures: `throw new Error("Database not initialized. Call openDb() first.")`
- No structured error types — all errors are generic Error instances with message strings

## Logging

**Framework:** Custom `createLogger` function in `worker/lib/logger.js`

**Patterns:**
- Structured logging with JSON format per line
- Methods: `logger.log(level, msg, extras)`, `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- Log line fields: `ts`, `level`, `msg`, `pid`, `port`, `component`, plus any extra fields passed
- Log file location: `{dataDir}/logs/worker.log`
- Log levels (ordered): DEBUG < INFO < WARN < ERROR
- stderr output for immediate feedback: `process.stderr.write("[prefix] message")`

## Comments

**When to Comment:**
- Block headers with dashes: `// ── 1. Partition into layers ──────────────────────────────────`
- Algorithm explanation before complex sections: `// Actor nodes go to the dedicated right column — skip regular layer logic`
- Setup/teardown instructions: `// Note: do not close here — the singleton is shared across this process`
- Migration/version tracking: Comments explain what changed in each DB migration

**JSDoc/TSDoc:**
- Used extensively for public functions and module-level exports
- Format: `/** [description] */` above function or const
- Includes @param, @returns, @throws tags with type annotations
- Example from `database.js`:
  ```javascript
  /**
   * Opens (or creates) the SQLite database for the given project root.
   * Runs pending migrations before returning. Idempotent — safe to call
   * multiple times; returns the same instance on subsequent calls.
   *
   * @param {string} [projectRoot] - Project root directory. Defaults to process.cwd().
   * @returns {import('better-sqlite3').Database} The open database instance.
   */
  export function openDb(projectRoot = process.cwd()) { ... }
  ```

## Function Design

**Size:** Functions range 5–50 lines; large sections (>100 lines) use internal helper functions

**Parameters:**
- Single object parameter for multiple options: `openDb(projectRoot = process.cwd())`
- Options objects passed to functions: `fetchImpact(nodeName, nodeId, options = {})`
- Defaults provided inline: `function truncate(str, max = 50) {}`

**Return Values:**
- Consistent return types: functions either return a value or undefined (no null)
- Early returns for guards: `if (!pos) continue;` before using value
- Set/Array returns for collections: `getNeighborIds()` returns Set, `.search()` returns Array

## Module Design

**Exports:**
- All exports are named; no default exports used
- Exports placed at function/const definition: `export function openDb() {...}`
- Internal module state exported as const: `export const state = {...}`

**Barrel Files:**
- Not used — modules import directly from source files
- No index.js re-exports observed

**Module Structure:**
- Single responsibility per file (e.g., `database.js` handles DB lifecycle, `query-engine.js` handles queries)
- Related functions grouped together with section headers
- Module-level comments explain purpose and usage at top of file

---

*Convention analysis: 2026-03-20*
