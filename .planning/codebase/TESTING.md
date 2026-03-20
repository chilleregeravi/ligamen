# Testing Patterns

**Analysis Date:** 2026-03-20

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (no external test runner like Jest or Vitest)
- Available since Node 18+; documented in `tests/storage/query-engine.test.js` comments
- Required Node version: >= 20.0.0 (from `package.json`)

**Assertion Library:**
- `node:assert/strict` — Node.js built-in strict assertion module
- Imported as: `import assert from "node:assert/strict"`

**Run Commands:**
```bash
node --test tests/storage/query-engine.test.js      # Run single test file
npm test                                              # Run test suite (script in package.json)
npm run test:storage                                  # Storage-specific tests (from package.json)
```

**Configuration:**
- No test config file (no `jest.config.js`, `vitest.config.js`, etc.)
- Tests run directly with Node.js
- No coverage tool integration detected

## Test File Organization

**Location:**
- **Colocated pattern (preferred):** Test files in same directory as source
  - Example: `worker/ui/modules/layout.js` has `worker/ui/modules/layout.test.js`
  - Example: `worker/ui/modules/renderer.js` has `worker/ui/modules/renderer.test.js`

- **Separate directory pattern (also used):** Tests in `tests/` tree with parallel structure
  - Example: `tests/storage/query-engine.test.js` tests `worker/db/query-engine.js`
  - Example: `tests/ui/graph-fit-to-screen.test.js` tests `worker/ui/graph.js`
  - Example: `tests/worker/logger.test.js` tests `worker/lib/logger.js`

**Naming:**
- Pattern: `[module-name].test.js` for unit tests
- Pattern: `[module-name].spec.js` not used (only `.test.js` observed)
- Bash integration tests: `tests/bats/[name].bats`

**Structure:**
```
tests/
├── bats/              # Bash integration tests (13 .bats files)
├── fixtures/          # Test fixtures and sample data
├── helpers/           # Test helper functions
├── integration/       # Integration tests
├── storage/           # Database/storage tests (9 .test.js files)
├── ui/                # UI verification tests (4 .test.js files)
├── worker/            # Worker/server tests (2 .test.js files)
└── test_helper/       # Vendored testing utilities (bats-support, bats-assert)
```

## Test Structure

**Suite Organization:**
```javascript
// Pattern from tests/storage/query-engine.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("database setup", () => {
  it("makeQE creates a WAL database", () => {
    const { db, qe } = makeQE();
    const mode = db.pragma("journal_mode", { simple: true });
    assert.strictEqual(mode, "wal");
    db.close();
  });
});
```

**Patterns:**
- **Grouping:** Logical test suites with `describe("category", () => {...})`
- **Individual tests:** Each test is a single `it("description", () => {...})` block
- **Setup:** Helper functions like `makeQE()` or `makeTmpDir()` create test fixtures
- **Teardown:** Cleanup done in `finally` blocks or at end of test function

**Setup Pattern:**
```javascript
// Helper function approach (no beforeEach/afterEach)
function makeTmpDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "actest-"));
  fs.mkdirSync(path.join(tmp, "logs"));
  return tmp;
}

test("my test", () => {
  const tmp = makeTmpDir();
  try {
    // Test logic here
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
```

**Teardown Pattern:**
- `finally` blocks for cleanup: `db.close()`, `fs.rmSync(tmp, { recursive: true })`
- No test lifecycle hooks (no `beforeEach`, `afterEach`, etc.)

**Assertion Pattern:**
```javascript
// Strict equality checks preferred
assert.strictEqual(actual, expected, "message");
assert.ok(condition, "message");
assert.deepStrictEqual(obj1, obj2, "message");
assert.equal(typeof value, "string");
assert.ok(!condition, "negation check");
```

## Test Types

**Unit Tests:**
- **Scope:** Individual functions or classes in isolation
- **Approach:** Create minimal fixtures (e.g., isolated DB instances) and test single responsibility
- **Example:** `tests/storage/query-engine.test.js` — tests QueryEngine methods with fresh DBs per test
- **Coverage:** Database operations, business logic, impact traversal algorithms

**Source Verification Tests (Static Analysis):**
- **Scope:** Verify implementation structure without runtime execution
- **Approach:** Read source file as string, check for required patterns with `src.includes()`
- **Example:** `tests/ui/graph-fit-to-screen.test.js` — verifies `fitToScreen()` function exists and calls `render()`
- **Example:** `worker/ui/modules/detail-panel.test.js` — checks for "infra routing branch", "escapeHtml helper", etc.
- **Pattern:** `const src = readFileSync(join(__dirname, '../source.js'), 'utf8')`

```javascript
// Source verification example
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../worker/ui/graph.js'), 'utf8');

test('fitToScreen() function is defined', () => {
  assert.ok(
    src.includes('function fitToScreen()'),
    'MISSING: fitToScreen function not defined in graph.js'
  );
});
```

**Integration Tests:**
- **Scope:** Test multiple components together (e.g., Fastify server, query engine, database)
- **Example:** `tests/worker/scan-bracket.test.js` — tests worker scanning with fixtures
- **Pattern:** Create full mock data, run operations, verify results

**Bash Integration Tests:**
- **Framework:** BATS (Bash Automated Testing System) with submodules `bats-support` and `bats-assert`
- **Example:** `tests/bats/session-start.bats` (17.4K) — tests CLI session initialization
- **Example:** `tests/bats/format.bats`, `tests/bats/lint.bats` — test quality gates
- **Pattern:** Run shell commands, assert on exit codes and output

## Fixtures and Test Data

**Test Data:**
- **Factory pattern (not factories):** Helper functions create test data on demand
- **Example from `query-engine.test.js`:**
  ```javascript
  function seedChain(qe) {
    const rId = qe.upsertRepo({ path: "/r", name: "r", type: "single" }).id;
    const [A, B, C, D] = ["svc-a", "svc-b", "svc-c", "svc-d"].map((n) =>
      qe.upsertService({
        repo_id: rId,
        name: n,
        root_path: "/r/" + n,
        language: "node",
      }),
    );
    // ... create connections
    return { A, B, C, D };
  }
  ```
- **Isolation:** Each test creates fresh data; no shared state between tests
- **Isolation pattern:** `makeQE()` creates independent database instances with UUID-based temp directories

**Location:**
- Test fixtures live in test files themselves (inline helper functions) or `tests/fixtures/`
- Example: `tests/fixtures/config/` contains sample configuration files
- Example: `tests/fixtures/drift/repo-a/` and `tests/fixtures/drift/repo-b/` contain sample repositories

## Coverage

**Requirements:**
- No coverage target enforced (no `.nyc_reporter.json` or similar)
- No coverage thresholds in config

**Coverage tracking:**
- No coverage tool integrated (would use `nyc` with Node.js test runner)
- Coverage not visible in test output

## Common Patterns

**Async Testing:**
- Async tests use `async` keyword and `await` directly
- Example from UI tests:
  ```javascript
  test("my async test", async () => {
    const result = await fetchData();
    assert.ok(result);
  });
  ```
- Promise-based assertions work naturally with strict assert

**Error Testing:**
- Errors tested indirectly via return values (e.g., empty Set on error)
- No explicit error assertion library
- Example from `query-engine.test.js`:
  ```javascript
  test("returns empty array for unknown query (not an error)", () => {
    const { db, qe } = makeQE();
    const results = qe.search("nonexistent-xyz-query-abc-999");
    assert.ok(Array.isArray(results), "should return array");
    assert.strictEqual(results.length, 0);
    db.close();
  });
  ```

**Database Testing:**
- SQLite in-memory with WAL mode for isolation
- Fresh database per test with all migrations applied
- Pragmas set consistently: `journal_mode = WAL`, `foreign_keys = ON`
- Example setup:
  ```javascript
  function makeQE() {
    const dir = path.join(os.tmpdir(), "ligamen-test-" + crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, "test.db");

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // Apply migrations...
    return { db, qe: new QueryEngine(db) };
  }
  ```

**Verification Tests (Custom Pattern):**
- No framework required — manual `passed++`/`failed++` counters
- Example from `detail-panel.test.js`:
  ```javascript
  let passed = 0;
  let failed = 0;

  function check(condition, description, pattern) {
    if (condition) {
      console.log(`OK: ${description}`);
      passed++;
    } else {
      console.error(`FAIL: ${description}${pattern ? ` (missing: ${pattern})` : ''}`);
      failed++;
    }
  }

  check(
    src.includes("nodeType === 'infra'"),
    "PANEL-02: infra routing branch exists",
    "nodeType === 'infra'"
  );

  if (failed > 0) {
    process.exit(1);
  }
  ```

---

*Testing analysis: 2026-03-20*
