# Coding Conventions

**Analysis Date:** 2026-03-16

## Naming Patterns

**Files:**
- Shell scripts: lowercase with hyphens (e.g., `format.sh`, `lint.sh`, `drift-versions.sh`)
- JavaScript modules: camelCase or kebab-case (e.g., `query-engine.js`, `mcp-server.js`, `db.js`)
- Test files: pattern + `.test.js` or `.spec.*` for Node.js; `.bats` for shell tests (e.g., `query-engine.test.js`, `format.bats`, `lint.bats`)
- Configuration: snake_case with `-` separators (e.g., `allclear.config.json`, `allclear-init.js`)

**Functions (JavaScript):**
- camelCase for all function names and methods
- Private/internal functions prefixed with underscore (e.g., `_searchDb`, `_migrations`, `_db`, `loadMigrationsAsync`)
- Exported functions and class methods use camelCase without underscore prefix (e.g., `openDb()`, `getDb()`, `setSearchDb()`)

**Functions (Shell):**
- lowercase with underscores (e.g., `detect_language()`, `cleanup_session_flags()`)
- Private/sourced library functions may prefix with underscore or be documented as internal

**Variables:**
- JavaScript: camelCase for local/module variables (e.g., `_db`, `_migrations`, `SEVERITY_ORDER` for constants)
- Shell: UPPERCASE for exported/global variables (e.g., `ALLCLEAR_CONFIG_FILE`, `ALLCLEAR_DISABLE_FORMAT`), lowercase for local scope
- Constants: UPPERCASE_WITH_UNDERSCORES (e.g., `SEVERITY_ORDER`, `THROTTLE_SECS`)

**Types:**
- JavaScript JSDoc type annotations on constructors and function parameters (e.g., `@param {import('better-sqlite3').Database} db`)
- No TypeScript in current codebase; all .js files use JSDoc for type hints

## Code Style

**Formatting:**
- Tool: Prettier (with fallback to language-specific formatters)
- Invoked automatically by `scripts/format.sh` on PostToolUse hooks
- Supported languages: Python (ruff format), Rust (rustfmt), TypeScript/JavaScript (prettier), Go (gofmt)
- JSON/YAML formatted with prettier when available
- Silent on success (no stdout), non-blocking (always exits 0)

**Linting:**
- Shell: shellcheck with `-x` flag for source includes (ignores SC1091 — source not followed)
- JavaScript: eslint (local or npm bin resolution preferred)
- Python: ruff check
- Rust: cargo clippy (throttled to 30s per project via `/tmp/allclear_clippy_*` marker)
- Go: golangci-lint
- Invoked by `scripts/lint.sh` on PostToolUse hooks
- Non-blocking: hook always exits 0 even if linter finds issues
- Output: lint issues surface via systemMessage JSON to Claude when found

## Import Organization

**Order (JavaScript):**
1. Standard library imports (`fs`, `path`, `os`, `crypto`, `child_process`)
2. Third-party packages (`better-sqlite3`, `@modelcontextprotocol/sdk`, `zod`, `fastify`)
3. Internal project modules (relative imports `./`, `../`)
4. Type annotations or constants

**Example from `worker/db.js`:**
```javascript
import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { syncFindings } from "./chroma-sync.js";
import { fileURLToPath, pathToFileURL } from "url";
```

**Order (Shell):**
1. Shebang: `#!/usr/bin/env bash`
2. Header comments (purpose, event triggers, spec references)
3. Guard statements and early exits
4. Source/include statements for libraries
5. Function definitions
6. Main logic/execution

**Path Aliases:**
- No path aliases in use; absolute imports standard for Node.js modules
- Shell scripts use `${CLAUDE_PLUGIN_ROOT}/lib/` or relative paths

## Error Handling

**Patterns:**
- JavaScript: try-catch blocks for initialization; graceful degradation on errors (e.g., ChromaDB fallback to FTS5 fallback to SQL in `worker/query-engine.js`)
- Shell: `set -euo pipefail` guard; early return/exit on missing prerequisites; silent failure on missing tools (non-blocking guarantee)
- Database errors: wrap migrations in transactions for atomicity; throw descriptive errors only for critical failures (e.g., database not initialized)
- Linter/formatter errors: suppress (redirect to `/dev/null`), report via systemMessage JSON, always exit 0

**Example from `scripts/lint.sh`:**
```bash
# Route ALL debug/error output to stderr sink
exec 2>/dev/null

# Non-blocking — even on linter failure, exit 0
LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
```

## Logging

**Framework:** console (Node.js built-in)

**Patterns:**
- stderr preferred for operational/debug output (not stdout, which may be consumed by tools)
- stdout reserved for JSON output (systemMessage, hook responses)
- Debug info prefixed with `[module-name]` for context (e.g., `[search] tier=chroma results=10`)
- No logging to stdout in `worker/mcp-server.js` (violates MCP JSON-RPC protocol)

**Example from `worker/query-engine.js`:**
```javascript
process.stderr.write("[search] tier=chroma results=" + results.length + "\n");
```

## Comments

**When to Comment:**
- Complex algorithms (e.g., recursive CTE in `transitiveImpact()`)
- Non-obvious workarounds or edge cases (e.g., macOS bash 3.2 compatibility in `lib/config.sh`)
- External requirement references (spec codes like FMTH-07, LNTH-06 in headers)

**JSDoc/TSDoc:**
- Function signatures: always document `@param` and `@returns` with types
- Class constructors: document purpose and key responsibilities
- Module-level: header comment explaining purpose, usage, and invariants

**Example from `worker/db.js`:**
```javascript
/**
 * Opens (or creates) the SQLite database for the given project root.
 * Runs pending migrations before returning. Idempotent — safe to call
 * multiple times; returns the same instance on subsequent calls.
 *
 * @param {string} [projectRoot] - Project root directory. Defaults to process.cwd().
 * @returns {import('better-sqlite3').Database} The open database instance.
 */
export function openDb(projectRoot = process.cwd()) {
```

## Function Design

**Size:**
- No strict limit; prefer <200 lines for complex functions (e.g., `QueryEngine.transitiveImpact()` is ~100 lines)
- Break multi-step workflows into helper functions (see `worker/confirmation-flow.js`)

**Parameters:**
- Prefer explicit parameters over global state where possible
- Use destructuring for options objects (e.g., `{ maxDepth: 2, direction: "upstream" }`)
- Optional parameters documented with `[name]` in JSDoc

**Return Values:**
- Consistent types: return null/[] only when intentional (documented)
- Database query results: return array of objects; empty array on no matches (never null)
- Void functions explicit: no implicit undefined returns in exports

## Module Design

**Exports:**
- Named exports for functions and classes (e.g., `export function openDb()`, `export class QueryEngine`)
- Module-level helper functions prefixed with `_` or kept private (not exported)
- Single responsibility: each module handles one concern (db lifecycle, queries, sync, etc.)

**Barrel Files:**
- Not used; imports go directly to module source (e.g., `import { openDb } from './db.js'`)

**Example module structure (`worker/db.js`):**
1. Imports (standard lib, third-party, internal)
2. Module-level state (singletons with underscore prefix)
3. Helper functions (private, using underscore or inline)
4. Exported public API
5. Top-level await for initialization

## Bash-Specific Conventions

**Strict Mode:**
- Scripts using `set -euo pipefail` (Exit on error, Undefined variables, Pipes fail)
- Exception: hooks may use looser error handling for non-blocking guarantees

**Quoting:**
- Variable expansion in double quotes unless word-splitting is intentional
- Use `[[ ]]` for test expressions (bash-specific, more robust than `[ ]`)

**Source Guards:**
- Library files use guard variables to prevent double-sourcing (e.g., `_ALLCLEAR_CONFIG_LOADED`)
- Return early if guard is set

**File Paths:**
- Avoid hardcoded paths; use `$BATS_TEST_DIRNAME`, `$CLAUDE_PLUGIN_ROOT`, `${SCRIPT}` variables
- Use `$(cd dir && pwd)` for canonicalization in tests

---

*Convention analysis: 2026-03-16*
