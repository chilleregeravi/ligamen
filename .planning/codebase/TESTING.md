# Testing Patterns

**Analysis Date:** 2026-03-23

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (since Node 18+)
- No external test runner required (Jest, Vitest, Mocha not used)
- Config: None needed (uses Node.js runtime defaults)

**Assertion Library:**
- `node:assert/strict` module (`import assert from "node:assert/strict"`)
- Provides `assert.equal()`, `assert.strictEqual()`, `assert.ok()`, `assert.throws()`, etc.

**Run Commands:**
```bash
node --test worker/scan/manager.test.js     # Run single test file
node --test                                 # Run all **/*.test.js files (when in proper dir)
npm run test:storage                        # Run storage tests (from package.json)
```

## Test File Organization

**Location:**
- **Co-located pattern:** Test files sit in same directory as source files
- Example: `worker/scan/manager.js` → `worker/scan/manager.test.js`
- Separate test directory for integration: `tests/storage/`, `tests/worker/`, `tests/ui/`

**Naming:**
- File suffix: `.test.js` (not `.spec.js`)
- Descriptive names: `manager.test.js`, `query-engine.test.js`, `http.test.js`
- One test file per module being tested

**Structure:**
```
plugins/ligamen/worker/
├── scan/
│   ├── manager.js
│   ├── manager.test.js          # Tests for manager.js
│   ├── findings.js
│   ├── findings.test.js         # Tests for findings.js
│   └── enrichment/
│       ├── auth-db-extractor.js
│       └── auth-db-extractor.test.js
```

## Test Structure

**Suite Organization:**

Using `node:test` built-in, tests use `test()`, `describe()`, `before()`, `after()`:

```javascript
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("getChangedFiles", () => {
  let repoDir;
  let initialHead;

  before(() => {
    const { dir, head } = makeTempRepo();
    repoDir = dir;
    initialHead = head;
  });

  after(() => {
    cleanupDir(repoDir);
  });

  test("returns empty array when no files changed", () => {
    const result = getChangedFiles(repoDir, initialHead);
    assert.deepStrictEqual(result, []);
  });

  test("returns changed files since commit", () => {
    // ... add file, commit, test ...
    const result = getChangedFiles(repoDir, newHead);
    assert.ok(result.includes("src/new-file.js"));
  });
});
```

**Patterns:**
- Top-level `describe()` for grouping related tests
- Individual `test()` calls for single assertions or small scenarios
- `before()` / `after()` for setup/teardown at suite level
- `beforeEach()` / `afterEach()` for per-test setup

**Test Isolation:**
- Each database test gets fresh temp directory: `mkdtempSync(join(tmpdir(), "ligamen-test-" + uuid))`
- Temp directories cleaned up in `after()`: `rmSync(dir, { recursive: true, force: true })`
- Real git repos created for git-based tests: `execSync("git init")`

## Mocking

**Framework:**
- No mocking library (no Sinon, Jest mocks, etc.)
- Hand-rolled mocks using plain JavaScript objects
- Example from `http.test.js`:
  ```javascript
  const mockQE = {
    getGraph: () => ({ nodes: [{ id: 1, name: "svc-a" }], edges: [] }),
    getImpact: (ep) => ({ affected: [{ id: 1, name: "svc-b" }] }),
    getService: (name) => name === "svc-a" ? { ... } : null,
  };
  ```

**Patterns:**

1. **Simple mock objects** - implement only the methods tested:
   ```javascript
   const mockLogger = {
     log: (level, msg, extra) => { /* record calls */ }
   };
   ```

2. **Mock with call recording** (from `scan-bracket.test.js`):
   ```javascript
   const mockQE = {
     calls: [],  // record all calls
     beginScan(args) {
       this.calls.push({ method: 'beginScan', args });
       return 100;  // return fixed ID for assertions
     }
   };
   ```

3. **Injection via setter functions** (for module-level state):
   ```javascript
   // Source exports injection function
   export function setAgentRunner(fn) { _agentRunner = fn; }

   // Test injects mock
   setAgentRunner(async (prompt, path) => {
     return { /* mock response */ };
   });
   ```

**What to Mock:**
- External service clients (HTTP requests, database connections) → use in-memory databases
- File system operations → use `fs.mkdtempSync()` to create real temp dirs instead of mocking fs
- Time/dates → accepted but not commonly done; let system time pass
- Process calls → use real `execSync()` on temp git repos (integration-style)

**What NOT to Mock:**
- Core business logic (functions being tested)
- SQLite database → use real in-memory DB: `new Database(":memory:")`
- File system for integration tests → use real temp directories
- Git operations → execute real git commands on temp repos

## Fixtures and Factories

**Test Data:**
- Helper functions to create valid test objects:
  ```javascript
  function minimalValid() {
    return {
      service_name: "test-svc",
      confidence: "high",
      services: [...],
      connections: [],
      schemas: [],
    };
  }

  function validConnection(overrides = {}) {
    return {
      source: "svc-a",
      target: "svc-b",
      protocol: "rest",
      method: "GET",
      path: "/health",
      ...overrides,
    };
  }
  ```

**Location:**
- Defined in test files themselves, not in separate fixture files
- Helper functions at top of test file after imports
- Creates data inline for each test

**Database Fixtures:**
- Seeding functions create repos, services, connections:
  ```javascript
  function seedRepo(db) {
    const repoId = db.prepare("INSERT INTO repos (path, name) VALUES (?, ?)").run("/test", "test-repo").lastInsertRowid;
    return repoId;
  }

  function seedService(db, repoId, { name, type = "service" } = {}) {
    return db.prepare("INSERT INTO services (repo_id, name, type) VALUES (?, ?, ?)")
      .run(repoId, name, type).lastInsertRowid;
  }
  ```

## Coverage

**Requirements:**
- No coverage thresholds enforced
- No coverage CI checks detected
- Coverage tool not configured

**View Coverage:**
- Not applicable (no tool configured)
- Manual inspection of test files shows good coverage of:
  - Core scan logic (`manager.test.js`: 1726 lines of tests)
  - Query engine (`query-engine.test.js` and related: 30+ test files)
  - HTTP endpoints (`http.test.js`: 580 lines)
  - MCP queries (`server.test.js`: 646 lines)

## Test Types

**Unit Tests:**
- **Scope:** Individual functions/methods in isolation
- **Approach:** Small inputs, deterministic outputs, fast execution
- **Example:** `test("validateFindings returns valid:false when confidence field is missing", () => { ... })`
- **Location:** Co-located with source (`worker/scan/manager.test.js`)
- **Speed:** Milliseconds per test

**Integration Tests:**
- **Scope:** Multi-module interactions, real databases, real file system
- **Approach:** Create temp git repos, real SQLite DBs, execute full workflows
- **Example:** `getChangedFiles(repoPath, sinceCommit)` tested with real git operations
- **Location:** `tests/storage/`, `tests/worker/` directories
- **Speed:** Seconds per test suite

**E2E Tests:**
- **Framework:** Not used
- **Approach:** No full end-to-end test harness; integration tests serve this purpose
- **Alternative:** CLI tested manually via Bats shell tests in `tests/bats/`

## Common Patterns

**Async Testing:**
- Tests using `async`/`await` for async functions:
  ```javascript
  test("GET /api/logs returns 200 with lines array", async () => {
    const server = await makeServer(mockQE, { dataDir: tmpDir });
    const res = await server.inject({ method: "GET", url: "/api/logs" });
    assert.equal(res.statusCode, 200);
    await server.close();
  });
  ```

**Error Testing:**
- Use `assert.throws()` for synchronous errors:
  ```javascript
  test("throws when required field missing", () => {
    const obj = { /* incomplete */ };
    assert.throws(
      () => validateFindings(obj),
      /field required/i
    );
  });
  ```
- For validation functions returning `{ valid: false, error: "..." }`:
  ```javascript
  test("validateFindings returns valid:false for missing confidence", () => {
    const result = validateFindings(obj);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes("confidence"));
  });
  ```

**Git-based Testing:**
- Real repos created and destroyed for each test:
  ```javascript
  function makeTempRepo() {
    const dir = mkdtempSync(join(tmpdir(), "ligamen-test-"));
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
    execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: "pipe" });
    const head = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    return { dir, head };
  }
  ```

**Database Testing:**
- In-memory SQLite for isolation:
  ```javascript
  function createTestDb() {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // ... create schema ...
    return db;
  }
  ```

**Verification Tests (non-behavioral):**
- Some tests verify code structure (not logic) by reading source files:
  ```javascript
  // worker/ui/modules/state.test.js
  const src = readFileSync(join(__dirname, "state.js"), "utf8");
  check(
    src.includes("isolatedNodeId: null"),
    "state.isolatedNodeId is present with null default",
    "isolatedNodeId: null"
  );
  ```

## Test Data Patterns

**Temporary Git Repos:**
- Created with `mkdtempSync()` and cleaned with `rmSync()`
- Initialized with `git init`, user config, initial commit
- Used to test diff/change detection logic

**Temporary Directories:**
- Log files: `makeTempDataDir(lines)` creates `logs/worker.log` with JSON log entries
- Databases: temp `.db` files in unique directories per test

**Mock Responses:**
- HTTP server mocks: `const mockQE = { getGraph: () => ({ ... }) }`
- Agent output: Fenced JSON blocks: ` ```json\n{ ... }\n``` `

---

*Testing analysis: 2026-03-23*
