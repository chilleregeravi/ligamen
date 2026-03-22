# Phase 75: Validation Hardening - Research

**Researched:** 2026-03-22
**Domain:** Node.js input validation, shell injection prevention, child_process APIs
**Confidence:** HIGH

## Summary

Phase 75 makes two targeted hardening changes to the scan pipeline. Both are surgical — no new dependencies, no new files, and the existing test framework (node:test) is already in place.

**SVAL-01** requires adding per-service validation logic inside `findings.js`. The current `validateFindings()` function already validates services array items (checking `name` and `confidence`) but does NOT validate `type` as an enum or check that `root_path` and `language` are non-empty strings. The agent schema (`agent-schema.json`) defines type as `service | library | sdk | infra`, but `persistFindings` in `query-engine.js` currently silently defaults `root_path` to `"."` and `language` to `"unknown"` when missing — meaning invalid data flows into the DB. The fix is to add validation in `findings.js` that warns and skips (not hard-fails) invalid services, keeping the overall findings valid while removing bad services from the persisted array.

**SVAL-02** requires switching `getChangedFiles()` and `getCurrentHead()` in `manager.js` from `execSync` with template string interpolation to `execFileSync` with argument arrays. The current code uses `JSON.stringify(repoPath)` as a partial mitigation, but the command is still assembled as a shell string and passed through `/bin/sh`, which preserves the injection surface. `execFileSync` bypasses the shell entirely.

**Primary recommendation:** Add per-service warn-and-skip validation in `findings.js`, and replace `execSync` calls in `manager.js` with `execFileSync` using argument arrays. Both changes require new tests in the existing test files.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SVAL-01 | findings.js validates services[].type as enum (service/library/sdk/infra), validates root_path and language presence as non-empty strings (THE-957) | Current validateFindings() validates services array but lacks type enum check and root_path/language non-empty checks. Add warn-and-skip logic inside the services loop, export VALID_SERVICE_TYPES constant for testability. |
| SVAL-02 | getChangedFiles and getCurrentHead use execFileSync with argument arrays instead of execSync with string interpolation — eliminates shell injection surface (THE-958) | Both functions in manager.js use execSync with template strings. Replace with execFileSync from node:child_process. Git -C flag and subcommand args become array elements. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:child_process | built-in | `execFileSync` for shell-free subprocess execution | Zero deps; `execFileSync` bypasses `/bin/sh` entirely |
| node:test | built-in | Test runner already used throughout the project | Consistent with all other test files — no jest/vitest |
| node:assert/strict | built-in | Assertions in tests | Used by every test file in the project |

### No New Dependencies
This phase adds zero npm packages. All required APIs are Node.js built-ins.

**execFileSync API:** Takes `(file, args[], options)` — args is a string array, no shell quoting needed.

## Architecture Patterns

### Where validation lives

`findings.js` is the sole validation layer between agent output and the database. The flow is:

```
agent output (raw text)
  → parseAgentOutput()     [findings.js] — extracts JSON block
  → validateFindings()     [findings.js] — validates structure
  → result.findings        passed to persistFindings()
  → query-engine.js        writes to SQLite
```

**Key insight:** The warn-and-skip pattern for SVAL-01 must happen _inside_ `validateFindings()` before returning the `ok()` result, not inside `persistFindings()`. The filtered findings object (with invalid services removed) is what gets returned as `result.findings`.

### Pattern 1: Warn-and-skip for invalid services (SVAL-01)

The existing service validation loop in `validateFindings()` (lines 118-131 of findings.js) hard-fails on any bad service item. The new behavior for `type`, `root_path`, and `language` must warn-and-skip rather than hard-fail. This preserves the overall findings document while dropping only the invalid services.

**What to add:**
- Export a `VALID_SERVICE_TYPES` constant array: `["service", "library", "sdk", "infra"]`
- Refactor the services loop to build a `validServices` array
- For each service: if `svc.type` is present but not in `VALID_SERVICE_TYPES`, push a warning and `continue`
- For each service: if `svc.root_path` is not a non-empty string, push a warning and `continue`
- For each service: if `svc.language` is not a non-empty string, push a warning and `continue`
- Return `ok({ ...obj, services: validServices }, warnings)` — spread obj and override services with the filtered array

**Critical:** The spread `{ ...obj, services: validServices }` is required. Returning `ok(obj, warnings)` without replacing `obj.services` means skipped services still appear in `result.findings` and get persisted.

**When to use warn-and-skip vs hard-fail:**
- Hard-fail: structural problems (`services` not an array, missing required array fields) — the whole findings is unusable
- Warn-and-skip: per-item semantic problems (`type` is an unrecognized enum value, `root_path` is empty) — the item is bad but the rest of findings is usable

**Type validation note:** Only warn-and-skip when `type` is _present but invalid_. A service without a `type` field should not trigger a warning — `persistFindings` defaults it to `"service"`. Only `type: "microservice"` (present but wrong enum value) should warn-and-skip.

### Pattern 2: execFileSync with argument arrays (SVAL-02)

Replace all three `execSync` call sites in `manager.js`. The pattern is:
- `execSync("git -C " + JSON.stringify(path) + " subcommand")` becomes `execFileSync("git", ["-C", path, "subcommand"], options)`
- The options object (`encoding`, `stdio`) passes through unchanged
- The import changes from `{ execSync }` to `{ execFileSync }`

**Three call sites to change:**
1. `getChangedFiles` — full scan branch (line 165): `git -C repoPath ls-files`
2. `getChangedFiles` — incremental branch (line 174): `git -C repoPath diff --name-status sinceCommit HEAD`
3. `getCurrentHead` (line 217): `git -C repoPath rev-parse HEAD`

**Error behavior:** `execFileSync` throws on non-zero exit just like `execSync`. The existing `try/catch` in `getChangedFiles` that returns `{ error: "not a git repo" }` continues to work unchanged.

### Warning surfacing: manager.js needs to log validateFindings warnings

The success criteria says "logs a validation warning." The `ok()` result from `validateFindings` includes a `warnings` array. Currently `manager.js` receives `result.warnings` but does not log them. A small addition to `scanRepos` is needed: after `parseAgentOutput` returns `result.valid === true`, iterate `result.warnings` and log each via `slog('WARN', ...)`.

### Recommended Project Structure
No structural changes. Both changes are within existing files:
```
plugins/ligamen/worker/scan/
  findings.js          — SVAL-01: add VALID_SERVICE_TYPES, warn-and-skip in services loop
  findings.test.js     — SVAL-01: new tests for type enum, root_path, language validation
  manager.js           — SVAL-02: replace execSync with execFileSync
  manager.test.js      — SVAL-02: existing tests pass after refactor; add path-with-spaces test
```

### Anti-Patterns to Avoid
- **Don't add validation inside persistFindings:** `query-engine.js` is the DB layer. Validation belongs in `findings.js` as the application-level guard.
- **Don't use shell:true option with execFileSync:** This defeats the entire purpose of SVAL-02.
- **Don't make the type check a hard-fail for the entire findings document:** An agent emitting one service with an invalid type should not discard all other valid services and connections.
- **Don't validate `type` as required:** The agent schema shows type is present on service items but was not previously validated. Absent type is acceptable (defaults to "service" in persistFindings). Only present-but-invalid type gets warn-and-skipped.
- **Don't leave the execSync import in manager.js:** Remove it entirely to prevent re-introduction.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shell-free subprocess | Custom spawn/exec wrapper | `execFileSync` from `node:child_process` | Built-in, battle-tested, exact API needed |
| JSON schema validation | ajv or zod integration | Extend existing hand-rolled validation in findings.js | findings.js header explicitly states "Zero external dependencies — uses only Node.js builtins" |

## Common Pitfalls

### Pitfall 1: Breaking existing service validation tests
**What goes wrong:** The current test suite in `findings.test.js` has a `minimalValid()` helper that includes `root_path: "src/"` and `language: "typescript"`. Adding hard-fails for missing root_path/language would pass. But if the new code hard-fails on absent `type`, all existing tests break (they don't set `type`).
**Why it happens:** The agent schema shows `type` as optional context; it wasn't previously validated.
**How to avoid:** Only warn-and-skip when `svc.type` is _present_ but not in `VALID_SERVICE_TYPES`. When `type` is absent, the service passes validation (persistFindings defaults it to "service").
**Warning signs:** Existing tests for "validateFindings accepts valid minimal input" failing.

### Pitfall 2: sinceCommit as array element in execFileSync migration
**What goes wrong:** `sinceCommit` comes from the database (`last_scanned_commit`). When passed as an argument array element to `execFileSync`, there is no shell interpretation — a crafted value like `HEAD; rm -rf /` becomes a literal git argument. Git rejects it as an invalid ref. No shell sees it.
**How to avoid:** Pass `sinceCommit` as a plain array element — do not wrap in `JSON.stringify` or any quoting. The array-based API handles it correctly.

### Pitfall 3: warn-and-skip without filtering the returned object
**What goes wrong:** Adding `continue` in the services loop builds a `validServices` array, but if the return statement still returns `ok(obj, warnings)` rather than `ok({ ...obj, services: validServices }, warnings)`, the filtered services don't appear in `result.findings`. The caller's `persistFindings` receives the original (unfiltered) services.
**How to avoid:** The return must spread obj and replace the services property with the filtered array.

### Pitfall 4: stdio option difference concern
**What goes wrong:** Developer worries that `execFileSync` has different default options from `execSync`.
**Reality:** Both functions accept the same options object. The existing `{ encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }` passes through unchanged. The `getCurrentHead` call only uses `{ encoding: "utf8" }` — this is fine, stderr defaults to `inherit`.

### Pitfall 5: Test coverage for execFileSync — mocking is unnecessary
**What goes wrong:** Trying to mock `execFileSync` in unit tests adds significant complexity for minimal benefit.
**How to avoid:** The existing `manager.test.js` already creates real temp git repos. After the execSync-to-execFileSync refactor, the same tests exercise the same code paths. Verify existing tests still pass. Add one new test for a path with spaces.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `execSync` with string interpolation | `execFileSync` with argument arrays | This phase | Eliminates shell injection surface entirely |
| Silent defaults in persistFindings (`root_path \|\| "."`) | Warn-and-skip in findings.js | This phase | Bad services never reach the DB |

**Note on JSON.stringify as partial mitigation:** The current code uses `JSON.stringify(repoPath)` to quote paths before shell interpolation. This prevents whitespace and most special chars from breaking the command, but the command still passes through `/bin/sh`. A crafted path containing shell metacharacters could potentially execute. `execFileSync` with arrays eliminates this class of vulnerability entirely.

## Open Questions

1. **Should existing `name`/`confidence` service checks also become warn-and-skip?**
   - What we know: They are currently hard-fail, and the success criteria does not mention them changing.
   - Recommendation: Leave `name` and `confidence` as hard-fail. A nameless service is unidentifiable; an invalid confidence makes the finding unreliable. Only convert `type`, `root_path`, and `language` to warn-and-skip per the requirements.

2. **Should warnings from validateFindings be logged by manager.js?**
   - What we know: `manager.js` receives `result.warnings` but does not currently log them. The success criteria says "logs a validation warning."
   - Recommendation: Add a warning-logging loop in `scanRepos` after successful parse. Small addition to manager.js beyond the SVAL-02 execFileSync change.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, no config file) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test plugins/ligamen/worker/scan/findings.test.js` |
| Full suite command | `node --test plugins/ligamen/worker/scan/findings.test.js plugins/ligamen/worker/scan/manager.test.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SVAL-01 | Service with `type: "microservice"` is skipped with warning | unit | `node --test plugins/ligamen/worker/scan/findings.test.js` | ✅ (add to existing file) |
| SVAL-01 | Service with empty `root_path` is skipped with warning | unit | `node --test plugins/ligamen/worker/scan/findings.test.js` | ✅ (add to existing file) |
| SVAL-01 | Service with empty `language` is skipped with warning | unit | `node --test plugins/ligamen/worker/scan/findings.test.js` | ✅ (add to existing file) |
| SVAL-01 | Valid services survive alongside skipped invalid ones | unit | `node --test plugins/ligamen/worker/scan/findings.test.js` | ✅ (add to existing file) |
| SVAL-02 | `getChangedFiles` returns correct results after execFileSync refactor | integration | `node --test plugins/ligamen/worker/scan/manager.test.js` | ✅ (existing tests verify; run after refactor) |
| SVAL-02 | Repo path with spaces works without shell quoting (no injection) | integration | `node --test plugins/ligamen/worker/scan/manager.test.js` | ❌ Wave 0 — add test with space in temp dir path |

### Sampling Rate
- **Per task commit:** `node --test plugins/ligamen/worker/scan/findings.test.js`
- **Per wave merge:** `node --test plugins/ligamen/worker/scan/findings.test.js plugins/ligamen/worker/scan/manager.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `findings.test.js` — covers SVAL-01 (type enum, root_path empty, language empty, mixed valid/invalid services)
- [ ] New test case in `manager.test.js` — covers SVAL-02 path-with-spaces regression

*(Existing test infrastructure fully in place — node:test, no install needed)*

## Sources

### Primary (HIGH confidence)
- Direct code read: `plugins/ligamen/worker/scan/findings.js` — current validateFindings structure, warnings pattern, VALID_* constants
- Direct code read: `plugins/ligamen/worker/scan/manager.js` — execSync usage at lines 165, 174, 217; import at line 25
- Direct code read: `plugins/ligamen/worker/db/query-engine.js` — persistFindings at line 1023, current silent defaults for root_path/language/type
- Direct code read: `plugins/ligamen/worker/scan/agent-schema.json` — service type enum: service|library|sdk|infra
- Direct code read: `.planning/REQUIREMENTS.md` — SVAL-01, SVAL-02 requirement text

### Secondary (MEDIUM confidence)
- Node.js child_process API pattern: `execFileSync` with argument arrays — standard built-in API, shell-free by design

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all built-in Node.js, no external libraries
- Architecture: HIGH — directly read from source files, no inference
- Pitfalls: HIGH — identified from actual code reading, not speculation

**Research date:** 2026-03-22
**Valid until:** 2026-06-22 (stable — no external dependencies change)
