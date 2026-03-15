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
