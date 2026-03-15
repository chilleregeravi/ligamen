# Feature Research

**Domain:** Claude Code plugin — developer quality automation for multi-repo polyglot teams
**Researched:** 2026-03-15
**Confidence:** HIGH (Claude Code plugin API verified via official docs; ecosystem via multiple confirmed sources)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Auto-format on file write | Every quality tool since 2020 does this; Plankton, Prettier, Black set the expectation | LOW | PostToolUse on Write/Edit matcher; must be non-blocking (warn on failure, never block) |
| Auto-lint on file write | Same expectation as format; Plankton, Biome, Ruff all do this | LOW | PostToolUse; collect violations as JSON; warn Claude, don't block |
| Single-command quality gate | `/allclear` must run ALL checks with zero flags; users leave if they must configure per-check | MEDIUM | SKILL.md auto-detects project type via pyproject.toml, Cargo.toml, package.json, go.mod |
| Project type auto-detection | Zero-config is now the baseline (Biome, Ultracite, Ruff all advertise it); requiring config = friction | MEDIUM | Detect from manifest files; fall back to file extensions; Python/Rust/TS/Go coverage required |
| Sensitive file guard | Security hooks are now expected in serious quality plugins; sensitive-canary, Safety Net set precedent | MEDIUM | PreToolUse hook; block reads/writes to .env, credentials, secrets; exit code 2 to block |
| Non-blocking hook behavior | Quality tools must never interrupt the flow of work — warn and continue is the standard | LOW | Exit code 1 = warn only; exit code 2 = block (reserved for hard security stops only) |
| Installable via standard channels | Plugin registry + git clone are the two paths users check first | LOW | plugin.json manifest, npx @allclear/cli init, git clone + symlink — all three channels |
| Help and discoverability | Users abandon tools that are hard to discover — discoverability is table stakes per Evil Martians research | LOW | SKILL.md descriptions must be clear; `/allclear` with no args should print usage |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cross-repo impact scanning (`/allclear impact`) | No Claude Code plugin addresses multi-repo API break detection; directly solves the Edgeworks Governor/Supervisor removal pain | HIGH | Scan sibling repos for references to changed symbols; auto-detect repos from parent dir; configurable via allclear.config.json |
| Cross-repo drift detection (`/allclear drift`) | Config and standards drift across repos is invisible until it causes incidents; no current Claude Code plugin addresses this | HIGH | Compare lock files, CI configs, lint rules, key deps across sibling repos; surface deltas |
| Session start context injection (`/allclear` SessionStart hook) | Primes Claude with multi-repo topology at session start so it makes better decisions throughout; unique to AllClear | MEDIUM | SessionStart hook outputs sibling repo list, modified files, recent cross-repo changes as structured context; known bug: works on /clear/resume but not brand-new sessions — workaround needed |
| Live service health check (`/allclear pulse`) | Surfaces service health before starting work — prevents wasted effort on broken dependencies; kubectl-aware but gracefully skips without it | MEDIUM | Optional kubectl dependency; graceful skip if not present; check pod readiness, recent restarts, error rates |
| Deploy state verification (`/allclear deploy`) | Closes the "is my change actually running?" loop without leaving Claude Code; common pain point in k8s teams | MEDIUM | Verify deployed image tags match current git HEAD; diff env vs code; graceful skip without kubectl |
| Go support | Plankton (the closest competitor) explicitly omits Go; AllClear covers Python, Rust, TypeScript, AND Go — rare in a single tool | MEDIUM | go vet, gofmt, golangci-lint detection via go.mod; adds meaningful differentiation for polyglot teams |
| Bats test suite for hooks | Hook scripts are shell code — untested shell code rots fast; having a tested plugin is a trust signal in the open-source ecosystem | MEDIUM | bats-core; hooks have deterministic outputs on known inputs; tests run in CI |
| allclear.config.json override layer | Zero-config default with escape hatch; teams with non-standard layouts (not flat parent-dir) can still use cross-repo features | LOW | Optional config file; override sibling repo paths, exclude repos, customize tool detection |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Issue tracker integration (Linear, GitHub Issues) | Teams want work items linked to quality gates | Adds external service dependency; violates "no external deps" constraint; other plugins (GitHub plugin) already do this better | Keep AllClear scoped to code and infrastructure only; rely on sibling plugins for issue tracking |
| Blocking hooks for format/lint failures | Developers want hard enforcement | Blocks Claude's edit flow; creates frustrating interruptions when tools are misconfigured or slow; Evil Martians research confirms slow tools are abandoned | Non-blocking by default: warn Claude, let work continue; reserve exit 2 blocking for security stops only (secrets guard) |
| Per-language configuration files (.allclear-python.json, etc.) | Developers expect to tune every rule | Config sprawl; zero-config is the differentiator; competing with the underlying tools (Ruff, golangci-lint) on config surface is losing battle | Delegate configuration to the underlying tools themselves; AllClear just orchestrates them |
| CI/CD pipeline integration | Teams want the same checks in CI | Out of scope for a local dev plugin; CI is a separate concern with different tooling (GitHub Actions, CircleCI); duplicating this creates maintenance burden | Focus on local development loop; document how to run the same underlying tools in CI |
| Monorepo-specific support (Nx, Turborepo, Bazel task graph) | Monorepo teams want build graph awareness | Monorepo orchestrators already solve this; AllClear is for multi-repo teams who explicitly rejected monorepo; trying to support both creates confused UX | Target multi-repo explicitly; if user is already using Nx/Turborepo, AllClear adds limited value there |
| Real-time file watcher (always-on daemon) | Instant feedback on any file change | Daemons are hard to install, debug, and uninstall; they conflict with Claude Code's own lifecycle; hook-based PostToolUse already fires on every Claude edit | Use PostToolUse hooks — they fire on every Claude write/edit without requiring a daemon |
| Automatic fix application without user review | One-click "fix everything" appeal | Auto-applying fixes for lint violations beyond formatting (e.g., logic changes) silently alters code semantics; format-only auto-apply is acceptable | Auto-apply formatting (idempotent, safe); present lint violations as warnings for human review |
| Framework-specific rules (FastAPI validators, Next.js patterns) | Developers want framework intelligence | Tight coupling to frameworks means frequent breakage as frameworks evolve; violates "framework-agnostic" constraint | Detect the framework and run its native linter/validator if one exists; don't embed rules directly |

## Feature Dependencies

```
[Project type auto-detection]
    └──required by──> [Auto-format on write]
    └──required by──> [Auto-lint on write]
    └──required by──> [/allclear quality gate]

[Cross-repo auto-detection (parent dir scan)]
    └──required by──> [/allclear impact]
    └──required by──> [/allclear drift]
    └──required by──> [Session start context injection]

[allclear.config.json override layer]
    └──enhances──> [Cross-repo auto-detection]
    └──enhances──> [/allclear impact]
    └──enhances──> [/allclear drift]

[kubectl availability check]
    └──gates──> [/allclear pulse]
    └──gates──> [/allclear deploy]
    (graceful skip when absent — not a hard dependency)

[Sensitive file guard hook]
    └──independent──> all other features
    (PreToolUse — fires regardless of project type)

[Bats test suite]
    └──validates──> [Auto-format hook scripts]
    └──validates──> [Auto-lint hook scripts]
    └──validates──> [Sensitive file guard]
    └──validates──> [Session start hook]

[/allclear quality gate (single command)]
    └──composes──> [Auto-format]
    └──composes──> [Auto-lint]
    └──composes──> [/allclear impact] (optional, additive)
```

### Dependency Notes

- **Project type auto-detection is foundational**: The format hook, lint hook, and `/allclear` gate all fail gracefully if detection finds nothing, but they require the detection logic to exist first. This must ship in phase 1.
- **Cross-repo detection enables three features**: Impact scanning, drift detection, and session start context all share the same sibling repo discovery logic. Build once, reuse across all three.
- **kubectl is optional, not a dependency**: pulse and deploy skip gracefully when kubectl is absent. This makes them installable for everyone, useful only for k8s teams.
- **SessionStart hook has a known bug**: As of March 2026, SessionStart hooks do not fire on brand-new sessions (only on /clear, /compact, resume). Context injection must either use UserPromptSubmit as a fallback or document the limitation clearly.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [ ] Project type auto-detection (pyproject.toml, Cargo.toml, package.json, go.mod) — all other features depend on this
- [ ] Auto-format hook (PostToolUse, Write/Edit matcher) — highest-frequency value delivery; fires on every edit
- [ ] Auto-lint hook (PostToolUse, Write/Edit matcher) — paired with format; completes the "every edit is clean" promise
- [ ] Sensitive file guard (PreToolUse, blocking) — security expectation; absence is a trust issue
- [ ] `/allclear` quality gate skill — the primary user-facing interface; validates the "one command" promise
- [ ] Cross-repo sibling repo discovery — required for impact and drift; build the foundation even if /impact and /drift are v1.x
- [ ] `/allclear impact` skill — the primary differentiator; validates the unique cross-repo value proposition
- [ ] `npx @allclear/cli init` installer — reduces friction for first install; required for plugin registry distribution

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] `/allclear drift` — add when impact scanning is validated and users ask for config consistency checking
- [ ] SessionStart context injection — add when the known new-session bug is resolved upstream, or implement UserPromptSubmit fallback
- [ ] Bats test suite expansion — add coverage for edge cases discovered after real-world usage
- [ ] allclear.config.json override layer — add when users with non-flat repo layouts request it

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] `/allclear pulse` — add when k8s users represent a meaningful share of adoption; adds kubectl dependency complexity
- [ ] `/allclear deploy` — same gate as pulse; both are advanced/optional features that need a validated user base first
- [ ] LSP server bundling — adds real-time diagnostics beyond PostToolUse hooks; high complexity, defer until hooks prove insufficient

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Project type auto-detection | HIGH | MEDIUM | P1 |
| Auto-format hook | HIGH | LOW | P1 |
| Auto-lint hook | HIGH | LOW | P1 |
| Sensitive file guard | HIGH | LOW | P1 |
| `/allclear` quality gate | HIGH | MEDIUM | P1 |
| `/allclear impact` (cross-repo) | HIGH | HIGH | P1 — primary differentiator |
| npx installer | MEDIUM | LOW | P1 — distribution prerequisite |
| Cross-repo sibling discovery | HIGH | MEDIUM | P1 — foundation for impact/drift |
| `/allclear drift` | HIGH | HIGH | P2 |
| Session start context injection | MEDIUM | MEDIUM | P2 — blocked by upstream bug |
| allclear.config.json override | MEDIUM | LOW | P2 |
| Bats test suite | MEDIUM | MEDIUM | P2 |
| `/allclear pulse` | MEDIUM | MEDIUM | P3 |
| `/allclear deploy` | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Plankton (closest competitor) | Safety Net / sensitive-canary | AllClear |
|---------|-------------------------------|-------------------------------|----------|
| Auto-format on write | Yes (Python, TS, Shell, YAML, JSON, TOML, Markdown, Dockerfile) | No | Yes (Python, Rust, TypeScript, Go) |
| Auto-lint on write | Yes (20+ linters, three-phase architecture) | No | Yes (per-language best-of-breed tools) |
| Go support | **No — explicitly omitted** | No | **Yes — differentiator** |
| Sensitive file guard | Config-based protected files list | Yes — dedicated tool | Yes — built-in hook |
| Destructive command guard | No | Yes | No (out of scope — Safety Net covers this) |
| Cross-repo impact scanning | **No** | **No** | **Yes — primary differentiator** |
| Cross-repo drift detection | **No** | **No** | **Yes** |
| Session start context injection | No | No | Yes (with upstream bug caveat) |
| Service health check | No | No | Yes (/allclear pulse, optional kubectl) |
| Deploy verification | No | No | Yes (/allclear deploy, optional kubectl) |
| Zero-config auto-detect | Partial (config.json required for tuning) | N/A | Yes — primary design principle |
| Single quality gate command | No | No | Yes (/allclear) |
| Plugin registry distribution | No (hooks-only, no plugin manifest) | No | Yes |
| npx installer | No | No | Yes |
| Test suite (bats) | No | No | Yes |
| External service dependencies | None | None | None — matching constraint |

## Sources

- [Claude Code Plugins Reference (official)](https://code.claude.com/docs/en/plugins-reference) — HIGH confidence
- [Claude Code Hooks Reference (official)](https://code.claude.com/docs/en/hooks) — HIGH confidence
- [Plankton GitHub (alexfazio/plankton)](https://github.com/alexfazio/plankton) — HIGH confidence (direct source)
- [Awesome Claude Code (hesreallyhim)](https://github.com/hesreallyhim/awesome-claude-code) — HIGH confidence
- [Claude Code Hooks Tutorial (blakecrosley.com)](https://blakecrosley.com/blog/claude-code-hooks-tutorial) — MEDIUM confidence (third-party, matches official docs)
- [Sensitive-canary tool (DEV Community)](https://dev.to/chataclaw/stop-claude-code-from-leaking-your-secrets-introducing-sensitive-canary-826) — MEDIUM confidence
- [Safety Net GitHub (kenryu42)](https://github.com/kenryu42/claude-code-safety-net) — MEDIUM confidence
- [Top 10 Claude Code Plugins 2026 (Composio)](https://composio.dev/content/top-claude-code-plugins) — MEDIUM confidence (curated list, not official)
- [SessionStart hook bug report (anthropics/claude-code #10373)](https://github.com/anthropics/claude-code/issues/10373) — HIGH confidence (official repo issue)
- [6 things developer tools must have in 2026 (Evil Martians)](https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption) — MEDIUM confidence

---
*Feature research for: AllClear — Claude Code quality gate plugin for multi-repo polyglot teams*
*Researched: 2026-03-15*
