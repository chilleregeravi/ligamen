# Stack Research

**Domain:** Claude Code Plugin — quality gates, cross-repo checks, auto-format/lint hooks
**Researched:** 2026-03-15
**Confidence:** HIGH (primary sources: official Claude Code docs at code.claude.com, direct examination of installed plugins)

---

## Recommended Stack

### Core Plugin Format

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `.claude-plugin/plugin.json` | (schema v1) | Plugin manifest — name, version, description, author | Required entry point for the Claude Code plugin system; `name` field sets the skill namespace (e.g., `allclear:quality`) |
| `skills/<name>/SKILL.md` | (current) | Slash-command + autonomous skill definitions | Official format for user-invokable skills (`/allclear:quality`); replaces legacy `commands/` .md files; supports `$ARGUMENTS` for parameterized invocation |
| `hooks/hooks.json` | (current) | Hook event configuration | Canonical location; wraps `{"hooks": {...}}`; supports all event types including `PostToolUse`, `PreToolUse`, `SessionStart` |
| `${CLAUDE_PLUGIN_ROOT}` | — | Runtime path variable | Required for referencing plugin scripts in hooks — plugin is copied to cache on install, so absolute paths break |

### Distribution Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `.claude-plugin/marketplace.json` | (current) | Marketplace catalog listing this plugin | Required for `/plugin install allclear@<marketplace>` distribution; supports `source: github`, `source: npm`, `source: git-subdir` |
| npm (`@allclear/cli`) | Node.js 18+ | `npx @allclear/cli init` installer | Provides frictionless bootstrap path; `bin` field in package.json maps to CLI entry; standard `#!/usr/bin/env node` shebang pattern |
| Git clone + symlink | — | Manual install path | Second distribution channel; documented in README; users run `ln -s /path/to/allclear ~/.claude/plugins/local/allclear` |

### Hook Script Runtime

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bash (POSIX sh where possible) | sh/bash | Hook scripts | Claude Code `command` hooks execute shell; `jq` is the standard tool for parsing stdin JSON (`tool_input.file_path`, `tool_name`, etc.) |
| `jq` | 1.6+ | Parse hook stdin JSON | De-facto standard in all documented examples; parse `tool_input.file_path` from PostToolUse Write/Edit events |
| bats-core | 1.13.0 (2025-11-07) | Test hook shell scripts | Official recommended test framework for bash; PROJECT.md explicitly specifies bats; supports `run` helper, exit code assertions, fixture files |

### Supporting Libraries (npm / CLI)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js | 18+ (LTS) | `npx @allclear/cli init` runtime | Only needed for the CLI installer entrypoint; the plugin itself has zero Node.js runtime dep |
| `commander` or `minimist` | current | CLI argument parsing for init | If init needs `--config`, `--scope` flags; `commander` is heavier but more ergonomic; `minimist` is minimal |
| `bats-support` | current | bats helper: formatted failure output | Add as git submodule in `test/libs/`; improves test DX significantly |
| `bats-assert` | current | bats assertion library | Provides `assert_output`, `assert_success`, `assert_failure` — covers 90% of hook test needs |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `claude --plugin-dir ./allclear` | Load plugin locally for testing without install | Use during development; `--plugin-dir` can be specified multiple times |
| `/reload-plugins` | Hot-reload plugin changes in running session | Avoids restarting; LSP changes still need full restart |
| `claude plugin validate .` | Validate `plugin.json` and `marketplace.json` JSON syntax | Run before every push; catches missing commas, wrong field types |
| `chmod +x scripts/*.sh` | Make hook scripts executable | Hooks silently fail if script is not executable; always chmod in repo and verify |

---

## Installation

```bash
# Plugin directory structure bootstrap (no npm install needed for core plugin)
mkdir -p allclear/.claude-plugin
mkdir -p allclear/skills/quality allclear/skills/impact allclear/skills/drift
mkdir -p allclear/skills/pulse allclear/skills/deploy
mkdir -p allclear/hooks allclear/scripts

# CLI installer package
mkdir -p allclear/bin
npm init -y  # in allclear/
# Set "name": "@allclear/cli", "bin": {"allclear": "./bin/init.js"}

# Testing
git submodule add https://github.com/bats-core/bats-core test/bats
git submodule add https://github.com/bats-core/bats-support test/libs/bats-support
git submodule add https://github.com/bats-core/bats-assert test/libs/bats-assert

# Dev tool: run tests
./test/bats/bin/bats test/
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `skills/` + SKILL.md | `commands/` + .md files | Never for new plugins — commands/ is the legacy format; skills/ enables both slash-command and autonomous invocation |
| Bash hook scripts | Node.js hook scripts | If hook logic requires complex async (e.g., API calls, JSON manipulation beyond jq) — claude-mem uses Node for this reason |
| bats-core as git submodule | `brew install bats-core` or `npm install bats` | Global install acceptable in CI/CD; submodule is preferred for reproducibility and zero-setup on clone |
| `${CLAUDE_PLUGIN_ROOT}` in hook commands | Hardcoded paths | Never use hardcoded paths — plugin is cached to `~/.claude/plugins/cache/` on install, breaking absolute paths |
| Single GitHub repo + marketplace.json | Monorepo with git-subdir source | Use git-subdir if AllClear is eventually embedded in a larger Claude plugins monorepo |
| npm source in marketplace.json | github source | Use npm source if publishing to npmjs.org becomes primary; github source is simpler for open-source initial release |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `commands/` directory for new skills | Legacy format; does not support autonomous invocation by Claude; docs explicitly mark it for migration | `skills/<name>/SKILL.md` |
| Absolute paths in hook commands | Plugin is copied to `~/.claude/plugins/cache/` at install time — any path outside the plugin root breaks | `${CLAUDE_PLUGIN_ROOT}/scripts/...` |
| Placing `skills/`, `hooks/`, `agents/` inside `.claude-plugin/` | Official docs call this the most common structural mistake; those dirs must be at plugin root, only `plugin.json` goes inside `.claude-plugin/` | Place at plugin root |
| Blocking hooks for format/lint | PROJECT.md constraint: "Non-blocking hooks must not block edits on failure" — exit code 2 blocks the edit action | Use exit 0 with `systemMessage` for warnings, or rely on non-zero non-2 exit for non-blocking error display |
| External service dependencies in hooks | PROJECT.md constraint: "No external service deps" — hooks must work offline | Use git, local tools (ruff, cargo fmt, prettier, gofmt), kubectl only |
| `../` paths in plugin | Claude Code refuses path traversal outside plugin root during cache copy | Self-contained scripts; use symlinks if shared deps are needed |
| Setting version in both `plugin.json` and `marketplace.json` | `plugin.json` silently wins, marketplace version is ignored — causes version confusion | Set version in `plugin.json` only; omit from marketplace entry |

---

## Stack Patterns by Variant

**For format/lint hooks (PostToolUse Write|Edit):**
- Read `tool_input.file_path` from stdin with `jq -r '.tool_input.file_path'`
- Detect language from file extension: `.py` → ruff/black, `.rs` → rustfmt, `.ts/.tsx/.js` → prettier, `.go` → gofmt
- Exit 0 always (non-blocking); output `{"systemMessage": "..."}` to surface warnings

**For sensitive file guard (PreToolUse Write|Edit):**
- Check `tool_input.file_path` against a blocklist (`.env`, `*.pem`, `secrets.*`)
- Exit 2 with message on stderr to block; exit 0 to allow
- `permissionDecision: "deny"` in hookSpecificOutput for structured response

**For session start context (SessionStart):**
- Matcher: `startup|clear|compact`
- Output `additionalContext` field with cross-repo status summary
- Only `command` type is supported for SessionStart (not prompt or agent)

**For the CLI installer (`npx @allclear/cli init`):**
- `#!/usr/bin/env node` shebang in `bin/init.js`
- `"type": "module"` in package.json for ES module syntax
- Detection logic: find `.claude/` in HOME, write plugin symlink or copy files
- Ask user for scope (user/project) if interactive TTY

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Claude Code 1.0.33+ | plugin system (--plugin-dir, /plugin commands) | Minimum version for plugin dev support; run `claude --version` |
| bats-core 1.13.0 | bats-support (any), bats-assert (any) | No known breaking incompatibilities as of 2025-11-07 release |
| Node.js 18+ | npm 9+, npx | Node 18 is current LTS baseline; `package.json` should specify `"engines": {"node": ">=18.0.0"}` |
| hooks.json hook types | PostToolUse, PreToolUse, SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, TaskCompleted, TeammateIdle | All available as of current Claude Code docs; `command` type is universal; `prompt` and `agent` types not available for SessionStart |

---

## Sources

- `https://code.claude.com/docs/en/plugins` — Plugin structure, SKILL.md format, hooks.json location, --plugin-dir flag (HIGH confidence — official Anthropic docs, verified 2026-03-15)
- `https://code.claude.com/docs/en/plugins-reference` — Complete manifest schema, component paths, hook event types, LSP fields, CLI commands (HIGH confidence — official Anthropic docs)
- `https://code.claude.com/docs/en/hooks` — Hook stdin JSON format, stdout fields, exit code semantics, timeout defaults, blocking vs non-blocking events (HIGH confidence — official Anthropic docs)
- `https://code.claude.com/docs/en/plugin-marketplaces` — marketplace.json schema, npm/github/git-subdir sources, distribution patterns (HIGH confidence — official Anthropic docs)
- `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/` — Direct inspection of `hooks.json` (${CLAUDE_PLUGIN_ROOT} usage, SessionStart/PostToolUse patterns), `package.json` (Node 18 engines field, bun support), `skills/do/SKILL.md` (frontmatter format) (HIGH confidence — production plugin, local filesystem)
- `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/code-review/d5c15b861cd2/` — Direct inspection of `commands/code-review.md` frontmatter (allowed-tools, description, disable-model-invocation fields) (HIGH confidence — official Anthropic plugin)
- `https://github.com/bats-core/bats-core/releases/latest` — bats-core 1.13.0, released 2025-11-07 (HIGH confidence — GitHub API)

---

*Stack research for: Claude Code plugin (AllClear — quality gates, cross-repo checks, auto-format hooks)*
*Researched: 2026-03-15*

---
---

# Stack Addendum: v2 Service Dependency Intelligence

**Milestone:** v2.0 — Service Dependency Graph, Worker Process, MCP Server, Graph UI
**Researched:** 2026-03-15
**Confidence:** HIGH for core libraries (npm registry + GitHub releases verified); MEDIUM for ChromaDB integration (official JS client verified, MCP bridge pattern inferred from design)

This section covers only the **new** stack additions required for v2. The v1 stack above remains unchanged.

---

## New Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `better-sqlite3` | 12.8.0 (2026-03-13) | SQLite primary storage — sync API, WAL + FTS5 | Fastest Node.js SQLite library; fully synchronous API avoids callback complexity in a single worker process; ships with SQLite 3.51.3 which includes WAL + FTS5 natively. Requires Node.js v20+. Do NOT use the experimental `node:sqlite` built-in — it's still flagged `--experimental-sqlite` and not production-ready. |
| `fastify` | 5.8.2 | HTTP server for REST API + static UI serving | 2.4× faster than Express in benchmarks; built-in TypeScript support; `@fastify/static` plugin for serving the D3 graph UI HTML; native JSON schema validation removes need for external validator. v5 requires Node.js v20+, aligned with better-sqlite3. |
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server (stdio transport) exposing impact tools | Official Anthropic TypeScript SDK; `McpServer` + `StdioServerTransport` is the canonical pattern for stdio MCP servers. The worker process runs both HTTP and MCP concurrently — HTTP for the UI/REST API, stdio MCP for Claude agent consumption. Peer dep: zod ≥3.25. |
| `d3` | 7.9.0 | Force-directed graph visualization in browser UI | Stable v7 (last major release); `d3-force` subpackage handles force simulation, `d3-selection` + `d3-zoom` + `d3-drag` handle interactivity. Served as static HTML/JS from the worker's Fastify server. No build step needed — use ESM CDN import or bundle from npm. |
| `chromadb` | 3.3.3 | Optional vector storage client for semantic search | Official Chroma JS/TS client v3 (complete rewrite June 2025); ~70% smaller bundle vs v2; talks to a running ChromaDB HTTP server over REST. This is the optional acceleration layer only — the system works fully without it via FTS5. |

---

## New Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.25+ | Schema validation for MCP tool parameters | Required peer dep of `@modelcontextprotocol/sdk`; use for validating `impact_query`, `impact_scan`, etc. tool inputs |
| `@fastify/static` | current | Serve D3 graph HTML + assets from worker | Register once pointing at `worker/ui/` dir; handles `index.html`, `d3.js`, CSS |
| `@fastify/cors` | current | CORS headers for REST API | Needed if the graph UI is ever opened from a different origin than localhost; also useful during development when testing from `file://` |
| `@types/better-sqlite3` | current | TypeScript types for better-sqlite3 | Dev dependency; only if worker is written in TypeScript |
| `@types/d3` | current | TypeScript types for D3 | Dev dependency; only for TypeScript-authored UI code |

---

## Worker Process Architecture

The AllClear worker is a **single Node.js process** (`worker/index.js`) that runs:

1. **Fastify HTTP server** on `localhost:PORT` (default `37888`) — REST API + static D3 UI
2. **MCP stdio server** — reads from stdin, writes to stdout; registered in Claude Code settings as an MCP server entry pointing to the worker executable

These two transports share the same in-process query engine and SQLite connection. No inter-process communication needed.

**PID file pattern** (no external daemon manager):

```javascript
// worker/index.js startup
import fs from 'fs';
import path from 'path';

const PID_FILE = path.join(process.env.ALLCLEAR_DATA_DIR, '.allclear/worker.pid');

// Write PID on start
fs.writeFileSync(PID_FILE, String(process.pid));

// Clean up on exit
function shutdown() {
  fs.rmSync(PID_FILE, { force: true });
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
```

**Port availability check** (before binding):

```javascript
import net from 'net';

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}
```

The `/allclear:map` and `/allclear:cross-impact` shell scripts check for the PID file and send a `curl localhost:PORT/health` probe before invoking the worker. If no worker is running, they `node worker/index.js &` with `nohup` and wait for the health endpoint.

---

## SQLite Configuration

```javascript
import Database from 'better-sqlite3';

const db = new Database(path.join(dataDir, '.allclear/impact-map.db'));

// Required configuration
db.pragma('journal_mode = WAL');       // concurrent readers, single writer
db.pragma('foreign_keys = ON');        // enforce FK constraints
db.pragma('synchronous = NORMAL');     // safe with WAL; faster than FULL
db.pragma('cache_size = -64000');      // 64MB page cache

// FTS5 virtual table for endpoint/schema search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
    path,
    protocol,
    source_file,
    target_file,
    content='connections',
    content_rowid='id'
  );
`);
```

**WAL checkpoint note:** better-sqlite3 is single-threaded synchronous. The worker never uses `worker_threads` for database access — one connection, one thread. This avoids WAL checkpoint starvation entirely. All HTTP requests are handled by Fastify's async event loop, serialized through the synchronous SQLite calls (fast enough for local use; no concurrency pressure expected).

---

## MCP Server Pattern

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const mcp = new McpServer({ name: 'allclear-impact', version: '2.0.0' });

mcp.tool('impact_query', 'Find services consuming or exposing an endpoint', {
  service: z.string(),
  endpoint: z.string().optional(),
  direction: z.enum(['consumes', 'exposes']).default('consumes'),
  transitive: z.boolean().default(false),
}, async ({ service, endpoint, direction, transitive }) => {
  // delegate to QueryEngine (same instance used by HTTP API)
  const results = queryEngine.impact(service, endpoint, direction, transitive);
  return { content: [{ type: 'text', text: JSON.stringify(results) }] };
});

// Connect stdio transport (separate from HTTP server)
const transport = new StdioServerTransport();
await mcp.connect(transport);
```

The MCP server and Fastify HTTP server run in the same Node.js process. The MCP transport consumes stdin/stdout; Fastify binds a TCP socket. They don't conflict.

**MCP server registration** in user's Claude Code settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "allclear-impact": {
      "command": "node",
      "args": ["/path/to/allclear/worker/index.js", "--mcp-only"]
    }
  }
}
```

The `/allclear:map` skill writes this entry automatically after first scan.

---

## ChromaDB Integration

chroma-mcp (the official Python MCP server from chroma-core) is a **Python process** — it is not used directly. Instead, AllClear uses the official `chromadb` npm package (v3.3.3) to talk directly to a running ChromaDB HTTP server.

```javascript
import { ChromaClient } from 'chromadb';

// Only instantiated if config.chroma is present
const chroma = new ChromaClient({
  path: `${config.chroma.ssl ? 'https' : 'http'}://${config.chroma.host}:${config.chroma.port}`,
  auth: config.chroma['api-key']
    ? { provider: 'token', credentials: config.chroma['api-key'] }
    : undefined,
});

const collection = await chroma.getOrCreateCollection({ name: 'allclear-connections' });
```

The `chromadb` v3 package removed bundled embedding functions. For semantic search, use `@chroma-core/default-embed` (installs the default embedding function separately). AllClear's fallback chain (vector → FTS5 → direct SQL) means ChromaDB failure is non-fatal.

---

## D3.js Graph UI

The graph UI is a single `worker/ui/index.html` file with inline or adjacent JS. No build step, no React, no bundler required for the UI. Fastify serves it as a static file.

```html
<!-- worker/ui/index.html -->
<script type="module">
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Fetch graph data from local REST API
const { nodes, links } = await fetch('/graph').then(r => r.json());

const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(width / 2, height / 2));
</script>
```

For production distribution (offline use, no CDN dependency), bundle `d3` via esbuild:

```bash
# Bundle D3 into worker/ui/d3.bundle.js
npx esbuild node_modules/d3/src/index.js --bundle --format=esm \
  --outfile=worker/ui/d3.bundle.js --platform=browser
```

---

## Bundling and Distribution

The worker process is distributed as source (`worker/` directory in the plugin repo). No pre-bundling is required for correctness. For the optional npm distribution path:

```bash
# Bundle worker to single file for npm package inclusion
npx esbuild worker/index.js \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:better-sqlite3 \
  --external:@modelcontextprotocol/sdk \
  --outfile=dist/worker.js
```

`better-sqlite3` must be external because it contains native binaries (`.node` addon) that cannot be bundled. It must be installed as a runtime dependency, not inlined.

**Package.json additions** for the worker:

```json
{
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "fastify": "^5.8.2",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "chromadb": "^3.3.3",
    "zod": "^3.25.0"
  },
  "optionalDependencies": {
    "@chroma-core/default-embed": "^1.0.0"
  }
}
```

D3 is a **browser-side** dependency, not a Node.js dependency. It is either loaded via CDN in `index.html` or bundled as a static asset — it does not appear in the Node.js `dependencies`.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `better-sqlite3` | `node:sqlite` (built-in) | `node:sqlite` requires `--experimental-sqlite` flag; not production-stable as of Node.js 22/24; no FTS5 examples confirmed in production use |
| `better-sqlite3` | `bun:sqlite` | Bun is not the AllClear runtime; better-sqlite3 works across all Node.js LTS versions the plugin must support |
| `fastify` v5 | `express` v5 | Fastify is 2.4× faster; first-class TypeScript; built-in schema validation; `@fastify/static` is purpose-built. Express is reasonable if team prefers it but offers no advantage here |
| `fastify` v5 | Native `http.createServer` | Native http lacks routing, static file serving, CORS middleware — would need manual reimplementation of what Fastify provides for free |
| `chromadb` npm package | Running `chroma-mcp` as Python subprocess | chroma-mcp is Python-only; spawning a Python subprocess from the Node.js worker adds OS dependency, version conflicts, and startup latency. The `chromadb` npm package talks directly to ChromaDB's HTTP REST API |
| D3.js v7 via CDN/bundle | Observable Plot | D3 provides the force simulation primitives needed for a dependency graph; Plot is higher-level and not suited for custom force-directed layouts |
| D3.js v7 | Cytoscape.js | Cytoscape is heavier (~400KB) and more suited for pre-defined graph layouts; D3 force simulation is the standard for exploratory dependency graphs |
| Single-process worker (HTTP + MCP stdio) | Separate HTTP process + MCP process | Single process shares the SQLite connection and query engine with zero IPC overhead; two processes would require a shared DB or RPC layer |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node:sqlite` (built-in) | Experimental flag required; no FTS5 production examples; API still changing | `better-sqlite3` |
| `bun:sqlite` | AllClear targets Node.js, not Bun; introduces runtime dependency assumption | `better-sqlite3` |
| `sequelize` or `prisma` ORM | Heavy abstractions over SQLite add complexity, break raw FTS5 queries, and add significant bundle size for what is essentially a local file database | Raw `better-sqlite3` with prepared statements |
| `ws` or `socket.io` WebSocket library | The graph UI doesn't need real-time push; polling `/graph` on demand is sufficient | Fastify REST + browser `fetch()` |
| `pm2` or `forever` for worker management | Overkill for a local dev tool; adds a global npm install requirement for the user; PID file + signal handling is sufficient | Native Node.js `process.on('SIGTERM')` + PID file |
| React / Vue / Svelte for graph UI | A build step in the plugin adds complexity for users cloning/installing it; D3 in a single HTML file requires no toolchain | Vanilla JS + D3 + inline `<script type="module">` |
| TypeScript compilation step in the plugin | Plugin files are executed directly by Node.js or Claude Code; a required `tsc` build step breaks the zero-config install promise | Plain JavaScript (JSDoc types for IDE support if needed) |
| `axios` or `node-fetch` for HTTP client | Node.js 20+ has native `fetch`; no additional HTTP client needed | Native `fetch()` (Node.js 20 global) |

---

## Version Compatibility (v2 additions)

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `better-sqlite3` 12.8.0 | Node.js 20+ | v12.8.0 raised minimum to Node.js v20; verified 2026-03-13. SQLite 3.51.3 bundled (includes WAL-reset fix) |
| `fastify` 5.8.2 | Node.js 20+ | v5 dropped Node.js 18 support; `@fastify/static` v8+ required for Fastify v5 |
| `@modelcontextprotocol/sdk` 1.27.1 | `zod` ≥3.25 | SDK imports from `zod/v4` internally but accepts zod v3.25+ via compatibility shim |
| `chromadb` 3.3.3 | ChromaDB server 0.5+ | v3 JS client is a full rewrite; incompatible with v2 API; requires separately installed embedding functions |
| `d3` 7.9.0 | Modern browsers (ES2017+) | v7 is the current stable; no v8 announced; ESM import works in all modern browsers |
| Node.js 20+ | All above | The minimum Node.js version for v2 worker is Node.js 20 (LTS), driven by better-sqlite3 12.x and fastify v5 |

---

## Sources (v2 addendum)

- `https://github.com/WiseLibs/better-sqlite3/releases` — v12.8.0 released 2026-03-13, Node.js v20+ required, SQLite 3.51.3 (HIGH confidence — GitHub releases, verified)
- `https://github.com/WiseLibs/better-sqlite3/discussions/1245` — Community discussion "Should I use better-sqlite3 over Node 22 core sqlite?" concluding node:sqlite not production-ready (MEDIUM confidence — community discussion)
- `https://github.com/WiseLibs/better-sqlite3/issues/1266` — `node:sqlite` benchmarking thread confirming better-sqlite3 still leads performance (MEDIUM confidence)
- `https://github.com/fastify/fastify/releases` — Fastify 5.8.2 current, Node.js v20+ required (HIGH confidence — GitHub releases)
- `https://github.com/modelcontextprotocol/typescript-sdk/releases` — @modelcontextprotocol/sdk v1.27.1 current (HIGH confidence — GitHub releases, verified 2026-03-15)
- `https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/` — StdioServerTransport pattern confirmed (MEDIUM confidence — official MCP docs)
- `https://d3js.org/getting-started` — D3 v7.9.0 confirmed current stable, ESM import pattern (HIGH confidence — official D3 docs)
- `https://www.trychroma.com/changelog/js-client-v3` — chromadb v3 rewrite changelog; v3.3.3 current (HIGH confidence — official Chroma changelog)
- `https://github.com/chroma-core/chroma-mcp` — chroma-mcp is Python-only (uvx command); no Node.js version exists (HIGH confidence — GitHub repo inspection)
- `https://esbuild.github.io/getting-started/` — esbuild `--external` flag for native modules, `--platform=node` pattern (HIGH confidence — official esbuild docs)
- `https://github.com/fastify/fastify-static` — @fastify/static for SPA serving pattern (HIGH confidence — official Fastify plugin)

---

*Stack research addendum for: AllClear v2 — Service Dependency Intelligence (worker, SQLite, MCP, D3, ChromaDB)*
*Researched: 2026-03-15*
