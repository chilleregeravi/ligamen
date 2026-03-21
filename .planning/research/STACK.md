# Stack Research

**Domain:** Claude Code plugin — scan intelligence and enrichment (v5.3.0 milestone)
**Researched:** 2026-03-21
**Confidence:** MEDIUM-HIGH (core patterns verified against npm registry and framework docs; auth regex patterns from ecosystem knowledge with MEDIUM confidence)

---

## Context: What Already Exists (Do Not Re-Research)

This is a subsequent-milestone research doc. The existing stack is fully validated and unchanged:

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js >=20, ESM (`"type":"module"`) | Locked. All new code must be ESM-compatible. |
| DB | better-sqlite3 ^12.8.0, WAL mode, migration system | Migrations 001–008 shipped. Migration 009 needed. |
| HTTP | Fastify ^5.8.2 + @fastify/cors + @fastify/static | No changes needed. |
| MCP | @modelcontextprotocol/sdk ^1.27.1 | No changes needed. |
| Validation | zod ^3.25.0 | Reuse for enrichment result schemas. |
| Optional vector | chromadb ^3.3.3 | Unchanged. |

**This document covers only NEW additions and patterns for v5.3.0 features.**

---

## Recommended Stack — New Additions Only

### Core Technologies (New)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| picomatch | ^4.0.3 | CODEOWNERS glob pattern matching | Zero dependencies, actively maintained (used by fast-glob, jest, chokidar, 5M+ projects). Handles `**`, dotfiles, matchBase semantics, and POSIX paths correctly. Safer than minimatch — no brace-expansion ESM chain issue (see minimatch issue #257). |
| Node.js builtins (`fs`, `path`, `readline`) | built-in (Node >=20) | CODEOWNERS file discovery and line parsing | Three-location probe + line-by-line parse is ~25 lines of code. No library needed. |

### Supporting Libraries (New)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new for enrichment orchestration | — | Enrichment pass is a sequential runner built from existing `manager.js` injection pattern | No queue library needed for fewer than 10 enrichers per service |
| None new for auth/DB detection | — | Regex over file content | Auth and DB backend detection requires only `fs.readFileSync` + regex. No AST parsing needed for the accuracy level this milestone targets. |
| None new for schema display | — | DOM innerHTML with existing `escapeHtml` | The detail-panel.js `renderInfraConnections` table pattern is directly reusable. No component framework needed. |

### Development Tools (No Changes)

| Tool | Purpose | Notes |
|------|---------|-------|
| node:test | Unit tests for enrichment modules | Already in use across all worker modules |
| bats-core | Shell integration tests | 173 tests passing — add enrichment trigger tests |
| zod ^3.25.0 | Validate enrichment pass result objects | Reuse existing import |

---

## Feature-Specific Patterns

### 1. CODEOWNERS Parsing (THE-940)

**Do not add `codeowners-utils` as a production dependency.** It is CJS-only, last published in 2020 (5 years ago), and not maintained for ESM projects. The parsing logic is ~30 lines to implement correctly.

**Implement as `worker/scan/codeowners.js`:**

CODEOWNERS format rules (per GitHub specification):
- File locations probed in order: `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`
- Lines starting with `#` are comments — skip
- Blank lines — skip
- Each valid line: `<pattern> <owner1> [owner2] ...`
- Owners are `@username`, `@org/team`, or `email@domain.com`
- **Last match wins** — when looking up owners for a file, iterate entries in reverse
- NO negation patterns (`!`) — CODEOWNERS does not support them unlike .gitignore

**picomatch usage for CODEOWNERS patterns:**

```javascript
import { createRequire } from 'node:module';
// picomatch v4.0.3 ships CJS — use createRequire in ESM context
const require = createRequire(import.meta.url);
const picomatch = require('picomatch');

function matchesPattern(filePath, pattern) {
  // Patterns without '/' match in any directory (matchBase: true)
  // Patterns starting with '/' are anchored to repo root
  const anchored = pattern.startsWith('/');
  const normalized = anchored ? pattern.slice(1) : pattern;
  const opts = { dot: true, matchBase: !pattern.includes('/') };
  return picomatch(normalized, opts)(filePath);
}

export function findOwners(entries, filePath) {
  // Iterate in reverse — last match wins per GitHub spec
  for (let i = entries.length - 1; i >= 0; i--) {
    if (matchesPattern(filePath, entries[i].pattern)) {
      return entries[i].owners;
    }
  }
  return [];
}
```

**Important edge cases to handle:**
- `docs/` (trailing slash) — treat as `docs/**` to match directory contents
- `*.js` without `/` — matchBase:true so it matches `src/foo.js`, not just `foo.js`
- `apps/*/src/**` — double-glob for subdirectory traversal (picomatch handles natively)
- Service root_path from `services` table is relative to repo root — use it directly as filePath argument

**Storage:** Write owners into `node_metadata` table (view=`ownership`, key=`owners`, value=JSON stringified array of owner strings). This is what `node_metadata` was designed for — no migration needed for ownership data specifically.

**Denormalized fast-path:** Write the first owner string into the new `services.owner` column (Migration 009) for single-query `/graph` responses.

---

### 2. Enrichment Pass Architecture (THE-941)

**No external orchestration library.** Extend the existing manager.js injection pattern.

**New file: `worker/scan/enrichment.js`**

Design as a registry of named enricher functions:

```javascript
// Enricher signature contract:
// async function enricher(ctx) => { [key: string]: string | null }
//   ctx = { serviceId, repoPath, language, entryFile, db, logger }
//   returns an object of metadata key→value pairs to write to node_metadata

const enrichers = [];

export function registerEnricher(name, fn) {
  enrichers.push({ name, fn });
}

export async function runEnrichmentPass(service, db, logger) {
  const ctx = {
    serviceId: service.id,
    repoPath: service.root_path,
    language: service.language,
    entryFile: service.boundary_entry,
    db,
    logger,
  };

  for (const { name, fn } of enrichers) {
    try {
      const result = await fn(ctx);
      // Write each key-value pair to node_metadata
      for (const [key, value] of Object.entries(result)) {
        db.prepare(`INSERT OR REPLACE INTO node_metadata
          (service_id, view, key, value, source, updated_at)
          VALUES (?, 'enrichment', ?, ?, 'enricher', datetime('now'))`)
          .run(service.id, key, value);
      }
    } catch (err) {
      logger?.warn?.(`Enricher ${name} failed: ${err.message}`);
      // Continue — one enricher failure must not block others
    }
  }
}
```

**Enrichers registered for v5.3.0:**
1. `codeowners-enricher` — reads CODEOWNERS, sets `owners`, `owner` (first owner)
2. `auth-enricher` — regex scans entry files, sets `auth_mechanism`, `auth_confidence`
3. `db-enricher` — regex scans for ORM imports and config files, sets `db_backend`

**Trigger in manager.js:** After `endScan()`, call `runEnrichmentPass` once per upserted service. Do NOT call on incremental no-op scans. Services can be enriched in parallel (`Promise.all`) with a concurrency cap matching the existing scan parallelism (4).

**Enrichment re-run policy:** Always re-run on full scans. On incremental scans, skip enrichment for services whose files were not in the changed set (check against `getChangedFiles` result).

---

### 3. Auth Mechanism Detection (THE-943)

**Approach: regex over entry-point files and auth/middleware directories.** Scan at most 20 files per service, capped to the entry file + files under `routes/`, `middleware/`, `auth/`, `security/` subdirectories. Keep enrichment under 500ms per service.

**Detection signal table (implement as ordered lookup — first match per language wins):**

| Language | Auth mechanism | File pattern | Signal regex |
|----------|---------------|-------------|-------------|
| Python | jwt | *.py | `/(PyJWT|python-jose|jose|fastapi_jwt_auth|jwt\.decode|jwt\.encode)/i` |
| Python | oauth2 | *.py | `/(OAuth2|authlib|social_django|django_oauth_toolkit|openid)/i` |
| Python | session | *.py | `/(SessionMiddleware|request\.session|flask_login|LOGIN_REQUIRED)/i` |
| Python | api-key | *.py | `/(APIKeyHeader|api_key|X-API-Key|api\.key)/i` |
| Python | none | — | Fallback if no pattern matches |
| Node.js | jwt | *.js *.ts | `/(jsonwebtoken|jwt\.sign|jwt\.verify|@auth\/core|next-auth|jose)/i` |
| Node.js | oauth2 | *.js *.ts | `/(passport\.use|oauth2|openid-client|auth0)/i` |
| Node.js | session | *.js *.ts | `/(express-session|cookie-session|req\.session)/i` |
| Node.js | api-key | *.js *.ts | `/[Aa]pi[Kk]ey|x-api-key|API_KEY/` |
| Go | jwt | *.go | `/(jwt-go|golang-jwt|dgrijalva\/jwt|lestrrat.*jwx)/i` |
| Go | oauth2 | *.go | `/(golang\.org\/x\/oauth2|oauth2\.Config)/i` |
| Go | middleware | *.go | `/\.Use\(.*[Aa]uth\|middleware\.[Aa]uth/` |
| Rust | jwt | *.rs | `/(jsonwebtoken|jwt_simple|frank_jwt)/i` |
| Rust | oauth2 | *.rs | `/(oauth2::|openidconnect::)/i` |
| Rust | actix-auth | *.rs | `/(actix.web.httpauth|HttpAuthentication)/i` |

**Multiple signals:** If both JWT and OAuth2 patterns match, store as `"oauth2+jwt"` (concatenated with `+`). OAuth2 implementations often use JWT as the token format — both signals carry useful information.

**Confidence:** `"high"` if pattern found in `boundary_entry` file. `"low"` if found only in a secondary file.

**node_metadata keys written:** `auth_mechanism` (e.g. `"jwt"`), `auth_confidence` (e.g. `"high"`).

**services column written:** `auth_mechanism` in Migration 009 (denormalized for fast graph query).

---

### 4. Database Backend Detection (THE-943)

**Same approach as auth — regex over imports and config files.**

**Probe order:** Check `schema.prisma` first (most authoritative) → then `*.env` / `docker-compose.yml` DATABASE_URL → then source file ORM imports.

| Language | DB | Signal | Regex |
|----------|----|----|-----|
| Any | prisma | schema.prisma | `datasource db \{[^}]*provider\s*=\s*"(\w+)"` → extract provider value |
| Any | env config | .env, docker-compose.yml | `/DATABASE_URL\s*=.*?(postgres|mysql|sqlite|mongo)/i` |
| Python | postgresql | *.py | `/(psycopg2|asyncpg|databases\[.*postgres|postgresql)/i` |
| Python | mysql | *.py | `/(mysqlclient|aiomysql|mysql\+pymysql)/i` |
| Python | sqlite | *.py | `/(sqlite3|aiosqlite|SQLite)/i` |
| Python | mongodb | *.py | `/(pymongo|motor\.|MongoClient)/i` |
| Python | redis | *.py | `/(redis\.Redis|aioredis|StrictRedis)/i` |
| Node.js | postgresql | *.js *.ts | `/(pg\b|postgres\(|@prisma.*postgresql|pgPool)/i` |
| Node.js | mysql | *.js *.ts | `/(mysql2|@prisma.*mysql|sequelize.*mysql)/i` |
| Node.js | sqlite | *.js *.ts | `/(better-sqlite3|sqlite3|@prisma.*sqlite)/i` |
| Node.js | mongodb | *.js *.ts | `/(mongoose|MongoClient|@prisma.*mongodb)/i` |
| Go | postgresql | *.go | `/(lib\/pq|pgx\.|gorm.*postgres)/i` |
| Go | mysql | *.go | `/(go-sql-driver\/mysql|gorm.*mysql)/i` |
| Rust | postgresql | *.rs | `/(sqlx.*postgres|diesel.*pg|tokio-postgres)/i` |
| Rust | sqlite | *.rs | `/(rusqlite|sqlx.*sqlite)/i` |

**node_metadata keys written:** `db_backend` (e.g. `"postgresql"`, `"sqlite"`).

**services column written:** `db_backend` in Migration 009.

---

### 5. Confidence and Evidence Persistence (THE-939)

**No new migrations or storage layer work needed.** The `connections` table already has `confidence TEXT` and `evidence TEXT` columns from the initial schema (migration 001). The `node_metadata` table has `source TEXT` for provenance.

**Gap to close:** Verify that `upsertConnection` in `query-engine.js` includes `confidence` and `evidence` in the `ON CONFLICT DO UPDATE SET` clause. If these fields are missing from the UPDATE side, they are silently dropped on re-scan.

**API change:** Add `confidence` and `evidence` to each edge in the `/graph` endpoint response. Currently the graph embeds exposes but not connection-level confidence/evidence.

**UI change in detail-panel.js:** For each connection listed in the service detail panel, show the confidence badge and evidence snippet. Evidence is a code snippet (≤3 lines from agent-schema.json spec) — render in a `<code>` block with `escapeHtml`.

---

### 6. Schema/Field Display in Canvas UI (THE-938)

**Approach: two new DB tables + embed in `/graph` + DOM rendering in detail-panel.js.**

Schemas are already collected by the scan agent (see `findings.js` — `schemas[]` with `name`, `role`, `file`, `fields[]`). The gap is that schemas are NOT currently stored or returned.

**Migration 009 adds:**

```sql
CREATE TABLE IF NOT EXISTS schemas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,  -- request | response | event_payload
  file            TEXT NOT NULL,
  scan_version_id INTEGER REFERENCES scan_versions(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(service_id, name, role)
);

CREATE TABLE IF NOT EXISTS schema_fields (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id INTEGER NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL,
  required  INTEGER NOT NULL DEFAULT 0  -- 0=false, 1=true
);

CREATE INDEX IF NOT EXISTS idx_schemas_service_id ON schemas(service_id);
CREATE INDEX IF NOT EXISTS idx_schema_fields_schema_id ON schema_fields(schema_id);
```

**`/graph` embed pattern:** Include schemas per node using the same embed-at-load pattern as exposes (embed in a single graph load, not per-click API call). Shape: `node.schemas = [{ name, role, file, fields: [{ name, type, required }] }]`.

**detail-panel.js rendering (reuse existing pattern):**

```javascript
function renderSchemas(schemas) {
  if (!schemas || schemas.length === 0) return '';
  return `<div class="detail-section">
    <div class="detail-label">Schemas</div>
    ${schemas.map(s => `
      <div style="margin-bottom:8px">
        <div style="font-weight:600">${escapeHtml(s.name)}
          <span style="opacity:0.6;font-weight:400"> ${escapeHtml(s.role)}</span>
        </div>
        <table class="schema-table" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>
            <th style="text-align:left;padding:2px 4px">Field</th>
            <th style="text-align:left;padding:2px 4px">Type</th>
            <th style="text-align:center;padding:2px 4px">Req</th>
          </tr></thead>
          <tbody>${s.fields.map(f => `
            <tr>
              <td style="padding:2px 4px;font-family:monospace">${escapeHtml(f.name)}</td>
              <td style="padding:2px 4px;font-family:monospace;opacity:0.8">${escapeHtml(f.type)}</td>
              <td style="padding:2px 4px;text-align:center">${f.required ? '✓' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('')}
  </div>`;
}
```

---

### 7. "Unknown" for Missing Metadata (THE-944)

**Normalize at the HTTP response layer, not the DB layer.**

In `http.js` `/graph` handler, when building each node object:

```javascript
language: node.language ?? 'unknown',
owner: node.owner ?? 'unknown',
auth_mechanism: node.auth_mechanism ?? 'unknown',
db_backend: node.db_backend ?? 'unknown',
```

**Never store `"unknown"` in the database.** Keep DB truthful (NULL = not yet detected). The UI receives a clean string. The `??` operator distinguishes `null`/`undefined` from empty string — if the enricher explicitly writes `""` (no auth detected), that surfaces as `""` not `"unknown"`. Only absent values become `"unknown"`.

---

### 8. Migration 009 Specification

Add as `worker/db/migrations/009_enrichment_schemas.js`.

**Full DDL summary:**

```sql
-- New columns on services (denormalized for single-query graph response)
ALTER TABLE services ADD COLUMN owner TEXT;          -- first owner from CODEOWNERS (null if unknown)
ALTER TABLE services ADD COLUMN auth_mechanism TEXT;  -- e.g. "jwt", "oauth2+jwt", "none"
ALTER TABLE services ADD COLUMN db_backend TEXT;      -- e.g. "postgresql", "sqlite", "mongodb"

-- New table: schemas (per-service, per scan_version)
CREATE TABLE IF NOT EXISTS schemas (...);

-- New table: schema_fields (child of schemas)
CREATE TABLE IF NOT EXISTS schema_fields (...);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schemas_service_id ON schemas(service_id);
CREATE INDEX IF NOT EXISTS idx_schema_fields_schema_id ON schema_fields(schema_id);
```

**Rationale for denormalized columns on `services` vs. node_metadata only:**
The `/graph` API fetches all services in one query for a given repo. If `owner`, `auth_mechanism`, and `db_backend` lived only in `node_metadata`, the graph query would need a subquery or a post-fetch loop. The existing query pattern uses a single `SELECT * FROM services` join — adding columns preserves this. `node_metadata` still stores enrichment audit trail (source, updated_at, confidence evidence).

---

## Installation — New Packages Only

```bash
# Add picomatch for CODEOWNERS glob matching
npm install picomatch

# No other new production dependencies for v5.3.0
```

**Verify before adding:** picomatch is likely already an indirect dependency (fast-glob and chokidar pull it in). Check `node_modules/picomatch/` presence before adding. If present, just add it as an explicit direct dep for clear version pinning.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| picomatch ^4.0.3 | codeowners-utils | CJS-only, last published 2020 (5 years ago), no ESM export, no active maintenance — not acceptable for an ESM-first project |
| picomatch ^4.0.3 | minimatch ^10.x | minimatch v10.0.2 introduced a breaking ESM chain issue via brace-expansion v4 (issue #257 on isaacs/minimatch); picomatch has zero deps and avoids this class of problem entirely |
| picomatch ^4.0.3 | Hand-rolled glob matcher | picomatch correctly handles `**` globstar, dotfiles (`dot:true`), matchBase, and brace expansion edge cases that a hand-rolled matcher would get wrong |
| Regex-based auth/DB detection | Tree-sitter AST parsing | Tree-sitter adds a 10-15MB native binary per language grammar; overkill for confidence-level classification. Regex over entry files achieves sufficient accuracy for "show jwt vs oauth2 in UI" |
| Regex-based auth/DB detection | Semgrep subprocess | External tool dependency violates "no external service deps" constraint; subprocess adds latency, failure modes, and portability issues |
| Sequential enricher pipeline | Bull/BullMQ | Queue overhead pointless for <10 enrichers per service; existing logger-injection pattern is already test-isolated and sufficient |
| `schemas` + `schema_fields` tables | node_metadata for schema data | Schemas have nested structure (schema → fields array); representing in key/value node_metadata requires complex key conventions (`schema:FieldName:type`) and makes queries unreadable. Dedicated tables are the correct normalized design. |
| DOM innerHTML + escapeHtml | React/Lit component | Entire UI is vanilla JS; adding a component framework for one new panel section creates more tech debt than it solves |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `codeowners-utils` npm package | CJS-only, 5 years unmaintained, no ESM export | picomatch + 30-line in-house CODEOWNERS parser |
| `minimatch` v10+ | brace-expansion ESM chain caused breaking patch release (issue #257); dep chain risk for zero net benefit over picomatch | picomatch (zero deps, no chain risk) |
| Tree-sitter for auth detection | Native binaries per language grammar, 10-15MB overhead, overkill for "detect if JWT is imported" | Regex over entry-point files + known subdirectories |
| Storing `"unknown"` in DB | Pollutes truthful null-means-not-detected semantics | Normalize to `"unknown"` string at HTTP response layer in http.js using `?? 'unknown'` |
| enrichment queue library (Bull, BullMQ, p-queue) | Unnecessary for <10 enrichers per service; Redis dep or complex scheduler for no benefit | `for...of` with async/await + `Promise.all` with concurrency slice |
| Separate worker thread for enrichment | Enrichers are I/O-bound (file reads, DB writes), not CPU-bound — no parallelism benefit from threads; adds IPC complexity | Same worker process, triggered post-scan in manager.js |
| Running enrichment on incremental no-op scans | Wastes time rescanning files that didn't change | Skip enrichment when `getChangedFiles` returns empty set; skip per-service if service files not in changed set |

---

## Version Compatibility

| Package | Range | Notes |
|---------|-------|-------|
| picomatch | ^4.0.3 | Zero deps. Ships CJS build (`"main": "index.js"` without `"type":"module"`). Use `createRequire(import.meta.url)` to import in ESM context. Current: v4.0.3 (confirmed from npm). |
| better-sqlite3 | ^12.8.0 | Migration 009 adds 2 new tables + 3 new columns to services. No breaking changes to existing queries. |
| zod | ^3.25.0 | Reuse for enricher result validation (optional — enrichers can return plain objects). |
| node:test | built-in | All new files in `worker/scan/` need companion `*.test.js` files. |

---

## Sources

- [github.com/micromatch/picomatch](https://github.com/micromatch/picomatch) — v4.0.3 confirmed (last published ~7 months ago), zero dependencies, CJS build with POSIX path support — HIGH confidence
- [npmjs.com/package/codeowners-utils](https://www.npmjs.com/package/codeowners-utils) — v1.0.2, last published 5 years ago, CJS-only — HIGH confidence on rejection rationale
- [github.com/isaacs/minimatch/issues/257](https://github.com/isaacs/minimatch/issues/257) — minimatch v10 ESM chain breaking change via brace-expansion v4 — MEDIUM confidence on current risk (may be resolved in minimatch v10.2.2+)
- [fastapi.tiangolo.com/tutorial/security/oauth2-jwt](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — FastAPI JWT auth patterns — HIGH confidence
- [www.django-rest-framework.org/api-guide/authentication](https://www.django-rest-framework.org/api-guide/authentication/) — DRF auth patterns — HIGH confidence
- [actix.rs/docs/middleware](https://actix.rs/docs/middleware/) — Rust actix-web auth middleware patterns — HIGH confidence
- Existing codebase: `findings.js`, `agent-schema.json`, `migrations/008_actors_metadata.js`, `query-engine.js`, `detail-panel.js` — direct read — HIGH confidence on integration points

---

*Stack research for: Ligamen v5.3.0 Scan Intelligence & Enrichment*
*Researched: 2026-03-21*
