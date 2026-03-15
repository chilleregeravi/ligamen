# Feature Research

**Domain:** Claude Code plugin — service dependency intelligence for multi-repo polyglot teams (v2.0 milestone)
**Researched:** 2026-03-15
**Confidence:** HIGH (design document verified, ecosystem patterns confirmed via multiple sources)

> **Scope note:** This document covers v2.0 new features only. v1.0 features (quality gate, format/lint hooks,
> file guard, session context, pulse, deploy) are already shipped and are listed here only where they represent
> dependencies for v2.0 features.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a service dependency intelligence tool must have. Missing these = the product feels incomplete or
untrustworthy for its stated purpose.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Service-to-service dependency graph (stored) | Any dependency intelligence tool must persist its graph; in-memory-only is not queryable by agents | HIGH | SQLite as source of truth; WAL mode for concurrent reads; `repos`, `services`, `connections` tables per design |
| API-level impact analysis (not symbol grep) | Symbol grep is v1 quality — users building real multi-service systems need endpoint/schema-level analysis | HIGH | `connections` table with protocol, method, path; `fields` table for schema fields; replaces v1 grep approach |
| Incremental scan (git diff driven) | Full rescans are too slow for daily use; any modern static analysis tool (Aikido, Designite) does incremental by default | HIGH | `repo_state` table tracking last_scanned_commit; git diff since that commit drives what to scan |
| Graceful fallback to grep when map is absent | Users must not hit a hard error before they have built a map; existing v1 behavior must remain accessible | MEDIUM | `/allclear:cross-impact` checks for worker + map data; falls back to grep-based scan if absent; suggests `/allclear:map` |
| User confirmation before persisting findings | Agent findings are hypotheses, not facts; persisting unreviewed data breaks trust | MEDIUM | ALL findings presented to user before SQLite write, regardless of agent confidence level; this is a hard requirement per design |
| Breaking vs additive change classification | Removing an endpoint is categorically different from adding a new field; treating them the same produces false alarm fatigue | MEDIUM | CRITICAL for removed endpoints; WARN for changed field types; INFO for additive fields; drives report severity |
| Transitive impact traversal | Direct consumers are obvious; transitive consumers (A calls B calls C) are the dangerous blind spot | HIGH | Recursive CTE or BFS graph walk; depth must be bounded; `direction` parameter (upstream/downstream/both) |
| Worker process start/stop management | A localhost process that doesn't reliably start and stop erodes trust fast | MEDIUM | Presence of `impact-map` section in config implies auto-start; remove section to disable; PID file management |
| Graph visualization (browser-based) | Every mature dependency tool (Grafana Service Dependency Graph, Port.io, ReSharper dependency diagrams) provides a visual; text-only output is insufficient for graph comprehension | HIGH | D3.js force-directed graph; nodes = services; edges = connections colored by protocol; rendered on `localhost:PORT` |
| MCP tools for agent use | MCP is the de-facto standard (as of 2025) for connecting agents to tools; not exposing impact data via MCP means agents cannot autonomously query it | HIGH | `impact_query`, `impact_changed`, `impact_graph`, `impact_scan`, `impact_search` per design document |

### Differentiators (Competitive Advantage)

Features that set AllClear v2.0 apart from the few tools that attempt service dependency intelligence.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent-based scanning (no external parsers) | CodeLogic, Augment Code use language-specific parsers (tree-sitter, stack-graphs) that miss non-standard code; Claude agents read code like a human and handle any language/framework | HIGH | Spawn agents into each linked repo; agents extract endpoints, consumers, events, schemas and return structured findings; no tree-sitter dependency |
| Protocol-aware connections (REST, gRPC, events, internal) | Most tools model "service calls service"; AllClear models the protocol, making Kafka/RabbitMQ event consumers visible alongside HTTP consumers | HIGH | `protocol` field on `connections` table: rest/grpc/kafka/rabbitmq/internal/sdk; impact analysis considers protocol semantics |
| Field-level schema tracking | Breaking change tools (oasdiff, Buf) work on OpenAPI/proto files; AllClear discovers schemas from code regardless of whether an OpenAPI spec exists | HIGH | `schemas` and `fields` tables; `required` flag on fields; distinguishes field removal (breaking) from field addition (additive) |
| Map versioning with snapshot history | Most dependency map tools have no concept of "what changed in the graph since last week"; AllClear snapshots SQLite files | MEDIUM | SQLite file copy to `.allclear/snapshots/`; `map_versions` table tracks metadata; enables graph diff queries |
| ChromaDB optional semantic search | Keyword search (FTS5) misses "find services that handle user authentication" — semantic search finds them; optional so tool works without it | HIGH | ChromaDB local or remote; falls back to FTS5 if unavailable; falls back to direct SQL if FTS5 unavailable; three-tier fallback chain |
| Mono-repo and multi-repo unified model | Most tools are mono-repo-only or multi-repo-only; AllClear models services, not repos — a mono-repo with 8 services and 4 separate repos with 2 services each are the same data model | MEDIUM | `repos` table is a container; `services` is the graph node; `repo.type` = mono/single but graph queries ignore this boundary |
| First-run recommendations for MCP setup | New users don't know to add the MCP server to their Claude Code settings; AllClear prompts on first successful map build | LOW | After first `/allclear:map` completion, output instructions: add `allclear-mcp` to `.claude/settings.json`; one-time only |
| `/allclear:map --view` shortcut | Users want to open the visualization without triggering a rescan; single flag skips straight to browser open | LOW | `--view` flag exits early if map data exists, opens browser; shows "no data yet" message if map is empty |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-persist findings without user review | Speed — skip the confirmation step | Agent findings are probabilistic; unreviewed data in the graph silently propagates wrong edges to all downstream impact queries; one bad edge corrupts the whole blast radius calculation | Always present findings to user; make the confirmation fast (show summary for high-confidence, ask questions for low-confidence) — not slow |
| OpenAPI spec parsing as primary scanner | OpenAPI gives structured schema data reliably | Services without OpenAPI specs (gRPC without reflection, internal SDKs, event producers) are invisible; creates a false "complete" graph that misses connections | Use agent scanning as primary; if an OpenAPI spec is found, use it as supporting evidence to increase confidence, not as the only source |
| Automatic re-scan on every file edit | Always-fresh graph | A full repo scan after every file save is prohibitively slow; hooks fire synchronously — a slow hook blocks Claude Code | Incremental scan on demand (after git commit range); re-scan suggestion at end of `/allclear:cross-impact` when map is stale |
| External service catalog integration (Backstage, Port.io) | Teams using Backstage want AllClear to read from it | Adds external service dependency; violates the "no external deps" constraint; Backstage schemas change without notice | Remain self-contained; AllClear's own SQLite is the catalog; document export path for teams wanting to push to Backstage |
| Git blame / ownership tracking in impact reports | "Who owns the affected service?" is a useful question | Requires GitHub/GitLab API access; violates no-external-deps constraint; ownership data goes stale | Scope to code and file paths only; let users look up owners through their own tooling |
| Auto-fix of breaking changes | "Just update all consumers for me" is appealing | Auto-updating consumer code is semantically unsafe; Claude making unsupervised changes to multiple repos is high-risk | Surface the affected files and what needs changing; let the user or Claude agent decide per-file with full context |
| Real-time graph streaming (WebSocket) | Live dependency visualization as code changes | WebSocket server adds significant complexity to the worker; the graph changes slowly (not on every keystroke); polling is sufficient for the use case | HTTP polling on 30s interval from D3 UI; `Last-Modified` header allows efficient conditional requests |

---

## Feature Dependencies

```
[Worker process (Node.js, localhost)]
    └──required by──> [SQLite storage]
    └──required by──> [HTTP REST API]
    └──required by──> [MCP server (stdio)]
    └──required by──> [D3 web UI]

[SQLite storage + schema]
    └──required by──> [Service graph build (/allclear:map)]
    └──required by──> [Impact query (/allclear:cross-impact)]
    └──required by──> [MCP tool: impact_query]
    └──required by──> [MCP tool: impact_changed]
    └──required by──> [Map versioning / snapshots]
    └──enhances──> [ChromaDB vector sync (optional)]

[Agent-based repo scanning]
    └──required by──> [Service graph build]
    └──required by──> [Incremental scanning]
    └──feeds──> [User confirmation flow]

[User confirmation flow]
    └──required by──> [SQLite write (findings persistence)]
    (hard gate — no writes bypass this)

[Linked-repos config (v1.0, existing)]
    └──required by──> [Repo discovery for /allclear:map]
    └──enhances──> [/allclear:map — skips parent dir scan if config present]

[Incremental scanning (git diff + repo_state)]
    └──required by──> [Default scan mode after first map build]
    └──depends on──> [repo_state table tracking last_scanned_commit]

[Breaking change classification]
    └──required by──> [Impact report severity levels (CRITICAL/WARN/INFO)]
    └──depends on──> [field-level schema tracking]

[Transitive graph traversal]
    └──required by──> [Full blast radius calculation]
    └──depends on──> [connections table with source/target service IDs]

[ChromaDB sync (optional)]
    └──enhances──> [impact_search MCP tool (semantic)]
    └──enhances──> [/allclear:cross-impact query quality]
    (graceful skip when unavailable — SQLite + FTS5 fallback)

[MCP server]
    └──enhances──> [/allclear:cross-impact] (agents can query without manual command)
    └──enables──> [autonomous agent impact checking before code changes]
```

### Dependency Notes

- **Worker is the load-bearing foundation**: All v2.0 features require the Node.js worker process. It must be phase 1 of the v2.0 build.
- **SQLite schema locks in the data model**: The `connections`, `schemas`, and `fields` tables must be stable before agents start scanning. Schema migrations are painful post-facto.
- **User confirmation is a hard gate, not a feature toggle**: Bypassing it for "speed" breaks the trust contract. Build it into the core write path from day one.
- **Incremental scanning requires repo_state seeded on first full scan**: First scan is always full; subsequent scans use `last_scanned_commit` from `repo_state`. Do not attempt incremental before the first full scan completes.
- **ChromaDB is optional but the fallback chain must be tested**: Three-tier fallback (ChromaDB → FTS5 → direct SQL) must work correctly; ChromaDB unavailability cannot crash the worker.
- **MCP server depends on worker being registered in Claude Code settings**: After first map build, recommend user add the MCP server entry. This is a one-time manual step — no way to auto-register.

---

## MVP Definition (v2.0)

### Launch With (v2.0 core)

Minimum viable product — validates the service dependency intelligence concept.

- [ ] Worker process (Node.js) with HTTP server — all other v2.0 features are unreachable without this
- [ ] SQLite schema (repos, services, connections, schemas, fields, map_versions, repo_state) — stable data model before any scanning
- [ ] Agent-based scanning via `/allclear:map` — the primary user-facing build flow
- [ ] User confirmation flow — hard gate before any SQLite write
- [ ] Incremental scanning (git diff since last_scanned_commit) — required for daily usability; full rescan is too slow
- [ ] `/allclear:cross-impact` redesign using graph queries — replaces grep scan when map data exists; keeps grep fallback
- [ ] Transitive impact traversal — blast radius is the core value; direct-only impact is insufficient
- [ ] Breaking change classification (CRITICAL/WARN/INFO) — differentiates removed endpoints from additive changes
- [ ] D3 web UI (basic force-directed graph) — required for users to validate the map and understand the dependency structure
- [ ] MCP server with `impact_query` and `impact_changed` tools — enables agents to check impact autonomously before making changes

### Add After Validation (v2.x)

Features to add once core graph intelligence is working and validated by real usage.

- [ ] `impact_graph` MCP tool (subgraph for a service) — add when users ask for service-scoped views
- [ ] `impact_search` MCP tool + ChromaDB sync — add when users need semantic search across the map
- [ ] Map snapshot diffing (graph changes since last week) — add when users ask "what changed in our dependencies?"
- [ ] D3 UI enhancements: node filtering by protocol, zoom, service detail pane — add after basic visualization is validated
- [ ] `impact_scan` MCP tool (trigger scan from agent) — add when agents need to self-trigger rescans

### Future Consideration (v2.x+)

Features to defer until v2.0 core proves the value proposition.

- [ ] Graph export (JSON, dot format for Graphviz) — defer until users ask for external tooling integration
- [ ] Snapshot comparison UI (visual graph diff) — defer; SQLite file diff is sufficient for MVP
- [ ] ChromaDB cloud mode (remote host) — defer; local ChromaDB covers the semantic search use case; cloud mode adds config complexity

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Worker process + HTTP API | HIGH | MEDIUM | P1 — foundation |
| SQLite schema | HIGH | MEDIUM | P1 — foundation |
| Agent-based scanning + `/allclear:map` | HIGH | HIGH | P1 — primary user interface |
| User confirmation flow | HIGH | MEDIUM | P1 — trust requirement |
| Incremental scanning | HIGH | MEDIUM | P1 — daily usability |
| Transitive impact traversal | HIGH | HIGH | P1 — blast radius is the core value |
| Breaking change classification | HIGH | MEDIUM | P1 — CRITICAL/WARN/INFO report |
| `/allclear:cross-impact` redesign | HIGH | MEDIUM | P1 — existing command gets new backend |
| D3 web UI (basic) | HIGH | HIGH | P1 — required for map validation |
| MCP server (impact_query, impact_changed) | HIGH | MEDIUM | P1 — agent autonomy |
| Map versioning / snapshots | MEDIUM | LOW | P2 |
| ChromaDB sync + impact_search | MEDIUM | HIGH | P2 |
| D3 UI enhancements (filter, zoom, detail) | MEDIUM | MEDIUM | P2 |
| impact_scan MCP tool | MEDIUM | LOW | P2 |
| impact_graph MCP tool | MEDIUM | MEDIUM | P2 |
| Graph export (JSON/dot) | LOW | LOW | P3 |
| Snapshot comparison UI | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v2.0 launch
- P2: Should have, add when P1 is validated
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

Tools in the service dependency intelligence space, verified via research.

| Feature | CodeLogic MCP server | Augment Code microservices analysis | Grafana Service Dependency Graph | AllClear v2.0 |
|---------|---------------------|--------------------------------------|----------------------------------|---------------|
| MCP tool interface | Yes (codelogic-method-impact, codelogic-database-impact) | No | No | Yes (5 tools) |
| Agent-based scanning | No (requires CodeLogic server, commercial) | No (static analysis) | No (telemetry-based) | **Yes — Claude agents, no external deps** |
| No external service dependency | No — requires CodeLogic cloud | No — requires Augment Code platform | No — requires Grafana stack | **Yes — SQLite local only** |
| Protocol-aware connections | No (code-only, no event bus) | Partial (HTTP only) | Yes (telemetry-based) | **Yes — REST/gRPC/events/internal** |
| Field-level schema tracking | Partial (database column level) | No | No | **Yes — `fields` table with required flag** |
| Breaking vs additive classification | No | Partial | No | **Yes — CRITICAL/WARN/INFO** |
| Transitive impact | Yes | Yes | Yes | Yes |
| Incremental scanning | N/A (static at scan time) | No | N/A (real-time telemetry) | **Yes — git diff driven** |
| Map versioning / history | No | No | Limited (Grafana state) | **Yes — SQLite snapshots** |
| Graph visualization | No (IDE only) | No | Yes (Grafana panel) | **Yes — D3.js localhost** |
| User confirmation flow | No | No | No | **Yes — hard gate before persistence** |
| Works without network access | No | No | No | **Yes — all local** |
| Open source | No | No | Yes (plugin) | Yes (Apache 2.0) |

---

## Sources

- [cross-impact-v2.md design document](../../.planning/designs/cross-impact-v2.md) — HIGH confidence (primary source)
- [Designing MCP tools for agents — Datadog Engineering](https://www.datadoghq.com/blog/engineering/mcp-server-agent-tools/) — HIGH confidence (first-hand implementation lessons)
- [CodeLogic MCP server — GitHub](https://github.com/CodeLogicIncEngineering/codelogic-mcp-server) — HIGH confidence (direct inspection)
- [MCP Apps — modelcontextprotocol.io blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) — HIGH confidence (official MCP blog)
- [Augment Code microservices impact analysis](https://www.augmentcode.com/tools/microservices-impact-analysis) — MEDIUM confidence (vendor marketing)
- [Breaking change detection — Buf Docs](https://buf.build/docs/breaking/) — HIGH confidence (official Buf documentation)
- [oasdiff breaking changes — Nordic APIs](https://nordicapis.com/using-oasdiff-to-detect-breaking-changes-in-apis/) — MEDIUM confidence
- [Incremental analysis — SD Times](https://sdtimes.com/devops/demystifying-differential-and-incremental-analysis-for-static-code-analysis-within-devops/) — MEDIUM confidence
- [Blast Radius impact analysis tool](https://blast-radius.dev/) — MEDIUM confidence (pattern reference)
- [Axon graph-powered code intelligence — GitHub](https://github.com/harshkedia177/axon) — MEDIUM confidence (pattern reference for blast radius)
- [Grafana Service Dependency Graph plugin](https://grafana.com/grafana/plugins/novatec-sdg-panel/) — MEDIUM confidence
- [Human-in-the-loop AI agents 2025 — Fast.io](https://fast.io/resources/ai-agent-human-in-the-loop/) — MEDIUM confidence (confirmation flow patterns)

---
*Feature research for: AllClear v2.0 — Service Dependency Intelligence milestone*
*Researched: 2026-03-15*
