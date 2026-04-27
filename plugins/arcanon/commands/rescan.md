---
description: Re-scan exactly one linked repo, bypassing the incremental change-detection skip. Other linked repos in the project are NOT touched. Updates scan_versions for the rescanned repo only. Pending scan_overrides for that repo are applied during the rescan via Phase 117's apply hook.
argument-hint: "<repo-path-or-name> [--json]"
allowed-tools: Bash
---

# Arcanon Rescan — Single-Repo Re-scan

Re-scan exactly one linked repo. Forces a full scan even when the repo's HEAD
commit matches `last_scanned_commit` (i.e. bypasses the incremental skip).
Other repos registered in the project are not re-scanned — their
`scan_versions` rows are untouched.

## When to use

- Right after `/arcanon:correct` — the apply hook in Phase 117-02 consumes
  pending overrides on the next scan; this command is the cheapest way to
  trigger that without re-scanning the whole project.
- After a hotfix landed in one repo and you want a fresh service map for it
  without touching the others.
- When `/arcanon:verify` flagged drift in one repo and you've fixed the
  underlying code — confirm the new scan picks up the changes.

## When NOT to use

- For a one-shot read-only check — use `/arcanon:verify` instead.
- To rebuild the entire project map — use `/arcanon:map` (or `/arcanon:map full`).
- To stage corrections — use `/arcanon:correct`. This command consumes them;
  it does not insert them.

## Usage

| Invocation | Behaviour |
| --- | --- |
| `/arcanon:rescan <path>` | Resolve `<path>` against `cwd`, look up by `repos.path`, re-scan that repo only. |
| `/arcanon:rescan <name>` | Look up by `repos.name`. If multiple repos share the basename, exit 2 with a disambiguation message — re-run with the absolute path. |
| `/arcanon:rescan <id-or-name> --json` | Emit `{ok, repo_id, repo_path, repo_name, scan_version_id, mode}` instead of the human line. |

## Resolution

- Filesystem path (relative or absolute). `path.resolve(cwd, arg)` then
  `SELECT id, path, name FROM repos WHERE path = ?`.
- Falls back to `SELECT id, path, name FROM repos WHERE name = ?` if the
  path lookup misses. Multi-match by name → exit 2 with the disambiguation
  list (every match's `(id, path)`).
- Zero matches → exit 2 with a friendly listing of every available repo
  (`(name, path)` lines) so the operator can pick the right one.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Rescan ran; new `scan_versions` row present for the rescanned repo. |
| `1` | Worker is not running, OR the worker bootstrap is incomplete (no agent runner injected), OR the scan threw mid-flight. |
| `2` | Usage error: missing repo arg, repo not found, ambiguous name. |

Silent (no output, exit 0) when run from a directory without an
`impact-map.db` — same contract as `/arcanon:list`, `/arcanon:correct`, and
`/arcanon:diff`.

## Step 1 — Detect worker

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/rescan.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per the CORRECT-04 contract
fi
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

If `WORKER_UP=no`, print:

> Worker is not running. Start it with `/arcanon:map` (which boots the worker
> as a side effect), then re-run `/arcanon:rescan <repo>`.

Then stop. Do **not** start the worker from this command — rescan does not
own the worker lifecycle. (Same contract as `/arcanon:verify`.)

## Step 2 — Run

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh rescan $ARGUMENTS
```

Relay the script's output verbatim. The CLI handler POSTs to the worker's
`POST /api/rescan` endpoint, which calls `scanSingleRepo(repoPath, qe, {})`
with `options.full=true`. Phase 117-02's `applyPendingOverrides` hook fires
between `persistFindings` and `endScan` and consumes any pending overrides
for that repo as a side-effect of the rescan.

## Step 3 — Interpret

- Exit 0, line `Rescanned: <name> (repo_id=N, scan_version_id=M)` — the
  scan succeeded and a fresh `scan_versions` row was written.
- Exit 2 — the repo identifier did not resolve. Re-run `/arcanon:list` to
  see what's registered, then call `/arcanon:rescan` with a valid path.
- Exit 1 — the worker is down (start it via `/arcanon:map`), the bootstrap
  is incomplete, or the agent threw mid-scan. The error message names which.

## Write contract

Unlike `/arcanon:verify` and `/arcanon:list`, **`/arcanon:rescan` IS a write
operation**. It replaces the rescanned repo's `services` and `connections`
rows (within the standard scan bracket: `beginScan` → `persistFindings` →
`applyPendingOverrides` → `endScan`). Other repos' rows are byte-identical
before and after.

## Help

**Usage:** `/arcanon:rescan <repo-path-or-name> [--json]`

Re-scan exactly one linked repo. Bypasses the incremental skip; consumes any
pending `scan_overrides` for that repo via Phase 117-02's apply hook.

**Options:**
- `<repo-path-or-name>` — required positional; absolute or relative path, OR
  the value of `repos.name` (typically the repo basename).
- `--json` — emit `{ok, repo_id, repo_path, repo_name, scan_version_id, mode}`.
- `--help`, `-h`, `help` — print this help and exit.

**Examples:**
- `/arcanon:rescan ../api`
- `/arcanon:rescan api`
- `/arcanon:rescan /abs/path/to/auth-service --json`
