# Pitfalls Research

**Domain:** SQLite-backed service dependency graph — adding idempotent upserts, cross-repo service identity merging, scan versioning, and cross-project MCP queries to an existing live system
**Researched:** 2026-03-16
**Confidence:** HIGH (SQLite official docs confirmed; codebase inspected; better-sqlite3 GitHub issues cross-referenced; Dexter's Log foreign key cascade post verified)

---

## Critical Pitfalls

### Pitfall 1: INSERT OR REPLACE Silently Deletes All Child Rows (Connections, Endpoints, Schemas, Fields)

**What goes wrong:**
`INSERT OR REPLACE` is not an update — it is a delete-then-reinsert. When the services table has a row with `(repo_id=1, name="auth-service")` and you INSERT OR REPLACE a new row for the same service, SQLite deletes the old row first, reassigns a new `id`, then inserts the fresh row. Every row in `connections`, `exposed_endpoints`, `schemas`, and `fields` that referenced the old `services.id` is cascade-deleted (because `foreign_keys = ON` is set in `database.js`). The service appears in the graph with the right name but zero connections and zero endpoints — silently, with no error.

**Why it happens:**
The current `_stmtUpsertService` in `query-engine.js` uses `INSERT OR REPLACE INTO services`. This was written before scan deduplication was a requirement. Without a UNIQUE constraint on `(repo_id, name)`, REPLACE never fires its conflict path — but as soon as migration 004 adds that UNIQUE constraint, every re-scan triggers the delete-then-reinsert path and wipes the connection graph for each re-scanned service.

**How to avoid:**
Replace `INSERT OR REPLACE` with `INSERT ... ON CONFLICT(repo_id, name) DO UPDATE SET root_path=excluded.root_path, language=excluded.language, type=excluded.type`. This performs an in-place update that preserves the existing `id` and leaves all child rows intact.

```sql
INSERT INTO services (repo_id, name, root_path, language, type)
VALUES (@repo_id, @name, @root_path, @language, @type)
ON CONFLICT(repo_id, name) DO UPDATE SET
  root_path = excluded.root_path,
  language  = excluded.language,
  type      = excluded.type
```

Apply the same change to `repos` (upsert by `path`) and `repo_state` (upsert by `repo_id`) — both already use `INSERT OR REPLACE` and have the same latent risk.

**Warning signs:**
- After a re-scan, the graph shows service nodes but no edges
- `exposed_endpoints` table is empty after the second scan of any repo
- `connections` count drops to zero immediately after `writeScan()` completes

**Phase to address:**
Schema migration phase (add UNIQUE constraint) must be paired atomically with the upsert syntax rewrite. If the UNIQUE constraint is added first (migration) before the upsert statements are rewritten (code), the first re-scan after deploying migration 004 will cascade-delete everything. Both changes must ship together.

---

### Pitfall 2: Adding UNIQUE Constraint to `services` Table Fails if Duplicate Rows Already Exist

**What goes wrong:**
The current `services` table has no UNIQUE constraint on `(repo_id, name)`. Every re-scan appends new rows for the same service rather than updating existing ones. Production databases already contain multiple rows for the same `(repo_id, name)` pair — this is the bug that v2.2 is fixing. When migration 004 tries to create a new `services` table with `UNIQUE(repo_id, name)` and copies the old data into it (SQLite's required pattern for adding constraints), the `INSERT INTO new_services SELECT * FROM old_services` statement fails with `UNIQUE constraint failed` on the first duplicate it encounters. The migration transaction rolls back and the schema stays at version 3 forever.

**Why it happens:**
SQLite cannot add constraints with `ALTER TABLE` — it requires the rename-create-copy-drop pattern. The copy step runs an unconstrained INSERT that fails if the source table contains duplicates. The migration author assumes the table is clean, but the whole reason for this migration is that it is not clean.

**How to avoid:**
The copy step must deduplicate before inserting. Use a `GROUP BY` with `MAX(id)` to keep only the most recent row per `(repo_id, name)` pair:

```sql
INSERT INTO services_new (id, repo_id, name, root_path, language, type)
SELECT MAX(id), repo_id, name, root_path, language, type
FROM services_old
GROUP BY repo_id, name;
```

Then migrate `connections`, `schemas`, and `fields` to re-point to the surviving `MAX(id)` rows. Rows referencing a deleted duplicate `id` must be updated to reference the surviving `id`, or deleted if their source and target both resolve to the same surviving service.

**Warning signs:**
- Migration 004 fails with `SQLITE_CONSTRAINT_UNIQUE` on first run against a real database
- Worker fails to start because `runMigrations()` throws and `_db` is never set
- Schema version stays at 3 after worker restart attempts

**Phase to address:**
Migration 004 implementation phase. Write the migration against a database that already has duplicates — not against a fresh test database. Add an integration test that seeds duplicates before running migration 004.

---

### Pitfall 3: FTS5 Index Desynchronization After `INSERT OR REPLACE` Reassigns Row IDs

**What goes wrong:**
The `services_fts` table is a content-mode FTS5 table backed by `services.rowid`. When `INSERT OR REPLACE` deletes the old service row (old `id` = 42) and inserts a new one (new `id` = 99), the `services_ad` trigger fires on delete (removes rowid 42 from the FTS index) and `services_ai` fires on insert (adds rowid 99). This is correct. However, `services_fts MATCH 'auth-service'` now returns rowid 99, which maps to the newly created service row. Any stale FTS results cached by the `search()` function that reference the old rowid 42 will return no rows from the backing table — FTS5 says the service exists but the joined query returns nothing. More seriously: after the duplicate-elimination migration, some rowids change en masse. The FTS index is not rebuilt. All FTS searches silently return stale or empty results until the index is rebuilt with `INSERT INTO services_fts(services_fts) VALUES('rebuild')`.

**Why it happens:**
FTS5 content tables maintain their own shadow index. They synchronize through triggers on INSERT/UPDATE/DELETE. When rows are deleted and reinserted with new IDs (by REPLACE or by migration), the trigger chain fires correctly for individual upserts but the FTS index can diverge if a bulk operation bypasses triggers (e.g., a direct `INSERT INTO services_new SELECT ... FROM services_old` inside a migration — this goes directly to the new table's triggers, but the old FTS table still has the old rowids).

**How to avoid:**
After any migration that rebuilds the `services` table (the rename-create-copy-drop pattern), explicitly rebuild all FTS5 indexes as the final step of the same migration transaction:

```sql
INSERT INTO services_fts(services_fts) VALUES('rebuild');
INSERT INTO connections_fts(connections_fts) VALUES('rebuild');
INSERT INTO fields_fts(fields_fts) VALUES('rebuild');
```

This is a full O(N) rebuild but runs only once per migration and is safe in a transaction.

**Warning signs:**
- FTS5 search returns service names but the JOIN to `services` returns no rows
- `search()` function returns results with IDs that no longer exist in the `services` table
- FTS results are a subset of actual services, missing recently re-scanned ones

**Phase to address:**
Migration 004 implementation phase. Add the FTS rebuild as the last step of the migration, inside the same transaction.

---

### Pitfall 4: Cross-Repo Service Identity Merging Creates False Edges by Name Collision

**What goes wrong:**
The v2.2 goal is to merge services with the same name across repos into one graph node. The `_resolveServiceId(name)` function in `query-engine.js` already does unscoped name lookup: `SELECT id FROM services WHERE name = ?`. If two repos each have a service named `worker` (a common generic name), the first scan creates `services(id=1, repo_id=1, name='worker')`. The second scan resolves `worker` to `id=1` and writes connections from repo 2's `worker` to repo 1's `worker`. The graph shows a self-referencing node. Impact queries traverse these phantom edges and report the wrong services as "affected." The user sees false positives on every `allclear:cross-impact` run.

**Why it happens:**
Service names are not globally unique across independent repos. `worker`, `server`, `api`, `gateway`, `proxy`, `scheduler` are common across any team's portfolio. Name-only resolution assumes names are globally canonical — this is only safe when the team has enforced a naming convention across repos, which most teams have not.

**How to avoid:**
The identity merging strategy must be explicit, not implicit. Two options:

1. **Agent-enforced canonical names**: The scan agent prompt instructs the agent to use the service's published name (from package.json, Cargo.toml, go.mod, etc.) not its folder name. Validation in `validateFindings()` rejects names that are too generic (block-list: `server`, `worker`, `api`, `app`, `main`).

2. **Explicit cross-repo link table**: Add a `service_aliases` table that maps `(repo_id, local_name) → canonical_service_id`. Merging is only applied when an alias mapping exists. Default: no merging — services in different repos are always distinct nodes unless explicitly aliased.

Option 2 is safer. Option 1 requires perfect agent compliance and has no enforcement fallback.

**Warning signs:**
- Impact graph shows a service connecting to itself (self-loop edge)
- `/allclear:cross-impact` reports services in unrelated repos as affected
- Two repos each have a node named `api` but only one appears in the graph (the other was merged into it)

**Phase to address:**
Cross-repo identity merging phase. This is the highest-risk feature in v2.2. Start with option 1 (canonical names + block-list validation) as the MVP, not option 2, to avoid the complexity of the alias table. Block generic names at validation time before any merge logic runs.

---

### Pitfall 5: MCP Server Resolves DB Path from `process.cwd()` — Wrong DB When Invoked from Any Repo

**What goes wrong:**
The MCP server in `worker/mcp/server.js` calls `resolveDbPath(process.env.ALLCLEAR_PROJECT_ROOT || process.cwd())`. When Claude Code invokes the MCP server, `process.cwd()` is the directory Claude Code was launched from, not the repo being queried. If the user opens Claude Code in `~/sources/frontend` and asks `allclear_impact` about a service in `~/sources/backend`, the MCP server opens `~/.allclear/projects/<hash-of-frontend>/impact-map.db` — a different database than the one the `backend` worker populated. The tool returns empty results with no error.

**Why it happens:**
The MCP server is a separate process from the worker. It doesn't know which worker is running or which project the agent is currently working in. `process.cwd()` reflects the shell working directory at MCP server startup, not the project being analyzed.

**How to avoid:**
The MCP tools must accept a `projectRoot` parameter and pass it to `resolveDbPath()`. When the agent calls `allclear_impact({ service: "auth-service", projectRoot: "/Users/me/sources/backend" })`, the tool opens the correct per-project DB. The `projectRoot` parameter should be optional (falls back to `ALLCLEAR_PROJECT_ROOT` env var, then `process.cwd()`) so existing single-project usage is unaffected. Validate the resolved path: if the DB file does not exist at the resolved location, return a structured error `{ error: "no_scan_data", hint: "Run /allclear:map first" }` rather than silently returning empty results.

**Warning signs:**
- MCP tool returns `{ results: [] }` for a service that definitely exists in the graph
- Running `allclear_impact` from a different terminal directory changes the results
- Two repos with different services appear to share the same MCP query result set

**Phase to address:**
Cross-project MCP queries phase. All five MCP tool handlers must be updated to accept `projectRoot`. Add an integration test that opens two different project DBs and verifies each tool queries the correct one.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep `INSERT OR REPLACE` for services without adding UNIQUE constraint | No migration needed | Next re-scan appends duplicates forever; graph dedup stays as `MAX(id) GROUP BY name` workaround | Never — the workaround is in `getGraph()` and is already noted as tech debt (SCAN-01..04) |
| Add UNIQUE constraint migration without deduplicating first | Simpler migration SQL | Migration fails on any real database with existing scans; worker refuses to start | Never — dedup must precede constraint |
| Name-only service identity merging without block-list | Simpler merge code | False edges from generic names (`worker`, `api`, `server`) corrupt the graph | Never without block-list; never for unrecognized names |
| Skip `projectRoot` parameter on MCP tools | No API change needed | All MCP queries silently query wrong DB in multi-repo setups | Never — defeats the entire purpose of cross-project queries |
| Skip FTS rebuild after migration | Faster migration | FTS search returns stale or wrong rowids until next full re-scan | Never — FTS rebuild is O(rows) not O(DB size); cheap |
| Snapshot files without size cap | Simpler code | Unbounded disk growth; 100 scans × 5 MB snapshot = 500 MB in `~/.allclear` | Acceptable only during early testing; add retention before shipping |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `INSERT OR REPLACE` + `foreign_keys = ON` | Assuming REPLACE is a safe UPDATE synonym | REPLACE deletes and reinserts, firing ON DELETE CASCADE on all child tables; use `ON CONFLICT DO UPDATE` to update in-place |
| FTS5 content table + table rebuild migration | Skipping FTS rebuild after rename-create-copy-drop | After migration, call `INSERT INTO services_fts(services_fts) VALUES('rebuild')` to resync the shadow index |
| `ON CONFLICT DO UPDATE` + `excluded.` alias | Referencing column without `excluded.` prefix | In `DO UPDATE SET name = name` the right-hand `name` refers to the existing row value, not the proposed new value; use `excluded.name` for the incoming value |
| `ON CONFLICT(col)` + no UNIQUE index on that column | Upsert clause silently ignored | SQLite requires a UNIQUE index on the conflict-target columns for `ON CONFLICT(col)` to activate; without the index, every row is treated as a fresh insert |
| VACUUM INTO snapshot + WAL mode | Using `cp` to copy the DB file | `cp` copies the WAL sidecar, which may be in mid-transaction; `VACUUM INTO` creates a clean, consistent copy without WAL sidecars |
| Cross-project MCP + `ALLCLEAR_PROJECT_ROOT` env | Setting env variable once at server start | MCP server is a long-running process; env var is fixed at startup; per-call `projectRoot` parameter is the correct mechanism for per-request DB routing |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Snapshot retention not enforced | `~/.allclear/projects/` grows unbounded; disk full errors | Enforce `history-limit` from `allclear.config.json` on every `createSnapshot()` call (already coded in `database.js`, verify it is called after every scan) | After ~20 scans of a medium-size repo (5 MB snapshot × 20 = 100 MB per project) |
| FTS5 `'rebuild'` called inside a large transaction | Rebuild holds a write lock for the duration; other reads block | Run FTS rebuild as its own transaction after the migration transaction commits, not nested inside it | When DB has > 10,000 service rows (uncommon at current scale) |
| `getGraph()` with `MAX(id) GROUP BY name` workaround | Graph query slows as duplicate rows accumulate (O(N²) GROUP BY on unindexed `name`) | Fixing the upsert (Pitfall 1) eliminates duplicates; workaround becomes unnecessary and should be removed post-migration | After 10+ re-scans of a large repo without the upsert fix |
| Storing scan history in `map_versions` with `snapshot_path` pointing to a deleted file | `getVersions()` returns rows whose snapshot files were manually deleted; history UI shows dead links | On each `createSnapshot()` call, verify file exists before recording; or accept orphan rows and handle missing files gracefully in the UI | First time a developer manually clears `~/.allclear` to free disk space |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| MCP `projectRoot` parameter passed directly to `resolveDbPath()` without validation | Path traversal: attacker-controlled `projectRoot = "../../etc"` causes DB open attempt on arbitrary path | Validate `projectRoot` is an absolute path under a set of allowed roots (e.g., parent directory of `ALLCLEAR_DATA_DIR`, or must be an existing directory on disk); reject any path containing `..` segments |
| MCP server opens DB in read-write mode for cross-project queries | Agent tools that are supposed to be read-only can modify another project's scan data | MCP server already uses `readonly: true` — preserve this; never open the cross-project DB with write access from MCP tools |
| `ALLCLEAR_PROJECT_ROOT` env var accepted without sanitization | Env injection from a crafted `.env` file in a scanned repo could redirect MCP queries | Document that `ALLCLEAR_PROJECT_ROOT` is trusted input; scan workers should never read `.env` files from scanned repos into the current process environment |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Re-scan shows "scan complete" but graph is empty due to cascade delete (Pitfall 1) | User assumes the scan found no services; re-scans repeatedly, worsening the situation | Write a post-scan integrity check: after `writeScan()`, query `SELECT COUNT(*) FROM connections` and warn if it drops to zero after previously being non-zero |
| Migration fails silently and worker falls back to old schema | User runs `/allclear:map`, gets old duplicate-filled graph, assumes the fix didn't work | `runMigrations()` already wraps each migration in a transaction; on failure, log the migration error to the shared logger with `component: 'db'` and surface it in the log terminal |
| Cross-project MCP returns empty results with no indication of why | Agent concludes the service doesn't exist or has no dependencies | Structured error response: `{ error: "no_scan_data", projectRoot: "...", hint: "Run /allclear:map in that project first" }` |
| Scan version history shows timestamps but no label | User can't distinguish a post-refactor scan from a pre-refactor scan | Auto-label each version with the git commit short hash and the number of services found: `"abc1234 — 12 services"` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Upsert preserves child rows:** After re-scanning a repo, verify `SELECT COUNT(*) FROM connections` is non-zero and matches the pre-scan count (not reset to zero)
- [ ] **Migration 004 survives duplicates:** Seed a test DB with 3 duplicate `(repo_id, name)` rows, run migration 004, verify it completes and produces exactly 1 row per unique pair
- [ ] **FTS5 remains in sync after migration:** After migration 004, run `SELECT name FROM services_fts WHERE services_fts MATCH '"auth-service"'` and verify it returns the surviving row's `id`, not a deleted one
- [ ] **ON CONFLICT activates (UNIQUE index exists):** Run `EXPLAIN QUERY PLAN INSERT INTO services ... ON CONFLICT(repo_id, name) DO UPDATE ...` and confirm it shows "UNIQUE INDEX" in the plan, not a full table scan
- [ ] **No false cross-repo edges:** Seed two repos each with a service named `api`, scan both, verify the graph shows two distinct `api` nodes (one per repo), not one merged node with phantom edges
- [ ] **MCP queries correct project DB:** With two project DBs open, call `allclear_impact` with `projectRoot` pointing to each; verify results are different and match the correct DB
- [ ] **Snapshot retention respected:** After 15 scans, verify `ls ~/.allclear/projects/<hash>/snapshots/` shows at most `history-limit` (default: 10) files
- [ ] **MCP `projectRoot` validated:** Pass `projectRoot = "../../etc"` to an MCP tool and verify it returns an error rather than attempting to open that path

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cascade delete wiped connections after REPLACE (Pitfall 1) | HIGH | Re-scan all repos from scratch to rebuild the connection graph; ensure upsert fix is deployed first or re-scan will repeat the deletion |
| Migration 004 failed, worker stuck at schema v3 | MEDIUM | Fix the migration SQL to include dedup step; or manually deduplicate via SQLite CLI (`DELETE FROM services WHERE id NOT IN (SELECT MAX(id) FROM services GROUP BY repo_id, name)`) then rerun migration |
| FTS5 index desync after migration | LOW | Run `INSERT INTO services_fts(services_fts) VALUES('rebuild')` via better-sqlite3 or SQLite CLI; no data loss, only index rebuild |
| False cross-repo edges from name collision | MEDIUM | Identify the generic service names involved; add them to the block-list in `validateFindings()`; re-scan affected repos to replace the bad data |
| MCP queries wrong project DB | LOW | Add `projectRoot` parameter to the affected tool call; or set `ALLCLEAR_PROJECT_ROOT` env var correctly; no data corruption — wrong DB was read-only |
| Snapshot files accumulating unbounded | LOW | Delete snapshots directory manually: `rm -rf ~/.allclear/projects/<hash>/snapshots/`; worker creates a fresh snapshot on next scan |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| INSERT OR REPLACE cascade-deletes child rows | Upsert rewrite phase (must ship with UNIQUE constraint migration) | After re-scan, `SELECT COUNT(*) FROM connections` equals pre-scan count |
| Migration 004 fails on existing duplicates | Migration 004 implementation | Migration test: seed duplicates → run migration → verify 1 row per `(repo_id, name)` |
| FTS5 index desync after migration | Migration 004 implementation | Post-migration FTS search returns correct rowids matching current `services.id` values |
| `ON CONFLICT DO UPDATE` not activating (missing index) | Upsert rewrite phase | `EXPLAIN QUERY PLAN` confirms UNIQUE INDEX usage |
| Cross-repo false edges from name collision | Cross-repo identity merging phase | Two repos with `api` service → two distinct graph nodes |
| MCP queries wrong project DB | Cross-project MCP queries phase | Two-project integration test with `projectRoot` parameter |
| `projectRoot` path traversal | Cross-project MCP queries phase | Fuzzing test rejects `..` path segments |
| Snapshot disk growth | Scan versioning phase | After 15 scans, snapshot count ≤ `history-limit` |

---

## Sources

- [SQLite UPSERT official documentation](https://sqlite.org/lang_upsert.html) — Confirms UPSERT syntax added in SQLite 3.24.0 (2018-06-04); `excluded.` qualifier behavior; `ON CONFLICT(col)` requires UNIQUE index on target column
- [Dexter's Log: INSERT ON CONFLICT REPLACE with ON DELETE CASCADE deletes child records](https://dexterslog.com/posts/insert-on-conflict-replace-with-on-delete-cascade-in-sqlite/) — Confirmed failure mode: REPLACE deletes parent first, cascade fires, child rows destroyed before new parent is inserted
- [better-sqlite3 Issue #654: FTS5 triggers fail to transact with RETURNING clause](https://github.com/WiseLibs/better-sqlite3/issues/654) — Root cause is SQLite bug; fixed in better-sqlite3 v7.4.6
- [SQLite Forum: Corrupt FTS5 table after declaring triggers a certain way](https://sqlite.org/forum/info/da59bf102d7a7951740bd01c4942b1119512a86bfa1b11d4f762056c8eb7fc4e) — FTS5 UPDATE trigger must use delete-then-reinsert; wrong order corrupts the index
- [simonh.uk: SQLite FTS5 Triggers](https://simonh.uk/2021/05/11/sqlite-fts5-triggers/) — Correct AFTER INSERT/DELETE/UPDATE trigger patterns for external content FTS5 tables
- [Sling Academy: Best Practices for UNIQUE Constraints in SQLite](https://www.slingacademy.com/article/best-practices-for-using-unique-constraints-in-sqlite/) — Adding UNIQUE constraint requires rename-create-copy-drop; pre-existing duplicates abort the copy INSERT
- [Miguel Grinberg: Fixing ALTER TABLE errors with Flask-Migrate and SQLite](https://blog.miguelgrinberg.com/post/fixing-alter-table-errors-with-flask-migrate-and-sqlite) — Batch mode migration pattern; unnamed constraint handling
- [Sequelize Issue #12823: Multi-column UNIQUE constraint corrupted during migration](https://github.com/sequelize/sequelize/issues/12823) — Real-world example of multi-column UNIQUE being flattened to per-column UNIQUE during SQLite migration rebuild
- [Datadog Security Labs: SQL injection in MCP server](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/) — MCP server input validation requirements; parameter sanitization before DB path resolution
- Codebase inspection: `worker/db/query-engine.js` (`_stmtUpsertService`, `_resolveServiceId`, `getGraph()` MAX(id) workaround), `worker/db/database.js` (`writeScan()`, `openDb()` pragma ordering), `worker/db/migrations/001_initial_schema.js` (FTS5 trigger definitions, no UNIQUE on services), `worker/mcp/server.js` (`resolveDbPath()` from `process.cwd()`) — confirmed specific anti-patterns

---

*Pitfalls research for: AllClear v2.2 — Scan Data Integrity (idempotent upserts, cross-repo service identity, scan versioning, cross-project MCP queries)*
*Researched: 2026-03-16*
