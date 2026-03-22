# Phase 76: Discovery Phase Wiring - Research

**Researched:** 2026-03-22
**Domain:** Scan pipeline orchestration — two-phase agent wiring in manager.js
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SARC-01 | Discovery agent (Phase 1) runs before deep scan per repo, returning languages, frameworks, service hints, and file targets as {{DISCOVERY_JSON}} to the deep scan prompt (THE-953) | manager.js `scanRepos` loop is the sole wiring point; agent-prompt-discovery.md and agent-prompt-deep.md already exist with the right shape; slog infrastructure handles the log entry requirement |
</phase_requirements>

---

## Summary

The codebase already contains all the raw materials for discovery wiring. `agent-prompt-discovery.md` is the discovery prompt (Phase 1). `agent-prompt-deep.md` is the deep-scan prompt (Phase 2) and already contains the `{{DISCOVERY_JSON}}` placeholder with fallback language ("If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files"). The `map.md` command document describes the two-phase protocol in detail, but `manager.js` — the actual scan executor — only calls a single agent per repo using `agent-prompt-service.md`, `agent-prompt-library.md`, or `agent-prompt-infra.md`. Phase 76 is wiring those two existing pieces into `manager.js`.

The change is surgical: inside the `scanRepos` for-loop, before the current deep-scan agent call, add a discovery agent call using `agentRunner`, parse its fenced-JSON output, inject it as `{{DISCOVERY_JSON}}` into the deep-scan prompt template (`agent-prompt-deep.md` rather than the repo-type-specific prompts), and log the discovery result. If the discovery agent throws or returns unparseable output, substitute an empty object and continue — the existing deep-scan fallback language covers this gracefully.

Discovery output is ephemeral — it is a `const` in the loop body, never written to the DB. The existing `slog` helper in `scanRepos` emits the log entry for the "discovery pass" success criterion.

**Primary recommendation:** Modify `scanRepos` in `manager.js` to run a discovery agent pass before the deep-scan agent pass, using `agent-prompt-deep.md` as the unified deep-scan template. Export `runDiscoveryPass` as a named function for testability.

---

## Standard Stack

### Core (no new dependencies)

| Component | Version | Purpose | Notes |
|-----------|---------|---------|-------|
| `node:test` + `node:assert/strict` | Node >=20 (built-in) | Unit tests | Project convention — zero external test deps |
| `better-sqlite3` | ^12.8.0 | DB access | No DB writes needed for this phase |
| ESM (`type: "module"`) | Node >=20 | Module system | All scan files are ESM |

No npm installs required for this phase.

### Files Already in Place

| File | Status | Role |
|------|--------|------|
| `worker/scan/agent-prompt-discovery.md` | EXISTS — use as-is | Discovery (Phase 1) prompt template |
| `worker/scan/agent-prompt-deep.md` | EXISTS — use as-is | Deep scan (Phase 2) prompt template with `{{DISCOVERY_JSON}}` |
| `worker/scan/manager.js` | MODIFY | Wire the two-phase loop |
| `worker/scan/manager.test.js` | MODIFY | Add tests for discovery wiring |

## Architecture Patterns

### Recommended Change Location

The entire change lives inside `scanRepos` in `manager.js`. The loop body currently does:

```
detect repo type → select prompt template → interpolate → call agentRunner → parse → persist
```

After wiring it will do:

```
run discovery agent → parse discovery JSON (with fallback) → log discovery pass
→ interpolate agent-prompt-deep.md with {{DISCOVERY_JSON}} and {{REPO_PATH}} → call agentRunner → parse → persist
```

### Pattern 1: Discovery Pass as Extracted Function

Extract the discovery agent call into a named helper function that is also exported. This matches the existing pattern where `buildIncrementalConstraint` is exported separately for testability.

```javascript
// Source: project pattern (buildIncrementalConstraint in manager.js)

/**
 * Run the discovery agent for a single repo.
 * Returns parsed discovery JSON on success, or {} on failure/timeout.
 *
 * @param {string} repoPath
 * @param {string} discoveryPromptTemplate - Raw file contents of agent-prompt-discovery.md
 * @param {(prompt: string, repoPath: string) => Promise<string>} agentRunner
 * @param {Function} slog - scan-local log helper
 * @returns {Promise<object>}
 */
export async function runDiscoveryPass(repoPath, discoveryPromptTemplate, agentRunner, slog) {
  const prompt = discoveryPromptTemplate.replaceAll("{{REPO_PATH}}", repoPath);
  try {
    const raw = await agentRunner(prompt, repoPath);
    const match = raw.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!match) {
      slog('WARN', 'discovery: no JSON block — using empty context', { repoPath });
      return {};
    }
    const parsed = JSON.parse(match[1].trim());
    const langs = Array.isArray(parsed.languages) ? parsed.languages : [];
    slog('INFO', 'discovery pass complete', {
      repoPath,
      languages: langs,
      frameworks: parsed.frameworks ?? [],
      service_hints: (parsed.service_hints ?? []).length,
    });
    return parsed;
  } catch (err) {
    slog('WARN', 'discovery pass failed — using empty context', { repoPath, error: err.message });
    return {};
  }
}
```

### Pattern 2: {{DISCOVERY_JSON}} Injection into agent-prompt-deep.md

`agent-prompt-deep.md` already contains `{{DISCOVERY_JSON}}` on line 7. The interpolation is a single `.replaceAll()` call added alongside the existing `{{REPO_PATH}}` replacement.

```javascript
// In scanRepos loop body, after discovery pass:
const discoveryJson = JSON.stringify(discoveryContext, null, 2);
const finalPrompt = promptDeep
  .replaceAll("{{REPO_PATH}}", repoPath)
  .replaceAll("{{DISCOVERY_JSON}}", discoveryJson)
  .replaceAll("{{SERVICE_HINT}}", basename(repoPath))
  .replaceAll("{{COMMON_RULES}}", commonRules.replaceAll("{{REPO_PATH}}", repoPath))
  .replaceAll("{{SCHEMA_JSON}}", schemaJson);
```

Note: `agent-prompt-deep.md` already includes all the content from the type-specific prompts (service/library/infra handling). The type-specific prompts (`agent-prompt-service.md`, `agent-prompt-library.md`, `agent-prompt-infra.md`) were added later as a refinement but `agent-prompt-deep.md` is the discovery-aware template. For this phase, use `agent-prompt-deep.md` for all repos when wiring discovery — SARC-03 (Phase 77) handles cleanup of dead code.

### Pattern 3: Fallback — Discovery Failure Does Not Abort Scan

The fallback is `{}` (empty object). The deep-scan prompt already has explicit fallback language: "If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files." So `JSON.stringify({})` injected as `{{DISCOVERY_JSON}}` satisfies the requirement that the scan is not aborted.

### Pattern 4: Log Entry Shape for "Discovery Pass Log Entry"

Success criterion 1 requires a log entry showing "detected languages, frameworks, and candidate entry-point files before the deep scan begins." The existing `slog` helper writes structured JSON to `worker.log`. The log entry format:

```json
{
  "ts": "...",
  "level": "INFO",
  "msg": "discovery pass complete",
  "pid": ...,
  "component": "worker",
  "repoPath": "/abs/path/to/repo",
  "languages": ["python", "typescript"],
  "frameworks": ["fastapi"],
  "service_hints": 2
}
```

### Recommended Project Structure (no changes to directory layout)

```
worker/scan/
├── manager.js              # MODIFY: add runDiscoveryPass, wire into scanRepos loop
├── manager.test.js         # MODIFY: add discovery wiring tests
├── agent-prompt-discovery.md  # USE AS-IS (Phase 1 prompt)
├── agent-prompt-deep.md       # USE AS-IS (Phase 2 prompt, has {{DISCOVERY_JSON}})
└── ...                        # all other files unchanged
```

### Anti-Patterns to Avoid

- **Persisting discovery output to DB:** The STATE.md decision is explicit — "Discovery output is ephemeral prompt context only — not persisted to DB." Never write discovery JSON to any table.
- **Aborting the scan on discovery failure:** If `agentRunner` throws or returns garbage, catch it and fall back to `{}`. The deep-scan proceeds regardless.
- **Opening a `beginScan` bracket before the discovery pass:** The scan version bracket (`beginScan`/`endScan`) wraps only the deep scan. Discovery is pre-scan and must not open a bracket.
- **Using `agent-prompt-service.md` / `agent-prompt-library.md` / `agent-prompt-infra.md` for the deep-scan after discovery:** The discovery-context-aware template is `agent-prompt-deep.md`. The type-specific prompts do not contain `{{DISCOVERY_JSON}}`. Do not attempt to inject discovery JSON into the type-specific prompts.
- **Calling `beginScan` before discovery completes:** The bracket must open only if the scan will actually run. Discovery is cheap and fast — complete it first, then open the bracket.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON extraction from agent output | Custom regex | Existing `JSON_BLOCK_RE` pattern from `findings.js` | Same regex: `` /```json\s*\n([\s\S]*?)\n```/ `` — copy this pattern, don't invent a new one |
| Logging | Custom stderr writes | Existing `slog` helper inside `scanRepos` | Already injected, already handles null logger gracefully |
| Test infrastructure | Jest, Vitest, Mocha | `node:test` + `node:assert/strict` | Project convention — all existing tests use zero external test deps |
| DB writes for discovery | New table or column | Nothing — ephemeral only | Requirement explicitly prohibits persistence |

---

## Common Pitfalls

### Pitfall 1: Opening the Scan Bracket Too Early

**What goes wrong:** `beginScan(repo.id)` is called before `runDiscoveryPass`, then discovery times out, leaving an open scan version bracket.

**Why it happens:** Copy-pasting from existing scan code without noticing the bracket must wrap only the deep-scan agent call.

**How to avoid:** Call `beginScan` only after discovery completes (or falls back). The current code opens the bracket at step 4 after the skip/noop checks — keep it there, add discovery before step 4.

**Warning signs:** `scan_versions` rows with no corresponding `endScan` call (open bracket), causing stale data to accumulate.

### Pitfall 2: Discovery Failure Silently Corrupting {{DISCOVERY_JSON}} Placeholder

**What goes wrong:** Discovery fails and `{}` is used as fallback, but `JSON.stringify({})` produces `{}` which is valid JSON — the deep-scan prompt still replaces `{{DISCOVERY_JSON}}` correctly. No issue. However, if the developer forgets to stringify (passes the object directly), the template replaceAll fails because `{{DISCOVERY_JSON}}` expects a string.

**How to avoid:** Always `JSON.stringify(discoveryContext, null, 2)` before the `.replaceAll("{{DISCOVERY_JSON}}", ...)` call.

### Pitfall 3: Using Type-Specific Prompts Instead of agent-prompt-deep.md

**What goes wrong:** Developer tries to inject `{{DISCOVERY_JSON}}` into `agent-prompt-service.md` — the placeholder is not present, so it passes through literally to the agent.

**Why it happens:** The current `scanRepos` code selects `promptService/promptLibrary/promptInfra` based on `detectRepoType`. The wiring phase switches to `promptDeep` for the deep-scan phase.

**How to avoid:** Load `promptDeep` for the deep-scan step. The repo-type prompts are not used in Phase 76 (SARC-03 will clean them up in Phase 77).

### Pitfall 4: Double-Counting Agent Calls in Tests

**What goes wrong:** Existing tests that mock `agentRunner` and count invocations break because discovery adds a second call per repo.

**Why it happens:** The test mock returns a fixed response regardless of which prompt it receives. After wiring, each repo triggers agentRunner twice (discovery + deep scan).

**How to avoid:** Update existing test mocks to detect the prompt type (discovery vs. deep scan) by checking for "Discovery Agent" or "{{DISCOVERY_JSON}}" in the prompt string. Or use a call counter and branch on call count. Review all `scanRepos` tests in `manager.test.js` — specifically the call count assertions.

### Pitfall 5: Missing `await` on runDiscoveryPass

**What goes wrong:** `const discoveryContext = runDiscoveryPass(...)` without `await` — `discoveryContext` is a Promise, `JSON.stringify` of a Promise produces `{}`.

**How to avoid:** The function must be `async`. All callers in `scanRepos` must `await` it. This is consistent with the existing `await agentRunner(...)` pattern.

---

## Code Examples

### Discovery JSON Schema (from agent-prompt-discovery.md)

The discovery agent returns this shape:

```json
{
  "repo_name": "string",
  "languages": ["python", "typescript"],
  "frameworks": ["fastapi", "express"],
  "service_hints": [
    {
      "name": "string",
      "type": "service | library | sdk",
      "root_path": "string",
      "entry_file": "string",
      "framework": "string"
    }
  ],
  "route_files": ["string"],
  "proto_files": ["string"],
  "openapi_files": ["string"],
  "event_config_files": ["string"],
  "has_dockerfile": true,
  "has_docker_compose": true,
  "mono_repo": false,
  "notes": "string"
}
```

No validation schema enforcement needed — the deep-scan prompt consumes it as context, not as structured DB input. Any valid JSON object (including `{}`) is safe.

### Test Pattern for Two-Agent Calls

```javascript
// Source: existing manager.test.js pattern extended for two-phase

let callCount = 0;
setAgentRunner(async (prompt, repoPath) => {
  callCount++;
  // First call is discovery — return minimal valid discovery JSON
  if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
    return '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';
  }
  // Second call is deep scan — return valid findings JSON
  return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
});

const results = await scanRepos([repoDir], {}, qe);
assert.equal(callCount, 2, 'two agent calls: discovery + deep scan');
```

### Test Pattern for Discovery Failure Fallback

```javascript
setAgentRunner(async (prompt, repoPath) => {
  if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
    throw new Error('discovery timeout');
  }
  return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
});

const results = await scanRepos([repoDir], {}, qe);
// Scan must still succeed with valid findings
assert.ok(results[0].findings !== null, 'deep scan proceeds despite discovery failure');
assert.equal(results[0].mode, 'full');
```

### Test Pattern for Discovery Log Entry

```javascript
const loggedMessages = [];
const mockLogger = {
  log: (level, msg, extra = {}) => loggedMessages.push({ level, msg, ...extra }),
  info: (msg, extra) => mockLogger.log('INFO', msg, extra),
  warn: (msg, extra) => mockLogger.log('WARN', msg, extra),
  error: (msg, extra) => mockLogger.log('ERROR', msg, extra),
  debug: (msg, extra) => mockLogger.log('DEBUG', msg, extra),
};
setScanLogger(mockLogger);

// ... run scanRepos ...

const discoveryLog = loggedMessages.find(l => l.msg === 'discovery pass complete');
assert.ok(discoveryLog, 'discovery pass log entry emitted');
assert.ok(Array.isArray(discoveryLog.languages), 'languages field present');
```

---

## State of the Art

| Old Approach | Current Approach | Status |
|--------------|------------------|--------|
| Single-phase scan (type-specific prompts) | Two-phase: discovery (structure) then deep (code) | Phase 76 wires this |
| `agent-prompt-deep.md` unused by manager.js | `agent-prompt-deep.md` becomes the deep-scan template when discovery is wired | Phase 76 |
| `promptDeep` loaded but not the primary deep-scan template | `promptDeep` becomes the active deep-scan template | Phase 76 |
| Type-specific prompts are primary deep-scan templates | Type-specific prompts become dead code | SARC-03 (Phase 77) cleanup |

**Key observation:** `manager.js` line 340 already loads `promptDeep`:
```javascript
// Legacy prompt kept as fallback
const promptDeep = readFileSync(join(__dirname, "agent-prompt-deep.md"), "utf8");
```
The comment says "Legacy prompt kept as fallback" — this comment is stale. `agent-prompt-deep.md` is actually the discovery-context-aware two-phase prompt that SARC-01 wants to activate. Phase 76 makes it the active deep-scan prompt. Phase 77 (SARC-03) removes the type-specific prompts and cleans up the comment.

---

## Open Questions

1. **Should `runDiscoveryPass` also receive a timeout?**
   - What we know: `agentRunner` is async and can hang. Current scans are sequential so a hung discovery blocks all remaining repos.
   - What's unclear: Whether Claude Code's Agent tool has its own timeout or if manager.js needs to add one.
   - Recommendation: Do not add a timeout mechanism in Phase 76. The success criterion only requires that a thrown error falls back gracefully — it says "if the discovery agent fails or times out." A try/catch on `agentRunner` covers the "fails" case. Timeout-as-reliability is SREL-01 (Phase 78). Leave timeout handling for Phase 78.

2. **Should discovery use a separate `agentRunner` invocation type?**
   - What we know: All agent calls use the injected `agentRunner(prompt, repoPath)`. There is no distinction between discovery and deep-scan agents at the runner level.
   - What's unclear: Whether `agentRunner` needs to accept a third parameter for subagent type.
   - Recommendation: No. Use the same `agentRunner` signature for both calls. The distinction is in the prompt content. The `map.md` command explicitly uses `subagent_type="Explore"` for both — this is an MCP concern, not a manager.js concern.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node >=20) |
| Config file | none — run directly |
| Quick run command | `node --test plugins/ligamen/worker/scan/manager.test.js` |
| Full suite command | `node --test plugins/ligamen/worker/scan/manager.test.js plugins/ligamen/worker/scan/findings.test.js plugins/ligamen/worker/scan/enrichment.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SARC-01 | Discovery agent runs before deep scan; prompt receives populated `{{DISCOVERY_JSON}}` | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — file exists, new test cases needed |
| SARC-01 | Discovery failure falls back to empty context; deep scan still runs | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — file exists, new test case needed |
| SARC-01 | Discovery log entry emitted with `languages`, `frameworks` fields | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — file exists, new test case needed |
| SARC-01 | Discovery output not persisted (no DB writes from discovery path) | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — implied by existing mock qe pattern |

### Sampling Rate

- **Per task commit:** `node --test plugins/ligamen/worker/scan/manager.test.js`
- **Per wave merge:** `node --test plugins/ligamen/worker/scan/manager.test.js plugins/ligamen/worker/scan/findings.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — `manager.test.js` exists and the test infrastructure (temp git repos, mock queryEngine, `setAgentRunner`) is already in place. New test cases are added to the existing file; no new files or framework installs needed.

---

## Sources

### Primary (HIGH confidence)

- Direct code read: `plugins/ligamen/worker/scan/manager.js` — full scan orchestration logic, agentRunner injection pattern, slog helper
- Direct code read: `plugins/ligamen/worker/scan/agent-prompt-discovery.md` — discovery prompt output schema
- Direct code read: `plugins/ligamen/worker/scan/agent-prompt-deep.md` — deep-scan prompt with `{{DISCOVERY_JSON}}` placeholder and fallback language
- Direct code read: `plugins/ligamen/commands/map.md` — authoritative two-phase protocol description
- Direct code read: `plugins/ligamen/worker/scan/manager.test.js` — existing test patterns, mock infrastructure
- Direct code read: `.planning/REQUIREMENTS.md` — SARC-01 specification
- Direct code read: `.planning/STATE.md` — "Discovery output is ephemeral prompt context only — not persisted to DB" (locked decision)

### Secondary (MEDIUM confidence)

- None required — all findings are from direct code reads.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all files confirmed to exist
- Architecture: HIGH — change location is unambiguous (scanRepos loop in manager.js); all supporting patterns are verified from existing code
- Pitfalls: HIGH — derived from careful reading of existing test patterns and the current manager.js logic flow

**Research date:** 2026-03-22
**Valid until:** 2026-06-22 (stable codebase — 90 days)
