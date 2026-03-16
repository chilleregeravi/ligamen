# Testing Patterns

**Analysis Date:** 2026-03-16

## Test Framework

**Runner:**
- Shell scripts: BATS (Bash Automated Testing System) v1.x
- JavaScript: Node.js built-in `node:test` (available since Node 18+)
- Config: No single centralized config; each runner has its own conventions

**Assertion Library:**
- BATS: `bats-support` and `bats-assert` helpers (loaded via `load 'test_helper/...'`)
- Node.js: `assert/strict` module from Node.js standard library

**Run Commands:**
```bash
make test                    # Run all BATS tests in tests/*.bats
make lint                    # Run shellcheck on scripts/*.sh and lib/*.sh
npm run test:storage         # Run Node.js test suite for storage (worker/query-engine.test.js)
./tests/bats/bin/bats tests/*.bats  # Direct BATS invocation
```

## Test File Organization

**Location:**
- Shell tests: co-located at `tests/[name].bats` (e.g., `tests/format.bats`, `tests/lint.bats`)
- JavaScript tests: co-located in same directory as source, named `[source].test.js` (e.g., `worker/query-engine.test.js`)
- Fixtures: `tests/fixtures/` for mock scripts and configuration files

**Naming:**
- BATS: `tests/[feature].bats` where feature is the script being tested (`format.bats` → `scripts/format.sh`)
- Node.js: `[module].test.js` in same directory as source module

**Structure:**
```
tests/
├── *.bats                          # Top-level BATS test suites
├── bats/                           # Vendored BATS framework (submodule)
├── test_helper/                    # Vendored test helpers (bats-support, bats-assert)
├── fixtures/                       # Mock files and test data
│   └── config/                     # Mock hook scripts
│       ├── mock-format.sh
│       ├── mock-lint.sh
│       └── mock-guard.sh
├── helpers/                        # Shared test utilities (bash)
│   └── mock_detect.bash            # Helper for mocking detect.sh

worker/
├── query-engine.test.js            # Inline test suite for QueryEngine
├── db-snapshot.test.js             # Inline test suite for snapshot functionality
├── scan-manager.test.js            # Inline test suite for scan manager
└── [other test files].js           # Additional inline test suites
```

## Test Structure

**Shell Test Suite Organization (BATS):**
```bash
#!/usr/bin/env bats
# Header with test suite purpose and spec codes

setup() {
  # Load helper libraries
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'

  # Set up test environment (temp directories, mock tools)
  STUB_DIR="$(mktemp -d)"
  export SCRIPT="${BATS_TEST_DIRNAME}/../scripts/format.sh"
}

teardown() {
  # Clean up temp files, mock tools
  rm -rf "${STUB_DIR}"
}

@test "test name — describes one behavior" {
  # Arrange
  printf '#!/usr/bin/env bash\nexit 0\n' > "${STUB_DIR}/tool"
  chmod +x "${STUB_DIR}/tool"

  # Act
  run bash -c "PATH='${STUB_DIR}:${PATH}' bash '${SCRIPT}'"

  # Assert
  assert_success          # Equivalent to [ "$status" -eq 0 ]
  assert_output ""        # Expect empty output (silent success)
}
```

**Node.js Test Suite Organization:**
```javascript
import { describe, it } from "node:test";
import assert from "assert/strict";

describe("feature category", () => {
  it("should do X in scenario Y", () => {
    // Arrange
    const { db, qe } = makeQE();  // Helper function for isolated DB
    const rId = qe.upsertRepo({ ... });

    // Act
    const result = qe.transitiveImpact(rId);

    // Assert
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(names, ["svc-a", "svc-b", "svc-c"]);

    // Cleanup
    db.close();
  });
});
```

**Patterns:**
- Setup: Initialize test environment, load helpers, create mocks
- Teardown: Remove temp files, close resources (important for DB tests)
- Test structure: Arrange → Act → Assert (AAA pattern)
- One assertion focus per test (where possible; may have multiple assertions for related properties)

## Mocking

**Framework:**
- BATS: Mock tools by creating stub scripts in temp directory, prepend temp directory to `$PATH`
- Node.js: Manual creation of test data via helper functions; no external mocking library

**Patterns:**
```bash
# BATS: Create mock tool
printf '#!/usr/bin/env bash\necho "output"\nexit 0\n' > "${STUB_DIR}/tool"
chmod +x "${STUB_DIR}/tool"

# Invoke test with mocked PATH
run bash -c "PATH='${STUB_DIR}:${PATH}' bash '${SCRIPT}'"
```

**What to Mock:**
- External tools (prettier, ruff, eslint, cargo) when testing conditional invocation
- File system paths (create temporary files/directories for input)
- Environment variables (export TEST_VAR=value before running)

**What NOT to Mock:**
- Core shell/bash builtins (test, echo, etc.)
- Node.js built-in modules (better-sqlite3 itself is real; test DB is real SQLite in temp dir)
- Database queries (use real SQLite with isolated test database)

## Fixtures and Factories

**Test Data (Node.js):**
```javascript
/**
 * Create a fresh isolated in-memory-backed on-disk DB for each test.
 * Uses better-sqlite3 directly (not the openDb singleton) so each test
 * gets a truly independent connection that can be safely closed.
 */
function makeQE() {
  const dir = path.join(os.tmpdir(), "allclear-test-" + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "test.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Bootstrap schema and run migration
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (...)`);
  migration001.up(db);

  const qe = new QueryEngine(db);
  return { db, qe };
}
```

**Test Data (Shell/BATS):**
- Inline temporary files created during test setup
- Mock configuration via environment variables
- Temporary directories for file path testing
- Shell functions for repetitive operations (e.g., `cleanup_session_flags()` in helpers)

**Location:**
- Node.js helpers: defined inline in test file as module-scope functions
- Shell helpers: `tests/helpers/` directory (shared across BATS suites)
- Fixture files: `tests/fixtures/` directory (static mock tools, config examples)

## Coverage

**Requirements:** No explicit coverage threshold enforced in CI

**View Coverage:**
```bash
# Node.js (manual): No built-in coverage tool in tests
# JavaScript files must be tested via node:test invocation

# Shell (manual): Review test output and grep for untested code paths
grep -n "TODO\|FIXME" scripts/*.sh  # Identify known gaps

# Approximate coverage via BATS output
make test 2>&1 | grep -E "^(ok|not ok)"  # Count pass/fail
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, methods, small behaviors
- Approach: Isolated fixtures (makeQE for DB tests), mock external tools
- Example: `query-engine.test.js` tests individual QueryEngine methods in isolation
- Shell: Test individual script branches (e.g., ruff present vs. absent)

**Integration Tests:**
- Scope: Multiple components interacting (e.g., DB + migrations + QueryEngine)
- Approach: Real database with seeded data, follow data flow through multiple functions
- Example: `worker/scan-manager.test.js` tests scan → findings schema validation → confirmation flow
- Shell: Not heavily used; most shell tests are narrow unit tests

**E2E Tests:**
- Framework: Not used; no dedicated E2E test suite
- Manual testing: Plugin behavior verified through actual Claude Code sessions

## Common Patterns

**Async Testing (Node.js):**
```javascript
// Top-level await supported (ES module context)
// Tests are synchronous by default; async operations wrapped:

it("should search asynchronously", async () => {
  const results = await search("payment", { skipChroma: true });
  assert.ok(results.length > 0);
});

// For callback-based code: use Promises
it("should handle callback-based op", () => {
  return new Promise((resolve, reject) => {
    doAsyncOp((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
});
```

**Error Testing:**
```javascript
// Node.js: assert.throws for exception testing
it("should throw on uninitialized DB", () => {
  assert.throws(
    () => getDb(),
    {
      message: "Database not initialized. Call openDb() first."
    }
  );
});

// BATS: test exit code and stderr output
@test "lint hook - exits 0 when linter finds issues" {
  printf '#!/usr/bin/env bash\nexit 1\n' > "${STUB_DIR}/ruff"
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success  # Hook always exits 0, even if linter failed
}
```

**Database Isolation (Node.js):**
```javascript
// Each test gets fresh database via makeQE()
describe("transitive traversal", () => {
  function seedChain(qe) {
    // Create test data in this specific QE instance
    const rId = qe.upsertRepo({ path: "/r", name: "r", type: "single" });
    // ... more setup
    return { A, B, C, D };
  }

  it("chain test", () => {
    const { db, qe } = makeQE();  // Fresh DB for this test
    const { A, B, C, D } = seedChain(qe);  // Seed data
    const hits = qe.transitiveImpact(A);
    // ... assertions
    db.close();  // Cleanup
  });
});
```

**Cycle Detection (Database):**
```javascript
// Specific test pattern for breaking edge case: cycles in graph
it("cycle detection: A→B→C→A terminates without infinite loop", () => {
  const { db, qe } = makeQE();
  const { A, C } = seedChain(qe);

  // Create cycle
  qe.upsertConnection({
    source_service_id: C,
    target_service_id: A,
    protocol: "rest",
    method: "GET",
    path: "/cycle",
  });

  // Must terminate (not infinite loop)
  const hits = qe.transitiveImpact(A);
  assert.ok(hits.length < 100, "cycle should not produce unbounded results");

  db.close();
});
```

## Test Execution in CI

**Makefile targets:**
- `make test`: Run BATS suite (all `.bats` files in `tests/`)
- `make lint`: Verify shell scripts with shellcheck
- `make check`: Validate JSON configs (plugin.json, hooks.json)

**GitHub Actions:** Not visible in current codebase analysis (scripts are present but workflow config not examined)

**Typical CI Flow:**
1. Lint shell code: `make lint`
2. Validate configs: `make check`
3. Run tests: `make test`
4. Run Node.js storage tests: `npm run test:storage`

---

*Testing analysis: 2026-03-16*
