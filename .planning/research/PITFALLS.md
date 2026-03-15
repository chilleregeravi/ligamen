# Pitfalls Research

**Domain:** Claude Code plugin development — quality gate + cross-repo hooks with shell scripts and npx CLI installer
**Researched:** 2026-03-15
**Confidence:** HIGH (official docs verified + real plugin inspection + hook behavior confirmed)

---

## Critical Pitfalls

### Pitfall 1: Misplaced Component Directories

**What goes wrong:**
`commands/`, `agents/`, `skills/`, and `hooks/` directories end up inside `.claude-plugin/` alongside `plugin.json`. Claude Code silently ignores them. The plugin installs without error but no skills, hooks, or commands appear.

**Why it happens:**
The manifest lives at `.claude-plugin/plugin.json`, so developers intuit that all plugin files should live under `.claude-plugin/`. The official warning exists precisely because this is the most common structural mistake.

**How to avoid:**
Only `plugin.json` belongs inside `.claude-plugin/`. Every other directory — `skills/`, `hooks/`, `commands/`, `agents/`, `scripts/` — must be at the plugin root:

```
allclear/
├── .claude-plugin/
│   └── plugin.json       <- only this here
├── skills/
├── hooks/
│   └── hooks.json
└── scripts/
```

**Warning signs:**
- Plugin installs without error but `/allclear` doesn't appear in the skill list
- `claude --debug` shows the plugin loading but no components registered
- `claude plugin validate` passes but skills are absent

**Phase to address:**
Phase 1 (Foundation). Establish canonical directory structure before writing any skill or hook content.

---

### Pitfall 2: Hook Scripts Without Executable Permissions

**What goes wrong:**
Shell scripts in `scripts/` are committed without the executable bit. Hooks silently fail to fire. PostToolUse auto-format and auto-lint hooks do nothing, and the user sees no error.

**Why it happens:**
`git add` does not preserve the executable bit across all clone environments. File permissions are easy to overlook during development when running from the same machine where the file was created.

**How to avoid:**
- Add `chmod +x scripts/*.sh` as a step in the install script AND document it in README
- For the `npx @allclear/cli init` installer, explicitly `chmod +x` each script after copying it
- Verify with a post-install smoke test: `[ -x scripts/format.sh ] && echo OK || echo BROKEN`
- Use `.gitattributes` to preserve executable bits: `scripts/*.sh text eol=lf`

**Warning signs:**
- Hook commands registered in `hooks.json` but PostToolUse events produce no output
- Running hook script manually works, but it doesn't fire inside Claude Code
- `ls -la scripts/` shows `-rw-r--r--` instead of `-rwxr-xr-x`

**Phase to address:**
Phase 1 (Foundation) — add executable enforcement to installer. Phase 3 (Hooks) — add bats test verifying `chmod +x` is applied on install.

---

### Pitfall 3: Absolute Paths Instead of `${CLAUDE_PLUGIN_ROOT}`

**What goes wrong:**
Hook commands and MCP server configs use hardcoded absolute paths like `/Users/ravi/.claude/plugins/...`. The plugin works on the author's machine but breaks for every other user because the path doesn't exist.

**Why it happens:**
Developers test locally with `--plugin-dir` pointing to a local directory. Absolute paths work perfectly during development. The plugin cache copies files to a content-addressed path (`~/.claude/plugins/cache/marketplace/plugin/VERSION/`) that differs from the development path, breaking all hardcoded paths.

**How to avoid:**
Use `${CLAUDE_PLUGIN_ROOT}` for every path inside hook commands, MCP configs, and script references:

```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"
}
```

Confirm this with the real claude-mem pattern — it even adds a fallback:
```bash
_R="${CLAUDE_PLUGIN_ROOT}"; [ -z "$_R" ] && _R="$HOME/.claude/..."; "$_R/scripts/run.sh"
```

**Warning signs:**
- Plugin works when loaded via `--plugin-dir` but hooks fail after marketplace install
- Debug logs show `command not found` or `No such file or directory`
- Paths in error messages reference the author's home directory

**Phase to address:**
Phase 3 (Hooks). Enforce `${CLAUDE_PLUGIN_ROOT}` in all hook commands from the start. Add bats test with a path-validation check.

---

### Pitfall 4: Non-Zero Exit Codes Blocking on PostToolUse (Format/Lint Hooks)

**What goes wrong:**
Auto-format and auto-lint hooks use `exit 1` when the formatter fails (e.g., file has syntax errors, tool not installed). This blocks Claude's edit cycle. The PROJECT.md constraint explicitly requires non-blocking hooks — this directly violates it.

**Why it happens:**
Standard shell scripting convention is `exit 1` on failure. Developers apply that same pattern without knowing that in `PostToolUse` context, exit code 2 produces a blocking error shown to Claude.

**How to avoid:**
Wrap every format/lint hook in a try-catch pattern that always exits 0:

```bash
#!/bin/bash
FILE=$(jq -r '.tool_input.file_path // empty' < /dev/stdin 2>/dev/null)
if [ -z "$FILE" ]; then exit 0; fi

# Run formatter, capture output, never block on failure
if command -v ruff &>/dev/null; then
  ruff format "$FILE" 2>&1 >&2 || true
fi
exit 0   # Always 0 — non-blocking
```

Print errors to stderr (they become informational messages, not blockers). Never use `exit 1` or `exit 2` in PostToolUse format/lint hooks.

**Warning signs:**
- Edits intermittently fail with formatter error messages
- `PostToolUse` hook fires but subsequent Claude actions are blocked
- Users report AllClear "breaking" their session when they edit a file with syntax errors

**Phase to address:**
Phase 3 (Hooks). Non-blocking exit policy must be a bats test requirement for every format/lint hook.

---

### Pitfall 5: Hook stdin/stdout Mixing — Debug Output Pollutes JSON

**What goes wrong:**
Hook scripts print debug statements or status messages to stdout, corrupting the JSON response that Claude Code parses. This causes JSON parse errors, hook failures, or silent misbehavior.

**Why it happens:**
Bash scripts naturally use `echo "Processing..."` for feedback. Developers don't realize that for hooks, stdout is a structured channel — only valid JSON (or empty output) should appear there.

**How to avoid:**
Always route debug output to stderr:

```bash
# BAD:
echo "Formatting $FILE..."
run_formatter "$FILE"

# GOOD:
echo "Formatting $FILE..." >&2
run_formatter "$FILE" >&2 || true
```

If the hook returns structured data (e.g., `additionalContext`), produce JSON on stdout only on exit 0, and only when needed. For pure side-effect hooks (format/lint), produce no stdout at all.

**Warning signs:**
- Hooks produce output like `JSON parse error` in debug mode
- Hook fires but Claude receives garbled tool context
- Adding `echo` debugging statements to a hook causes it to stop working

**Phase to address:**
Phase 3 (Hooks). Establish stderr-only logging as a bats test assertion.

---

### Pitfall 6: Incorrect Event Name Casing Breaks Hooks Silently

**What goes wrong:**
Hooks registered with `"postToolUse"` or `"sessionstart"` simply don't fire. No error. No warning. The hook is registered but never invoked because event names are case-sensitive.

**Why it happens:**
Hook event names look like camelCase or other conventions, leading to guessing. The correct names are PascalCase: `PostToolUse`, `PreToolUse`, `SessionStart`.

**How to avoid:**
Copy event names exactly from the reference. The full list from official docs: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionStart`, `SessionEnd`, `TeammateIdle`, `TaskCompleted`, `PreCompact`.

Validate with `claude plugin validate` after any hooks.json change.

**Warning signs:**
- Hook added to hooks.json but never fires
- `claude --debug` doesn't show the hook in the registered list
- All other hooks in the same hooks.json work correctly

**Phase to address:**
Phase 3 (Hooks). Add `claude plugin validate` to CI and document correct event names in inline comments.

---

### Pitfall 7: Version Not Bumped — Users Never Get Updates

**What goes wrong:**
Plugin code changes ship without a version bump in `plugin.json`. Existing users are stuck on the old version because the plugin cache is keyed on version number. New installs get the new code; existing users do not.

**Why it happens:**
It's easy to push code changes to the marketplace repository and forget that Claude Code uses version numbers to trigger cache invalidation. This is different from standard npm packages where the registry enforces version uniqueness.

**How to avoid:**
Make version bump a mandatory checklist item before any release. The official docs explicitly warn: "If you change your plugin's code but don't bump the version in `plugin.json`, your plugin's existing users won't see your changes due to caching."

Use a release checklist or CI check: `git diff main..HEAD -- .claude-plugin/plugin.json | grep version || echo "VERSION NOT BUMPED"`.

**Warning signs:**
- Bug is fixed and pushed but users still report the bug
- New skill added but doesn't appear for users who already have the plugin installed
- `claude plugin update allclear` reports "already up to date" despite code changes

**Phase to address:**
Phase 5 (Distribution). Build version-bump verification into the release process before marketplace submission.

---

### Pitfall 8: Cross-Repo Discovery Assuming a Flat Parent Directory Layout

**What goes wrong:**
AllClear's cross-repo scanning (`/allclear impact`, `/allclear drift`) auto-discovers sibling repos by scanning the parent directory. This breaks for users who do not use a flat layout (e.g., deeply nested monorepo structures, custom workspace root in a non-parent dir, WSL path mappings).

**Why it happens:**
The Edgeworks ecosystem that spawned AllClear uses a flat layout (`~/sources/repo1`, `~/sources/repo2`). This pattern is natural to the authors but not universal.

**How to avoid:**
- Auto-detect from parent directory as the default path
- Always provide `allclear.config.json` as a first-class override with explicit `repos` array
- When no sibling repos are found, degrade gracefully with a clear message: "No sibling repos detected. Add repos to allclear.config.json to enable cross-repo scanning."
- Document the expected layout in README prominently

**Warning signs:**
- Cross-repo skills return "no repos found" on machines with non-flat layouts
- Users in monorepos report that impact scanning only sees the current repo
- Tests pass locally but fail in CI because CI uses a different workspace structure

**Phase to address:**
Phase 2 (Skills) — build config override from day one, not as an afterthought.

---

### Pitfall 9: PreToolUse vs PostToolUse Decision Output Format Confusion

**What goes wrong:**
Hooks that need to block dangerous operations (e.g., the sensitive file guard) use the wrong JSON format. A `PreToolUse` hook that sends `{"decision": "block"}` (the PostToolUse format) has no effect. The sensitive file write proceeds silently.

**Why it happens:**
The two events use completely different JSON schemas for control decisions:
- `PreToolUse` requires `hookSpecificOutput.permissionDecision: "deny"`
- `PostToolUse` uses top-level `decision: "block"`

This asymmetry is surprising and underdocumented.

**How to avoid:**
For PreToolUse (sensitive file guard):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Sensitive file protected by AllClear"
  }
}
```

Include the correct format as a comment in the hook script. Add a bats test that mocks the hook invocation and verifies the output schema.

**Warning signs:**
- Sensitive file guard hook fires (visible in debug logs) but writes are not blocked
- Testing blocking logic locally seems to work but fails in real usage
- The hook script exits 0 with JSON but the action proceeds anyway

**Phase to address:**
Phase 3 (Hooks) — sensitive file guard phase. This is the highest-security pitfall in the project.

---

### Pitfall 10: `npx @allclear/cli init` Scoped Package Name Already Taken

**What goes wrong:**
The npm package name `@allclear/cli` is claimed by another party before AllClear publishes. The installer command in documentation and README breaks. Users can't install via the documented npx path.

**Why it happens:**
Scoped npm packages under `@allclear` require owning the `allclear` organization on npm. If the org isn't claimed before publishing, someone else can take it.

**How to avoid:**
Claim the `allclear` npm organization immediately in Phase 1 (before any public announcement). Publish a placeholder `@allclear/cli` package (even `0.0.1` with a README) to reserve the name. Verify the package name is available NOW before it appears in any documentation.

**Warning signs:**
- `npm publish --access public` fails with "organization does not exist"
- `npx @allclear/cli` resolves to a different package
- The npm org page at npmjs.com/org/allclear doesn't exist under your account

**Phase to address:**
Phase 1 (Foundation) — reserve npm org and package name before any other work proceeds.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline hook commands in hooks.json (one-liners) | No separate script files | Impossible to test with bats, hard to debug, breaks on quoting edge cases | Never — always use script files |
| Hardcode tool commands (`ruff`, `cargo fmt`) without `command -v` guards | Simpler hook scripts | Hook crashes when tool not installed; blocks edits if exit code not 0 | Never — always guard with `command -v` |
| Single hooks.json with all hooks | Simpler structure | Hard to test individual hooks; no separation of concerns | MVP only — split by hook type before v1 release |
| Skip `allclear.config.json` support in first cross-repo skill | Ship faster | First real user with non-flat layout files a bug immediately | Never — config override is load-bearing for real-world use |
| Publish to npm registry without reserving the org first | Save time | Package name squatting; installer URL documented before name is secured | Never |
| Skip bats tests for hooks (test manually) | Faster initial development | Shell scripts regress silently; non-blocking guarantee breaks | Never — hooks require bats tests per constraints |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code plugin cache | Referencing files outside plugin root with `../shared` paths | All paths must stay within plugin root; symlinks are honored but cross-directory refs are not copied to cache |
| Claude plugin marketplace | Pushing code changes without version bump | Bump `version` in plugin.json with every release; cache is version-keyed |
| npx installer | Using `npm link` during development then shipping relative paths | Use `${CLAUDE_PLUGIN_ROOT}` in all plugin paths; test via `--plugin-dir` |
| `jq` in hook scripts | Assuming `jq` is installed on all user machines | Guard with `command -v jq` or use a pure-bash alternative for simple JSON parsing |
| kubectl for pulse/deploy skills | Hard-failing when kubectl not found | Skip gracefully: `command -v kubectl || { echo "kubectl not found, skipping" >&2; exit 0; }` |
| git for cross-repo discovery | Assuming `git` root == project root | Use `git rev-parse --show-toplevel` to find actual repo root; repos may be nested |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| PostToolUse hooks running on every single file edit | Noticeable lag on every keystroke/edit in Claude | Use specific matchers: `"matcher": "Write|Edit"` and filter by file extension inside the script | Immediately noticeable with any real workload |
| Cross-repo scan on every `/allclear` invocation without caching | `/allclear` takes 5+ seconds in repos with 10+ siblings | Cache sibling repo list in `allclear.config.json` or a temp file; re-scan only when config changes | 8+ sibling repos |
| `git status` and `git log` called in hooks synchronously | Each edit stalls for 100-500ms as git commands run | Run expensive git operations async or skip in hooks entirely; reserve for skill invocations | Any project with >1000 commits or slow disk |
| SessionStart hook scanning all sibling repos on startup | Session startup takes 3-10 seconds | Lazy-load repo discovery; only scan when a cross-repo skill is actually invoked | Flat layouts with 5+ sibling repos |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sensitive file guard using path substring match (`grep ".env"`) | Guard bypassed with `../.env`, `.env.local`, `.ENV`, or path traversal | Use normalized absolute paths and match against an allowlist of patterns; use `realpath` to resolve before comparing |
| Hook scripts that `eval` or `bash -c` with tool input data | Claude Code tool inputs can contain arbitrary strings; code injection if unsanitized | Never use `eval` in hook scripts; use `jq -r` to extract specific fields, not raw substitution |
| npx installer running as `sudo` without explicit user consent | Privilege escalation during install | Installer must never require sudo; install to user-local paths only (`~/.claude/plugins/`) |
| Publishing secrets in `allclear.config.json` examples | Users copy examples with real credentials | Config examples must use placeholder values; document that config.json should be gitignored |
| Hook outputs leaking file contents to stdout | Tool input (including file contents) visible in Claude's context unexpectedly | Hooks should never echo tool input back to stdout; only emit structured JSON or nothing |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `/allclear:quality` instead of `/allclear` for the main command | Unexpected namespace prefix surprises users expecting `/allclear` | Test exactly how the skill name appears in `/help` after namespacing; document the full command in README |
| Format/lint hook running on every `.md` or `.json` edit | Annoying false positives; linting markdown with Python tools | Filter by file extension inside hook script; only run relevant formatters per file type |
| `npx @allclear/cli init` requiring interactive prompts | Breaks in CI/automated environments | All prompts must have `--yes` / non-interactive flag defaults |
| Cross-repo drift output wall of text | Users overwhelmed; ignore the output | Structure output with severity levels; surface only actionable differences by default |
| Sensitive file guard blocking legitimate operations with no explanation | User confused why their edit was rejected | Guard must output a clear explanation: "AllClear blocked write to .env — add to allowlist in allclear.config.json to permit" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Auto-detect project type:** Verify it handles mixed-language repos (e.g., TypeScript frontend + Python backend in the same repo) — test with `package.json` AND `pyproject.toml` present simultaneously
- [ ] **Non-blocking hooks:** Verify format/lint hooks exit 0 when the formatter is not installed on the test machine — don't just test with all tools present
- [ ] **Cross-repo discovery:** Verify it returns empty results gracefully when no sibling repos exist — not just when they do
- [ ] **Sensitive file guard:** Verify it actually blocks writes (using PreToolUse correct schema) — test with a real edit to `.env`, not just a dry run
- [ ] **npx installer:** Verify it works on a clean machine without the plugin pre-installed — test in a fresh Docker container or VM
- [ ] **Plugin version bump:** Verify that after `npm publish`, existing users who run `claude plugin update allclear` actually receive the new version
- [ ] **SKILL.md descriptions:** Verify Claude auto-invokes skills in the right context — test `/allclear impact` is NOT auto-triggered during normal edits
- [ ] **kubectl graceful skip:** Verify `/allclear pulse` and `/allclear deploy` produce clear skip messages when kubectl is absent, not errors
- [ ] **Symlink installation path:** Verify git clone + symlink path works when the clone directory is not in the user's default plugin path
- [ ] **`${CLAUDE_PLUGIN_ROOT}` in all hooks:** Verify by grepping hooks.json — zero hardcoded paths

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Misplaced component directories | LOW | Move directories to plugin root; run `claude plugin validate`; bump patch version; republish |
| Hook scripts not executable | LOW | `chmod +x scripts/*.sh`; update installer to enforce permissions; bump version |
| Absolute paths in hooks | MEDIUM | Find/replace all hardcoded paths with `${CLAUDE_PLUGIN_ROOT}`; test on clean install; bump version |
| Non-blocking hooks became blocking | LOW | Add `exit 0` at end of each format/lint hook; add bats test; bump version |
| npm package name squatted | HIGH | Rename to `@allclear-dev/cli` or similar; update all documentation; republish; redirect old README |
| Version not bumped | LOW | Bump version in plugin.json; republish; instruct users to run `claude plugin update allclear` |
| Sensitive file guard not blocking | HIGH | Fix PreToolUse JSON schema; add bats test with mock; bump version and notify users of security fix |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Misplaced component directories | Phase 1 (Foundation) | `claude plugin validate` passes; all 5 skills appear in `/help` |
| Hook scripts not executable | Phase 1 (Foundation) + Phase 3 (Hooks) | `ls -la scripts/` shows executable bit; bats test asserts chmod |
| Absolute paths in hooks | Phase 3 (Hooks) | `grep -r '/Users/' hooks/` returns no matches |
| Non-blocking PostToolUse hooks | Phase 3 (Hooks) | Bats test: hook exits 0 when formatter is absent |
| stdout pollution in hooks | Phase 3 (Hooks) | Bats test: hook stdout is empty or valid JSON only |
| Wrong event name casing | Phase 3 (Hooks) | `claude plugin validate` + smoke test each hook event |
| Version not bumped on release | Phase 5 (Distribution) | CI lint: version in plugin.json must differ from published version |
| Cross-repo flat layout assumption | Phase 2 (Skills) | Integration test with non-flat workspace config |
| PreToolUse vs PostToolUse schema confusion | Phase 3 (Hooks) | Bats test mocking PreToolUse input; verify deny blocks write |
| npm org not reserved | Phase 1 (Foundation) | `npm org ls allclear` confirms ownership before any code ships |

---

## Sources

- [Claude Code Plugins Reference — official docs](https://code.claude.com/docs/en/plugins-reference) — Directory structure, path traversal limitations, version caching behavior, `${CLAUDE_PLUGIN_ROOT}` spec
- [Claude Code Create Plugins — official docs](https://code.claude.com/docs/en/plugins) — Structure overview, common mistakes warning, migration guide
- [Claude Code Skills — official docs](https://code.claude.com/docs/en/skills) — SKILL.md frontmatter, `disable-model-invocation`, description quality, invocation control
- [Claude Code Hooks — official docs](https://code.claude.com/docs/en/hooks) — PreToolUse vs PostToolUse JSON schemas, exit code semantics, stdin/stdout handling, async hook limitations
- claude-mem plugin v10.5.5 (local cache at `~/.claude/plugins/cache/thedotmack/claude-mem/`) — Real-world `${CLAUDE_PLUGIN_ROOT}` fallback pattern, hooks.json structure
- code-review official plugin (local cache at `~/.claude/plugins/cache/claude-plugins-official/code-review/`) — Minimal plugin.json pattern without version field
- [DataCamp: How to Build Claude Code Plugins](https://www.datacamp.com/tutorial/how-to-build-claude-code-plugins) — Community-confirmed structure mistakes
- [awesome-claude-code GitHub](https://github.com/hesreallyhim/awesome-claude-code) — Community plugin patterns and known issues
- PROJECT.md constraints — Non-blocking hooks requirement, bats test requirement, zero-config auto-detect requirement

---
*Pitfalls research for: Claude Code plugin (AllClear) — quality gates, cross-repo hooks, shell scripts, npx installer*
*Researched: 2026-03-15*
