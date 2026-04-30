# Predecessor Surface Inventory: v0.1.4 → v0.1.5

**Predecessor milestone:** v0.1.4 Operator Surface (shipped 2026-04-27, phases 114-122, 41/41 REQs)
**New milestone:** v0.1.5 Identity & Privacy (defining requirements; THE-1029 + THE-1031 + VER)
**Audited:** 2026-04-27

## Inventory Summary

| Surface | Count | Notes |
|---------|-------|-------|
| Top-level slash commands | 17 | One markdown file per command in `plugins/arcanon/commands/` |
| HTTP routes (Fastify, worker/server/http.js) | 11 | All read-only except `POST /scan` |
| MCP tools (worker/mcp/server.js) | 9 | 5 impact + 3 drift + 1 audit |
| Hub-sync modules | 5 | `auth.js`, `client.js`, `payload.js`, `queue.js`, `index.js` (+ `evidence-location.js`) |
| Migrations shipped through v0.1.4 | 18 | Most-recent: 017 scan_overrides, 018 actors_label |
| Hub payload envelope versions in flight | 3 | `1.0`, `1.1` (libraryDeps), `1.2` (evidence_mode hash-only/none) |
| Persistent state files | 1 | `~/.arcanon/config.json` (mode 0600) |
| `arcanon.config.json` schema keys touched | 8+ | `linked-repos`, `boundaries`, `project-name`, `hub.{auto-sync, auto-upload, url, project-slug, evidence_mode, beta_features.library_deps}`, `external_labels` |
| Env vars recognized | 6+ | `ARCANON_API_KEY`, `ARCANON_API_TOKEN`, `ARCANON_HUB_URL`, `ARCANON_PROJECT_ROOT`, `ARCANON_DATA_DIR`, `ARCANON_DISABLE_HOOK`, `ARCANON_IMPACT_DEBUG`, `ARCANON_CHROMA_*`, `ARCANON_TEST_AGENT_RUNNER` (removed in 118-02 correction) |
| Hook / extension points | 2 | `applyPendingOverrides(scanVersionId, queryEngine, slog)` (manager.js:817), `getShadowQueryEngine(projectRoot)` (pool.js) |
| Removed surfaces (reference) | 4 | `/arcanon:upload`, `/arcanon:cross-impact`, `runtime-deps.json`, `POST /api/rescan` + `POST /scan-shadow` (architectural correction) |

## Surface Inventory

### Commands (17 total, all top-level under `/arcanon:*`)

All commands live in `plugins/arcanon/commands/<name>.md` and route via `scripts/hub.sh` or markdown-orchestrated inline `Agent` invocations. Every command has a `## Help` section consumed by `lib/help.sh`.

| Command | Markdown | Dispatch |
|---------|----------|----------|
| `/arcanon:correct` | commands/correct.md | scripts/hub.sh correct → cmdCorrect |
| `/arcanon:diff` | commands/diff.md | inline read-only SQLite (`{readonly:true}`) |
| `/arcanon:doctor` | commands/doctor.md | inline 8-check probe + isolated read-only SQLite handle |
| `/arcanon:drift` | commands/drift.md | scripts/drift.sh dispatcher (openapi/types/versions) |
| `/arcanon:export` | commands/export.md | worker/cli/export.js (mermaid/dot/html/json) |
| `/arcanon:impact` | commands/impact.md | scripts/impact.sh, 3-state degradation |
| `/arcanon:list` | commands/list.md | scripts/hub.sh list → /api/scan-quality + /graph |
| `/arcanon:login` | commands/login.md | scripts/hub.sh login → cmdLogin → storeCredentials |
| `/arcanon:map` | commands/map.md | markdown-orchestrated Agent + inline persistFindings/applyPendingOverrides/endScan |
| `/arcanon:promote-shadow` | commands/promote-shadow.md | inline atomic POSIX rename (live↔shadow) |
| `/arcanon:rescan` | commands/rescan.md | markdown-orchestrated (post-118 correction; no HTTP route) |
| `/arcanon:shadow-scan` | commands/shadow-scan.md | markdown-orchestrated (post-119 correction; no HTTP route) |
| `/arcanon:status` | commands/status.md | scripts/hub.sh status → cmdStatus → /api/scan-freshness + queueStats |
| `/arcanon:sync` | commands/sync.md | scripts/hub.sh upload + drain |
| `/arcanon:update` | commands/update.md | scripts/update.sh (4 modes) |
| `/arcanon:verify` | commands/verify.md | scripts/hub.sh verify → /api/verify |
| `/arcanon:view` | commands/view.md | pure markdown alias for `/arcanon:map view` |

**Subcommands worth nothing:**
- `/arcanon:map view` — survives via map.md script flow (verbatim re-implementation cloned by view.md)
- `/arcanon:diff --shadow` — live↔shadow DB diff (Phase 119)
- `/arcanon:sync --offline`, `--repo <p>`, `--dry-run`, `--force`, `--drain`
- `/arcanon:correct connection|service --action {delete|update|rename|set-base-path}`
- `/arcanon:drift openapi --spec <path>` (repeatable)

### HTTP Routes (worker/server/http.js)

All routes are read-only except `POST /scan` (used by the legacy CLI upload path).

| Method | Path | Returns | Line |
|--------|------|---------|------|
| GET | `/api/readiness` | `{status:"ok"}` | http.js:195 |
| GET | `/api/version` | `{version}` from package.json | http.js:200 |
| GET | `/api/scan-quality` | quality breakdown | http.js:246 |
| GET | `/api/scan-freshness` | `{last_scan_iso, last_scan_age_seconds, scan_quality_pct, repos:[{name, path, last_scanned_sha, new_commits}]}` | http.js:326 |
| GET | `/api/verify` | `{results:[{verdict, source_file, line_start, line_end, snippet, ...}], total, truncated, scope}` | http.js:431 |
| GET | `/projects` | listProjects() | http.js:538 |
| GET | `/graph` | `{services:[{... root_path, repo_path, repo_name}], connections, actors:[{... label}], boundaries}` | http.js:548 |
| GET | `/impact` | `getImpact(change)` | http.js:586 |
| GET | `/service/:name` | `getService(name)` | http.js:604 |
| POST | `/scan` | `{status:"persisted", repo_id}` | http.js:622 |
| GET | `/versions` | `getVersions()` | http.js:661 |
| GET | `/api/logs` | `{lines:[{ts,level,msg,...}]}` (last 500) | http.js:675 |

**No `/api/repos` route exists.** The audit prompt referenced `/api/repos`; the actual surface is `GET /projects` (project-list) and the `repos` array nested inside `/api/scan-freshness` and `/graph` responses.

### MCP Tools (worker/mcp/server.js — name `arcanon-impact`, version `0.1.0`)

Server registered at `worker/mcp/server.js:1252`. 9 tools:

| Tool | Line | Returns path-y fields? |
|------|------|------------------------|
| `impact_query` | 1255 | yes — `source_file`, `target_file`, `root_path` via enrichImpactResult |
| `impact_changed` | 1303 | yes — `changed_files` (relative), `affected[].source_file` via JOINs |
| `impact_graph` | 1344 | yes — `nodes[].root_path` via DB |
| `impact_search` | 1385 | yes — `results[].source_file`, `target_file` (LIKE on c.source_file at server.js:501) |
| `impact_scan` | 1429 | mostly counts; `repo_path` field in result wrapper |
| `drift_versions` | 1456 | repo paths in service identifiers |
| `drift_types` | 1481 | service identifiers |
| `drift_openapi` | 1506 | spec paths |
| `impact_audit_log` | 1572 | low risk — log msg fields |

`getGraph()` (the `/graph` endpoint, also reachable indirectly through MCP) projects `r.path AS repo_path` at `worker/db/query-engine.js:1591`.

### Hub-Sync Layer (worker/hub-sync/)

- **`auth.js`** — `resolveCredentials({apiKey, hubUrl})` returns `{apiKey, hubUrl, source}` (auth.js:58); `storeCredentials(apiKey, {hubUrl})` writes `~/.arcanon/config.json` mode 0600 (auth.js:129); `hasCredentials()` boolean wrapper (auth.js:120). Persisted shape today: `{api_key, hub_url}` only.
- **`client.js`** — `uploadScan(payload, {apiKey, hubUrl, attempts, backoffsMs, timeoutMs, log, fetchImpl})` POSTs `${hubUrl}/api/v1/scans/upload` with `Authorization: Bearer arc_…` and `Content-Type: application/json` (client.js:128–138). Throws `HubError(message, {status, retriable, body, attempts})`. **No `X-Org-Id` header today.** No structured error-code parsing — error message is built from RFC 7807 `body.title` (client.js:164).
- **`payload.js`** — `buildScanPayload(opts)` produces `ScanPayloadV1` envelope. Schema-version state machine at payload.js:188–205 → `1.0` (full + no library deps), `1.1` (full + libraryDeps populated), `1.2` (hash-only / none). The v1.2 envelope shape **does not include any auth/identity field** in metadata — auth is purely at the transport level (Bearer header).
- **`queue.js`** — offline upload queue, table `hub_uploads`. Not auth-aware.
- **`index.js`** — `syncFindings(opts)` orchestrator wraps build + resolve + upload; passes `apiKey, hubUrl` to `uploadScan` (index.js:71–75).
- **`evidence-location.js`** — `extractEvidenceLocation(evidence, sourceFile, projectRoot)` — pure helper for hash-only mode (Phase 120).

**Call sites of `resolveCredentials` / `storeCredentials` / `uploadScan` to update for AUTH-01..03:**

| Call site | Line | Currently passes |
|-----------|------|------------------|
| `worker/cli/hub.js:163` | `cmdLogin` | `storeCredentials(apiKey, {hubUrl})` |
| `worker/cli/hub.js:179, 1282` | `cmdStatus`, `cmdDoctor` | `resolveCredentials()` (no args) |
| `worker/cli/hub.js:777` | `cmdList` | `resolveCredentials()` (no args) |
| `worker/hub-sync/index.js:64, 114` | `syncFindings`, `drainQueue` | `resolveCredentials({apiKey, hubUrl})` |
| `worker/hub-sync/index.js:71, 146` | `syncFindings`, `drainQueue` | `uploadScan(payload, {apiKey, hubUrl, log})` |
| `worker/hub-sync/auth.js:122` | `hasCredentials` | calls `resolveCredentials()` no-args |
| `worker/scan/manager.js:941, 949` | `scanRepos` HUB-01 gate | calls `hasCredentials()` |

Total: **7 distinct call sites** across 3 files (`hub.js`, `index.js`, `manager.js`/`auth.js`).

### Migrations Shipped Through v0.1.4

| # | Name | Touches | File |
|---|------|---------|------|
| 001 | initial_schema | base tables (services, connections, repos) | 001_initial_schema.js |
| 002 | service_type | services.type | 002_service_type.js |
| 003 | exposed_endpoints | exposed_endpoints table | 003_exposed_endpoints.js |
| 004 | dedup_constraints | UNIQUE(repo_id,name) on services | 004_dedup_constraints.js |
| 005 | scan_versions | scan_versions table | 005_scan_versions.js |
| 006 | dedup_repos | UNIQUE on repos | 006_dedup_repos.js |
| 007 | expose_kind | exposed_endpoints.kind | 007_expose_kind.js |
| 008 | actors_metadata | actors, actor_connections, node_metadata | 008_actors_metadata.js |
| 009 | confidence_enrichment | connections.confidence/evidence | 009_confidence_enrichment.js |
| 010 | service_dependencies | service_dependencies | 010_service_dependencies.js |
| 011 | services_boundary_entry | services.boundary_entry | 011_services_boundary_entry.js |
| 013 | connections_path_template | connections.path_template TEXT | 013_connections_path_template.js |
| 014 | services_base_path | services.base_path TEXT | 014_services_base_path.js |
| 015 | scan_versions_quality_score | scan_versions.quality_score REAL | 015_scan_versions_quality_score.js |
| 016 | enrichment_log | enrichment_log table | 016_enrichment_log.js |
| 017 | scan_overrides | scan_overrides table + idx | 017_scan_overrides.js |
| 018 | actors_label | actors.label TEXT NULL | 018_actors_label.js |

(Note: migration 012 was renumbered before execution; no 012 file exists on disk — see v0.1.3 milestone notes.)

**v0.1.5 has no schema migration in its REQ list.** AUTH-04's persistent state change is in `~/.arcanon/config.json` (filesystem JSON, not SQLite) — no migration counter increment required.

### DB Pool / Cache Keys

- `worker/db/pool.js` — `getQueryEngine(projectRoot)` keys cache by `projectRoot` only.
- `getShadowQueryEngine(projectRoot)` — uncached, always-fresh (Phase 119 architectural seam to bypass openDb singleton). Live and shadow can never collide.
- `_resetDbSingleton()` — underscore-internal escape hatch from `openDb()`'s process-cached singleton; only used by `evictLiveQueryEngine`.

### Hub Payload Versions In Flight

- `1.0` — default; `evidenceMode="full"` + library deps disabled OR no deps populated
- `1.1` — `evidenceMode="full"` + `libraryDepsEnabled=true` + ≥1 service with non-empty `dependencies`
- `1.2` — `evidenceMode="hash-only"` OR `"none"` (regardless of libraryDeps state)

The state machine is encoded at `worker/hub-sync/payload.js:188–205`. The HUB-05 byte-identity contract guarantees the v1.0 default-mode payload is byte-identical to the pre-Phase-120 emission.

**Critical for v0.1.5:** the auth header is at the *transport* layer (HTTP request header), not in the payload envelope. AUTH-01 modifies `uploadScan(payload, opts)` to add the `X-Org-Id` request header. This **does not require a payload version bump** — the envelope schema is unaffected.

### Persistent State (`~/.arcanon/config.json`)

Persisted shape today (post v0.1.0):

```json
{
  "api_key": "arc_xxxxxxxxxxxx",
  "hub_url": "https://api.arcanon.dev"   // optional; defaults to DEFAULT_HUB_URL
}
```

- File mode: `0600` (auth.js:139, with `chmodSync` belt-and-suspenders auth.js:141)
- Directory mode: `0700` (auth.js:134)
- Read sites: `auth.js:43 readHomeConfig()` only
- Write sites: `auth.js:129 storeCredentials()` only
- Spread-merge preserves unknown keys (`{ ...existing, api_key }` at auth.js:137) — this is the SAFE upgrade primitive AUTH-04 needs to add `default_org_id` without clobbering `api_key`/`hub_url`.

### Plugin Manifest userConfig (`plugins/arcanon/.claude-plugin/plugin.json`)

Three keys today: `api_token` (sensitive), `hub_url`, `auto_sync` (boolean). AUTH-04 / AUTH-09 may want to add `default_org_id` here too — confirm whether the milestone wants it as an installer-time config or strictly machine-default file.

### `arcanon.config.json` Schema Keys (per-repo config)

| Key | Read Site | Phase Added |
|-----|-----------|-------------|
| `linked-repos[]` | scripts/hub.sh, manager.js | v0.1.x baseline |
| `boundaries[]` | http.js:574 (`/graph`), graph UI | v0.1.x baseline |
| `project-name` | hub.js:175, manager.js:91 (fallback) | v0.1.x baseline |
| `hub.auto-sync` (legacy: `auto-upload`) | manager.js:64–77 `_readHubAutoSync` | v0.1.1 |
| `hub.url` | manager.js:90 | v0.1.x baseline |
| `hub.project-slug` | hub.js:175,394, manager.js:91 | v0.1.x baseline |
| `hub.beta_features.library_deps` | hub.js:395, manager.js:92 | v5.8 |
| `hub.evidence_mode` (`full`\|`hash-only`\|`none`) | hub.js:400 (cmdUpload), manager.js (TBD path) | v0.1.4 INT-01 |
| `external_labels` | externals-catalog.js:301 | v0.1.4 INT-07 |

**AUTH-05 will add `hub.org_id`.** No collision with existing keys.

### Logger (worker/lib/logger.js)

- 86 lines, single function `createLogger({dataDir, port, logLevel, component})`
- Writes JSON-lines to `{dataDir}/logs/worker.log` via `fs.appendFileSync` (logger.js:62–64)
- Size-based rotation at 10 MB (`MAX_LOG_BYTES`); keeps `.1`, `.2`, `.3`
- TTY mode also writes to `process.stderr` (logger.js:65–67)
- `extra` object spread into the log line via `Object.assign` (logger.js:59) — **all string values inside `extra` (e.g., `stack`, `repoPath`, `error.message`) currently flow unmasked to disk and stderr.**
- Stack traces: callers explicitly pass `{stack: err.stack}` — see http.js:289–291, http.js:381–383, http.js:510, manager.js multiple sites, mcp/server.js multiple sites. PII-04 must mask all of these.

### Hook / Extension Points (post-v0.1.4)

- `applyPendingOverrides(scanVersionId, queryEngine, slog)` — pure-async function-typed seam between `persistFindings` (manager.js:810) and `endScan` (manager.js:819). Composable; AUTH-05 work that touches `_readHubConfig` does **not** need to compose at this seam.
- `getShadowQueryEngine(projectRoot)` — uncached pool helper for shadow DB.
- `evictLiveQueryEngine(projectRoot)` — clears pool Map AND `_db` singleton via `_resetDbSingleton()`.
- `loadMergedCatalog` — single-call seam at `scanRepos` head for externals enrichment.
- Logger injection points — `setScanLogger(logger)` (manager.js:115), `setExtractorLogger(logger)`, `httpLog`, `logger` arg in `createLogger`. **PII-04 will need a single masking shim wrapping `log()` itself, NOT every call site.**

### Env Vars Recognized

`ARCANON_API_KEY`, `ARCANON_API_TOKEN`, `ARCANON_HUB_URL`, `ARCANON_PROJECT_ROOT`, `ARCANON_DATA_DIR`, `ARCANON_DISABLE_HOOK`, `ARCANON_IMPACT_DEBUG`, `ARCANON_CHROMA_MODE`, `ARCANON_CHROMA_HOST`, `ARCANON_CHROMA_PORT`. (No `ARCANON_TEST_AGENT_RUNNER` — removed in 118-02 architectural correction.)

**AUTH-03 will add `ARCANON_ORG_ID`.** No collision.

### SessionStart Enrichment (scripts/session-start.sh)

- v0.1.1 ambient banner (`N services mapped. K load-bearing files. Last scan: date. Hub: status.`)
- v0.1.4 added FRESH-01..05 freshness signals via `/api/scan-freshness`
- Audit confirmation: `grep -n "repo_path\|repos.path"` returned 0 hits in session-start.sh — the script does **not** currently render the `repos[].path` field from `/api/scan-freshness` to the user. PII-03's masking of that field is therefore safe to ship without a session-start edit.

### Removed Surfaces (reference only — catches dangling refs)

- `/arcanon:upload` — removed v0.1.3 (DEP-01..06). Any new-milestone REQ referencing this is a bug.
- `/arcanon:cross-impact` — removed v0.1.1; absorbed into `/arcanon:impact`.
- `runtime-deps.json` — removed v0.1.3.
- `POST /api/rescan`, `POST /scan-shadow`, `cmdRescan`, `cmdShadowScan`, `scanSingleRepo`, `ARCANON_TEST_AGENT_RUNNER=1` test stub — removed in 118-02 / 119-01 architectural correction. The replacement is markdown-orchestrated. Confirmed via `grep`: no remaining references.

---

## Risk Register

Each risk classifies how a v0.1.5 REQ interacts with a v0.1.4 surface.

### High — Contract Regression

- **(C1) AUTH-01 — `uploadScan(opts)` signature change.** `uploadScan(payload, {apiKey, hubUrl, …})` is called from 2 sites (`worker/hub-sync/index.js:71, 146`). Adding required `orgId` to `opts` is a hard signature break: every existing call must thread `orgId` through. Both call sites today receive `creds = resolveCredentials({apiKey, hubUrl})` and pass `{apiKey: creds.apiKey, hubUrl: creds.hubUrl}` — they must read `creds.orgId` too. **Mitigation:** AUTH-03 expands `resolveCredentials()` return shape first; AUTH-01 then consumes `creds.orgId`. Plan must sequence AUTH-03 before AUTH-01 (otherwise AUTH-01 has nothing to thread).

- **(C2) AUTH-03 — `resolveCredentials(opts)` return shape change.** Return goes from `{apiKey, hubUrl, source}` → `{apiKey, hubUrl, orgId, source}`. **Six** call sites read this object: `index.js:64, 114`, `hub.js:179, 777, 1282`, plus `auth.js:122` (via `hasCredentials`). Of these, `hub.js:179, 777, 1282` use only `creds.apiKey` and `creds.hubUrl` — they will be unaffected (extension-only). `auth.js:122` discards the result. `index.js:64, 114` need the new field. **Mitigation:** new field is additive in shape; existing destructures `{apiKey, hubUrl}` still work; sole risk is: if missing-orgId throws (per AUTH-03 spec), then `hasCredentials()` (which wraps `resolveCredentials()` in try/catch and returns `false` on any throw) will start returning `false` for users who have valid api keys but no org id. This is a **silent semantic change** for `manager.js:941` HUB-01 gate (auto-sync will silently turn off). Plan must either (a) make `hasCredentials()` orgId-tolerant and only throw at upload time, or (b) explicitly document that auto-sync now requires org id and surface a WARN at scan-end when it gates off.

- **(C3) AUTH-04 — `~/.arcanon/config.json` schema extension.** Persisted shape today is `{api_key, hub_url}`. AUTH-04 adds `default_org_id`. Existing users have files with `api_key` and `hub_url` but no `default_org_id`. **The file already uses spread-merge** (`{...existing, api_key}` at auth.js:137) so `storeCredentials` extension is structurally safe. **First-run upgrade behavior:** existing users who upgrade and run `/arcanon:login` *without* `--org-id` will trigger the AUTH-06 whoami flow, which writes `default_org_id` back. Existing users who upgrade and *don't* re-run `/arcanon:login` will hit AUTH-03's "missing org id" throw on next `/arcanon:sync`. **Mitigation:** AUTH-03's error message must literally name the three resolution sources AND the remediation `/arcanon:login --org-id <uuid>` (the spec already says this — verify the plan honors it). Document this in CHANGELOG `### BREAKING` per VER-02.

- **(C4) AUTH-08 — server error code parsing.** Today `client.js:164` builds error messages from RFC 7807 `body.title` only. There is **no structured `body.code` field handling**. AUTH-08 introduces parsing for: `missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`, `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`, `invalid_key`. **Hard dependency on hub-side THE-1030.** If the hub returns these codes, `body.code` (or wherever they land — RFC 7807 typically uses `type` URI or a custom field) must be parsed; the existing `body.title` fallback should remain for unknown codes. **Mitigation:** plan must spec the exact JSON shape coordinated with arcanon-hub THE-1030 (likely `{type, title, status, detail, code}`); parsing must be additive — never throw on unknown codes; never break the existing `body.title` fallback. Test M-AUTH-08 must pin the contract.

- **(C5) AUTH-06 — `/arcanon:login` flow gains `whoami` step.** Today login is **storage-only** (login.md line 38: "the hub exposes no way to validate an arc_* key without an actual upload, so treat the /arcanon:login step as storage-only"). AUTH-02 adds `getKeyInfo(apiKey, hubUrl)` against `GET /api/v1/auth/whoami`. **The endpoint does not exist today on the hub** — pure THE-1030 dependency. With `--org-id`, login should "warn-but-allow" if the key isn't authorized for that org. Without `--org-id`, login auto-selects on N=1, prompts on N>1, fails on N=0. **Mitigation:** plan must spec the offline / hub-unreachable behavior — does login fail closed (block storage), fail open (store anyway, warn), or detect-and-skip? This is a UX call the milestone owner must make explicit. Without it, every offline `arcanon:login` invocation bricks first-time setup.

### High — Shadows / Collides

- **(S1) PII-02 — MCP tool response masking changes a wire format consumed by Claude.** Every MCP tool call response goes to Anthropic. Today `repo_path`, `root_path`, `source_file`, `target_file` flow as absolute paths from `query-engine.js:1591` and JOINs in mcp/server.js. Skills, hooks, README examples, and on-disk tests may grep for `/Users/` or assume absolute paths. **Mitigation:** PII-07 bats grep-assertion is the right gate. Plan must add a unit test confirming a Claude-tool-call's downstream consumer (the `Explore` agent prompts in `agent-prompt-*.md`) still works with `~`-prefixed paths. Confirm that `worker/scan/agent-prompt-service.md:104` (`"root_path": "src/"`) — already relative — won't be re-masked redundantly. Idempotent `maskHome` (PII-01 spec) handles this.

- **(S2) PII-03 — `/api/scan-freshness` `repos[].path` field is a published wire contract.** The endpoint is consumed by `cmdStatus` (hub.js:194 `_fetchScanFreshness`) and `scripts/session-start.sh`. The session-start script does NOT currently render `repos[].path` (confirmed via grep), but `cmdStatus` may pass it through to the human-readable status output. **Mitigation:** plan must (a) confirm session-start tolerates `~` prefix (today: not rendered → tolerant); (b) confirm `cmdStatus` rendering of `repos[].path` is human-display-only (no test grepping `/Users/`); (c) add bats grep-assertion under PII-07.

### Medium — Missing Extension Point

- **(M1) PII-04 — Logger masking has no existing seam.** `worker/lib/logger.js:42–68` — the `log()` function does `Object.assign(lineObj, extra)` and `JSON.stringify` directly. There's no `serialize` or `format` hook between the merge and the `appendFileSync`. **Mitigation:** plan must add a single masking step `Object.assign(lineObj, maskHomeDeep(extra))` between lines 59–60 (or `lineObj = maskHomeDeep(lineObj)` after merge), NOT touch every call site (that would multiply ~30 sites across the worker). One file edit, one seam, one place to test. Stack-trace masking is a special case: stack frames are strings inside `extra.stack` — `maskHomeDeep` should recurse into string values (not just object key matching) for `stack` specifically, OR PII-04 plans an explicit `extra.stack = maskHome(extra.stack)` shim.

### Medium — Pool / Cache Collision

- None for v0.1.5. Auth and PII don't touch the DB pool, query-engine cache, or shadow DB layer.

### Medium — Composition with Existing Hooks

- **(X1) AUTH-05 — `_readHubConfig` extension.** AUTH-05 adds `cfg.hub.org_id` read to `worker/scan/manager.js:84–97 _readHubConfig`. The function returns 4 keys today (`hubAutoSync, hubUrl, projectSlug, libraryDepsEnabled`); AUTH-05 adds `orgId`. The destructure at manager.js:937 must add `orgId`, and the `syncFindings` call at manager.js:962 (currently passes 5 named opts) must thread `orgId` to ride the AUTH-01 wire. **Mitigation:** trivially additive when AUTH-01/-03 land first. Plan must order: AUTH-03 → AUTH-01 → AUTH-05 (or all together in one phase since they're tightly coupled).

- **(X2) PII-06 + applyPendingOverrides — composition order.** PII-06 adds an absolute-source_file rejection at `worker/scan/findings.js parseAgentOutput`. CORRECT-03's `applyPendingOverrides` runs between `persistFindings` and `endScan` (manager.js:810–819). **Order in scan pipeline:** parseAgentOutput → validate → persistFindings → applyPendingOverrides → endScan → enrichment. PII-06 lands BEFORE persistFindings (rejection at parse time). No collision with applyPendingOverrides. **Mitigation:** none required — they compose.

### Low — Endpoint Co-existence

- **(L1) AUTH-07 — `/arcanon:status` Identity block additions.** Today `cmdStatus` returns a `report` object with 9 fields (hub.js:196–205). AUTH-07 adds Identity block fields (resolved org id + source, key preview, scopes, authorized orgs, `(missing)` fallback). Strict superset; pure addition. **Mitigation:** confirm `--json` mode emits Identity as a *nested* `identity: {…}` object so existing JSON consumers don't see field-name churn at the top level.

- **(L2) MCP server version unchanged.** `worker/mcp/server.js:1252` declares `version: "0.1.0"` — not bumped through milestones. PII-02 doesn't need to touch this; it's a labeling string. (Verify: should this be `0.1.5` for VER-01? Probably not — historically pinned at 0.1.0.)

### Untouched Predecessor Surfaces (no risk)

- Migrations 001–018 — additive-only DDL, no v0.1.5 REQ regresses them. No new migration in v0.1.5.
- `applyPendingOverrides` hook (manager.js:810) — untouched.
- `getShadowQueryEngine` / shadow DB pipeline — untouched.
- `/arcanon:correct`, `/arcanon:rescan`, `/arcanon:shadow-scan`, `/arcanon:promote-shadow`, `/arcanon:diff --shadow` — untouched.
- `/arcanon:list`, `/arcanon:doctor`, `/arcanon:view`, `/arcanon:diff` — read-only commands; PII-02/03 will mask their HTTP/MCP responses but the dispatch surfaces are untouched.
- `lib/help.sh` — untouched.
- `loadMergedCatalog`, `actor-labeler.js`, `external_labels` extension — untouched.
- Hub payload v1.0/v1.1/v1.2 envelope shape — **untouched.** The auth header is a transport concern; envelope is invariant.
- `POST /scan` HTTP route — internal, untouched.
- `/api/verify` — untouched (response already uses relative `source_file`; PII-02 won't change it).
- Removed `/arcanon:upload` — confirmed gone, no v0.1.5 REQ references it.
- `evictLiveQueryEngine`, `_resetDbSingleton` — untouched.

---

## Recommended Plan-Phase Pre-Flight Notes

For each High/Medium risk, the roadmapper should add a "Plan-phase pre-flight requirement" to the owning phase. Suggested phrasings:

| Risk | REQ | Pre-flight note |
|------|-----|-----------------|
| C1 | AUTH-01 | "Plan must sequence AUTH-03 before AUTH-01: AUTH-03 expands `resolveCredentials` return shape with `orgId`; AUTH-01 then reads `creds.orgId` at the 2 hub-sync/index.js call sites (lines 71, 146). Confirm zero callers destructure with `Object.keys` or otherwise depend on field-set parity." |
| C2 | AUTH-03 | "Plan must spec how `hasCredentials()` (auth.js:120) handles missing-org-id. Two options: (a) keep `hasCredentials()` returning true when api_key resolves but org_id doesn't — defer the throw to upload time; (b) tighten `hasCredentials()` to require org_id, with a manager.js:941 WARN when auto-sync gates off. Pick (a) or (b) explicitly. The HUB-01 auto-sync gate (manager.js:941, 949) MUST surface why uploads are silently skipped." |
| C3 | AUTH-04 | "Plan must verify storeCredentials' existing spread-merge (`{...existing, api_key}` at auth.js:137) preserves `default_org_id` when only `api_key` is being rewritten. Add a unit test pinning: writing api_key on top of `{api_key, hub_url, default_org_id}` keeps all three. CHANGELOG `### BREAKING` entry must call out the upgrade path: existing v0.1.4 users will fail on next `/arcanon:sync` until they re-run `/arcanon:login` (or `/arcanon:login --org-id <uuid>`)." |
| C4 | AUTH-08 | "Plan must coordinate with arcanon-hub THE-1030 to lock the error response JSON shape — likely `{type, title, status, detail, code}` per RFC 7807 with a custom `code` field. Test M-AUTH-08 must enumerate all 7 codes. Existing `body.title` fallback (client.js:164) MUST remain for forward-compat with codes the plugin doesn't recognize. The HubError object should gain `.code` (string|null) without breaking existing `.status`, `.retriable`, `.body`, `.attempts` fields." |
| C5 | AUTH-06 | "Plan must spec offline / hub-unreachable login behavior. Recommended: when whoami fails network or returns 5xx, store the credential anyway (with the user-supplied `--org-id` if given, else fail), emit a WARN that grants couldn't be verified. NEVER silently store an unvalidated credential without an org id. THE-1030 hard dependency means this phase ships AFTER hub deploy." |
| S1 | PII-02 | "Plan must verify `maskHome` is idempotent on already-relative paths emitted by the agent (`agent-prompt-service.md:104` shows root_path as `src/`). The agent contract is documented to emit relative paths; PII-06 hardens this. Add a unit test under PII-07 confirming an already-relative path round-trips through maskHome unchanged." |
| S2 | PII-03 | "Plan must spec a single bats grep-assertion against `cmdStatus` JSON output (hub.js:196) confirming no `/Users/` or `/home/` strings escape after a clean scan. session-start.sh confirmed not to render `repos[].path` today (grep returns 0 hits) so no script edit is needed; pin this as a structural regression guard in commands-surface.bats." |
| M1 | PII-04 | "Plan must add masking as a SINGLE seam in worker/lib/logger.js between lines 59 and 60 (after `Object.assign(lineObj, extra)`, before `JSON.stringify`). Do NOT add masking calls at the ~30 logger call sites scattered across worker/. Stack-trace masking: `extra.stack` is a string; `maskHomeDeep` must mask string values, not just keyed paths. Add a unit test asserting log line contains `~/path/to/repo` not `/Users/me/path/to/repo` after `logger.info('x', {stack: '/Users/me/foo.js:42'})`." |
| X1 | AUTH-05 | "Plan must thread `orgId` through manager.js:937 destructure and manager.js:962 syncFindings call. Confirm the `_readHubConfig` return shape extension doesn't break manager.test.js fixtures. Phase ordering: AUTH-03 + AUTH-01 + AUTH-05 land together (single phase); landing AUTH-05 alone won't compile." |
| X2 | PII-06 | "No composition risk with applyPendingOverrides (PII-06 fires at parseAgentOutput, well before persistFindings). Plan must spec: rejection logs WARN with the masked offending value, drops just the source_file field (not the whole connection), does not fail the scan. Belt-and-suspenders only — agent contract already mandates relative paths per agent-prompt-service.md:89." |
| L1 | AUTH-07 | "Plan should emit Identity as a nested `identity: {…}` object in `--json` mode (not flat top-level fields), to insulate existing JSON consumers from field-set churn. Human mode adds new lines; JSON mode adds one new key." |

---

*Audit produced 2026-04-27 by gsd-predecessor-auditor. Consumed by gsd-roadmapper next.*
