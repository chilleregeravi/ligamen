# Testing Patterns

**Analysis Date:** 2026-03-31

## Test Frameworks

**Two test systems are used:**

| System | Language | Location | Purpose |
|--------|----------|----------|---------|
| **Bats** (Bash Automated Testing System) | Bash | `tests/*.bats`, `tests/integration/*.bats` | Shell script hook testing |
| **Node.js built-in `node:test`** | JavaScript | `plugins/ligamen/worker/**/*.test.js`, `tests/storage/*.test.js`, `tests/worker/*.test.js`, `tests/ui/*.test.js` | Worker/DB/MCP/UI logic testing |

### Bats

- **Runner:** `tests/bats/bin/bats` (vendored in-repo)
- **Assertion helpers:** `tests/test_helper/bats-support/` and `tests/test_helper/bats-assert/` (vendored)
- **Run command:** `make test` (runs `$(BATS) tests/*.bats`)
- **Test helper:** `tests/test_helper.bash` loads bats-support and bats-assert

### Node.js `node:test`

- **Runner:** `node --test <file>` (Node.js 18+ built-in test runner)
- **Assertion library:** `node:assert/strict` (`assert.equal()`, `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.ok()`, `assert.throws()`, `assert.rejects()`, `assert.doesNotReject()`)
- **No external test runner** (Jest, Vitest, Mocha not used)
- **Config:** None needed

**Run Commands:**
```bash
make test                                          # Run all Bats tests
node --test tests/storage/query-engine.test.js     # Run single JS test file
node --test tests/storage/*.test.js                # Run all storage tests
node --test plugins/ligamen/worker/**/*.test.js    # Run all co-located worker tests
npm run test:storage                               # Package.json shortcut (from plugins/ligamen/)
```

## Test File Organization

**Two placement strategies coexist:**

### Co-located Tests (worker modules)
Test files sit next to the source they test:
```
plugins/ligamen/worker/
├── db/
│   ├── database.js
│   ├── database.test.js           # Tests for database.js
│   ├── query-engine.js
│   ├── query-engine-enrich.test.js # Tests for enrichment functions
│   ├── pool-repo.test.js          # Tests for pool repo management
│   ├── migration-004.test.js      # Tests for specific migration
│   ├── migration-008.test.js
│   └── snapshot.test.js
├── mcp/
│   ├── server.js
│   └── server-search.test.js      # Tests for MCP search/scan tools
├── scan/
│   ├── discovery.js
│   └── discovery.test.js          # Tests for repo discovery
├── server/
│   ├── chroma.js
│   └── chroma.test.js             # Tests for ChromaDB integration
└── ui/modules/
    ├── interactions.js
    ├── interactions.test.js
    ├── layout.js
    ├── layout.test.js
    ├── renderer.js
    └── renderer.test.js
```

### Separate Test Directory (integration, storage, cross-module)
```
tests/
├── *.bats                         # Shell hook tests (format, lint, guard, etc.)
├── integration/
│   └── impact-flow.bats           # E2E scan-to-query flow
├── storage/
│   ├── api-surface.test.js        # getGraph() exposes attachment
│   ├── migration-007.test.js      # Migration-specific tests
│   ├── query-engine.test.js       # Core QueryEngine behavior
│   ├── query-engine-upsert.test.js
│   └── scan-version-bracket.test.js
├── worker/
│   └── scan-bracket.test.js       # beginScan/endScan bracket wiring
├── ui/
│   ├── graph-actor-dedup.test.js
│   ├── graph-exposes.test.js
│   ├── graph-fit-to-screen.test.js
│   ├── graph-hidpi.test.js
│   └── renderer-hidpi.test.js
├── fixtures/                      # Shared test fixtures
│   ├── config/                    # Config loading test data
│   └── drift/                     # Drift detection test data
├── helpers/                       # Shared test utilities
├── test_helper.bash               # Bats helper loader
└── test_helper/                   # Vendored bats-support, bats-assert
```

**Naming:**
- JavaScript tests: `.test.js` suffix (never `.spec.js`)
- Bats tests: `.bats` suffix
- One test file per module or per feature area

## Test Structure

### JavaScript Tests (node:test)

**Suite organization using `describe()` and `test()`:**
```javascript
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("enrichImpactResult()", () => {
  let db;
  let tmpDir;

  before(() => {
    db = buildDb({ withActors: false });
    const repoId = seedRepo(db);
    seedService(db, repoId, { name: "payments-api", type: "service" });
    tmpDir = mkdtempSync(join(tmpdir(), "ligamen-enrich-test-"));
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns object with results and summary keys", () => {
    const results = [{ service: "billing-service", protocol: "rest", depth: 1 }];
    const out = enrichImpactResult(db, "payments-api", results);
    assert.ok("results" in out, "must have results key");
    assert.ok("summary" in out, "must have summary key");
  });
});
```

**Flat test style (no describe nesting):**
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("loadFromConfig returns [] when ligamen.config.json is missing", () => {
  const projectRoot = makeTempDir();
  try {
    const result = loadFromConfig(projectRoot);
    assert.deepEqual(result, []);
  } finally {
    cleanup(projectRoot);
  }
});
```

### Bats Tests

**Suite structure with setup/teardown:**
```bash
#!/usr/bin/env bats
# tests/config.bats -- Ligamen configuration layer tests
# Covers: CONF-01 (config loading), CONF-02 (disable toggles)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/tests/fixtures/config"
LIB_CONFIG="$REPO_ROOT/plugins/ligamen/lib/config.sh"

setup() {
  unset _LIGAMEN_CONFIG_LOADED
  unset LIGAMEN_CONFIG_FILE
  ORIG_DIR="$PWD"
}

teardown() {
  cd "$ORIG_DIR"
  unset _LIGAMEN_CONFIG_LOADED
}

@test "config.sh loads siblings from ligamen.config.json" {
  cd "$FIXTURE_DIR"
  source "$LIB_CONFIG"
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq 3 ]
}
```

**Stub-based testing for external tools:**
```bash
@test "format hook - runs ruff format for .py file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/ruff_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local testfile="${STUB_DIR}/test.py"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/ruff_called" ]
}
```

## Mocking

**Framework:** No mocking library (no Sinon, Jest mocks, etc.). Hand-rolled mocks using plain JavaScript objects.

**Pattern 1: Simple mock objects** -- implement only methods under test:
```javascript
const mockQE = {
  getGraph: () => ({ nodes: [{ id: 1, name: "svc-a" }], edges: [] }),
  getImpact: (ep) => ({ affected: [{ id: 1, name: "svc-b" }] }),
  getService: (name) => name === "svc-a" ? { /* ... */ } : null,
};
```

**Pattern 2: Call-recording mocks** (from `tests/worker/scan-bracket.test.js`):
```javascript
function makeMockQE({ repoState = null, scanVersionId = 100 } = {}) {
  const calls = [];
  return {
    calls,
    upsertRepo: (repoData) => {
      calls.push({ method: "upsertRepo", args: [repoData] });
      return { id: 42 };
    },
    beginScan: (repoId) => {
      calls.push({ method: "beginScan", args: [repoId] });
      return scanVersionId;
    },
  };
}
```

**Pattern 3: Dependency injection via setter functions:**
```javascript
// Source exports injection function
export function setAgentRunner(fn) { _agentRunner = fn; }

// Test injects mock
setAgentRunner(async (prompt, path) => {
  return { /* mock response */ };
});
```

**Pattern 4: Mock ChromaDB client injection** (from `plugins/ligamen/worker/server/chroma.test.js`):
```javascript
const mockCollection = {
  upsert: async (args) => { upsertCalledWith = args; },
  query: async () => ({
    ids: [[]], documents: [[]], distances: [[]], metadatas: [[]],
  }),
};
const mockClient = {
  heartbeat: async () => ({ nanosecondHeartbeat: 1000 }),
  getOrCreateCollection: async () => mockCollection,
};
const result = await initChromaSync(settings, mockClient);
```

**Pattern 5: Test-only state reset:**
```javascript
// Source exports reset function
export function _resetForTest() { /* reset module state */ }

// Test uses in beforeEach
beforeEach(() => { _resetForTest(); });
```

**What to Mock:**
- External service clients (ChromaDB, HTTP endpoints)
- Agent runner functions (scan orchestration)
- Time-dependent behavior (rarely needed)

**What NOT to Mock (use real implementations):**
- SQLite databases -- use `new Database(":memory:")` or temp file DBs
- File system -- use `fs.mkdtempSync()` for real temp directories
- Git operations -- execute real `git` commands on temp repos
- Core business logic under test

## Fixtures and Factories

**Database Factory Functions:**
```javascript
function makeQE() {
  const dir = path.join(os.tmpdir(), "ligamen-test-" + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Run migrations...
  const qe = new QueryEngine(db);
  return { db, qe };
}
```

**Seed Helpers:**
```javascript
function seedRepo(db) {
  return db.prepare("INSERT INTO repos (path, name, type) VALUES (?,?,?)")
    .run("/tmp/test", "test-repo", "single").lastInsertRowid;
}

function seedService(db, repoId, { name, type = "service" } = {}) {
  return db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language, type) VALUES (?,?,?,?,?)"
  ).run(repoId, name, ".", "typescript", type).lastInsertRowid;
}
```

**Temp Directory Helpers:**
```javascript
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
```

**Git Repo Factory:**
```javascript
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ligamen-bracket-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "index.js"), "module.exports = {}");
  execSync("git add index.js", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
  return dir;
}
```

**Location:** All fixtures/factories are defined inline in test files, not in separate fixture modules.

## Coverage

**Requirements:** No coverage thresholds enforced. No coverage CI checks.

**Coverage tool:** Not configured. No `c8`, `istanbul`, or built-in Node.js `--experimental-test-coverage` usage detected.

**Approximate test scope (by line count, ~18,800 total test lines):**
- Core query engine and storage: `tests/storage/*.test.js`
- Worker scan logic: `tests/worker/*.test.js`
- Database modules: `plugins/ligamen/worker/db/*.test.js`
- MCP server: `plugins/ligamen/worker/mcp/server-search.test.js`
- UI modules: `plugins/ligamen/worker/ui/modules/*.test.js`, `tests/ui/*.test.js`
- ChromaDB integration: `plugins/ligamen/worker/server/chroma.test.js`
- Discovery: `plugins/ligamen/worker/scan/discovery.test.js`
- Shell hooks: `tests/*.bats` (format, lint, guard, config, detect, etc.)
- Integration: `tests/integration/impact-flow.bats`

## Test Types

### Unit Tests (JavaScript)
- **Scope:** Individual functions/methods in isolation
- **Approach:** Small inputs, deterministic outputs, fast execution
- **Location:** Co-located with source (`worker/**/*.test.js`)
- **Speed:** Milliseconds per test
- **Example:** `test("enrichImpactResult returns object with results and summary keys", () => { ... })`

### Integration Tests (JavaScript)
- **Scope:** Multi-module interactions with real databases and file systems
- **Approach:** Create temp git repos, real SQLite DBs, execute full workflows
- **Location:** `tests/storage/`, `tests/worker/`, `tests/integration/`
- **Speed:** Seconds per test suite
- **Example:** Full scan-to-query flow in `tests/integration/impact-flow.bats`

### Shell Hook Tests (Bats)
- **Scope:** Individual hook scripts (format.sh, lint.sh, file-guard.sh)
- **Approach:** Stub external tools via PATH manipulation, pipe JSON input, assert exit codes and output
- **Location:** `tests/*.bats`
- **Speed:** Milliseconds per test
- **Key test categories:**
  - Non-blocking guarantee (hooks exit 0 even when tools fail)
  - Per-language tool invocation (correct formatter/linter called)
  - Silent success (no stdout on clean run)
  - Generated directory skipping (node_modules, .venv, target)
  - Configuration toggle tests (LIGAMEN_DISABLE_*, LIGAMEN_LINT_THROTTLE)

### Source Analysis Tests (verification)
- **Scope:** Verify code structure by reading source files (not executing them)
- **Approach:** Read source as text, check for required patterns
- **Location:** `plugins/ligamen/worker/ui/modules/renderer.test.js`, `tests/ui/graph-*.test.js`
- **Pattern:**
  ```javascript
  const src = readFileSync(join(__dirname, "renderer.js"), "utf8");
  check(
    src.includes("boundaryBoxes"),
    "LAYOUT-05 -- boundary box rendering present",
    "boundaryBoxes"
  );
  ```
- **Use case:** Verifying UI rendering code contains expected canvas API calls, state properties, filter logic

## Common Testing Patterns

### Async Testing
```javascript
test("querySearch: FTS5 query returns matching rows", async () => {
  const db = createTestDb({ withFts: true });
  const result = await querySearch(db, { query: "payments", limit: 20 });
  db.close();
  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length >= 1);
  assert.equal(result.search_mode, "fts5");
});
```

### Error Testing
```javascript
test("chromaSearch throws Error when chromaAvailable=false", async () => {
  await assert.rejects(
    async () => chromaSearch("test", 10),
    /ChromaDB not available/,
  );
});

test("never rejects even when collection.upsert throws", async () => {
  await assert.doesNotReject(async () => {
    await syncFindings({ services: [{ name: "svc-a", endpoints: [] }] });
  }, "syncFindings must not rethrow even when upsert fails");
});
```

### Database Testing
```javascript
function createTestDb({ withFts = true } = {}) {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE repos (...)`);
  if (withFts) {
    db.exec(`CREATE VIRTUAL TABLE connections_fts USING fts5(...)`);
  }
  // Seed initial data...
  return db;
}
```

### Graceful Degradation Testing
Tests verify behavior when optional features/tables are absent:
```javascript
it("returns exposes: [] for all nodes when migration 007 has not run", () => {
  const { db, qe } = makeQEWithout007();  // DB missing latest migration
  const graph = qe.getGraph();
  assert.ok(Array.isArray(svc.exposes));   // Still works, returns empty
  assert.strictEqual(svc.exposes.length, 0);
});

test("does not throw when actors table is absent", () => {
  const dbNoActors = buildDb({ withActors: false });
  // ...function still works, returns empty results
});
```

### Bats Stub Testing
External tools are stubbed by creating shell scripts in a temp directory and prepending to PATH:
```bash
setup() {
  STUB_DIR="$(mktemp -d)"
  SCRIPT="${BATS_TEST_DIRNAME}/../plugins/ligamen/scripts/format.sh"
}

@test "format hook - runs ruff format for .py file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/ruff_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/ruff_called" ]
}
```

## When Writing New Tests

**For a new JavaScript module:**
1. Create `{module-name}.test.js` in the same directory as the source
2. Use `node:test` and `node:assert/strict`
3. Follow the describe/test/before/after pattern shown above
4. Use real in-memory SQLite if DB is needed
5. Clean up temp files in `after()` blocks
6. Include a header comment listing requirement IDs covered

**For a new shell hook:**
1. Create `tests/{hook-name}.bats`
2. Load bats-support and bats-assert in setup
3. Test non-blocking guarantee (exit 0 even when tools fail)
4. Test per-language tool dispatch
5. Use stub scripts in temp directory with PATH manipulation

**For a new migration:**
1. Create `tests/storage/migration-NNN.test.js` or co-locate as `worker/db/migration-NNN.test.js`
2. Apply only the relevant migration chain
3. Test both "migration applied" and "graceful degradation without migration" scenarios

## CI/CD Testing

**CI Pipeline:** Not configured. No `.github/workflows/` directory in the project root (only in vendored dependencies).

**Manual testing workflow:**
- `make test` -- runs all Bats shell tests
- `make lint` -- runs shellcheck on all scripts
- `make check` -- validates JSON config files
- `node --test <file>` -- runs individual JavaScript test files

---

*Testing analysis: 2026-03-31*
