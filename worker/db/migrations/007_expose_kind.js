/**
 * Migration 007 — Add kind discriminant column to exposed_endpoints, purge malformed rows.
 *
 * STORE-01: Adds `kind TEXT NOT NULL DEFAULT 'endpoint'` to exposed_endpoints.
 *   The kind column is the foundation for type-specific data in v2.3 — it lets
 *   the parser tag rows as 'endpoint', 'library', or 'infra' without a table rename.
 *
 * STORE-02: Deletes malformed rows where method IS NULL AND path NOT LIKE '/%'.
 *   Broken library/infra scans inserted function signatures (e.g. 'ClientConfig):')
 *   and Unicode arrows (e.g. '→') as path values. These rows occupy UNIQUE slots
 *   (service_id, method, path) and cause INSERT OR IGNORE to silently block correct
 *   rows on re-scan. Must be purged before the fixed parser lands in Plan 30-02.
 */

export const version = 7;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // STORE-01: Add kind discriminant column with default 'endpoint'
  db.exec(`
    ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
  `);

  // STORE-02: Purge malformed rows from broken library/infra scans.
  // Predicate: method IS NULL AND path NOT LIKE '/%'
  //   - method IS NULL: REST endpoints typically have a method; null-method rows
  //     that are valid (e.g. webhooks) always start with '/'
  //   - path NOT LIKE '/%': real REST paths start with '/'; function signatures,
  //     arrows, and other scanner artifacts do not
  db.exec(`
    DELETE FROM exposed_endpoints
    WHERE method IS NULL AND path NOT LIKE '/%';
  `);
}
