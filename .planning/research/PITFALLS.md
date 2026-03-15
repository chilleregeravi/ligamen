# Pitfalls Research

**Domain:** Service dependency intelligence — adding Node.js worker, SQLite + ChromaDB storage, MCP server, D3 graph UI, and agent-based scanning to an existing shell-based Claude Code plugin
**Researched:** 2026-03-15
**Confidence:** HIGH (SQLite official docs + better-sqlite3 confirmed; MCP spec official; ChromaDB GitHub issues; D3 performance research 2025; Claude Code GitHub issues confirmed)

---

## Critical Pitfalls

### Pitfall 1: Worker Process Orphaning After Shell Script Exit

**What goes wrong:**
The shell-based `/allclear:map` command starts the Node.js worker process, then the command exits. If the worker was started as a fire-and-forget subprocess without proper PID tracking, it becomes an orphan — running but invisible to the user. Re-running `/allclear:map` starts a second worker on the same port, causing an EADDRINUSE error or silent split-brain where two processes share one SQLite file.

**Why it happens:**
Shell scripts spawn background processes with `&` without persisting the PID. The plugin command exits and the PID is lost. On the next invocation, there is no way to know whether a worker is already running on the configured port.

**How to avoid:**
Write the worker PID to `.allclear/worker.pid` immediately after spawn. Before starting a new worker, check if the PID in `worker.pid` is still alive (`kill -0 $PID 2>/dev/null`). If alive, skip spawn. If dead, remove the stale PID file and start fresh. The HTTP server should also register a `SIGTERM`/`SIGINT` handler that removes `worker.pid` on clean shutdown.

```bash
# In /allclear:map command script
PIDFILE=".allclear/worker.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
  echo "Worker already running (PID $(cat $PIDFILE))" >&2
else
  node worker/server.js &
  echo $! > "$PIDFILE"
fi
```

**Warning signs:**
- `Error: listen EADDRINUSE :::37888` on second invocation of `/allclear:map`
- Two `node worker/server.js` processes visible in `ps aux`
- SQLite `SQLITE_BUSY` errors immediately after starting `/allclear:map`

**Phase to address:**
Worker foundation phase. PID file management must be implemented before any other worker functionality.

---

### Pitfall 2: SQLite WAL File Growing Without Bound

**What goes wrong:**
The worker uses SQLite in WAL mode for concurrency. If any reader holds a long-lived transaction — even a simple read that stays open while agent scanning runs — the WAL checkpoint cannot complete. The WAL file grows unboundedly. With large service maps and frequent scans, the `.allclear/impact-map.db-wal` file can reach hundreds of megabytes and slow all queries.

**Why it happens:**
WAL mode checkpointing requires that no readers hold open snapshots. When agent scans run over many repos simultaneously while the HTTP server is also serving read queries, there are always concurrent readers. The default auto-checkpoint at 1000 pages is blocked by these long-lived reads, so the WAL never resets.

**How to avoid:**
- Set `PRAGMA journal_size_limit = 67108864` (64 MB cap even if checkpoint fails)
- Use `better-sqlite3`'s synchronous API — it never holds connections open across the event loop tick
- Run explicit `db.checkpoint('TRUNCATE')` after every scan completes (scans are write-heavy, readers will be idle momentarily)
- Set `busyTimeout: 5000` on the connection so reads don't fail on transient locks
- Never open a prepared SELECT statement and leave it un-finalized across an async boundary

```javascript
const db = new Database('.allclear/impact-map.db');
db.pragma('journal_mode = WAL');
db.pragma('journal_size_limit = 67108864');
db.pragma('busy_timeout = 5000');
```

**Warning signs:**
- `.allclear/impact-map.db-wal` file larger than 50 MB between scans
- Query latency increasing over time without schema growth
- `SQLITE_BUSY` errors in worker logs despite WAL mode being enabled

**Phase to address:**
SQLite/storage phase. WAL pragma configuration must be in the initial database setup, not added later.

---

### Pitfall 3: ChromaDB Assumed Present — Hard Failure Instead of Graceful Skip

**What goes wrong:**
ChromaDB is optional, but code that calls the ChromaDB client without checking availability first will throw on connection refused. If ChromaDB sync is inline with the scan persist path, a ChromaDB outage silently prevents all findings from being written to SQLite — or crashes the worker entirely.

**Why it happens:**
Developers wire ChromaDB into the save flow early. It works during development where ChromaDB is running. In production, ChromaDB may not be configured, may fail to start, or may crash mid-session. The design document's fallback chain (ChromaDB → FTS5 → direct SQL) is easy to spec but easy to skip in implementation.

**How to avoid:**
ChromaDB sync must be on a completely separate async path from SQLite writes. The sequence must always be: write to SQLite first, confirm success, then attempt ChromaDB sync asynchronously. Any ChromaDB error must be caught, logged to stderr, and not bubble up to the caller. On startup, probe ChromaDB with a health check and set a `chromaAvailable` flag — don't probe on every query.

```javascript
async function persistFindings(findings) {
  // Always succeeds or throws for real errors
  await db.writeScan(findings);

  // Fire-and-forget — ChromaDB is optional acceleration
  if (chromaAvailable) {
    syncToChroma(findings).catch(err => {
      console.error('[chroma] sync failed, continuing without vectors:', err.message);
    });
  }
}
```

**Warning signs:**
- Worker crashes with `ECONNREFUSED localhost:8000` when ChromaDB is not running
- Scan results disappear when ChromaDB goes offline mid-scan
- Cross-impact queries fail instead of falling back to FTS5

**Phase to address:**
ChromaDB integration phase. The fallback chain must be tested explicitly: disable ChromaDB and verify all queries still return results via FTS5.

---

### Pitfall 4: MCP Server stdout Pollution Breaks the Protocol

**What goes wrong:**
The MCP server uses stdio transport. Any `console.log()` or debug output that goes to stdout instead of stderr breaks the JSON-RPC framing. Claude Code receives malformed messages and either ignores all MCP tool calls or crashes the MCP connection entirely. This is silent — no visible error to the user.

**Why it happens:**
Node.js developers default to `console.log()` for debugging. In an HTTP server context this is fine. In an MCP stdio transport, stdout is a structured protocol channel — every byte must be a valid JSON-RPC message. Adding a single `console.log('Server started')` line breaks the entire MCP session.

**How to avoid:**
Redirect all logging to stderr from the very first line of the MCP server. Wrap `console.log` to write to stderr in the MCP server module:

```javascript
// At top of mcp-server.js — before any other code
const log = (...args) => process.stderr.write(args.join(' ') + '\n');
// Never use console.log in MCP server code
```

Add a CI lint rule: `grep -rn "console\.log" mcp-server.js && exit 1 || exit 0`.

**Warning signs:**
- MCP tools registered but never return results
- Claude Code logs show JSON parse errors in MCP communication
- Adding debug statements to MCP server causes all tools to stop working
- `impact_query` tool appears in tool list but calling it hangs

**Phase to address:**
MCP server phase. Establish the stderr-only logging convention before writing any tool handlers. Add a bats/jest test that runs the MCP server and verifies stdout contains only valid newline-delimited JSON.

---

### Pitfall 5: Background Subagents Cannot Access MCP Tools

**What goes wrong:**
The scan manager spawns Claude agents to scan repos. If those agents are spawned as background subagents (using `run_in_background: true`), they cannot access MCP tools — including the `impact_scan` and `impact_query` tools exposed by the AllClear MCP server. Scan results either never arrive or fall back to a degraded mode silently.

**Why it happens:**
This is a confirmed Claude Code bug/limitation: background subagents do not inherit MCP tool access from the parent session. Issue #13254 on the claude-code GitHub repo documents this behavior. Agents spawned in the foreground have MCP access; background agents do not.

**How to avoid:**
Do not use `run_in_background: true` for agents that need to call MCP tools. Instead, run agents sequentially in the foreground within the scan manager, or use a queue approach where the main process dispatches work and collects results. If parallel scanning is needed, implement it within the Node.js worker using the Claude SDK directly (not via Claude Code's agent spawning), where MCP tool access is explicit.

**Warning signs:**
- Agent scans complete but return no results
- Worker logs show agents were spawned but no findings were written to SQLite
- Switching from foreground to background agent spawn causes silent scan failures

**Phase to address:**
Agent scanning phase. Validate agent MCP tool access in the first agent scan prototype before building the full scan pipeline.

---

### Pitfall 6: Agent Scanning Hallucinating Endpoints That Don't Exist

**What goes wrong:**
Claude agents scanning codebases for service connections are prone to hallucination — particularly when code uses indirect patterns like dynamic routing, string interpolation for endpoint paths, or convention-over-configuration frameworks. Agents invent endpoint paths, infer connections that don't exist, or miss connections hidden in configuration files. The result: the dependency graph contains false edges that cause false-positive impact alerts.

**Why it happens:**
LLMs fill gaps in context with plausible-sounding completions. When an HTTP client call looks like `client.get('/users/' + id)`, the agent may invent a canonical endpoint path. Framework-specific patterns (e.g., FastAPI decorators, Express router chaining, Spring Boot annotations) require framework knowledge to parse correctly, and agents may misinterpret them.

**How to avoid:**
- Require agents to report confidence levels per finding (HIGH/MEDIUM/LOW) based on evidence quality
- LOW confidence findings must be surfaced separately with the evidence that produced them
- Never persist LOW confidence findings without explicit user confirmation
- Include specific prompting in agent instructions: "Only report endpoints you found literal string definitions for. Do not infer from usage patterns. If you see a dynamic path, report the template, not a specific instance."
- Validate reported connections with a secondary check: does the claimed file/function actually exist? (simple file-existence check in the worker before persisting)

**Warning signs:**
- Impact reports flagging services that have no code relationship
- Agent reports endpoint paths containing template variables like `{id}` mixed with specific paths
- Re-scanning the same repo produces different sets of connections each time

**Phase to address:**
Agent scanning phase. Build confidence-level requirements and secondary validation into the agent prompt template and persistence layer from the start.

---

### Pitfall 7: Incremental Scan Missing Renamed or Deleted Files

**What goes wrong:**
The incremental scan uses `git diff` to find changed files since the last scan commit. When a service file is renamed (`git mv`), `git diff` shows a deletion + addition. The scan processes the new file but does not clean up connections that referenced the old file path. Over time, the dependency graph accumulates ghost connections pointing to file paths that no longer exist.

**Why it happens:**
`git diff` reports rename as two separate events (delete + add) unless `--find-renames` is specified. Even with rename detection, the incremental scan logic typically processes "changed files" without a cleanup pass for "deleted source files."

**How to avoid:**
After every incremental scan, run a cleanup pass: for each connection whose `source_file` or `target_file` no longer exists on disk, mark it stale (do not delete — show as `status: stale` in the UI). On full re-scan, purge all stale connections. Parse `git diff --name-status` (not just `--name-only`) to detect `D` (deleted) and `R` (renamed) entries and trigger targeted cleanup for those file paths.

```bash
# Get file status changes since last scan
git diff --name-status $LAST_COMMIT HEAD
# R100  old/path/service.py  new/path/service.py
# D     removed/endpoint.ts
```

**Warning signs:**
- Impact graph showing connections to files that no longer exist
- `source_file` entries in connections table pointing to git-deleted paths
- Graph UI showing phantom nodes after a service directory restructuring

**Phase to address:**
Incremental scan phase. Build stale-connection detection into the first incremental scan implementation, not as a follow-up cleanup task.

---

### Pitfall 8: Transitive Graph Walk Hitting Cycles and Infinite Recursion

**What goes wrong:**
The cross-impact query walks the dependency graph transitively (A calls B calls C). If any cycle exists in the graph — even an indirect one (A → B → C → A) — a naive recursive CTE or application-level traversal will loop forever, exhausting memory or hitting SQLite's default 1000-recursion limit with an opaque error.

**Why it happens:**
Service graphs can legitimately contain cycles (mutual authentication, callback patterns, event loops). The design calls for transitive traversal but cycle detection is easy to forget in the initial recursive CTE implementation.

**How to avoid:**
Use SQLite's recursive CTE with an explicit visited-set pattern to detect cycles:

```sql
WITH RECURSIVE transitive(service_id, path, depth) AS (
  SELECT target_service_id, ',' || target_service_id || ',', 1
  FROM connections WHERE source_service_id = :start
  UNION ALL
  SELECT c.target_service_id,
         t.path || c.target_service_id || ',',
         t.depth + 1
  FROM connections c
  JOIN transitive t ON c.source_service_id = t.service_id
  WHERE t.path NOT LIKE '%,' || c.target_service_id || ',%'  -- cycle detection
    AND t.depth < 10  -- safety depth limit
)
SELECT DISTINCT service_id FROM transitive;
```

Cap traversal depth at a configurable limit (default: 5, configurable up to 10) to prevent runaway queries on deeply connected graphs.

**Warning signs:**
- `cross-impact` queries hanging on graphs with more than 10 services
- SQLite error: `SQLITE_ERROR: too many levels of trigger recursion`
- Memory usage spiking during transitive graph walk

**Phase to address:**
Query engine phase. Cycle detection and depth limits must be in the first recursive CTE implementation. Test with a deliberately cyclic graph.

---

### Pitfall 9: User Confirmation Fatigue Causing Rubber-Stamping

**What goes wrong:**
The design requires user confirmation for ALL agent findings before persistence. If the confirmation flow presents 50+ individual findings across 6 repos, users will approve everything without reading — rubber-stamping inaccurate results into the database. This defeats the entire validation purpose and populates the graph with LLM-hallucinated connections.

**Why it happens:**
The design principle "user confirms everything" is correct for safety, but the UX implementation matters. Presenting every finding individually in a long sequential confirmation dialog causes decision fatigue. Users click confirm on everything to get through it.

**How to avoid:**
Group findings by confidence and type. Present HIGH confidence findings as a collapsible summary with a single "Confirm all high-confidence" action. Present LOW confidence findings individually with specific evidence and a require-action flag. Give users an "Edit" action that opens a text representation of the findings they can modify. Never present more than 5-7 individual confirmation decisions in a single flow.

Structure the confirmation UI:
1. Summary: "Found N connections across X repos — N HIGH confidence, N MEDIUM, N LOW"
2. HIGH confidence batch: show grouped by repo, single confirm
3. MEDIUM confidence: show with evidence, allow per-repo confirm
4. LOW confidence: show each with specific question ("Did you intend service A to call service B?")

**Warning signs:**
- Users report scan takes too long and they "just hit confirm"
- Impact graph contains connections that don't match actual code
- Users disable the map feature because confirmation is too tedious

**Phase to address:**
Confirmation flow / map command phase. Design the grouped confirmation UX before implementing it — do not build sequential confirmation and refactor later.

---

### Pitfall 10: D3 Force Graph Rendering Freezing on Large Service Maps

**What goes wrong:**
The D3.js force-directed graph uses SVG rendering. With 50+ services and 200+ connections, the force simulation runs on the main thread and locks the browser tab during layout calculation. The user sees an unresponsive UI for 3-10 seconds on every graph load or re-layout. At 100+ nodes, the tab becomes completely unresponsive.

**Why it happens:**
D3 force simulations are CPU-intensive. SVG rendering is significantly slower than Canvas for large node counts. The default force simulation runs synchronously on the main browser thread with no virtualization. Research shows performance degrades sharply beyond 2,000 SVG nodes, but even at 50-100 nodes with heavy link force calculations, the UI blocks noticeably.

**How to avoid:**
- Use Canvas rendering (not SVG) for nodes and edges when node count > 30
- Run force simulation in a Web Worker so the main thread stays responsive
- Cap the simulation to 100 alpha decay iterations with `simulation.stop()` after reaching a stable layout, then resume only on user interaction
- Implement zoom-based level-of-detail: only render node labels when zoomed in past a threshold
- For graphs > 100 services, cluster by repo and show a collapsed cluster node with expand-on-click

```javascript
// Use canvas renderer for performance
const canvas = document.getElementById('graph-canvas');
const ctx = canvas.getContext('2d');

// Run simulation in Web Worker
const worker = new Worker('force-worker.js');
worker.onmessage = ({ data: positions }) => renderFrame(ctx, positions);
```

**Warning signs:**
- Browser tab becomes unresponsive for 2+ seconds after loading the graph page
- Chrome DevTools shows force simulation consuming 100% CPU for multiple seconds
- User reports graph "freezes" when switching between services in the graph UI
- requestAnimationFrame callbacks are dropping below 10 fps

**Phase to address:**
Graph UI phase. Choose Canvas vs SVG rendering and Web Worker simulation before writing any graph rendering code — retrofitting Canvas rendering onto an SVG implementation requires a rewrite.

---

### Pitfall 11: Shell-to-Node.js Handoff Race Condition

**What goes wrong:**
The shell command `/allclear:map` starts the Node.js worker with `node worker/server.js &` and immediately sends an HTTP request to start scanning. The HTTP server hasn't finished binding to its port yet. The request fails with `ECONNREFUSED`, the shell script reports an error, and the user sees a failure even though the worker started successfully.

**Why it happens:**
Node.js servers take 100-500ms to start and bind. Shell scripts have no async/await — they can't `await server.ready()`. Simple `sleep 1` workarounds are fragile and slow.

**How to avoid:**
Implement a readiness probe in the shell script: poll the worker's `GET /health` endpoint with retries until it responds 200 or a timeout (5 seconds) is exceeded.

```bash
wait_for_worker() {
  local port=$1
  local retries=20
  for i in $(seq 1 $retries); do
    if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Worker failed to start within 5s" >&2
  return 1
}

node worker/server.js &
wait_for_worker 37888 || exit 1
```

The worker's `/health` endpoint must be the very first route registered, before any DB initialization.

**Warning signs:**
- `/allclear:map` fails with `Connection refused` on first invocation but succeeds if run again immediately after
- Scan start command fails but `ps aux | grep node` shows worker is running
- Tests pass when run sequentially but fail when run quickly in CI

**Phase to address:**
Worker foundation phase. Readiness probe must be part of the initial worker startup flow, not added after observing the race condition.

---

### Pitfall 12: SQLite Snapshot Copies Bloating Disk with No Cleanup

**What goes wrong:**
The versioning system copies the entire SQLite database file to `.allclear/snapshots/` on every scan. For a project with 10 repos and 3 months of weekly scans, this generates 12+ snapshot files. If each snapshot is 50 MB, that is 600 MB of snapshot history in the working directory — committed to git by accident or just filling disk.

**Why it happens:**
Snapshots are full file copies. The design doesn't specify a retention policy. Developers add snapshots without adding cleanup. `.allclear/` may not be gitignored.

**How to avoid:**
- Add `.allclear/` to `.gitignore` automatically during first `/allclear:map` run
- Default snapshot retention policy: keep last 10 snapshots (configurable via `history-limit` in config)
- After writing each snapshot, run cleanup: `ls -t .allclear/snapshots/*.db | tail -n +11 | xargs rm -f`
- Display snapshot disk usage in the `/allclear:map --view` output so users are aware

**Warning signs:**
- `.allclear/snapshots/` directory growing unboundedly
- `git status` shows `.allclear/` as untracked (not gitignored)
- Disk usage alerts from machines running automated map updates

**Phase to address:**
Versioning / storage phase. Gitignore and retention policy must be part of the initial snapshot implementation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Web Worker for D3 force simulation | Simpler graph UI implementation | Browser tab freezes on graphs > 30 nodes; requires Canvas rewrite later | Never — choose Canvas + Web Worker from the start |
| ChromaDB sync inline with SQLite persist | Simpler code path | ChromaDB outage blocks all scan persistence; hard to separate later | Never — always async/separate |
| PID tracking without readiness probe | Faster first implementation | Race conditions on every cold start; intermittent CI failures | Never — readiness probe is a 10-line fix |
| Single recursive CTE without cycle detection | Simpler initial query | Infinite loop on any cyclic graph; emergency hotfix required | Never — add depth limit and visited-set from day one |
| Sequential agent scanning (one repo at a time) | Simpler orchestration | Scan of 10 repos takes 10x longer; users abandon the feature | Acceptable for MVP; parallelize in a follow-up phase |
| Store snapshot path as relative in `map_versions` table | Works in dev | Breaks when `.allclear/` is moved or repo is cloned to a different path | Never — use paths relative to DB file location |
| Skip `status: stale` for deleted file connections | Simpler data model | Ghost connections accumulate; no way to distinguish fresh vs orphaned data | Never — stale flag is required for correctness |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| better-sqlite3 + WAL | Opening multiple `Database()` instances in the same process | Use a single shared Database instance as a module singleton; WAL still allows concurrent reads |
| ChromaDB HTTP client | Assuming the client constructor validates connectivity | ChromaDB client constructor never throws; connection errors surface only on the first query. Always run an explicit ping before marking `chromaAvailable = true` |
| MCP stdio transport | Using `process.stdout.write()` for any non-JSON-RPC output | All logging must go to `process.stderr`; stdout is exclusively for MCP protocol messages |
| Claude Code MCP config | Expecting MCP server to auto-register after editing `settings.json` | Claude Code must be fully restarted (not just refreshed) after MCP server config changes |
| D3 force simulation + Canvas | Using SVG element selectors for node click/hover in Canvas mode | Canvas has no DOM elements; hit detection requires manual point-in-circle math on `mousemove` |
| Git diff for incremental scan | Using `--name-only` instead of `--name-status` | `--name-only` misses deleted/renamed files; `--name-status` provides D/R/M/A status codes needed for correct cleanup |
| SQLite snapshot copy | Using `cp` to copy a live database | WAL mode databases have a `-wal` and `-shm` sidecar file; snapshot must use SQLite's `VACUUM INTO` or the Online Backup API to get a consistent snapshot |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| D3 SVG rendering at scale | Tab unresponsive for 2-10 seconds on graph load | Use Canvas renderer for node count > 30; Web Worker for simulation | > 30 nodes with default SVG |
| Recursive CTE without depth cap | Query hangs indefinitely on cyclic graphs | Add `depth < 10` termination condition and visited-set cycle detection | First time a graph contains any cycle |
| WAL file growth from long-lived reads | Queries slow as WAL grows to 100+ MB | Set `journal_size_limit`, run `checkpoint(TRUNCATE)` after every scan | After 50+ scans without restart |
| Agent spawning without backpressure | Worker spawns 10 agents simultaneously; API rate limits hit | Use a concurrency queue — max 2-3 agents in parallel | On first multi-repo scan in a rate-limited environment |
| Snapshot copy using `cp` on live DB | Corrupt snapshot (WAL not checkpointed) | Use `VACUUM INTO 'snapshot.db'` for atomic consistent copy | On any active write transaction |
| MCP tool context window bloat | Claude's context window consumed before conversation starts | Limit MCP tool descriptions to essential fields; do not include examples in tool schemas | With > 5 tools each having verbose descriptions |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Worker HTTP server listening on `0.0.0.0` instead of `127.0.0.1` | Remote machines on the local network can query or trigger scans on the user's codebase | Always bind to `127.0.0.1` (localhost only). The design specifies "localhost:PORT" — enforce this in code, not just docs |
| Agent instructions containing repo path passed without sanitization | If config file is compromised, arbitrary shell commands can be injected into agent prompts | Sanitize all config-derived values before interpolating into agent instructions; reject paths containing shell metacharacters |
| `.allclear/impact-map.db` committed to git | Service topology, endpoint paths, and internal architecture are exposed in the public repo | Write `.allclear/` to `.gitignore` automatically on first run; display a prominent warning if `.allclear/` appears in `git status` |
| ChromaDB API key stored in `allclear.config.json` in plaintext | Config files are often committed to git, exposing credentials | Support `ALLCLEAR_CHROMA_API_KEY` env var override; warn in docs that the `api-key` config field should not be committed |
| MCP server accepting requests without any auth | Any process on the local machine can call `impact_scan` to trigger agent execution | While full auth is heavy for localhost, add a shared secret token set on startup that callers must pass in the `Authorization` header |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Presenting all scan findings as a flat list for confirmation | Users rubber-stamp without reading; hallucinated connections enter the graph | Group by confidence level; HIGH confidence as single batch confirm; LOW confidence as individual questions |
| Map UI opening in background tab without focus | User doesn't know the graph is ready; dismisses browser notification | Print the URL in the terminal and indicate it has been opened: "Graph ready at http://localhost:37888 — opening in browser" |
| Re-scan prompt after every cross-impact query | Developer workflow interrupted by repeated "re-scan?" questions | Only suggest re-scan when git diff shows significant changes since last scan; suppress after clean-state checks |
| Snapshot history not visible by default | Users don't know they can compare graph versions; feature is discoverable only in docs | Show "N snapshots available — run /allclear:map --history to compare" in the scan summary output |
| Worker running silently in background with no status | Users don't know if the worker has crashed or is healthy | SessionStart hook should check worker health and print a one-line status: "AllClear worker: running (port 37888, last scan: 2h ago)" |
| Confirmation dialog for 50+ low-confidence findings | Users abandon the scan midway; partial data entered | Cap max LOW confidence findings presented per scan at 10; batch the rest as "N additional uncertain connections found — confirm to review later" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Worker PID management:** Verify second invocation of `/allclear:map` does NOT start a second worker — test with `ps aux | grep node` count before and after
- [ ] **WAL mode setup:** Verify `journal_mode = WAL` and `journal_size_limit` are set on every database open, not just on creation — check with `PRAGMA journal_mode;` after reopening existing DB
- [ ] **ChromaDB fallback:** Verify cross-impact queries return results when ChromaDB is not running — test by stopping ChromaDB while worker is running
- [ ] **MCP stdout cleanliness:** Verify MCP server stdout contains only newline-delimited JSON — run `node mcp-server.js | grep -v '^\{' | head -5` and expect no output
- [ ] **Incremental scan deleted files:** Verify connections to deleted files are marked stale after a scan that includes a `git rm` — check `connections` table for `status = stale`
- [ ] **Transitive traversal cycles:** Verify `impact_query` returns without hanging on a manually-created cyclic graph (A→B→C→A in the connections table)
- [ ] **D3 graph at scale:** Verify graph UI remains responsive with a synthetic dataset of 100 nodes and 300 edges — measure time to first interactive frame
- [ ] **Snapshot integrity:** Verify snapshot copy is readable as a valid SQLite database using `sqlite3 snapshot.db .schema` after a copy during an active scan
- [ ] **Gitignore for .allclear/:** Verify that running `/allclear:map` for the first time writes `.allclear/` to `.gitignore` — check with `git status` after first map run
- [ ] **Worker localhost binding:** Verify worker cannot be accessed from another machine on the local network — test from a second machine: `curl http://[dev-machine-ip]:37888/graph` must fail

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned worker processes | LOW | Kill all `node worker/server.js` processes; delete `.allclear/worker.pid`; restart with `/allclear:map` |
| Corrupted SQLite WAL file | MEDIUM | Stop worker; run `sqlite3 impact-map.db 'PRAGMA wal_checkpoint(TRUNCATE);'`; restart; if corrupt, restore from latest snapshot |
| Ghost connections from deleted files | LOW | Run `/allclear:map --full` to perform a complete re-scan; this purges all stale connections and rebuilds from current file state |
| ChromaDB desync from SQLite | LOW | Disable ChromaDB in config, restart worker (queries continue via FTS5); re-enable and run `/allclear:map --full` to resync vectors |
| Cyclic graph causing query hang | LOW | Worker has query timeout; query will fail after timeout; fix the cycle by running `/allclear:map --full` to regenerate connections from fresh scans |
| Bloated snapshot directory | LOW | `rm .allclear/snapshots/*.db`; snapshot history is cosmetic, not required for current operation |
| MCP server not responding | MEDIUM | Restart worker; verify MCP config in Claude Code `settings.json`; fully restart Claude Code after config change |
| Agent hallucinated connections in graph | MEDIUM | Delete specific connections via `DELETE FROM connections WHERE id IN (...)` using the worker's REST API; run targeted partial re-scan for affected repos |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Worker process orphaning | Worker foundation | `ps aux` shows exactly one worker after multiple `/allclear:map` invocations |
| WAL file unbounded growth | SQLite/storage setup | WAL file size after 100 writes is < 64 MB |
| ChromaDB hard failure | ChromaDB integration | Worker stays healthy when ChromaDB process is killed |
| MCP stdout pollution | MCP server setup | `node mcp-server.js \| grep -v JSON-RPC` produces no output |
| Background subagents without MCP access | Agent scanning | Agent scan returns results when run both sequentially and via scan manager |
| Agent hallucination | Agent scanning + confirmation flow | Manual review of 3 scan results confirms no invented endpoints |
| Incremental scan missing deletions | Incremental scan | After `git rm` a file and re-scanning, the connection is marked stale |
| Transitive traversal cycles | Query engine | Cyclic test graph returns in < 100ms without hanging |
| Confirmation fatigue | Map command UX | User study / walkthrough confirms high-confidence batch confirm works correctly |
| D3 performance at scale | Graph UI | 100-node synthetic graph renders first interactive frame in < 500ms |
| Shell-to-Node.js race condition | Worker foundation | Cold-start test: 10 consecutive first-starts show 0 ECONNREFUSED errors |
| Snapshot bloat | Versioning/storage | Snapshot count never exceeds configured retention limit after 20 scans |

---

## Sources

- [SQLite Write-Ahead Logging — official docs](https://sqlite.org/wal.html) — Checkpoint starvation, WAL growth, reader snapshot behavior
- [SQLite User Forum: WAL File Grows Past Auto Checkpoint Limit](https://sqlite.org/forum/info/a188951b80292831794256a5c29f20f64f718d98ed0218bf44b51dd5907f1c39) — Real-world unbounded growth scenarios
- [better-sqlite3 Performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL mode setup, checkpoint API
- [PhotoStructure: How to VACUUM SQLite in WAL Mode](https://photostructure.com/coding/how-to-vacuum-sqlite/) — Checkpoint and snapshot best practices
- [ChromaDB Library Mode Stale Data — Medium](https://medium.com/@okekechimaobi/chromadb-library-mode-stale-rag-data-never-use-it-in-production-heres-why-b6881bd63067) — Stale data in ChromaDB library vs server mode
- [ChromaDB Issue #346: Remote end closed connection](https://github.com/chroma-core/chroma/issues/346) — Connection reliability failure modes
- [MCP Transports — official spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) — stdio stdout/stderr protocol requirements
- [MCPcat: Error Handling in MCP Servers](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) — isError flag, structured error responses
- [MCP Python SDK Issue #396: Inconsistent exception handling](https://github.com/modelcontextprotocol/python-sdk/issues/396) — Client undetected server termination behavior
- [Claude Code Issue #13254: Background subagents cannot access MCP tools](https://github.com/anthropics/claude-code/issues/13254) — Confirmed limitation on background agent MCP access
- [Claude Code Issue #19097: Process lifecycle management for spawned background tasks](https://github.com/anthropics/claude-code/issues/19097) — Orphaned process behavior
- [D3 Force Graph Performance — Medium: Best Libraries for Large Graphs](https://weber-stephen.medium.com/the-best-libraries-and-methods-to-render-large-network-graphs-on-the-web-d122ece2f4dc) — SVG vs Canvas vs WebGL performance thresholds
- [PMC: Graph visualization efficiency 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12061801/) — 2025 study on D3/ECharts/G6 with SVG/Canvas/WebGL at scale
- [GitHub Dependency Graph Accuracy Study — ScienceDirect](https://www.sciencedirect.com/article/pii/S0950584925001934) — 27%+ inaccuracy in automated dependency extraction
- [Nielsen Norman Group: Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/) — Confirmation fatigue and overuse consequences
- [Datadog: Using LLMs to filter out false positives from static code analysis](https://www.datadoghq.com/blog/using-llms-to-filter-out-false-positives/) — LLM hallucination in code analysis context
- [Node.js Child Processes — DEV Community](https://dev.to/satyam_gupta_0d1ff2152dcc/mastering-child-processes-in-nodejs-a-complete-guide-32g3) — Zombie process prevention, process cleanup patterns

---
*Pitfalls research for: AllClear v2.0 — service dependency intelligence (Node.js worker, SQLite + ChromaDB, MCP server, D3 graph UI, agent scanning)*
*Researched: 2026-03-15*
