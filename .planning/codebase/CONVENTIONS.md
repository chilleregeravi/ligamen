# Coding Conventions

**Analysis Date:** 2026-03-31

## Languages

**Dual-language codebase:**
- **Bash** (`.sh`) -- Hook scripts, utility libraries, session lifecycle (`plugins/ligamen/scripts/`, `plugins/ligamen/lib/`)
- **JavaScript** (ESM `.js`) -- Worker process, MCP server, query engine, UI modules (`plugins/ligamen/worker/`)

All JavaScript uses **ES Modules** (`"type": "module"` in `plugins/ligamen/package.json`). Use `import`/`export`, never `require()`.

## Naming Patterns

**Files:**
- Shell scripts: `kebab-case.sh` (e.g., `plugins/ligamen/scripts/file-guard.sh`, `plugins/ligamen/scripts/drift-versions.sh`)
- Shell libraries: `kebab-case.sh` in `plugins/ligamen/lib/` (e.g., `lib/detect.sh`, `lib/config.sh`, `lib/linked-repos.sh`)
- JavaScript modules: `kebab-case.js` (e.g., `worker/db/query-engine.js`, `worker/scan/manager.js`, `worker/lib/logger.js`)
- JavaScript tests: `{module-name}.test.js` co-located with source (e.g., `worker/db/query-engine-enrich.test.js`)
- Bats tests: `kebab-case.bats` in `tests/` (e.g., `tests/detect.bats`, `tests/file-guard.bats`)
- Migration files: `NNN_snake_case.js` (e.g., `worker/db/migrations/001_initial_schema.js`, `worker/db/migrations/009_confidence_enrichment.js`)
- Command definitions: `kebab-case.md` (e.g., `plugins/ligamen/commands/cross-impact.md`, `plugins/ligamen/commands/drift.md`, `plugins/ligamen/commands/map.md`)

**Functions (JavaScript):**
- Use `camelCase` for all functions: `createHttpServer()`, `getChangedFiles()`, `buildScanContext()`, `sanitizeBindings()`
- Factory functions: `create*` prefix: `createLogger()`, `createHttpServer()`, `createCodeownersEnricher()`
- Setter injections: `set*` prefix: `setScanLogger()`, `setAgentRunner()`, `setExtractorLogger()`
- Boolean checks: `is*` prefix: `isChromaAvailable()`, `isViewOnlyMode()`
- Private/internal functions: `_` prefix: `_hasServiceEntryPoint()`, `_sortServicesForBoundaries()`

**Functions (Bash):**
- Use `snake_case`: `detect_project_type()`, `detect_language()`, `block_file()`, `warn_file()`

**Variables (JavaScript):**
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_LOG_BYTES`, `VALID_PROTOCOLS`, `VALID_CONFIDENCE`, `NODE_RADIUS`, `MAX_TRANSITIVE_DEPTH`, `QUERY_TIMEOUT_MS`)
- Module-level private state: `_` prefix (e.g., `_logger`, `_capacity`, `_cache`, `_mcpLogLevel`)
- Local variables: `camelCase` (e.g., `logPath`, `lineObj`, `repoState`, `projectRoot`, `scanVersionId`)
- State object properties: `camelCase` (e.g., `graphData`, `selectedNodeId`, `blastNodeId`)

**Variables (Bash):**
- Environment variables: `UPPER_SNAKE_CASE` with `LIGAMEN_` prefix (e.g., `LIGAMEN_DISABLE_LINT`, `LIGAMEN_CONFIG_FILE`, `LIGAMEN_LINT_THROTTLE`)
- Local script variables: `UPPER_SNAKE_CASE` (e.g., `FILE`, `LINT_OUTPUT`, `LINTER_NAME`)
- Private/guard variables: `_` prefix (e.g., `_LIGAMEN_CONFIG_LOADED`, `_linked_repo_path`, `_extra_patterns`)

**Types/Classes:**
- `PascalCase`: `QueryEngine`, `StmtCache`

**Database/Schema:**
- `snake_case` for SQL column names: `source_service_id`, `target_service_id`, `root_path`, `auth_mechanism`, `scan_version_id`
- Foreign keys named `{entity}_id`: `repo_id`, `actor_id`, `service_id`

**Environment Variables:**
- All custom env vars use `LIGAMEN_` prefix
- Disable toggles follow `LIGAMEN_DISABLE_{FEATURE}=1` pattern: `LIGAMEN_DISABLE_FORMAT`, `LIGAMEN_DISABLE_LINT`, `LIGAMEN_DISABLE_GUARD`
- Configuration overrides: `LIGAMEN_LINT_THROTTLE`, `LIGAMEN_DATA_DIR`, `LIGAMEN_LOG_LEVEL`, `LIGAMEN_WORKER_PORT`
- Extra patterns: `LIGAMEN_EXTRA_BLOCKED` (colon-separated glob patterns)

## Code Style

**Formatting:**
- The `plugins/ligamen/scripts/format.sh` hook auto-formats on every file write via PostToolUse
- JavaScript/TypeScript: prettier (preferred) or eslint --fix
- Python: ruff format (preferred) or black
- Rust: rustfmt
- Go: gofmt
- JSON/YAML: prettier
- Format hook always exits 0 (non-blocking) per FMTH-10 convention
- No project-level `.eslintrc` or `.prettierrc` config files (formatting delegated to hook + tool defaults)

**Linting:**
- The `plugins/ligamen/scripts/lint.sh` hook runs language-specific linters on PostToolUse
- JavaScript/TypeScript: eslint (local resolution preferred: `node_modules/.bin/eslint`)
- Python: ruff check
- Rust: cargo clippy (with configurable throttle, default 30 seconds per project)
- Go: golangci-lint
- Shell scripts: shellcheck (run via `make lint` with `-x -e SC1091` flags)
- Lint hook always exits 0 per LNTH-07 convention; output truncated to 30 lines per LNTH-06

**Indentation:**
- JavaScript: 2 spaces
- Shell: 2 spaces
- SQL in JavaScript: 2 spaces inside template literals, indented relative to surrounding code

**String Quoting (JavaScript):**
- Double quotes for strings consistently: `"node:test"`, `"INFO"`, `"rest"`
- Template literals for interpolation: `` `received ${signal}, shutting down` ``
- Trailing commas in multi-line function arguments and object literals

**Module System:**
- ES modules exclusively (`"type": "module"` in `plugins/ligamen/package.json`)
- All imports include `.js` extension (required for ESM resolution)
- Use `node:` protocol prefix for built-in modules: `"node:fs"`, `"node:path"`, `"node:os"`, `"node:test"`, `"node:assert/strict"`

## Import Organization

**Order (JavaScript ES modules):**
1. Node.js builtins with `node:` protocol prefix (e.g., `import fs from "node:fs"`, `import path from "node:path"`)
2. Third-party packages (e.g., `import Database from "better-sqlite3"`, `import Fastify from "fastify"`)
3. Local project imports using relative paths (e.g., `import { QueryEngine } from "./query-engine.js"`)

**Path Aliases:**
- None. All imports use relative paths with explicit `.js` extensions.

**Shell Sourcing:**
- Guard against direct execution: `[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }`
- Use `$CLAUDE_PLUGIN_ROOT` for cross-file references from hooks to lib
- Source guard pattern to prevent double-loading: `_LIGAMEN_CONFIG_LOADED` variable
- Use `source` (not `.`) for clarity

## Error Handling

**JavaScript Patterns:**
- Try/catch with empty catch for optional operations (settings not available, file not found):
  ```javascript
  try { /* operation */ } catch { /* File does not exist yet -- use defaults */ }
  ```
- Functions return `null` or empty arrays on failure, not exceptions:
  ```javascript
  export function getQueryEngine(projectRoot) {
    if (!projectRoot) return null;
    // ...
    if (!fs.existsSync(dbPath)) return null;
  }
  ```
- Validation functions return result objects: `{ valid: true, findings, warnings }` or `{ valid: false, error }`
- Database operations use transactions for atomicity: `db.transaction(() => { ... })()`
- Throw `Error` for programmer errors only: `throw new Error("agentRunner not initialized")`
- Lock files validated with try-catch on JSON parse; corrupted locks removed silently

**HTTP Error Responses:**
- Structured `{ error: message }` JSON with appropriate status codes
- 400 for missing/invalid parameters
- 404 for not-found resources
- 500 for internal errors (log error, return `{ error: err.message }`)
- 503 for "data not yet available" (e.g., no scan data)

**Shell Patterns:**
- `set -euo pipefail` at top of executable scripts (not sourced libraries)
- Sourced libraries intentionally omit `set -e`: "sourcing context owns error handling"
- `|| true` suffix for non-critical commands that might fail
- Exit code conventions: 0 = success/allow, 2 = hard block (PreToolUse deny)
- `2>/dev/null` redirects for optional command checks

**Hook Error Handling:**
- Format hook: always exits 0 (non-blocking, FMTH-10)
- Lint hook: always exits 0 (LNTH-07), lint output delivered as systemMessage JSON
- File guard: exits 0 for allow/warn, exits 2 for hard block with hookSpecificOutput JSON
- Example safe format call: `ruff format "$FILE" >/dev/null 2>&1 || true`

## Logging

**Framework:** Custom structured logger at `plugins/ligamen/worker/lib/logger.js`

**Patterns:**
- JSON-structured log lines written to `{dataDir}/logs/worker.log`
- Each line contains: `ts`, `level`, `msg`, `pid`, `port` (optional), `component`
- Four log levels: `DEBUG < INFO < WARN < ERROR`
- Log level filtering at creation time via `logLevel` parameter (default: `"INFO"`)
- Extra fields merged via `Object.assign(lineObj, extra)` pattern
- Size-based rotation at 10 MB threshold, keeping at most 3 rotated files (.1, .2, .3)
- TTY-aware: writes to stderr only when `process.stderr.isTTY` is truthy
- Component tag pattern: each module gets its own component (e.g., `'worker'`, `'http'`, `'scan'`, `'mcp'`)

**Logger Usage:**
```javascript
const logger = createLogger({ dataDir, port, logLevel, component: 'worker' });
logger.log("INFO", "worker started", { port });
logger.info("ChromaDB connected");
logger.error("query failed", { route: '/graph', stack: err.stack });
```

**Logger Injection:**
- Setter functions: `setScanLogger(logger)`, `setExtractorLogger(logger)`
- Silent no-op when logger not injected: `if (_logger) _logger.log(...)`

**Shell Logging:**
- Stderr for warnings/errors: `echo "message" >&2`
- Stdout reserved for machine-readable JSON output (especially in hook scripts)

**Critical Rule:** Never use `console.log` in MCP server code (`plugins/ligamen/worker/mcp/server.js`). The lint hook enforces this -- `console.log` in the MCP server corrupts the JSON-RPC session. Use `console.error()` for MCP server debugging.

## Comments

**Section Headers:**
- Use `// ---------------------------------------------------------------------------` (75 dashes) separator lines in both JS and Bash
- Number major sections: `// 1. Parse CLI args`, `// 2. Read settings.json`, etc.
- Use `# -- Section Title ----...` for bash sub-sections

**File-Level Documentation:**
- Every JavaScript module starts with a JSDoc comment describing purpose, exports, and usage
- Shell scripts include header comments with purpose, event triggers, and exit code contracts

**Requirement Tags:**
- Every test file starts with a comment block listing which requirements it covers
- Use ticket-style tags: `TEST-01`, `FMTH-07`, `CONF-02`, `LNTH-06`, `GRDH-03`, etc.
- Example: `# Covers: FMTH-07 (silent success), FMTH-09 (skip generated directories)`
- Use inline tags for individual rules: `// SREL-01 (THE-933):`, `// OWN-01`

**JSDoc:**
- Full JSDoc for all exported functions with `@param`, `@returns`
- Type annotations reference external types: `@param {import('better-sqlite3').Database} db`
- `@typedef` for complex object shapes:
  ```javascript
  /** @typedef {{ name: string, root_path: string, language: string, confidence: string }} Service */
  ```

## Function Design

**Size:** Functions are focused and typically 10-50 lines. Core logic functions may be 50-200 lines.

**Parameters:**
- Positional params for required args, options object for optional config
- Pattern: `function(required1, required2, options = {})`
- Options destructured: `const { limit = 20, skipChroma = false } = options`
- Query engine methods take plain objects: `upsertService({ repo_id, name, root_path, language })`

**Return Values:**
- Upsert methods return objects with `id` property: `upsertRepo() => { id }`
- Query methods return arrays: `transitiveImpact() => [{ name, depth, ... }]`
- Classification returns sorted arrays: `classifyImpact() => [{ severity, ... }]`
- Search returns typed arrays: `search() => [{ kind, ... }]`
- Validation: `{ valid: true, findings, warnings }` or `{ valid: false, error }`
- Always return arrays (never null/undefined) for list operations -- use `[]` for empty

## Module Design

**Exports:**
- Named exports only (`export function`, `export class`, `export const`)
- No default exports
- Test helpers exported with `_` prefix for testability: `export function _resetForTest()`
- Migration modules export `version` (number) and `up(db)` function

**Barrel Files:**
- Not used. Each module is imported directly by path.

**Singletons:**
- Database instance cached and returned via `openDb()` / `getDb()`
- Logger instance injected via setter, cached in `_logger`
- Query engine per project in `plugins/ligamen/worker/db/pool.js` Map

**Dependency Injection for Testability:**
- `setAgentRunner(fn)` -- inject mock agent runner for scan tests
- `setScanLogger(logger)` -- inject/suppress logging in tests
- `_resetForTest()` -- reset module-level state between test runs
- `initChromaSync(settings, mockClient)` -- accepts mock ChromaDB client
- This pattern eliminates the need for mocking/stubbing libraries

## Commit Message Conventions

**Format:** Conventional Commits with scope
- `feat(scope): description` for new features
- `fix: description` for bug fixes
- `chore: description` for maintenance tasks, version bumps
- `docs(scope): description` for documentation
- `refactor: description` for code restructuring

**Scope patterns:**
- Phase number: `feat(89-01):`, `docs(phase-91):`
- Phase sub-plan: `docs(89-01/02):`
- Feature area: `docs(89-crossing-semantics):`

**Message style:**
- Lowercase after prefix
- Imperative mood: "add", "fix", "complete", "create", "bump"
- Optional em-dash for detail: `docs(89-01/02): complete crossing-semantics plans -- CROSS-01, CROSS-02`
- Milestone bumps: `chore: bump all manifests to vX.Y.Z`
- Milestone completion: `chore: complete vX.Y.Z {Milestone Name} milestone`

## Shell Script Conventions

**Shebang:** `#!/usr/bin/env bash` for all shell scripts

**Header pattern for executable scripts:**
```bash
#!/usr/bin/env bash
set -euo pipefail
```

**Header pattern for sourced libraries:**
```bash
#!/usr/bin/env bash
# No set -e here -- sourcing context owns error handling.
```

**JSON handling in hooks:**
- Read stdin once: `INPUT=$(cat)`
- Parse with jq using null-coalescing: `jq -r '.tool_input.file_path // empty'`
- Emit JSON output via jq for safe escaping: `printf '%s' "$MSG" | jq -Rs .`
- Hook output schemas:
  - SystemMessage: `{"systemMessage": "..."}`
  - PreToolUse deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`

**macOS Compatibility:**
- Avoid `mapfile` (not available in bash 3.2); use `while IFS= read -r` instead
- Avoid GNU-specific flags (e.g., `realpath -m`); provide BSD fallbacks
- Use `cksum` instead of `md5sum` for portability
- Path normalization with BSD-compatible fallback (see `plugins/ligamen/scripts/file-guard.sh` lines 33-41)

## JSON Configuration Convention

**Config file:** `ligamen.config.json` in project root
- Key naming: `kebab-case` for top-level keys: `"linked-repos"`, `"impact-map"`, `"project-name"`
- Example: `{"linked-repos":["../api"],"impact-map":{"history":true},"project-name":"ligamen"}`

**Settings file:** `~/.ligamen/settings.json` for user-level settings
- Key naming: `LIGAMEN_UPPER_SNAKE_CASE` keys: `"LIGAMEN_LOG_LEVEL"`, `"LIGAMEN_WORKER_PORT"`, `"LIGAMEN_CHROMA_MODE"`

---

*Convention analysis: 2026-03-31*
