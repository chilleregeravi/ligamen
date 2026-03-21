# Pitfalls Research

**Domain:** Scan intelligence enrichment — adding enrichment passes, schema surfacing, confidence/evidence surfacing, ownership metadata, auth/DB extraction, and quality-gate spinout to an existing Claude Code plugin with Canvas UI, SQLite storage, and MCP tools
**Researched:** 2026-03-21
**Confidence:** HIGH — based on direct codebase inspection across 8 shipped milestones of this project, retrospective documents, and domain analysis of agent-extracted data systems

---

## Critical Pitfalls

### Pitfall 1: Enrichment Pass Stomps Primary Scan Data

**What goes wrong:**
An enrichment pass runs after the primary scan (or as a second scan mode) and writes to the same tables (services, connections, schemas, fields) using the same upsert paths. If the enrichment agent returns a slightly different service name, a different root_path, or leaves out a service entirely (because it is focused on a narrower task), `ON CONFLICT DO UPDATE` silently overwrites fields with worse data. The primary scan's accurate data is replaced by enrichment guesses.

Even more dangerous: the enrichment pass triggers `beginScan`/`endScan` brackets that delete stale rows. If the enrichment prompt extracts fewer services than the primary scan (it likely does — it is specialized), `_stmtDeleteStaleServices` removes the services the enrichment agent did not re-confirm, even though the primary scan data was correct.

**Why it happens:**
The scan bracket was designed for full-repo scans. Enrichment is additive — it adds supplemental columns or new table rows, not replace existing core records. Reusing the full scan pipeline path (beginScan → upsert → endScan) for enrichment violates that assumption.

**How to avoid:**
Enrichment writes must target separate tables or clearly additive columns only. Never let enrichment trigger a scan bracket. Two concrete options:
1. Enrichment writes to `node_metadata` (the extensibility table from migration 008) using `INSERT OR REPLACE WHERE view='enrichment'` — this is side-car data that never touches core scan rows
2. Enrichment adds optional nullable columns to core tables (via migration) and the enrichment upsert only sets those new columns, with an explicit WHERE clause preventing overwrite of primary scan columns

**Warning signs:**
- Service count in the graph decreases after an enrichment run
- Services that had high-confidence connections lose those connections after enrichment
- The graph shows services without `root_path` or `language` after enrichment runs

**Phase to address:**
Storage phase — the migration and upsert strategy for enrichment data must be defined before any enrichment agent runs. Never reuse the primary scan upsert path.

---

### Pitfall 2: Confidence Scores Are Stored But Never Surfaced — Schema Field Is Orphaned

**What goes wrong:**
The current `agent-schema.json` has `"confidence": "high | low"` on services and connections. The `findings.js` validator requires it. But if you look at what `getGraph()` returns and what the Canvas UI renders, confidence is not displayed on nodes or edges. It is stored in `connections.scan_version_id` ancestry but there is no `confidence` column in `services` or `connections`.

Adding confidence surfacing in the UI means either (a) a new migration adding a `confidence` column, or (b) deriving confidence from `scan_version_id` metadata. Both require coordinated changes across migration → upsert → API → UI. If only the UI phase is planned and the storage phase is not, the UI has no data to display — the feature "looks done" but shows all nodes as the same confidence.

**Why it happens:**
Confidence is validated at parse time but never written to SQLite. The confirmation flow (confirmation.js) uses confidence to group findings (high vs low), but once confirmed, the confidence level is discarded before persistence. This is a known gap — the data reaches the edge of the pipeline and falls off.

**How to avoid:**
Add `confidence TEXT` column to `services` and `connections` in a migration. Update `_stmtUpsertService` and `_stmtUpsertConnection` to include confidence. Verify in `getGraph()` that the column is returned. Only then wire the UI. Test by inserting a low-confidence service and verifying the column value survives the full pipeline.

**Warning signs:**
- All nodes render the same color regardless of confidence level
- `SELECT confidence FROM services` in the DB returns NULL for all rows
- UI toggle for confidence filtering exists but does not change which nodes are visible

**Phase to address:**
Storage migration phase — before any UI work. Confidence column must be in the DB and populated through the upsert path.

---

### Pitfall 3: Evidence Strings Are Validated But Never Persisted

**What goes wrong:**
The `agent-schema.json` requires `"evidence"` on every connection — the exact code snippet proving the connection exists. `findings.js` validates its presence. But there is no `evidence` column in the `connections` table. The value is validated, then discarded at the upsert step (`_stmtUpsertConnection` does not include `evidence`).

When the upcoming milestone adds evidence surfacing to the UI (showing users why a connection was detected), the data is not available. Retroactive scanning of all repos is required to rebuild evidence. If users have already confirmed and accumulated scan history, those confirmed connections have no evidence attached.

**Why it happens:**
Evidence was added to the agent schema in a later milestone (v2.2/v2.3 era) as a hallucination-reduction measure — it forces the agent to cite code. But the storage layer was not updated in the same milestone because the immediate goal was validation, not surfacing. The column was deferred and then forgotten.

**How to avoid:**
Add `evidence TEXT` column to `connections` in the same migration that adds the confidence column. Update the upsert statement. Include evidence in `getGraph()` responses and detail panel API responses. Verify with a test that `evidence` survives the full pipeline: agent output → parseAgentOutput → validateFindings → persistFindings → DB row → getGraph() → detail panel.

**Warning signs:**
- `SELECT evidence FROM connections LIMIT 5` returns column-not-found error
- Detail panel shows "Evidence: —" or "Evidence: undefined" for all connections
- Agent prompt includes evidence requirement but DB migration for the column was not in the milestone

**Phase to address:**
Storage migration phase — same migration as confidence column. These two fields travel together through the pipeline.

---

### Pitfall 4: Auth/DB Extraction Creates a Secret-Detection False Positive Problem

**What goes wrong:**
Auth and DB extraction means asking the agent to identify authentication mechanisms (OAuth, JWT, API keys, basic auth) and database connections (connection strings, ORM config, migration files). This is high-value enrichment. It is also the domain where agents most confidently hallucinate.

The specific risks:
1. **Hardcoded value extraction**: If the agent reads actual credential values from config files (even `.env.example` or test fixtures) and stores them in SQLite, the database becomes a credential store. The intent is to store `"uses: JWT via Authorization header"` not `"uses: Bearer eyJhbGci..."`. Without explicit prompt guardrails, agents store whatever they find.
2. **False positives from placeholder values**: Test tokens like `token: 'test-secret'`, `.env.example` values like `DATABASE_URL=postgres://user:pass@localhost`, and UUID strings in test fixtures all pattern-match as secrets. A broad extraction prompt produces noisy data that poisons the quality gate.
3. **Pattern drift across languages**: JWT detection in Python (`@jwt_required`) vs Go (`jwtMiddleware.Handler`) vs TypeScript (`passport.use(new JwtStrategy(...))`) requires different patterns per language. A single prompt that handles all languages tends to either miss most or over-extract all.

**Why it happens:**
The v2.0 retrospective identified: "Agent prompts need strong boundary rules to prevent hallucinated services." Auth/DB extraction compounds this because the target data (secrets, connection details) is exactly what security-naive code puts in comments, test files, and example configs. An agent prompt without an explicit exclusion list will extract from all of these.

**How to avoid:**
- Prompt must explicitly exclude: test fixtures, `.env.example`, `*.example`, `*.sample`, `*.test.*`, `*_test.*`, `*spec.*` files
- Store auth metadata as structured fields (mechanism type, header name, scope) NOT as the value itself. Schema: `{ auth_type: 'jwt', header: 'Authorization', scheme: 'Bearer' }` — not the token value
- Add a prompt rule: "Do NOT extract any value that looks like a secret, token, password, or connection string. Extract only the mechanism type and the code pattern that implements it."
- Add a validator in `findings.js` that rejects any extraction where a field value matches common credential patterns (length >40 random chars, `Bearer [A-Za-z0-9+/=]{20,}`, etc.)

**Warning signs:**
- SQLite DB contains strings that look like JWT tokens or passwords
- Auth extraction for a service reports `"type": "database-url"` with a value instead of `"type": "postgres"`
- All Node.js services report JWT auth because `package.json` lists `jsonwebtoken` as a dependency (not because auth is actually implemented)

**Phase to address:**
Prompt design and validation phase — before any enrichment agent runs. The validator must reject credential values at parse time, not at storage time.

---

### Pitfall 5: Schema Visualization Blocks on Stale DB Data — No Invalidation

**What goes wrong:**
The Canvas UI currently renders graph data from `getGraph()` which is computed at request time from the live DB. Schema visualization adds a new dimension: instead of services and connections, users see services and their schemas (fields, types, required flags).

If schema data is added to `getGraph()` responses (embedded per-node), the response payload grows significantly for repos with many endpoints (a typical service exposes 20-50 endpoints, each with request/response schemas and 5-15 fields). A graph with 30 nodes can balloon from ~5KB to ~150KB of JSON.

But the deeper problem is stale data: when a developer re-scans a repo and the schema changes (a field is renamed, a required flag changes), the old schema data stays in the `schemas` and `fields` tables unless the stale-data cleanup handles it. The current `_stmtDeleteStaleServices` and `_stmtDeleteStaleConnections` use `scan_version_id` to remove stale rows. But `schemas` and `fields` may not have `scan_version_id` columns — check migration 001. If they do not, schema data accumulates and is never cleaned up across re-scans.

**Why it happens:**
The initial schema (migration 001) added `schemas` and `fields` tables for v2.0. The scan bracket cleanup (`_stmtDeleteStaleServices`) only references `services` and `connections`. `schemas` and `fields` are referenced by `service_id` but the stale cleanup does not cascade because there is no `scan_version_id` on schema rows. `ON DELETE CASCADE` on the FK handles deletion when a service is deleted, but services survive re-scans (they are upserted, not deleted).

**How to avoid:**
Before building schema visualization, verify the stale cleanup path for schemas. Run a test: scan a repo, upsert a schema with 5 fields, re-scan with a different schema (different fields), verify old fields are gone. If old fields survive, add `scan_version_id` to `schemas` and `fields` and add stale cleanup statements for those tables. Only then build the visualization layer.

**Warning signs:**
- Re-scanning a repo does not update field types in the detail panel
- `SELECT COUNT(*) FROM fields` grows monotonically across scans without corresponding service growth
- Schema panel shows fields that no longer exist in the source code

**Phase to address:**
Storage audit phase — before schema visualization. Verify stale cleanup completeness. Fix any gaps before building the UI that depends on schema accuracy.

---

### Pitfall 6: Ownership Metadata Has No Stable Identity Key

**What goes wrong:**
Ownership extraction assigns a team or person to a service (e.g., "payments-api is owned by the platform team, contact: alice@example.com"). This data comes from CODEOWNERS, package.json author fields, git blame patterns, or the agent reading README headers.

The fundamental problem: ownership data extracted by an agent is unstructured text that has no stable identity. "Platform Team", "platform-team", and "Platform Engineering" are all the same team but three different strings. An agent extracting from three repos in the same organization produces three different strings for the same owner, stored as three separate records.

This means:
1. Filtering the graph by owner produces partial results
2. Deduplication at display time requires fuzzy matching (hard to get right)
3. Re-scanning a repo may change the ownership string if the agent reads a different file

**Why it happens:**
Ownership metadata is typically free-form text in source repos. CODEOWNERS files use GitHub usernames. README files use team names. package.json uses email addresses. There is no canonical format.

**How to avoid:**
- Normalize ownership during extraction, not at query time. The agent prompt must extract the most canonical form (GitHub team or user handles from CODEOWNERS take precedence over prose names from README)
- Store a normalized `owner_key` (lowercase-hyphenated, same normalization as service names) alongside a display `owner_name`
- Add a validation step: `owner_key` must match `/^[a-z][a-z0-9-]*$/` — same rules as service names. Reject free-form strings
- Build a deduplication UI at the ownership management layer: when two services report the same owner via different strings, surface this for user resolution

**Warning signs:**
- Graph filter by team shows 3 different owner entries for what users know is the same team
- Re-scanning a repo changes ownership for a service that hasn't changed its CODEOWNERS file
- Owner field contains email addresses in some services and team names in others

**Phase to address:**
Ownership extraction prompt design phase — the normalization rule must be in the agent prompt and the validator before any data reaches the DB.

---

### Pitfall 7: Two-Phase Scan (Discovery + Enrichment) Creates Partial State Windows

**What goes wrong:**
If enrichment runs as a separate pass after the primary scan, there is a window between pass 1 completion and pass 2 completion where the graph is in a partially enriched state. During this window:
- MCP tools return results that are inconsistent — some services have enrichment data, others do not
- The Canvas UI may render confidence indicators for only half the nodes
- If the enrichment pass fails halfway through (agent error, timeout), the state is permanently partial unless there is explicit cleanup

This is compounded by the incremental scan design: if a user re-scans only changed repos, the enrichment pass may run on the changed repos but not re-run on unchanged repos. Over time, enrichment data drifts — older repos have stale enrichment (or no enrichment) while newer repos have fresh enrichment.

**Why it happens:**
Enrichment was not designed into the original scan pipeline, so there is no concept of enrichment status per repo. The primary scan has `scan_versions` (beginScan/endScan bracket). Enrichment has no equivalent tracking.

**How to avoid:**
- Add `enrichment_versions` table (same structure as `scan_versions`) with `repo_id`, `started_at`, `completed_at`, `enrichment_type`
- Do not surface enrichment data in the UI or MCP tools unless `completed_at` is set for that repo+type combination
- On enrichment failure, mark the enrichment version as failed (or leave `completed_at` NULL) so the next scan triggers re-enrichment
- For incremental scans: enrichment re-runs if the primary scan ran (same trigger condition), not independently

**Warning signs:**
- Some nodes in the graph have confidence badges, others do not, with no pattern (not just "unenriched repos")
- MCP `impact_query` returns different confidence data for different services in the same query
- After a failed enrichment run, the UI shows partial confidence overlays

**Phase to address:**
Enrichment architecture phase — define the enrichment tracking model before implementing any enrichment agent. The tracking table is prerequisite infrastructure.

---

### Pitfall 8: Quality Gate Spinout Shares Process State With the Worker

**What goes wrong:**
The current quality gate (`/ligamen:quality`) runs as a shell command — it has no dependency on the worker process. A quality gate "spinout" likely means moving quality gate logic to a separate server-side process or MCP tool for autonomous triggering.

The risks when quality gate becomes a server-side component:
1. **Shared SQLite write contention**: If quality gate checks run autonomously (e.g., triggered by PreToolUse hook) and write results to SQLite at the same time as a scan bracket writes scan data, WAL mode handles concurrent reads but concurrent writes still serialize. High-frequency quality gate checks can queue behind in-progress scan writes.
2. **Process death propagation**: If quality gate logic lives in the worker process and the worker dies (OOM, crash), quality gate becomes unavailable. Currently quality gate is shell-only and always available. Mixing them couples availability.
3. **Hook re-entrancy**: If quality gate is triggered by a PreToolUse hook and the quality gate check spawns agent tools, the spawned tools trigger more PreToolUse hooks → re-entrancy loop. Claude Code issue #13254 notes background subagents cannot access MCP tools, but the re-entrancy risk through hooks exists.

**Why it happens:**
Shell commands and worker processes have fundamentally different execution models. Mixing them without explicit interface boundaries creates implicit shared state (the SQLite DB) and availability coupling.

**How to avoid:**
- Keep quality gate shell commands as pure read-only DB queries — they never write to SQLite, only read
- If quality gate results are persisted (pass/fail history), use a separate table (`quality_gate_runs`) with its own write path that does not conflict with scan brackets
- Quality gate MCP tools must be read-only (SELECT only) — no upserts, no transactions beyond a single read
- If quality gate triggers agent sub-tasks, document the re-entrancy risk and add a guard (session-level lock file or env var flag) to prevent recursive triggering

**Warning signs:**
- Quality gate reports stale data while a scan is in progress (reading mid-scan state)
- Worker OOM crash also disables quality gate features
- PreToolUse hook triggers quality gate which triggers another PreToolUse → exponential hook call growth in logs

**Phase to address:**
Quality gate spinout design phase — define the read/write boundary and process isolation model before any implementation. Confirm the quality gate writes do not intersect scan brackets.

---

### Pitfall 9: Migration Guard for New Columns Uses Wrong Try/Catch Pattern

**What goes wrong:**
The existing codebase already has one migration guard pattern — in `QueryEngine` constructor, `_stmtUpsertConnection` tries the query with `crossing` column, falls back on catch to the query without it:

```javascript
try {
  this._stmtUpsertConnection = db.prepare(`INSERT OR REPLACE INTO connections (..., crossing) ...`);
} catch {
  this._stmtUpsertConnection = db.prepare(`INSERT OR REPLACE INTO connections (...) ...`);
}
```

When the next milestone adds `confidence` and `evidence` columns to `connections` (and `confidence` to `services`), this pattern must be replicated for each new column. The risk: developers add a try/catch guard for `confidence` but forget to add one for `evidence`. The prepare succeeds (because `confidence` is in the columns) but the execute fails at runtime when `evidence` is bound and the column does not exist on older DBs.

The second risk: the try/catch pattern hides migration failures. If migration 009 fails partway through (e.g., adding `confidence` succeeds but adding `evidence` fails due to a SQLite version quirk), the constructor catch swallows the error and the upsert silently drops the evidence value. There is no runtime signal that data is being lost.

**Why it happens:**
Try/catch migration guards are a pragmatic pattern for backward compatibility but they provide no observability. A failed prepare is caught but not logged; a successful prepare with partial columns is not detectable.

**How to avoid:**
- After a migration runs, verify its result: `PRAGMA table_info(connections)` and assert all expected columns are present. If not, throw with a clear message rather than silently falling back
- For multiple new columns in one migration, add them in a single `ALTER TABLE` batch. SQLite does not support multi-column ALTER TABLE in one statement (each column requires its own ALTER), but wrapping all adds in a single transaction ensures atomicity — if any add fails, they all roll back
- Log (to stderr) which schema variant the QueryEngine initialized with: `[db] using schema variant: pre-009 (no confidence/evidence columns)` vs `post-009`. Makes silent fallbacks visible.

**Warning signs:**
- `confidence` is visible in the DB but `evidence` is not, even after running migrations
- No error was reported during migration, but `PRAGMA table_info(connections)` shows missing columns
- `_stmtUpsertConnection` succeeds but the `evidence` value in the bound object is ignored

**Phase to address:**
Storage migration phase — design the migration atomicity and post-migration verification before writing any migration code.

---

### Pitfall 10: Canvas UI Performance Degrades With Schema Data Per Node

**What goes wrong:**
The current `getGraph()` API returns nodes and edges. Adding schema data (fields per schema per service) to the response means each node now carries a potentially large nested structure. At 30 nodes with 5 schemas each and 10 fields per schema, the graph JSON grows from ~10KB to ~200KB. This hits the Canvas UI as a single large JSON parse on load.

The deeper problem: the D3 force simulation runs in a Web Worker. If schema data is embedded in the node data passed to the worker, the `postMessage` transfer serializes the full schema data on every simulation tick — 60 times per second. This kills performance even on fast machines.

Additionally, detail panel rendering currently uses `innerHTML` with `escapeHtml()` for XSS safety. Schema field data (field names and types extracted from source code) can contain template literal characters, angle brackets, and special characters that escape incorrectly if not handled consistently. The v2.3 retrospective specifically flagged this: "escapeHtml() for all user-controlled template literal insertions in UI code."

**Why it happens:**
Performance in the v2.0 retrospective specifically called out: "Canvas over SVG for graph rendering — scales well beyond 30 nodes." But that observation was about node/edge count, not per-node data volume. The Canvas performance characteristic does not extend to large payloads in the data passed to the simulation worker.

**How to avoid:**
- Keep schema data out of `getGraph()`. Use a separate `GET /api/node/:id/schemas` endpoint for on-demand schema fetching (already used for detail panel; extend it for schemas)
- The force simulation worker only receives node positions and edge connectivity — it never needs schema data
- Schema field rendering in the detail panel must use `escapeHtml()` on every field name, type string, and any extracted code reference
- Add pagination to schema field lists — limit to first 20 fields per schema in the UI with a "show more" control

**Warning signs:**
- Graph load time increases proportionally with service count after schema data is added to `getGraph()`
- Web Worker postMessage profiling shows schema data in the tick payloads
- Detail panel renders field type strings with unescaped angle brackets (`<T>` in TypeScript generics displays as invisible HTML)

**Phase to address:**
API design phase — define the `getGraph()` vs `getNodeSchemas()` split before any UI work. Schema data must never enter the simulation worker.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reusing primary scan upsert path for enrichment | No new code paths | Enrichment overwrites primary scan data; scan brackets delete enrichment-only rows | Never — enrichment must be side-car only |
| Not adding `confidence` column to services/connections immediately | Defer a migration | Confidence data never reaches the DB; all future UI work on confidence is blocked | Never — confidence column is prerequisite for surfacing it |
| Storing evidence strings in memory only (not persisted) | No migration needed | Evidence must be re-extracted by re-scanning; users lose proof of past confirmations | MVP only — accept for first enrichment phase, fix in following phase |
| Embedding all schema data in getGraph() response | Single API call | Response grows 10-20x; simulation worker receives unnecessary data | Never — on-demand per-node schema fetch is the correct pattern |
| Free-form ownership strings without normalization | Simpler extraction prompt | Owner filter produces partial results; dedup requires fuzzy matching | Never — normalization must be in the prompt, not a post-hoc fix |
| Try/catch migration guard without post-migration verification | Simple pattern | Silent column omission; data loss with no observable signal | Acceptable for read queries; never acceptable for write paths |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Enrichment agent + scan bracket | Running `beginScan`/`endScan` for an enrichment pass | Enrichment never triggers a scan bracket; write only to `node_metadata` or additive nullable columns |
| Confidence field + confirmation.js | Using confidence from `findings.js` grouping but not persisting it to DB | Add confidence to upsert statements; verify it survives the full pipeline (parse → confirm → persist → query) |
| Evidence field + connections table | Validating evidence in `findings.js` but not writing it to the `connections` table | Add `evidence TEXT` column before any display work; update `persistFindings()` to include evidence in the upsert |
| Schema data + getGraph() API | Adding schemas array to each node in getGraph() response | Use a separate per-node schema endpoint; keep getGraph() lean (node positions + edge metadata only) |
| Quality gate MCP tool + scan writes | Quality gate MCP tool writes pass/fail state during an active scan | Quality gate MCP tools are read-only; any state writes go to a separate table outside the scan transaction |
| Ownership extraction + CODEOWNERS files | Storing raw CODEOWNERS GitHub handles as owner names | Normalize to lowercase-hyphenated `owner_key`; validate against the same naming rules as service names |
| Auth extraction + test fixtures | Agent reads test token values from fixtures and stores them in DB | Prompt must explicitly exclude test files; validator must reject values matching credential patterns |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Schema data in getGraph() response | Graph load time grows 10-20x; detail panel slow to render | Separate API endpoint for per-node schemas | At ~10 nodes with 5+ schemas each |
| Schema data in Web Worker postMessage | Frame drops during force simulation; 60fps drops to <10fps | Worker only receives node IDs and positions; schema data stays in main thread | Immediately if schema data enters tick loop |
| Confidence/evidence re-extraction after missed migration | Full rescan of all repos required to populate new columns | Add columns + update upserts atomically; verify in first run before users accumulate history | After first enrichment release without the columns |
| Auth extraction on large monorepos | Agent reads hundreds of config files; scan time exceeds agent timeout | Limit auth extraction to specific files (CODEOWNERS, package.json auth fields, entry point files) | Monorepos with >200 config files |
| Enrichment re-running on every incremental scan | Enrichment adds 30+ seconds to every scan even for 1-line changes | Enrichment re-runs only if primary scan ran; tracked by `enrichment_versions` table | Every incremental scan if no tracking |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Extracting actual credential values during auth extraction | SQLite DB becomes a credential store; exposed via MCP tools to any AI agent | Prompt rule: extract mechanism type and code pattern only, never the credential value; validator rejects patterns matching credentials |
| Returning evidence strings (raw code snippets) via MCP tools without sanitization | Code snippets may contain secrets from adjacent lines | Truncate evidence to ≤3 lines, strip lines matching credential patterns before MCP response |
| Storing ownership email addresses as owner identifiers | PII in the DB; exposed via MCP tools | Use GitHub handles or team slugs only; never store personal email addresses in the owner tables |
| No input validation on ownership strings before DB insert | Injection via crafted CODEOWNERS or README content | Apply same normalization regex as service names; reject strings not matching `/^[a-z][a-z0-9-@./]*$/` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Confidence shown for some nodes but not others after partial enrichment | Users trust the graph incorrectly — silence is interpreted as "unknown" not "unenriched" | Show a third state: "not yet enriched" (grey) vs "high confidence" (green) vs "low confidence" (yellow) |
| Evidence displayed as raw agent output | Confusing to users who are not reading the source code themselves | Format evidence as a code block with file path and line reference; strip leading/trailing whitespace |
| Schema visualization loads all fields immediately | Overwhelming for services with 50+ fields | Default to collapsed schemas; expand on click; show field count in collapsed state |
| Ownership shown as extracted strings with no edit flow | Users cannot correct wrong ownership without re-scanning | Add an override UX — user edits override extraction results and are stored separately so re-scans don't undo corrections |

---

## "Looks Done But Isn't" Checklist

- [ ] **Confidence column persisted:** `SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5` returns rows — not just NULL. Confidence survives the full pipeline: agent → findings.js → confirmation.js → persistFindings() → connections table.
- [ ] **Evidence column persisted:** `SELECT evidence FROM connections WHERE evidence IS NOT NULL LIMIT 5` returns rows with actual code snippets, not NULL or placeholder text.
- [ ] **Stale schema cleanup works:** Re-scan a repo after removing a field from a struct. Verify the old field is not present in `SELECT * FROM fields WHERE ...`. If it persists, `scan_version_id` is missing from the fields table.
- [ ] **Enrichment does not trigger scan bracket:** Run an enrichment pass and verify that `SELECT COUNT(*) FROM services WHERE repo_id = ?` does not decrease compared to before enrichment.
- [ ] **Auth extraction produces no credential values:** Insert a service with a `.env.example` containing `API_KEY=abc123def456ghi789jkl012` and run auth enrichment. Verify no extracted value in the DB matches that pattern.
- [ ] **Ownership normalized:** Extract ownership from a repo with `CODEOWNERS` containing `* @my-org/platform-team`. Verify stored `owner_key` is `platform-team`, not `@my-org/platform-team` or `Platform Team`.
- [ ] **getGraph() response size unchanged:** Add schema data and verify that `GET /graph` response size has not grown. Schema data must come from a separate endpoint.
- [ ] **Quality gate MCP tools are read-only:** Run a quality gate MCP tool during an active scan (beginScan called, endScan not yet called). Verify the quality gate tool does not block, does not write, and returns consistent read data.
- [ ] **Enrichment failure leaves no partial state:** Kill the enrichment agent mid-run. Verify the next enrichment run starts cleanly and does not produce duplicate or orphaned rows.
- [ ] **Detail panel escapeHtml covers new fields:** Render a service with a TypeScript generic type `Array<Record<string, unknown>>` as a schema field type. Verify angle brackets appear as literal characters in the detail panel, not as invisible HTML tags.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Enrichment stomped primary scan data | HIGH | Re-scan all repos from scratch; redesign enrichment to use side-car tables; migration to restore lost data may not be possible if backups don't exist |
| Confidence/evidence columns missing from DB | MEDIUM | Add migration; re-scan all repos to populate columns; users lose history of which data was high vs low confidence |
| Credential values stored in DB | HIGH | Delete affected rows; rotate any real credentials if they were extracted from non-test files; add prompt guardrail retroactively |
| Schema stale cleanup broken | MEDIUM | Add `scan_version_id` to schemas/fields tables; write migration to backfill; re-scan all repos |
| Ownership strings not normalized | LOW | Write a migration that normalizes existing owner strings; re-run extraction only for services where normalization changed the key |
| Quality gate + scan write contention | MEDIUM | Make quality gate tools read-only; if history writes are needed, add a separate table outside scan transactions; test under concurrent load |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Enrichment stomps primary scan data (1) | Enrichment storage architecture | `SELECT COUNT(*) FROM services` does not decrease after enrichment; stale cleanup only fires on primary scan brackets |
| Confidence column not persisted (2) | Storage migration phase | `SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5` returns rows |
| Evidence column not persisted (3) | Storage migration phase — same as confidence | `SELECT evidence FROM connections WHERE evidence IS NOT NULL LIMIT 5` returns rows with code snippets |
| Auth extraction stores credential values (4) | Prompt design and validation phase | Validator rejects connection with evidence matching credential pattern; no credential values in `node_metadata` view='auth' |
| Schema stale cleanup gap (5) | Storage audit phase | Re-scan with different fields; old fields absent from `fields` table |
| Ownership string normalization missing (6) | Ownership extraction prompt phase | Owner filter shows distinct canonical keys; no two entries for the same team |
| Two-phase scan partial state (7) | Enrichment tracking table phase | Enrichment failure leaves `enrichment_versions.completed_at = NULL`; UI suppresses enrichment data for unfinished repos |
| Quality gate process coupling (8) | Quality gate spinout design phase | Quality gate MCP tool returns data during active scan; worker crash does not disable quality gate shell commands |
| Migration guard silent failure (9) | Storage migration phase | Post-migration PRAGMA verification asserts all new columns present; missing column throws, not silently falls back |
| Canvas performance with schema data (10) | API design phase | `GET /graph` response size after schema milestone is within 10% of pre-schema baseline; simulation worker receives no schema fields |

---

## Sources

- Codebase inspection: `plugins/ligamen/worker/db/query-engine.js` — confirmed confidence not in upsert statements; evidence not in connections table schema
- Codebase inspection: `plugins/ligamen/worker/scan/agent-schema.json` — confirmed evidence and confidence fields required in agent output but not persisted
- Codebase inspection: `plugins/ligamen/worker/db/migrations/` — confirmed 8 migrations; no confidence or evidence columns exist
- Codebase inspection: `plugins/ligamen/worker/db/migrations/008_actors_metadata.js` — confirmed `node_metadata` extensibility table design (the correct target for enrichment side-car data)
- Codebase inspection: `plugins/ligamen/worker/scan/manager.js` — confirmed scan bracket (beginScan/endScan) design; stale cleanup operates on services and connections only
- `.planning/RETROSPECTIVE.md` v2.0 lessons: "Agent prompts need strong boundary rules to prevent hallucinated services" — applies directly to auth/DB extraction scope
- `.planning/RETROSPECTIVE.md` v2.2 lessons: "INSERT OR REPLACE in SQLite is semantically DELETE+INSERT — cascade-deletes FK children; use ON CONFLICT DO UPDATE instead"
- `.planning/RETROSPECTIVE.md` v2.3 lessons: "SQLite UNIQUE constraints treat NULL != NULL — must use COALESCE in unique index for nullable columns"; "escapeHtml() for all user-controlled template literal insertions"
- `.planning/RETROSPECTIVE.md` v3.0 lessons: "Always verify the full data pipeline (prompt → validator → DB → API → UI) before shipping — the crossing field was in the prompt and schema but dropped in writeScan"; "Private field naming (_db) creates fragile coupling"
- `.planning/RETROSPECTIVE.md` v3.0 patterns: "Enrichment functions (enrichImpactResult, enrichSearchResult) as best-effort wrappers with null-db guards" — confirms enrichment as side-car pattern
- Checkmarx research on false positives in secret scanning: context-aware classification required to distinguish test tokens from production credentials
- Node.js Web Worker `postMessage` documentation: structured clone algorithm serializes all data including nested objects on every transfer
- LLM hallucination research (arxiv 2510.06265): confidence calibration is unreliable when model is highly confident in incorrect outputs — confidence from agent must be validated against evidence, not trusted directly

---

*Pitfalls research for: Ligamen v6.x — Scan intelligence enrichment (enrichment architecture, schema surfacing, confidence/evidence surfacing, ownership, auth/DB extraction, quality-gate spinout)*
*Researched: 2026-03-21*
