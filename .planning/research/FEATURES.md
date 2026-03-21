# Feature Research

**Domain:** Claude Code plugin — scan intelligence and enrichment (v5.3.0)
**Researched:** 2026-03-21
**Confidence:** HIGH (direct codebase inspection + verified patterns from ecosystem research)

> **Scope note:** This document covers v5.3.0 features ONLY.
> Already shipped and treated as dependencies: MCP server (8 tools), graph UI, SQLite with
> node_metadata table, scan manager with beginScan/endScan brackets, confirmation flow with
> synonyms, findings schema with confidence/evidence fields already in the JSON contract,
> schemas array in findings, actor/actor_connections tables, plugin marketplace structure.

---

## Current State (Evidence Base)

Read directly from codebase before researching. These are facts, not assumptions.

| What exists | File | Relevance to v5.3.0 |
|-------------|------|----------------------|
| `confidence` and `evidence` in findings JSON | `worker/scan/agent-schema.json` | Schema already captures these; DB does not yet persist them |
| `schemas[]` with `name`, `role`, `file`, `fields[]` | `worker/scan/agent-schema.json` | Schema surfacing data collected; not yet shown in graph UI detail panel |
| `node_metadata` table: `(service_id, view, key, value, source)` | `worker/db/migrations/008_actors_metadata.js` | Built exactly to hold enrichment data without new migrations; currently unused |
| `source_file` / `target_file` on connections | `worker/scan/agent-schema.json` + `worker/scan/findings.js` | In schema; agent prompts need explicit guidance to populate these reliably |
| Agent prompt files per type | `worker/scan/agent-prompt-service.md`, `-library.md`, `-infra.md`, `-common.md` | Auth/DB extraction and CODEOWNERS ownership require prompt additions |
| `query-engine-enrich.test.js` — `enrichImpactResult()`, `enrichSearchResult()` | `worker/db/query-engine.js` | Enrichment functions exist for impact/search; enrichment pass architecture is separate |
| No CODEOWNERS parsing code | `worker/scan/` | Must be added — filesystem read of `CODEOWNERS`, pattern matching against service root_path |
| No auth/DB extraction logic | `worker/scan/` | Must be added — regex/AST pattern recognition in agent prompts or post-scan pass |
| quality-gate command | `plugins/ligamen/commands/quality-gate.sh` + `skills/quality-gate.md` | THE-937: move to standalone plugin |
| `/graph` HTTP endpoint | `worker/server/http.js` | Returns services/connections/exposed; must be extended to serve schemas and ownership |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that directly fulfill the milestone goal. Without these, v5.3.0 is incomplete.

| Feature | Why Expected | Complexity | Dependency On Existing |
|---------|--------------|------------|------------------------|
| Persist confidence and evidence to DB | Findings JSON already carries `confidence` (high/low) and `evidence` (code snippet ≤3 lines) on every connection; storing them enables MCP tools to surface evidence without re-scanning | MEDIUM | `connections` table needs two new columns: `confidence TEXT` and `evidence TEXT`; migration 009; `upsertConnection()` must write them |
| Surface schemas in graph detail panel | `schemas[]` array already captured in scan findings; agent already populates it per the prompt; must store in DB and render in detail panel alongside endpoints | HIGH | New `schemas` table + `schema_fields` table (or JSON column); `/graph` API must include schemas per service; detail panel renderer must display field names+types |
| CODEOWNERS extraction — ownership per service | Teams expect to see who owns what next to each node; standard CI/CD platforms use CODEOWNERS as canonical ownership; Ligamen already has `root_path` per service to match against patterns | MEDIUM | New post-scan enrichment pass; filesystem read of `{repo_path}/CODEOWNERS` or `{repo_path}/.github/CODEOWNERS`; gitignore-style pattern matching against service `root_path`; write to `node_metadata(service_id, view='ownership', key='team', value='{owner}')` |
| Auth mechanism extraction | Detail panel currently shows connections and exposed endpoints; auth mechanism (JWT, OAuth2, API key, mTLS, none) is essential context for security-conscious teams using Ligamen for architecture review | MEDIUM | Agent prompt addition (auth_mechanism field on services); or post-scan regex pass over config/middleware files; write to `node_metadata(view='auth', key='mechanism', value='...')` |
| DB backend extraction | Infra services often have ambiguous types without knowing what database they back; "unknown" DB creates noise in the graph | MEDIUM | Agent prompt addition (`db_backend` field on infra services) or post-scan pass detecting docker-compose/terraform DB declarations; write to `node_metadata(view='db', key='backend', value='postgres')` |
| Enrichment pass architecture | Auth, DB, ownership, and future STRIDE/vuln data all need a structured post-scan hook system; ad hoc additions create spaghetti | HIGH | Pluggable `runEnrichmentPasses(serviceId, repoPath, db)` called from scan manager after `endScan()`; each pass is an independent module (codeowners.js, auth-detector.js, db-detector.js); writes to `node_metadata`; passes are idempotent (INSERT OR REPLACE) |
| Agent prompt improvements for source_file/target_file | THE-942: connections currently often have null `target_file`; without it agents cannot trace calls to exact function locations; this is a data quality fix | LOW | Update agent-prompt-common.md with explicit instruction: "Always attempt to identify target_file as file:function — use null only when the target is a separate deployed service" |
| Show "unknown" for missing metadata in UI | When a service was scanned before enrichment passes ran, or a pass found no data, the UI should display "unknown" rather than blank/absent keys; this signals "we looked, didn't find" vs "we never looked" | LOW | UI renderer change in detail panel: check for `null` vs absent, render "unknown" string for all optional metadata keys |
| Spin out quality-gate to standalone plugin | THE-937: quality-gate is a general-purpose dev quality command unrelated to dependency intelligence; it adds noise to Ligamen's surface area and couples an independent tool to Ligamen's release cycle | MEDIUM | New repo or separate plugin directory; remove from `plugins/ligamen/commands/` and `plugins/ligamen/skills/`; update README; no DB changes needed |

### Differentiators (Competitive Advantage)

Features that go beyond the minimum but make the enrichment system substantially more useful.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Confidence badge in detail panel | Showing `high` vs `low` confidence per connection lets teams triage "scan said this exists" vs "scan is certain" without re-running | LOW | Render connection confidence from DB in detail panel; color-code (green=high, yellow=low); already in findings schema |
| Evidence snippet on hover/expand | The `evidence` field (≤3 lines of actual code proving the connection) is the most valuable artifact for a developer reviewing scan output; showing it inline removes the "did the scanner hallucinate this?" doubt | MEDIUM | Store evidence in `connections.evidence TEXT`; surface in detail panel as expandable code block with syntax-aware monospace rendering |
| Multi-owner support | Some services span team boundaries; CODEOWNERS allows multiple owners per pattern; Ligamen should store all owners, not just the last match | LOW | Store comma-separated or JSON array in `node_metadata.value`; render as tag list in detail panel |
| Ownership filter in filter panel | "Show me only services owned by @team-payments" is a natural navigation gesture for large graphs | MEDIUM | Add `owner` filter to the existing filter panel toggle system; read from `node_metadata(view='ownership')` |
| Enrichment pass timing in worker logs | Structured log entries for each pass (`[enrich:codeowners] service=payments-api elapsed=12ms`) let teams see enrichment cost and debug when ownership data is missing | LOW | One logger.log call per pass per service; already have structured logger with component tags |
| `node_metadata` viewer in detail panel | Rather than hard-coding auth/DB/ownership into specific UI sections, a generic "Metadata" section showing all `node_metadata` rows for the service would future-proof the UI for STRIDE/vuln views | MEDIUM | Read all `node_metadata` rows for service; group by `view`; render as collapsible sections; already have escapeHtml() for safety |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Automatic CODEOWNERS inference from git blame | "Auto-detect ownership without CODEOWNERS" | Git blame produces per-line attribution, not team ownership; produces noisy results for vendored code and auto-generated files; violates the "detect, don't configure" principle when the output would be unreliable | Only read from actual CODEOWNERS files; if none present, write `node_metadata(view='ownership', key='team', value='unknown')` |
| Storing raw evidence snippets in FTS5 virtual tables | "Make evidence searchable" | FTS5 tokenizes evidence as natural language; code snippets produce poor token boundaries and misleading relevance scores; storage cost is high for little gain | Evidence is best read inline from the detail panel; full-text search of code is not a Ligamen use case |
| Enrichment passes that write to `connections` or `services` tables | "Update the connection with enriched data" | Scan manager owns `connections` and `services`; enrichment passes writing to those tables create a temporal coupling: enrichment must run after endScan but before the next scan starts; any race corrupts base data | All enrichment writes go to `node_metadata` only; base tables are scan-owned |
| Per-field confidence scoring (field-level not connection-level) | "I want to know how confident the scanner is about each field" | The LLM cannot reliably produce calibrated per-field confidence; it would add noise, not signal; the current connection-level confidence (high/low) is already binary and easily understood | Keep confidence binary at connection level; flag the whole connection as low if any field is uncertain |
| Auth mechanism enforcement / policy engine | "Flag services without JWT" | This is a policy/compliance tool, not a visualization tool; adding enforcement logic couples Ligamen to specific security policies that differ across teams | Surface auth mechanism in the UI; let teams decide what to do with the information; enforcement belongs in CI checks, not in the graph viewer |
| Re-scanning on every detail panel open | "Always show fresh data" | Scanning is agent-invoked and takes 10–60s per repo; triggering it from a UI click would block the UI and produce inconsistent results mid-scan | Detail panel reads from DB (which is scan-version-bracketed); show last-scan-at timestamp so users know data age |

---

## Feature Dependencies

```
[Migration 009 — confidence/evidence columns on connections]
    └──required by──> [Persist confidence + evidence to DB]
                          └──required by──> [Confidence badge in detail panel]
                          └──required by──> [Evidence snippet on hover]

[Migration 009 or reuse node_metadata — schemas table]
    └──required by──> [Surface schemas in graph detail panel]
                          └──note: schemas relate to services, not connections]

[CODEOWNERS enrichment pass]
    └──requires──> [Enrichment pass architecture (runEnrichmentPasses)]
    └──writes to──> [node_metadata table (already exists)]
    └──enables──> [Ownership filter in filter panel]

[Auth mechanism enrichment pass]
    └──requires──> [Enrichment pass architecture (runEnrichmentPasses)]
    └──writes to──> [node_metadata table]
    └──enables──> [node_metadata viewer in detail panel]

[DB backend enrichment pass]
    └──requires──> [Enrichment pass architecture (runEnrichmentPasses)]
    └──writes to──> [node_metadata table]

[Enrichment pass architecture]
    └──requires──> [scan manager endScan() hook point]
    └──independent of──> [agent prompt improvements]
    └──independent of──> [quality-gate spin-out]

[Agent prompt improvements (source_file/target_file)]
    └──independent of all other features]
    └──improves data quality for all MCP tool responses]

[Show "unknown" for missing metadata]
    └──requires──> [at least one enrichment pass running and writing node_metadata]
    └──UI-only change, no DB migration needed]

[Quality-gate spin-out]
    └──independent of all enrichment features]
    └──removal-only from this plugin]
```

### Dependency Notes

- **Enrichment pass architecture must ship before individual passes.** CODEOWNERS, auth, and DB extraction all call into `runEnrichmentPasses()`; the framework must exist before any pass is wired in.
- **Migration 009 is the linchpin for confidence/evidence.** Without it, none of the confidence-in-UI features work. It is small (two nullable TEXT columns on connections), low-risk, and backwards-compatible.
- **Schemas storage requires a decision: new table vs JSON column.** A `schemas` table with a `schema_fields` join table is relational and queryable but adds two new tables. Alternatively, a `schemas_json TEXT` column on `services` avoids a migration cascade but is not queryable. Given the node_metadata pattern already used in this codebase, storing schemas as node_metadata entries (`view='schema'`) is the cleanest fit — no new table, upsertable, and consistent with the enrichment architecture.
- **Quality-gate spin-out is fully independent** and can be done in any phase without affecting enrichment work.
- **"Unknown" rendering in detail panel depends on enrichment passes running at least once.** Before any pass has run, the `node_metadata` table is empty for a service; the UI should distinguish "enrichment has never run" (no row) from "enrichment ran and found nothing" (row with value='unknown').

---

## MVP Definition (v5.3.0)

### Launch With (v5.3.0 core)

Features that directly deliver the milestone goal: enrichment architecture, schema surfacing, confidence/evidence, ownership, auth/DB, agent data quality, quality-gate spin-out.

- [ ] **Migration 009** — add `confidence TEXT` and `evidence TEXT` to `connections` table; `upsertConnection()` must write both; backwards-compatible nullable columns
- [ ] **Persist confidence + evidence** — scan manager passes confidence/evidence from findings into upsertConnection; MCP impact responses include evidence snippet when available
- [ ] **Enrichment pass architecture** — `runEnrichmentPasses(serviceId, repoPath, db, logger)` framework; called from scan manager after `endScan()`; each pass is a separate module; passes are idempotent via INSERT OR REPLACE on node_metadata
- [ ] **CODEOWNERS enrichment pass** — reads `CODEOWNERS` or `.github/CODEOWNERS` from repo root; applies last-matching-pattern rule (gitignore semantics); writes `node_metadata(view='ownership', key='team', value='{owners}')` per service; handles missing file gracefully (writes 'unknown')
- [ ] **Auth mechanism extraction** — agent prompt addition: `auth_mechanism` field on services (enum: jwt, oauth2, api_key, mtls, none, unknown); OR post-scan pass detecting middleware patterns; writes to node_metadata
- [ ] **DB backend extraction** — agent prompt addition: `db_backend` field on infra/service (`postgres`, `mysql`, `redis`, `dynamodb`, `mongodb`, `none`, `unknown`); OR post-scan pass over docker-compose/terraform DB declarations; writes to node_metadata
- [ ] **Schema storage** — store `schemas[]` from findings into `node_metadata(view='schema', key='{schema_name}', value='{json}')` per service; avoids new table migration
- [ ] **Schema display in detail panel** — detail panel renders schema section: list of schema names, their role (request/response/event_payload), and field table (name, type, required badge)
- [ ] **Agent prompt improvements (source_file/target_file)** — update agent-prompt-common.md with explicit guidance to populate `target_file` as `file:function`; add examples; validate in findings.js that null is only accepted for external targets
- [ ] **Show "unknown" for missing metadata** — detail panel renders "unknown" for all optional metadata keys when node_metadata row is absent or value is null/empty
- [ ] **Quality-gate spin-out** — remove `commands/quality-gate.sh` and `skills/quality-gate.md` from plugins/ligamen; document as separate plugin; update README

### Add After Validation (v5.3.x)

Features to add once core enrichment is working and tested.

- [ ] **Confidence badge in detail panel** — render connection confidence (high/low) as color-coded badge; requires migration 009 data to be present
- [ ] **Evidence snippet in detail panel** — expandable code block showing the exact evidence string; trigger: first user feedback that "I can't tell if this connection is real"
- [ ] **Ownership filter in filter panel** — filter graph by CODEOWNERS team; trigger: teams with >10 services start using Ligamen
- [ ] **Enrichment pass timing in logs** — structured log per pass per service; trigger: any pass taking >100ms noticed in dev

### Future Consideration (v6+)

Features to defer until product-market fit is established.

- [ ] **node_metadata viewer in detail panel** — generic metadata section grouping all node_metadata by view; trigger: when STRIDE or vuln views are being built
- [ ] **Multi-owner display** — show all CODEOWNERS entries for a service as a tag list; trigger: teams with multi-team ownership patterns report confusion
- [ ] **Per-connection confidence timeline** — track confidence change over successive scans; requires scan version history correlation

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Migration 009 (confidence/evidence columns) | HIGH | LOW (2 columns, 1 migration file) | P1 |
| Persist confidence + evidence from scan | HIGH | LOW (extend upsertConnection) | P1 |
| Enrichment pass architecture | HIGH | MEDIUM (framework + 3 passes) | P1 |
| CODEOWNERS enrichment pass | HIGH | MEDIUM (gitignore pattern matching) | P1 |
| Auth mechanism extraction | MEDIUM | MEDIUM (prompt addition + node_metadata write) | P1 |
| DB backend extraction | MEDIUM | MEDIUM (prompt addition + node_metadata write) | P1 |
| Schema storage + display | HIGH | HIGH (storage + UI rendering) | P1 |
| Agent prompt improvements (source_file/target_file) | HIGH | LOW (markdown edit + validation tweak) | P1 |
| Show "unknown" for missing metadata | MEDIUM | LOW (UI renderer change) | P1 |
| Quality-gate spin-out | LOW (for this plugin) | MEDIUM (new repo/plugin structure) | P1 |
| Confidence badge in detail panel | MEDIUM | LOW | P2 |
| Evidence snippet in detail panel | MEDIUM | MEDIUM (expandable UI component) | P2 |
| Ownership filter in filter panel | MEDIUM | MEDIUM | P2 |

**Priority key:**
- P1: Required for v5.3.0 milestone to be complete
- P2: Should have; add in same milestone if time allows, otherwise v5.3.x patch
- P3: Future consideration

---

## Pattern Research: How These Systems Work

### Enrichment Pass Architecture (MEDIUM confidence — general pipeline pattern)

Post-scan enrichment follows the ELT (extract-load-transform) pattern: the agent scan extracts raw
data and loads it into the DB; enrichment passes transform it into derived metadata. The pattern
used in code intelligence tools (e.g., Nemesis, sourcegraph enrichers) is:

1. Primary data load completes atomically (endScan brackets guarantee this in Ligamen)
2. Enrichment passes run independently, reading from base tables, writing to metadata tables
3. Each pass is idempotent (INSERT OR REPLACE semantics)
4. Passes can be skipped on error without invalidating base data

This maps directly onto Ligamen's existing `node_metadata(service_id, view, key, value)` table.

### CODEOWNERS Parsing (HIGH confidence — documented by GitHub/GitLab)

Standard pattern:
- File locations checked in order: `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`
- Each line: `<gitignore-pattern> <owner1> [owner2 ...]`
- Last matching pattern wins (not first)
- Patterns use gitignore semantics: `*` matches files in a directory, `**` matches recursively
- Owner formats: `@username`, `@org/team`, `user@email.com`
- Lines starting with `#` are comments; empty lines are ignored

For Ligamen: match `service.root_path` against patterns; the last matching rule's owners are the
service owners. If no rule matches, the service has no explicit owner (write 'unknown').

Node.js implementation: the `hmarr/codeowners` package (MIT) implements this correctly with full
gitignore semantics. Alternatively, implement from scratch — the pattern matching is straightforward
with `minimatch` (already indirectly available in the Node ecosystem) or a simple recursive glob.

### Confidence + Evidence Storage (HIGH confidence — based on existing findings schema)

Ligamen already defines `confidence: "high" | "low"` and `evidence: string` on every connection
in the findings JSON. The pattern used in threat intelligence systems (Recorded Future, Sumo Logic)
stores confidence as a numeric or enum score alongside provenance data. For Ligamen's binary
(high/low) model: store as TEXT in the connections table; surface in the UI as a simple badge.
Evidence snippets (≤3 lines of code) are best displayed verbatim in a monospace code block.

### Schema Visualization in Dependency Graphs (MEDIUM confidence — Grafana SDG + general patterns)

Service dependency graph tools (Grafana SDG panel, Dynatrace Smartscape) show connection-level
metadata in detail panels. Schema/field visualization in this context typically means:
- A collapsible section in the service detail panel (not on the graph edges — too noisy)
- Group schemas by role (request, response, event_payload)
- For each schema: name, source file, and a field table (name, type, required)
- Keep it read-only — no editing in the viewer

This is display-only complexity, not data complexity. The hard work is storage; rendering is a
table with three columns.

### Auth/DB Extraction (MEDIUM confidence — static analysis patterns)

Common approaches in code intelligence tools:
1. **Agent prompt**: Ask the LLM to identify auth mechanism and DB from imports/middleware/config.
   Pros: LLM understands context, no regex brittle patterns. Cons: adds latency.
2. **Regex/AST post-scan pass**: Detect `passport`, `jsonwebtoken`, `express-jwt` imports for JWT;
   `pg`, `mysql2`, `mongoose` for DB backends. Pros: fast, deterministic. Cons: framework-specific.

For Ligamen (framework-agnostic constraint): the agent prompt approach is correct. Add structured
fields to the service object in the scan schema. The post-scan enrichment pass is a fallback for
repos that weren't re-scanned (reads docker-compose/Kubernetes env vars for DB URLs).

---

## Sources

- Direct inspection of `plugins/ligamen/worker/scan/agent-schema.json` — HIGH confidence (source of truth for findings schema)
- Direct inspection of `plugins/ligamen/worker/db/migrations/008_actors_metadata.js` — HIGH confidence (node_metadata table definition)
- Direct inspection of `plugins/ligamen/worker/db/query-engine-enrich.test.js` — HIGH confidence (existing enrich function contracts)
- Direct inspection of `plugins/ligamen/worker/scan/findings.js` — HIGH confidence (validation logic for confidence/evidence fields)
- [GitHub CODEOWNERS syntax](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — HIGH confidence; canonical source
- [GitLab CODEOWNERS reference](https://docs.gitlab.com/user/project/codeowners/reference/) — HIGH confidence; confirms last-pattern-wins semantics
- [hmarr/codeowners Go package](https://pkg.go.dev/github.com/hmarr/codeowners) — MEDIUM confidence; reference implementation showing correct parsing approach
- [Grafana Service Dependency Graph plugin](https://grafana.com/grafana/plugins/novatec-sdg-panel/) — MEDIUM confidence; UI patterns for dependency graph detail panels
- [Nemesis 2.X enrichment architecture](https://specterops.io/blog/2026/03/10/the-nemesis-2-x-development-guide/) — MEDIUM confidence; post-scan enrichment pass pattern
- [Google Enterprise Knowledge Graph confidence scores](https://cloud.google.com/enterprise-knowledge-graph/docs/confidence-score) — MEDIUM confidence; confidence scoring patterns in graph systems
- WebSearch: "CODEOWNERS file parsing ownership attribution developer tooling patterns 2025" — MEDIUM confidence

---
*Feature research for: Ligamen v5.3.0 — Scan Intelligence & Enrichment*
*Researched: 2026-03-21*
