---
description: Run a scan into a shadow DB without touching the live impact map. Use /arcanon:diff --shadow to compare, /arcanon:promote-shadow to swap.
argument-hint: "[--full] [--json]"
allowed-tools: Bash
---

# Arcanon Shadow Scan — Sandbox Scan

Performs a scan into `${ARCANON_DATA_DIR}/projects/<hash>/impact-map-shadow.db`
instead of the live `impact-map.db`. The live DB is byte-untouched.

This is the **write half** of the validate-before-commit workflow shipped in
v0.1.4. After the shadow scan completes you can:

- `/arcanon:diff --shadow` — compare live vs shadow side-by-side (Plan 119-02).
- `/arcanon:promote-shadow` — atomically swap shadow into live (Plan 119-02).
- *Do nothing* — the shadow DB stays put until the next `/arcanon:shadow-scan`,
  which overwrites it.

## When to use

- **Validate before commit.** You suspect a refactor will change the dependency
  graph, but you want to see the new graph before mutating the live one.
- **Compare scans cleanly.** A live re-scan replaces the previous scan in place;
  a shadow scan keeps both DBs side-by-side for `/arcanon:diff --shadow`.
- **Trial pending overrides.** Phase 117's apply-hook fires inside the shadow
  scan transparently — pending `scan_overrides` rows are read from and written
  to the SHADOW DB's `scan_overrides` table. Live overrides are unaffected.

## When NOT to use

- For a routine refresh — use `/arcanon:map` (writes to live, half the disk).
- For a one-shot read-only check — use `/arcanon:verify`.
- To stage a single override — use `/arcanon:correct`. This command consumes
  any pending overrides into the SHADOW DB on the next scan; it does not
  insert them.

## Usage

| Invocation | Behaviour |
| --- | --- |
| `/arcanon:shadow-scan` | Scan all linked repos in incremental mode → shadow DB. |
| `/arcanon:shadow-scan --full` | Force a full scan of every linked repo. |
| `/arcanon:shadow-scan --json` | Emit `{shadow_db_path, results, reused_existing}` instead of the human line. |

## Hard contracts

- **Live DB is byte-identical** before and after a shadow scan. Asserted in
  `tests/shadow-scan.bats` Test 8 via sha256.
- **Shadow data NEVER uploads to Arcanon Hub.** The HTTP route forces
  `options.skipHubSync=true` on the call into `scanRepos`. Caller-supplied
  options cannot override this (T-119-01-06).
- **Existing shadow DB is overwritten in place** with a one-line warning. The
  command is non-interactive — there is no prompt. If you want to keep the
  current shadow, run `/arcanon:promote-shadow` first.
- **Worker bootstrap dependency.** Like `/arcanon:rescan`, the shadow scan
  drives `scanRepos` end-to-end inside the worker. Production worker startup
  does not wire an agent runner (118-02 SUMMARY); the route returns 503 in
  that case. Tests use `ARCANON_TEST_AGENT_RUNNER=1`.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Shadow scan ran; `impact-map-shadow.db` written. |
| `1` | Worker not running, or scan threw mid-flight. |
| `2` | Reserved for invocation errors (none today). |

Silent (no output, exit 0) when run from a directory without an
`impact-map.db` — same contract as `/arcanon:list`, `/arcanon:correct`,
`/arcanon:rescan`, and `/arcanon:diff`.

## Step 1 — Detect worker

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/shadow-scan.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per the SHADOW-01 contract
fi
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

If `WORKER_UP=no`, print:

> Worker is not running. Start it with `/arcanon:map` (which boots the worker
> as a side effect), then re-run `/arcanon:shadow-scan`.

Then stop. Do **not** start the worker from this command — shadow-scan does
not own the worker lifecycle. (Same contract as `/arcanon:verify` and
`/arcanon:rescan`.)

## Step 2 — Run

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh shadow-scan $ARGUMENTS
```

Relay the script's output verbatim. The CLI handler POSTs to the worker's
`POST /scan-shadow` endpoint, which calls
`getShadowQueryEngine(projectRoot, {create: true})` and passes the result into
`scanRepos`. Phase 117-02's `applyPendingOverrides` hook fires between
`persistFindings` and `endScan` against the SHADOW QE — pending shadow
overrides are consumed; live overrides are untouched.

## Step 3 — Interpret

- Exit 0, line `Shadow scan complete (N repos scanned). Shadow DB: <path>` —
  the scan succeeded; `impact-map-shadow.db` now reflects the latest scan.
- Exit 1 — the worker is down, or the agent threw mid-scan. The error message
  names which.

## Help

**Usage:** `/arcanon:shadow-scan [--full] [--json]`

Run a scan into the project's shadow DB instead of the live one. The live
`impact-map.db` is byte-untouched. Use `/arcanon:diff --shadow` to compare and
`/arcanon:promote-shadow` to swap shadow into live.

**Options:**
- `--full` — force a full re-scan of every linked repo (otherwise incremental).
- `--json` — emit `{shadow_db_path, results, reused_existing}` instead of the
  human line.
- `--help`, `-h`, `help` — print this help and exit.

**Examples:**
- `/arcanon:shadow-scan`
- `/arcanon:shadow-scan --full`
- `/arcanon:shadow-scan --json`
