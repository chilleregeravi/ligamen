/**
 * Tests for drift tools (Phase 48) — MCP tool implementations
 * Run: node --test worker/mcp/server-drift.test.js
 *
 * Wave 0 scaffold: tests for drift_versions (Plan 01), drift_types (Plan 02),
 * drift_openapi (Plan 03).  Plans 02 and 03 will add their own tests here.
 *
 * These tests exercise the query logic functions directly with an in-memory
 * SQLite database and temporary filesystem repos, bypassing the MCP SDK layer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Named imports from server.js — will fail (RED) until Task 2 adds the export.
import { queryDriftVersions } from "./server.js";

// ─────────────────────────────────────────────────────────────
// Test DB helpers
// ─────────────────────────────────────────────────────────────

/**
 * Create an in-memory SQLite DB with the minimal repos + services schema
 * required by the drift tools.
 */
function createDriftTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      last_commit TEXT,
      scanned_at TEXT
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER REFERENCES repos(id),
      name TEXT NOT NULL,
      root_path TEXT,
      language TEXT
    );
  `);

  return db;
}

/**
 * Create a temporary directory that acts as a fake repo root.
 * Writes any provided manifest files into the directory.
 *
 * @param {string} name - Short label (used in directory path for debug clarity)
 * @param {Record<string, string | object>} manifestFiles - filename → content map.
 *   String content is written as-is; objects are JSON.stringify'd.
 * @returns {{ repoPath: string, cleanup: () => void }}
 */
function createTempRepo(name, manifestFiles = {}) {
  const repoPath = path.join(
    os.tmpdir(),
    `ligamen-test-${name}-${Date.now()}`,
  );
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [filename, content] of Object.entries(manifestFiles)) {
    fs.writeFileSync(
      path.join(repoPath, filename),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return { repoPath, cleanup: () => fs.rmSync(repoPath, { recursive: true, force: true }) };
}

// ─────────────────────────────────────────────────────────────
// queryDriftVersions — Plan 01 tests
// ─────────────────────────────────────────────────────────────

test("queryDriftVersions: null db returns empty findings and repos_scanned=0", async () => {
  const result = await queryDriftVersions(null, {});
  assert.deepEqual(result, { findings: [], repos_scanned: 0 });
});

test("queryDriftVersions: CRITICAL finding when same package has different exact versions", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("react-old", {
    "package.json": { dependencies: { react: "17.0.0" } },
  });
  const repo2 = createTempRepo("react-new", {
    "package.json": { dependencies: { react: "18.0.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-old", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-new", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  assert.ok(Array.isArray(result.findings), "findings should be array");
  const reactFinding = result.findings.find((f) => f.item === "react");
  assert.ok(reactFinding, "should have a finding for react");
  assert.equal(reactFinding.level, "CRITICAL", `expected CRITICAL, got ${reactFinding.level}`);
  assert.ok(Array.isArray(reactFinding.repos), "repos should be array");
  assert.ok(reactFinding.repos.includes("repo-old"), "repos should include repo-old");
  assert.ok(reactFinding.repos.includes("repo-new"), "repos should include repo-new");
  assert.ok(typeof reactFinding.detail === "string", "detail should be string");
});

test("queryDriftVersions: WARN finding when same package has different range specifiers (^18 vs ~18)", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("range-caret", {
    "package.json": { dependencies: { react: "^18.0.0" } },
  });
  const repo2 = createTempRepo("range-tilde", {
    "package.json": { dependencies: { react: "~18.0.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-caret", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-tilde", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  const reactFinding = result.findings.find((f) => f.item === "react");
  assert.ok(reactFinding, "should have a finding for react");
  assert.equal(reactFinding.level, "WARN", `expected WARN, got ${reactFinding.level}`);
});

test("queryDriftVersions: INFO finding when same package has identical exact versions", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("same-a", {
    "package.json": { dependencies: { lodash: "4.17.21" } },
  });
  const repo2 = createTempRepo("same-b", {
    "package.json": { dependencies: { lodash: "4.17.21" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-a", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-b", null, null, null,
  );

  // With default severity=WARN, INFO findings are suppressed.
  // Use severity="all" (or severity="INFO") to see INFO entries.
  const result = await queryDriftVersions(db, { severity: "all" });
  const lodashFinding = result.findings.find((f) => f.item === "lodash");
  assert.ok(lodashFinding, "should have an INFO finding for lodash when severity=all");
  assert.equal(lodashFinding.level, "INFO", `expected INFO, got ${lodashFinding?.level}`);
});

test("queryDriftVersions: repos_scanned equals number of repos whose paths exist on disk", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("scan-count", {
    "package.json": { dependencies: { express: "4.18.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    db.close();
  });

  // Insert one real path and one non-existent path.
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "real-repo", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, "/nonexistent/path/xyz-12345", "ghost-repo", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  // Only the real repo path exists on disk.
  assert.equal(result.repos_scanned, 1, `expected repos_scanned=1, got ${result.repos_scanned}`);
});

test("queryDriftVersions: severity=CRITICAL suppresses WARN findings", async (t) => {
  const db = createDriftTestDb();

  // Two repos: one CRITICAL mismatch (react) and one WARN (lodash range specifiers).
  const repo1 = createTempRepo("severity-a", {
    "package.json": {
      dependencies: {
        react: "17.0.0",   // CRITICAL: version mismatch with repo2
        lodash: "^4.17.21", // WARN: different range specifier from repo2
      },
    },
  });
  const repo2 = createTempRepo("severity-b", {
    "package.json": {
      dependencies: {
        react: "18.0.0",
        lodash: "~4.17.21",
      },
    },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "sev-repo-a", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "sev-repo-b", null, null, null,
  );

  const result = await queryDriftVersions(db, { severity: "CRITICAL" });
  const levels = result.findings.map((f) => f.level);
  assert.ok(levels.includes("CRITICAL"), "should include CRITICAL finding");
  assert.ok(!levels.includes("WARN"), "should not include WARN when severity=CRITICAL");
  assert.ok(!levels.includes("INFO"), "should not include INFO when severity=CRITICAL");
});

test("queryDriftVersions: repos with no manifest files produce no findings for that repo", async (t) => {
  const db = createDriftTestDb();

  // repo1 has a manifest, repo2 is an empty dir (no package.json / go.mod / Cargo.toml).
  const repo1 = createTempRepo("with-manifest", {
    "package.json": { dependencies: { axios: "1.0.0" } },
  });
  const repo2 = createTempRepo("no-manifest", {}); // Empty directory.
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "with-manifest-repo", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "no-manifest-repo", null, null, null,
  );

  const result = await queryDriftVersions(db, { severity: "all" });
  // axios only appears in one repo — no drift finding expected.
  const axiosFinding = result.findings.find((f) => f.item === "axios");
  assert.equal(axiosFinding, undefined, "should not have a finding for a package in only one repo");
  // Both repos were scanned (paths exist on disk).
  assert.equal(result.repos_scanned, 2);
});
