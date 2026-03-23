# Phase 59: Runtime Dependency Installation - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Install MCP server runtime npm dependencies into ${CLAUDE_PLUGIN_ROOT} on every session start, with idempotency to skip unchanged installs, failure cleanup, and a self-healing MCP wrapper for the first-session race condition. Does not include version bumping (Phase 61) or end-to-end MCP verification (Phase 60).

</domain>

<decisions>
## Implementation Decisions

### Install Location
- Install into `${CLAUDE_PLUGIN_ROOT}` via `npm install --prefix ${CLAUDE_PLUGIN_ROOT}` using `runtime-deps.json` as the package.json
- ESM walks up directory tree to find node_modules — no NODE_PATH needed (NODE_PATH is silently ignored by ESM)
- Use `--omit=dev` flag (modern npm 8+, our minimum is Node 20)

### Idempotency
- Diff sentinel stored in `${CLAUDE_PLUGIN_DATA}/.ligamen-deps-installed.json` (persists across plugin updates)
- Double check: re-install if sentinel mismatches OR `node_modules/better-sqlite3` directory is missing in PLUGIN_ROOT
- This covers both "deps changed" and "plugin update wiped node_modules" cases

### Failure Handling
- On npm install failure: delete partial `node_modules`, do NOT write sentinel
- Next session retries clean (no partial install persistence)
- Log error to stderr for debugging
- better-sqlite3 uses prebuild-install internally — downloads prebuilt binaries for the platform, only falls back to compile if no prebuilt exists

### MCP Wrapper (Self-Healing)
- Extend existing `mcp-wrapper.sh` (bash, not Node.js bootstrap)
- Before `exec node server.js`: check if `node_modules/better-sqlite3` exists
- If missing: run same npm install logic, output to stderr (stdout must stay clean for MCP JSON-RPC)
- On install failure: print clear error to stderr, exit 1
- Covers first-session race where MCP server starts before SessionStart hook completes

### Hook Architecture
- New `scripts/install-deps.sh` as separate script (not inline in session-start.sh)
- First entry in SessionStart hooks array with `"timeout": 120` (native compilation can take 30-60s)
- session-start.sh stays as second entry at `"timeout": 10` — unchanged
- SessionStart only — NOT UserPromptSubmit (install is too heavy for every prompt)

### Claude's Discretion
- Exact npm install flags beyond --omit=dev (e.g., --prefer-offline, --no-audit)
- Whether to copy runtime-deps.json to PLUGIN_ROOT as package.json or use --prefix with custom package.json path
- Logging format and verbosity during install

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing hook infrastructure
- `plugins/ligamen/hooks/hooks.json` — Current hook definitions, SessionStart entry at timeout 10
- `plugins/ligamen/scripts/session-start.sh` — Session context injection, SESSION_ID dedup at line 31-37

### MCP server
- `plugins/ligamen/scripts/mcp-wrapper.sh` — Current 6-line wrapper, needs self-healing extension
- `plugins/ligamen/.mcp.json` — MCP server config, currently points to node server.js
- `plugins/ligamen/worker/mcp/server.js` — Server entry point with ESM imports

### Runtime deps
- `plugins/ligamen/runtime-deps.json` — Dep manifest for install (already created)
- `plugins/ligamen/package.json` — Full package.json with type: "module"

### Research
- `.planning/research/STACK.md` — ESM + NODE_PATH incompatibility, install-into-PLUGIN_ROOT strategy
- `.planning/research/PITFALLS.md` — Hook/MCP race, timeout, ABI mismatch risks
- `.planning/research/ARCHITECTURE.md` — Integration flow, build order

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `session-start.sh` SESSION_ID dedup pattern (lines 31-37) — same flag-file idempotency pattern can inform install script
- `mcp-wrapper.sh` CLAUDE_PLUGIN_ROOT resolution (lines 4-5) — reuse in install-deps.sh

### Established Patterns
- All scripts use `set -euo pipefail` with `trap 'exit 0' ERR` for non-blocking behavior
- `${CLAUDE_PLUGIN_ROOT}` resolved from env or script-relative fallback
- jq dependency check before JSON operations

### Integration Points
- `hooks.json` SessionStart array — install-deps.sh added as first entry
- `mcp-wrapper.sh` — extended with dep check before exec
- `runtime-deps.json` — read by install script, diffed against sentinel

</code_context>

<specifics>
## Specific Ideas

- Install script should follow same non-blocking pattern as session-start.sh (trap 'exit 0' ERR)
- The diff sentinel approach mirrors claude-mem's `.install-version` stamp pattern
- npm install output goes to stderr exclusively — MCP wrapper stdout must be pristine JSON-RPC

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 59-runtime-dependency-installation*
*Context gathered: 2026-03-21*
