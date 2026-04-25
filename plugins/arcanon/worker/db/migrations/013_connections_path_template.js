/**
 * Migration 013 — Add connections.path_template column.
 *
 * Phase 109 (TRUST-03): connections whose only difference is a template variable
 * name (e.g. /runtime/streams/{stream_id} vs /runtime/streams/{name}) need to
 * collapse to a single canonical row. The canonical form ({_} placeholder) is
 * stored in the existing `path` column (preserving API surface and the existing
 * 4-col UNIQUE dedup constraint). The original template(s) — what the agent
 * actually emitted — are stored in this new `path_template` column for display.
 *
 * On collapse of multiple variants, persistFindings (Plan 109-02) stores templates
 * comma-joined (e.g. "/runtime/streams/{stream_id},/runtime/streams/{name}").
 *
 * Idempotent via PRAGMA table_info check — safe to re-run.
 *
 * Existing rows are NOT backfilled. They retain `path_template = NULL` until
 * a re-scan touches the row. See .planning/phases/109-path-canonicalization-and-evidence/109-CONTEXT.md D-06
 * for the safety rationale (silent canonicalization of historic data could
 * incorrectly collapse legitimately-distinct rows).
 *
 * Migration numbering: this is `version: 13`. Phase 110 will ship `version: 12`
 * (services.base_path) later in the v0.1.3 train. The loader (database.js:41-68)
 * sorts by exported `version` integer, so 013 runs after 012 once 012 lands —
 * shipping 013 first is safe at runtime.
 */

export const version = 13;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const hasCol = (table, col) =>
    db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === col);

  if (!hasCol("connections", "path_template")) {
    db.exec("ALTER TABLE connections ADD COLUMN path_template TEXT;");
  }
}
