# Project Research Summary

**Project:** AllClear — Claude Code quality gate plugin
**Domain:** Claude Code plugin (quality gates, cross-repo checks, auto-format/lint hooks)
**Researched:** 2026-03-15
**Confidence:** HIGH

## Executive Summary

AllClear is a Claude Code plugin delivering automatic code quality enforcement (format, lint, sensitive file protection) through the hooks system, and active cross-repo intelligence (impact scanning, drift detection) through the skills system. The plugin ecosystem is well-documented via official Anthropic sources and live plugin inspection, making the technical path clear. The canonical build pattern separates concerns into three layers: an event layer (hooks that fire deterministically on every Claude edit), a user layer (skills invoked interactively via slash-commands), and a shared library layer (bash scripts for project-type detection and sibling repo discovery). This separation is load-bearing — mixing concerns between layers is the primary source of failure in comparable plugins.

The recommended approach is to build foundation first (directory structure, npm org reservation, shared detection library), then hooks (auto-format, lint, file guard), then skills (quality gate, cross-repo impact), then tests and distribution. The architecture research confirms a natural 5-phase build order where each phase has no circular dependencies on later phases. The key differentiator — cross-repo impact scanning — is technically feasible using pure bash with local git operations, requires no external services, and addresses a gap that the closest competitor (Plankton) explicitly does not cover.

The critical risks are structural and operational, not conceptual. The top three: (1) misplaced component directories silently disable the entire plugin with no error output; (2) format/lint hooks that exit non-zero block Claude's edit cycle, violating the core non-blocking contract; and (3) the npm org `@allclear` must be reserved before any public announcement or documentation ships or it can be squatted. All three risks are preventable at low cost if addressed in Phase 1.

## Key Findings

### Recommended Stack

The plugin requires no external framework beyond the Claude Code plugin system itself. The core stack is: POSIX shell scripts for hooks, `jq` for stdin JSON parsing, SKILL.md files for slash-command definitions, and `hooks.json` for event wiring. The only runtime dependency for end users is the underlying formatters/linters they already have installed (ruff, cargo fmt, prettier, gofmt, go vet). The npx installer (`@allclear/cli`) uses Node.js 18+ for the setup script only — the plugin itself has zero Node.js runtime dependency. Tests use bats-core 1.13.0 as git submodules for reproducibility.

**Core technologies:**
- `skills/<name>/SKILL.md`: Slash-command and autonomous skill definitions — official format supporting both `/allclear` and autonomous invocation; use `skills/` not legacy `commands/`
- `hooks/hooks.json`: Lifecycle event bindings — canonical location; all event types available; event names are PascalCase and case-sensitive
- POSIX bash + `jq`: Hook script runtime — `jq` parses hook stdin JSON; scripts must be `chmod +x`; always use `${CLAUDE_PLUGIN_ROOT}` never hardcoded paths
- `lib/detect.sh` + `lib/siblings.sh`: Shared bash libraries — single source of truth for project-type detection and sibling repo discovery; sourced by hooks and injected into skills
- `bats-core` 1.13.0: Hook test framework — mandatory per PROJECT.md constraints; add as git submodule with `bats-support` and `bats-assert`
- `@allclear/cli` (Node.js 18+): npx installer — `#!/usr/bin/env node` entry, ES module syntax, installs plugin to `~/.claude/plugins/` via `claude plugin install` or git+symlink fallback
- `.claude-plugin/plugin.json`: Plugin manifest — only this file goes inside `.claude-plugin/`; all other directories (skills/, hooks/, scripts/, lib/) go at plugin root

### Expected Features

The feature research confirms a clear MVP boundary. Project-type auto-detection is the single foundational feature that all others depend on; it must ship first. The non-blocking hook behavior (warn, never interrupt) is both a PROJECT.md constraint and a user expectation set by the broader quality tooling ecosystem.

**Must have (table stakes):**
- Auto-format on file write (PostToolUse, non-blocking) — users expect this from any quality tool since 2020
- Auto-lint on file write (PostToolUse, non-blocking) — paired with format; completes the "every edit is clean" promise
- Sensitive file guard (PreToolUse, blocking on `.env`, `*.pem`, `secrets.*`) — security expectation; absence is a trust issue
- Single-command quality gate (`/allclear`) — zero flags, auto-detects project type; missing this = feels incomplete
- Project-type auto-detection from manifest files — zero-config is the baseline; required by all three above
- `npx @allclear/cli init` installer — frictionless install is a table-stakes expectation for plugin distribution

**Should have (competitive):**
- Cross-repo sibling repo discovery — foundation for impact and drift; build even if /impact ships first
- `/allclear impact` — primary differentiator; no existing Claude Code plugin detects cross-repo API breaks; directly addresses the Edgeworks pain case
- `/allclear drift` — config consistency across repos; second cross-repo feature sharing discovery foundation
- SessionStart context injection — primes Claude with repo topology; blocked by upstream bug (only fires on /clear, not brand-new sessions); use UserPromptSubmit fallback or document limitation
- `allclear.config.json` override layer — escape hatch for non-flat repo layouts; load-bearing for real-world adoption
- Go support — Plankton explicitly omits Go; AllClear covering Python, Rust, TypeScript, AND Go is a genuine differentiator

**Defer (v2+):**
- `/allclear pulse` (kubectl service health) — add when k8s users represent meaningful adoption share
- `/allclear deploy` (deploy state verification) — same gate as pulse; advanced/optional
- LSP server bundling — real-time diagnostics beyond hooks; high complexity; defer until hooks prove insufficient

### Architecture Approach

The architecture is a three-layer plugin with clean separation: a deterministic event layer (hooks that fire on every Claude tool call), an LLM-orchestrated user layer (skills that Claude executes when invoked), and a shared library layer that both consume. This separation is critical — format/lint logic belongs in hooks, not skills, because skills are LLM-executed and not guaranteed to fire on every edit. The build order is strictly sequential within phases: lib/ first, then scripts/ (hooks), then skills/, then tests/, then distribution.

**Major components:**
1. `lib/detect.sh` + `lib/siblings.sh` — shared bash libraries; single source of truth for project-type detection and cross-repo discovery; sourced by hooks and referenced via `!`command`` injection in skills
2. `hooks/hooks.json` + `scripts/*.sh` — event layer; PreToolUse fires file-guard.sh (blocking); PostToolUse fires format.sh and lint.sh (non-blocking, always exit 0); SessionStart fires session-start.sh (context injection)
3. `skills/*/SKILL.md` — user layer; five skills (quality-gate, cross-impact, drift, pulse, deploy-verify); each SKILL.md is a prompt playbook with live shell injection for context
4. `bin/allclear-init.js` + `package.json` — distribution layer; npx installer; detects install method; published as `@allclear/cli`
5. `tests/*.bats` — validation layer; one bats file per script; verifies exit codes, stdout/stderr separation, non-blocking behavior

### Critical Pitfalls

1. **Misplaced component directories** — Only `plugin.json` belongs inside `.claude-plugin/`. Putting `skills/`, `hooks/`, or `scripts/` there causes silent failure with zero error output. Establish canonical directory structure in Phase 1 and validate with `claude plugin validate` before writing any content.

2. **Non-zero exit codes in PostToolUse hooks** — Format/lint hooks that exit 1 or 2 block Claude's edit cycle, violating the PROJECT.md non-blocking constraint. Every PostToolUse hook must always exit 0; route errors to stderr as informational output; add a bats test asserting exit 0 when the formatter is absent.

3. **Absolute paths instead of `${CLAUDE_PLUGIN_ROOT}`** — Hardcoded paths work locally but break after marketplace install because the plugin is copied to a content-addressed cache directory. Use `${CLAUDE_PLUGIN_ROOT}/scripts/...` in all hook commands from day one.

4. **PreToolUse vs PostToolUse JSON schema confusion** — The sensitive file guard uses PreToolUse blocking, which requires `hookSpecificOutput.permissionDecision: "deny"` — not the PostToolUse `decision: "block"` format. Using the wrong schema causes the hook to fire but writes to proceed silently. This is the highest-security pitfall in the project.

5. **npm org not reserved before documentation ships** — `@allclear/cli` requires owning the `allclear` npm organization. Reserve it and publish a placeholder `0.0.1` package in Phase 1, before the package name appears in any README or docs.

## Implications for Roadmap

Based on research, the architecture's build order directly maps to phases. The dependency graph has no cycles and the natural ordering is: foundation → hooks → skills → tests → distribution.

### Phase 1: Foundation

**Rationale:** Three Phase 1 pitfalls (misplaced directories, non-executable scripts, npm org squatting) can permanently break the project if not resolved first. Directory structure and npm reservation are prerequisite to all other work.
**Delivers:** Canonical plugin skeleton, shared detection library, npm org `@allclear` reserved, placeholder `0.0.1` published, `claude plugin validate` passing with no skills yet
**Addresses:** Project-type auto-detection (`lib/detect.sh`), cross-repo sibling discovery (`lib/siblings.sh`), `.claude-plugin/plugin.json` manifest
**Avoids:** Misplaced component directories pitfall, npm org squatting pitfall, absolute path pitfall (establish `${CLAUDE_PLUGIN_ROOT}` convention from first file)

### Phase 2: Hooks (Event Layer)

**Rationale:** Hooks deliver the highest-frequency user value (every edit auto-formatted and linted) and establish the non-blocking contract that everything else depends on. Building hooks before skills validates the hook architecture before adding skill complexity.
**Delivers:** Auto-format hook (PostToolUse, Python/Rust/TypeScript/Go), auto-lint hook (PostToolUse), sensitive file guard (PreToolUse, blocking), SessionStart context injection
**Addresses:** Auto-format on write, auto-lint on write, sensitive file guard, non-blocking hook behavior (all table-stakes features)
**Avoids:** Non-blocking exit code pitfall, stdout pollution pitfall, wrong event name casing pitfall, PreToolUse/PostToolUse schema confusion pitfall

### Phase 3: Skills (User Layer)

**Rationale:** Skills build on the shared libraries established in Phase 1 and complement the hooks established in Phase 2. The quality gate skill is the primary user-facing interface. Cross-repo impact scanning is the primary differentiator and should ship in v1 to validate the unique value proposition.
**Delivers:** `/allclear` quality gate skill, `/allclear impact` cross-repo impact scanning, `/allclear drift` drift detection, `allclear.config.json` override layer
**Addresses:** Single-command quality gate, cross-repo impact scanning, cross-repo drift detection, config override for non-flat layouts
**Avoids:** Cross-repo flat layout assumption pitfall (build config override from day one, not as afterthought)

### Phase 4: Tests (Validation Layer)

**Rationale:** PROJECT.md mandates bats tests. Tests must cover the non-blocking guarantee (format/lint exit 0 when tools absent), the blocking guarantee (file guard exits 2 on sensitive paths), and the PreToolUse JSON schema correctness. Testing after hooks and skills are working enables integration-level coverage.
**Delivers:** Full bats test suite (`tests/format.bats`, `lint.bats`, `file-guard.bats`, `session-start.bats`, `detect.bats`), CI integration, `claude plugin validate` in CI
**Addresses:** Bats test suite (competitive differentiator — no competing plugin has one), non-blocking hook verification, security schema verification
**Avoids:** All hook-layer pitfalls through test assertions; version-not-bumped pitfall via CI check

### Phase 5: Distribution

**Rationale:** Distribution comes last because the installer can only be tested against a working plugin. The marketplace submission requires a verified, tested plugin.
**Delivers:** `npx @allclear/cli init` installer, marketplace.json, README with install paths, plugin registry submission
**Addresses:** Installable via standard channels (table stakes), discoverability
**Avoids:** Version-not-bumped pitfall (release checklist/CI check before marketplace push)

### Phase Ordering Rationale

- `lib/` before `scripts/` before `skills/` is dictated by the dependency graph in ARCHITECTURE.md — each phase sources or references the prior phase
- Hooks before skills because hooks are deterministic (verifiable in isolation) while skills are LLM-orchestrated (harder to test) — validate the simpler layer first
- Tests as a dedicated phase rather than inline because bats test structure benefits from testing completed scripts, not works-in-progress; the bats submodule setup is also a meaningful setup cost
- Distribution last because `npx @allclear/cli init` installer requires a stable, marketplace-ready plugin to install; testing the installer against an unstable plugin wastes cycles
- Phase 1 npm org reservation is a one-time action that must happen before Phase 5 distribution; embedding it in Phase 1 ensures it cannot be forgotten

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Skills):** SKILL.md `!`command`` injection syntax for referencing `lib/` from a skill subdirectory needs verification against current Claude Code runtime — the `${CLAUDE_SKILL_DIR}/../../lib/` relative path pattern should be confirmed before implementation
- **Phase 3 (Skills):** SessionStart known bug (doesn't fire on brand-new sessions, only on /clear/compact/resume) — track upstream issue #10373; decide at planning time whether to implement UserPromptSubmit fallback or document the limitation
- **Phase 5 (Distribution):** Marketplace submission process (`claude.ai/settings/plugins/submit`) — verify current submission requirements and review timeline before scheduling Phase 5

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Directory structure and plugin.json manifest are fully documented in official docs with no ambiguity
- **Phase 2 (Hooks):** Hook stdin/stdout JSON protocol, exit code semantics, and non-blocking patterns are all verified from official docs and live plugin inspection; patterns are copy/paste ready
- **Phase 4 (Tests):** bats-core testing patterns are well-established; bats-support and bats-assert cover all hook assertion needs

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Sourced from official Claude Code docs + live plugin inspection of claude-mem and code-review plugins in local cache; all version requirements confirmed |
| Features | HIGH | Table stakes verified against Plankton, Safety Net, sensitive-canary direct inspection; differentiators confirmed by competitor gap analysis; SessionStart bug confirmed via official issue tracker |
| Architecture | HIGH | Build order validated by official plugin creation guide; component boundaries confirmed by live hookify and example-plugin inspection; anti-patterns sourced from official common mistakes documentation |
| Pitfalls | HIGH | Critical pitfalls sourced from official docs warnings + live plugin pattern inspection; exit code semantics confirmed from hooks reference; PreToolUse JSON schema confirmed from official spec |

**Overall confidence:** HIGH

### Gaps to Address

- **SessionStart new-session bug:** As of March 2026, SessionStart hooks do not fire on brand-new sessions (only /clear, /compact, resume). Decision needed at Phase 3 planning: implement UserPromptSubmit fallback or document limitation. Track upstream issue #10373.
- **Skill namespace in `/help`:** The exact slash-command that appears to users (e.g., `/allclear` vs `/allclear:quality-gate`) depends on how Claude Code namespaces the plugin's skills. Verify in a dev session with `--plugin-dir` before finalizing skill names in SKILL.md frontmatter.
- **`${CLAUDE_SKILL_DIR}` relative path to `lib/`:** Skills reference `lib/detect.sh` via shell injection. The path `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` assumes a two-level skills directory layout. Confirm this resolves correctly at runtime — the alternative `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` may be more reliable.
- **Mixed-language repo detection:** `lib/detect.sh` must handle repos containing both `package.json` and `pyproject.toml` (e.g., TypeScript frontend + Python backend). Priority logic for multi-manifest repos is not specified in research; needs a design decision.

## Sources

### Primary (HIGH confidence)
- `https://code.claude.com/docs/en/plugins` — Plugin structure, SKILL.md format, hooks.json location, --plugin-dir flag, common structural mistakes warning
- `https://code.claude.com/docs/en/plugins-reference` — Complete manifest schema, component paths, hook event types, `${CLAUDE_PLUGIN_ROOT}`, version caching behavior
- `https://code.claude.com/docs/en/hooks` — Hook stdin JSON format, stdout fields, exit code semantics (blocking vs non-blocking), PreToolUse `permissionDecision` schema, PostToolUse `systemMessage` schema
- `https://code.claude.com/docs/en/plugin-marketplaces` — marketplace.json schema, npm/github/git-subdir sources
- `https://code.claude.com/docs/en/skills` — SKILL.md frontmatter, `disable-model-invocation`, `!`command`` injection, `CLAUDE_SKILL_DIR`
- `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/` — Live `${CLAUDE_PLUGIN_ROOT}` fallback pattern, hooks.json structure, Node.js 18 engines field
- `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/code-review/d5c15b861cd2/` — Minimal plugin.json pattern, commands/code-review.md frontmatter
- `https://github.com/bats-core/bats-core/releases/latest` — bats-core 1.13.0, released 2025-11-07
- `https://github.com/anthropics/claude-code/issues/10373` — SessionStart hook new-session bug (confirmed via official repo)

### Secondary (MEDIUM confidence)
- `https://github.com/alexfazio/plankton` — Competitor feature analysis; Go omission confirmed; three-phase lint architecture
- `https://github.com/kenryu42/claude-code-safety-net` — Sensitive file guard patterns, destructive command guard
- `https://dev.to/chataclaw/stop-claude-code-from-leaking-your-secrets-introducing-sensitive-canary-826` — Sensitive-canary feature comparison
- `https://blakecrosley.com/blog/claude-code-hooks-tutorial` — Hook patterns (matches official docs, third-party confirmation)
- `https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption` — Non-blocking design principle, discoverability requirements
- `https://composio.dev/content/top-claude-code-plugins` — Plugin ecosystem landscape, AllClear gap identification

### Tertiary (LOW confidence)
- `https://www.datacamp.com/tutorial/how-to-build-claude-code-plugins` — Community-confirmed structural mistakes (consistent with official docs warnings)

---
*Research completed: 2026-03-15*
*Ready for roadmap: yes*
