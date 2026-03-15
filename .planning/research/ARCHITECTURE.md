# Architecture Research

**Domain:** Claude Code plugin (skills + hooks + CLI installer)
**Researched:** 2026-03-15
**Confidence:** HIGH — sourced from official Claude Code documentation and live installed plugin inspection

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AllClear Plugin Root                          │
├─────────────────────────────────────────────────────────────────────┤
│  User Layer (invoke with /allclear:<name> or auto-trigger)           │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ skill:       │  │ skill:       │  │ skill:       │              │
│  │ quality-gate │  │ cross-impact │  │ drift        │              │
│  │ SKILL.md     │  │ SKILL.md     │  │ SKILL.md     │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │ skill:       │  │ skill:       │                                │
│  │ pulse        │  │ deploy-verify│                                │
│  │ SKILL.md     │  │ SKILL.md     │                                │
│  └──────────────┘  └──────────────┘                                │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Event Layer (fire automatically on Claude Code lifecycle events)    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  hooks/hooks.json                                          │     │
│  │                                                            │     │
│  │  PreToolUse  → file-guard.sh  (block sensitive files)     │     │
│  │  PostToolUse → format.sh      (auto-format edited file)   │     │
│  │  PostToolUse → lint.sh        (auto-lint edited file)     │     │
│  │  SessionStart→ session-start.sh (context injection)       │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Support Layer (shared by hooks and skills)                          │
│                                                                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │
│  │ scripts/      │  │ lib/          │  │ allclear.      │           │
│  │ (shell hooks) │  │ (detect.sh,   │  │ config.json   │           │
│  │               │  │  sibling.sh)  │  │ (optional)    │           │
│  └───────────────┘  └───────────────┘  └───────────────┘           │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Distribution Layer                                                  │
│                                                                      │
│  ┌────────────────────┐  ┌──────────────────────────────────┐      │
│  │ .claude-plugin/    │  │ bin/allclear-init.js              │      │
│  │ plugin.json        │  │ (npx @allclear/cli init)          │      │
│  │ (registry entry)   │  │                                   │      │
│  └────────────────────┘  └──────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|---------------|----------------|
| `skills/<name>/SKILL.md` | Prompt playbook for each quality-gate skill; tells Claude what to run, check, and report | Markdown with YAML frontmatter; references scripts in `${CLAUDE_SKILL_DIR}/scripts/` |
| `hooks/hooks.json` | Declares which lifecycle events trigger which shell scripts | JSON config mapping event names to script commands via `${CLAUDE_PLUGIN_ROOT}` |
| `scripts/format.sh` | Auto-format the file just edited; receives file path from hook stdin JSON | Shell script; reads `tool_input.file_path` from stdin; detects language and runs formatter |
| `scripts/lint.sh` | Auto-lint the file just edited; non-blocking (warns, does not exit 2) | Shell script; same detection pattern as format; outputs `systemMessage` JSON on failure |
| `scripts/file-guard.sh` | Block writes to sensitive paths (env files, secrets); runs PreToolUse | Shell script; exits 2 on match to deny the tool call; exits 0 to allow |
| `scripts/session-start.sh` | Inject repo context at session open (project type, sibling repos, health state) | Shell script; runs on SessionStart; outputs `additionalContext` JSON |
| `lib/detect.sh` | Shared language/project-type detection sourced by other scripts | Bash library; checks for pyproject.toml, Cargo.toml, package.json, go.mod |
| `lib/siblings.sh` | Shared cross-repo discovery (parent dir scan + allclear.config.json override) | Bash library sourced by impact/drift skills |
| `.claude-plugin/plugin.json` | Plugin identity, version, metadata for registry | Minimal JSON; name=allclear, version, author, license |
| `bin/allclear-init.js` | npx installer: detects install method, runs `claude plugin install`, writes symlink | Node.js CLI entry; entry in `package.json` `bin` field; published as `@allclear/cli` |
| `allclear.config.json` (project) | Optional project-level override: sibling repo paths, format/lint tool overrides | JSON; read by lib/detect.sh and lib/siblings.sh; absent = auto-detect only |
| `tests/` | Bats test suite for all shell scripts | `.bats` files; one per script |

## Recommended Project Structure

```
allclear/
├── .claude-plugin/
│   └── plugin.json               # Plugin manifest (name, version, description, license)
│
├── skills/
│   ├── quality-gate/
│   │   └── SKILL.md              # /allclear — run all quality checks for detected project type
│   ├── cross-impact/
│   │   └── SKILL.md              # /allclear impact — scan sibling repos for breaking changes
│   ├── drift/
│   │   └── SKILL.md              # /allclear drift — check consistency across sibling repos
│   ├── pulse/
│   │   └── SKILL.md              # /allclear pulse — live service health via kubectl
│   └── deploy-verify/
│       └── SKILL.md              # /allclear deploy — verify deploy state
│
├── hooks/
│   └── hooks.json                # Declares PreToolUse, PostToolUse, SessionStart bindings
│
├── scripts/
│   ├── format.sh                 # PostToolUse: auto-format edited file (non-blocking)
│   ├── lint.sh                   # PostToolUse: auto-lint edited file (non-blocking)
│   ├── file-guard.sh             # PreToolUse: block writes to sensitive paths (blocking)
│   └── session-start.sh          # SessionStart: inject project/sibling repo context
│
├── lib/
│   ├── detect.sh                 # Shared: detect project type from manifest files
│   └── siblings.sh               # Shared: discover sibling repos from parent dir or config
│
├── tests/
│   ├── format.bats
│   ├── lint.bats
│   ├── file-guard.bats
│   ├── session-start.bats
│   └── detect.bats
│
├── bin/
│   └── allclear-init.js          # npx @allclear/cli init — installs plugin into Claude Code
│
├── package.json                  # npm package: name="@allclear/cli", bin="bin/allclear-init.js"
├── allclear.config.json.example  # Documented example of optional project config
├── LICENSE                       # Apache 2.0
└── README.md
```

### Structure Rationale

- **skills/ at root:** Official Claude Code convention. Each subdirectory = one skill namespace under `/allclear:<name>`. Files beyond SKILL.md (scripts, references) can live alongside it.
- **hooks/ at root:** Official location. Claude Code auto-discovers `hooks/hooks.json`. Scripts referenced from hooks.json must use `${CLAUDE_PLUGIN_ROOT}/scripts/...` to survive plugin cache relocation.
- **scripts/ separate from skills/:** Hook scripts are invoked by the runtime, not loaded as skill content. Keeping them separate from skill directories avoids accidental inclusion as skill supporting files and clarifies the invocation path (runtime shell vs. LLM prompt).
- **lib/ for shared logic:** detect.sh and siblings.sh are needed by both hook scripts and skill prompts (via shell injection with `!`command``). Centralizing them prevents drift between implementations.
- **bin/ for npx entry:** Standard npm convention. `package.json` `bin` field points here. The installer runs `claude plugin install allclear@marketplace` or git-clone + symlink depending on detected environment.
- **tests/ flat:** Bats tests are integration-level; one file per script under test is idiomatic.

## Architectural Patterns

### Pattern 1: Hook Script communicates via JSON on stdout

**What:** Every hook script reads Claude Code's event JSON from stdin, does its work, and writes a JSON decision object to stdout. Claude Code reads this output to decide whether to block the action, inject context, or show a message to the user.

**When to use:** All four hooks (format, lint, file-guard, session-start) follow this pattern.

**Trade-offs:** Requires understanding the JSON protocol per event type. Benefit: hooks compose cleanly and the contract is explicit. Failure to parse stdin should always exit 0 (allow) to avoid blocking Claude.

**Example (PostToolUse lint hook, non-blocking):**
```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)  # read stdin once
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  exit 0  # nothing to lint
fi

# source shared detection
source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
LANG=$(detect_language "$FILE")

if ! run_lint "$LANG" "$FILE" 2>/tmp/allclear_lint_err; then
  MSG=$(cat /tmp/allclear_lint_err | head -20)
  printf '{"systemMessage": "AllClear lint: %s"}' "$(echo "$MSG" | jq -Rs .)"
fi
# exit 0 always — PostToolUse can't block, so non-blocking warning only
exit 0
```

### Pattern 2: PreToolUse File Guard (blocking)

**What:** PreToolUse hooks can deny a tool call by exiting with code 2. The file-guard hook checks the target path against a deny list and blocks writes to sensitive files.

**When to use:** Only PreToolUse supports blocking. PostToolUse is reactive and cannot prevent execution.

**Trade-offs:** Effective protection, but must be carefully tuned to avoid false blocks. The deny list should be configurable via allclear.config.json.

**Example (PreToolUse file-guard, blocking):**
```bash
#!/usr/bin/env bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

DENY_PATTERNS=('.env' '.env.*' '*.pem' '*.key' 'secrets.*' 'credentials.*')

for pat in "${DENY_PATTERNS[@]}"; do
  if [[ "$(basename "$FILE")" == $pat ]]; then
    echo "AllClear: blocked write to sensitive file: $FILE" >&2
    exit 2  # deny the tool call
  fi
done
exit 0
```

### Pattern 3: Skills as Orchestration Prompts

**What:** Each skill's SKILL.md is not a library — it is a prompt that tells Claude *what to do* when invoked. Skills can use `!`command`` to inject live shell output (current branch, project type, detected sibling repos) before Claude sees the prompt. Skills reference scripts in their own directory for complex logic.

**When to use:** All five quality-gate skills use this pattern. The prompt describes the check, the detection logic lives in lib/, and skill scripts handle heavy lifting.

**Trade-offs:** Skills are LLM-executed, not deterministic shell. This is correct for quality-gate reporting (summarization, cross-repo reasoning) but wrong for the hook layer (format/lint must run deterministically). Keep these concerns separated.

**Example (quality-gate SKILL.md frontmatter):**
```yaml
---
name: quality-gate
description: Run all quality checks for this project. Use when the user invokes /allclear, asks to run quality checks, or wants to verify code before commit.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: "[scope]"
---

Run quality checks for this project.

Project type: !`source ${CLAUDE_SKILL_DIR}/../../lib/detect.sh && detect_project_type .`

## Steps
1. Run tests (detect runner from project type above)
2. Run linter (detect from project type)
3. Run type checker if applicable
4. Report results: pass/fail per check with counts
```

### Pattern 4: Shared Library sourced by both hooks and skills

**What:** `lib/detect.sh` and `lib/siblings.sh` are bash libraries that hook scripts source directly (`source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"`) and that skills reference via `!`...`` shell injection. This is the single source of truth for project detection and sibling repo discovery.

**When to use:** Any time two components (hook + skill, or two skills) need the same detection logic.

**Trade-offs:** Shell libraries have no type system. Keep them small and focused. Test them independently with Bats.

## Data Flow

### Skill Invocation Flow

```
User types /allclear (or Claude auto-invokes)
    |
    v
Claude Code loads skills/quality-gate/SKILL.md into context
    |
    v
!`command` injections execute (detect project type, sibling repos)
    |
    v
Claude receives rendered prompt with live data
    |
    v
Claude invokes Bash tool to run linter/test/formatter
    |
    v
Claude synthesizes results and reports to user
```

### Hook Execution Flow (PostToolUse format/lint)

```
Claude calls Write or Edit tool on a file
    |
    v
Claude Code fires PostToolUse event
    |
    v
scripts/format.sh receives stdin JSON: {tool_name, tool_input: {file_path, ...}}
    |
    v
lib/detect.sh detects language from file extension + project manifest
    |
    v
Formatter/linter runs on file_path
    |
    |-- success --> exit 0 (silent)
    |-- failure --> stdout JSON {systemMessage: "..."} + exit 0 (non-blocking warn)
```

### Hook Execution Flow (PreToolUse file-guard)

```
Claude calls Write/Edit/MultiEdit tool
    |
    v
Claude Code fires PreToolUse event
    |
    v
scripts/file-guard.sh receives stdin JSON: {tool_name, tool_input: {file_path}}
    |
    |-- safe path  --> exit 0 (allow)
    |-- denied path --> stderr message + exit 2 (BLOCK — tool call denied)
```

### SessionStart Context Injection Flow

```
Claude Code session begins
    |
    v
scripts/session-start.sh fires (no file_path — scans cwd)
    |
    v
lib/detect.sh detects project type in cwd
lib/siblings.sh discovers sibling repos from ../
    |
    v
stdout JSON: {additionalContext: "Project: TypeScript\nSiblings: [api, ui, sdk]"}
    |
    v
Claude receives this context injected into session start
```

### npx Installer Flow

```
Developer runs: npx @allclear/cli init
    |
    v
bin/allclear-init.js checks for claude binary in PATH
    |
    v
Detect install preference:
  - Marketplace: claude plugin install allclear@official
  - Git+symlink: git clone → ln -s plugin/ ~/.claude/plugins/allclear
    |
    v
Write .claude/settings.json enabledPlugins entry (project scope)
    |
    v
Print confirmation + /allclear:quality-gate usage hint
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single-repo | All features work; cross-impact and drift skip gracefully if no siblings |
| 5-10 sibling repos | lib/siblings.sh scans parent dir; session-start context may grow large; cap sibling count at 10 |
| 50+ repos (monorepo-style) | allclear.config.json explicit list becomes required; auto-discovery too slow for SessionStart hook (10s timeout) |

### Scaling Priorities

1. **First bottleneck:** SessionStart hook timing. Claude Code enforces a timeout on hooks. With many siblings, the context injection script must complete quickly. Mitigation: cap sibling scan depth, cache detected project types in a temp file per session.
2. **Second bottleneck:** Format/lint hook latency on large files. PostToolUse runs synchronously before Claude continues. Keep hooks fast (< 5s) by running only the formatter for the specific file, not the whole project.

## Anti-Patterns

### Anti-Pattern 1: Putting format/lint logic inside SKILL.md

**What people do:** Write a skill prompt that tells Claude to run formatters after editing.

**Why it's wrong:** Skills are LLM-executed — Claude decides when to invoke them. Hooks are runtime-executed — they fire deterministically on every matching tool call. Format/lint must be hooks, not skills, to guarantee they run on every edit.

**Do this instead:** Put format and lint in PostToolUse hooks in `hooks/hooks.json`. Use skills only for interactive quality-gate reporting.

### Anti-Pattern 2: Using absolute paths in hooks.json

**What people do:** Write `"command": "/home/user/.claude/plugins/allclear/scripts/format.sh"`.

**Why it's wrong:** The plugin cache copies plugin files to `~/.claude/plugins/cache/<hash>/`. Absolute paths to the original plugin directory break after installation.

**Do this instead:** Always use `${CLAUDE_PLUGIN_ROOT}/scripts/format.sh`. This variable is set by Claude Code to the actual cache location.

### Anti-Pattern 3: Exiting with code 2 in PostToolUse

**What people do:** Exit 2 in a format or lint hook to block Claude after a failed format.

**Why it's wrong:** PostToolUse hooks cannot prevent a tool call — the tool already ran. Exiting 2 produces an error that confuses Claude and may interrupt its workflow. The PROJECT.md constraint "non-blocking hooks" is explicit here.

**Do this instead:** Exit 0 always from PostToolUse. Use `systemMessage` in stdout JSON to surface warnings to the user without blocking.

### Anti-Pattern 4: Duplicating detect logic in each script

**What people do:** Each hook script independently checks for pyproject.toml, Cargo.toml, etc.

**Why it's wrong:** Detection logic drifts. Adding Go support requires touching every script.

**Do this instead:** Centralise in `lib/detect.sh`, source it from every hook script and reference it from skill `!`command`` injections.

### Anti-Pattern 5: Putting plugin.json at the plugin root instead of .claude-plugin/

**What people do:** Place `plugin.json` directly in the plugin root directory.

**Why it's wrong:** Claude Code only recognizes the manifest at `.claude-plugin/plugin.json`. A root-level `plugin.json` is treated as application config (e.g., for an npm package), not as a plugin manifest.

**Do this instead:** Keep `.claude-plugin/plugin.json` for the Claude Code manifest. Keep `package.json` at the root for npm/npx distribution. They coexist without conflict.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| kubectl | Bash invocation in `scripts/pulse.sh` and `scripts/deploy-verify.sh` | Gracefully skip if kubectl not in PATH; pulse/deploy are optional/advanced per PROJECT.md |
| git | Bash invocation in all scripts | Required; cross-repo checks clone nothing, operate on local working trees only |
| npm/npx | bin/allclear-init.js distribution | @allclear/cli published to npm registry; installer is pure Node.js, no build step needed at install time |
| Claude Plugin Registry | `.claude-plugin/plugin.json` + marketplace.json | Submission via claude.ai/settings/plugins/submit |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| hooks/hooks.json → scripts/*.sh | JSON on stdin via `${CLAUDE_PLUGIN_ROOT}/scripts/` command paths | Scripts must be chmod +x; use `${CLAUDE_PLUGIN_ROOT}` not absolute paths |
| scripts/*.sh → lib/*.sh | Bash `source` directive | lib/ scripts are libraries, not executables; no shebang required but add one for direct testing |
| skills/*/SKILL.md → lib/*.sh | Shell injection via `!`source lib/detect.sh && ...`` | CLAUDE_SKILL_DIR points to skill subdirectory; use `../../lib/` relative path or `${CLAUDE_PLUGIN_ROOT}/lib/` |
| bin/allclear-init.js → Claude Code CLI | Child process spawn of `claude plugin install` | Falls back to git clone if claude binary not found |
| allclear.config.json → lib/siblings.sh, lib/detect.sh | File read at runtime | Optional; absence = auto-detect; presence = overrides |

## Build Order Implications

Dependencies determine which components can be built independently vs. which require prior components:

```
Phase 1 (Foundation — no dependencies):
  lib/detect.sh       ← nothing depends on this existing first, but everything else needs it
  lib/siblings.sh     ← same
  .claude-plugin/plugin.json  ← pure metadata

Phase 2 (Hooks — depend on lib/):
  scripts/file-guard.sh   ← needs lib/detect.sh for language context
  scripts/format.sh       ← needs lib/detect.sh
  scripts/lint.sh         ← needs lib/detect.sh
  scripts/session-start.sh ← needs lib/detect.sh + lib/siblings.sh
  hooks/hooks.json         ← wires events to scripts; build last in this phase

Phase 3 (Skills — depend on lib/, can reference scripts/):
  skills/quality-gate/SKILL.md   ← needs lib/detect.sh for !`injection`
  skills/cross-impact/SKILL.md   ← needs lib/siblings.sh
  skills/drift/SKILL.md          ← needs lib/siblings.sh
  skills/pulse/SKILL.md          ← standalone (kubectl optional)
  skills/deploy-verify/SKILL.md  ← standalone (kubectl optional)

Phase 4 (Tests — depend on all scripts):
  tests/*.bats        ← test each script in isolation with mocked stdin

Phase 5 (Distribution — wraps everything):
  package.json        ← npm package metadata
  bin/allclear-init.js ← installer; build after plugin is verified working
```

## Sources

- Claude Code Plugins Reference (official): https://code.claude.com/docs/en/plugins-reference
- Claude Code Skills Reference (official): https://code.claude.com/docs/en/skills
- Claude Code Hooks Reference (official): https://code.claude.com/docs/en/hooks
- Claude Code Plugin Creation Guide (official): https://code.claude.com/docs/en/plugins
- hookify plugin (official marketplace, live example): `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/`
- example-plugin (official marketplace, canonical reference): `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/example-plugin/`
- thedotmack/openclaw (live npx installer example): `/Users/ravichillerega/.claude/plugins/marketplaces/thedotmack/`

---
*Architecture research for: Claude Code plugin (AllClear — quality gates, hooks, CLI installer)*
*Researched: 2026-03-15*
