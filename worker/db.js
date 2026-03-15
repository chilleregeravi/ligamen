/**
 * worker/db.js — Database lifecycle module for AllClear v2.0
 *
 * Opens (or creates) the SQLite database for a project, applies WAL mode and
 * performance pragmas, runs pending migrations, and exposes the singleton
 * database handle via openDb() / getDb().
 *
 * DB path: ~/.allclear/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db
 *
 * IMPORTANT: This module uses top-level await to preload migration modules.
 * Callers that import this module from an ES module context get the fully
 * initialized module (migrations preloaded). The module-level _migrations
 * array is populated before any openDb() call can execute.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Module-level singleton database instance */
let _db = null;

/** Preloaded migration modules, sorted by version */
const _migrations = await loadMigrationsAsync();

/**
 * Asynchronously discovers and imports all migration modules.
 * Called once at module load time via top-level await.
 *
 * @returns {Promise<Array<{version: number, up: (db: any) => void}>>}
 */
async function loadMigrationsAsync() {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  const migrations = [];
  for (const file of files) {
    const modulePath = pathToFileURL(path.join(migrationsDir, file)).href;
    try {
      const migration = await import(modulePath);
      if (migration && typeof migration.version === 'number' && typeof migration.up === 'function') {
        migrations.push({ version: migration.version, up: migration.up });
      }
    } catch (err) {
      console.error(`Failed to load migration ${file}:`, err.message);
    }
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Computes the project-specific data directory path.
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {string} Full path to the directory (not yet created).
 */
function projectHashDir(projectRoot) {
  const hash = crypto
    .createHash('sha256')
    .update(projectRoot)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.homedir(), '.allclear', 'projects', hash);
}

/**
 * Opens (or creates) the SQLite database for the given project root.
 * Runs pending migrations before returning. Idempotent — safe to call
 * multiple times; returns the same instance on subsequent calls.
 *
 * @param {string} [projectRoot] - Project root directory. Defaults to process.cwd().
 * @returns {import('better-sqlite3').Database} The open database instance.
 */
export function openDb(projectRoot = process.cwd()) {
  if (_db) return _db;

  const dataDir = projectHashDir(projectRoot);
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'impact-map.db');
  const db = new Database(dbPath);

  // Apply pragmas in specified order
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');   // 64 MB page cache
  db.pragma('busy_timeout = 5000');   // 5s — prevents SQLITE_BUSY on concurrent reads

  runMigrations(db);

  _db = db;
  return _db;
}

/**
 * Returns the already-opened database instance.
 * @throws {Error} If openDb() has not been called yet.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!_db) {
    throw new Error('Database not initialized. Call openDb() first.');
  }
  return _db;
}

/**
 * Runs all pending migrations in version order.
 * Creates the schema_versions table if absent, then applies any migrations
 * whose version number exceeds the current MAX(version).
 *
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  // Ensure migration tracker table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion =
    db.prepare('SELECT MAX(version) FROM schema_versions').pluck().get() ?? 0;

  for (const migration of _migrations) {
    if (migration.version <= currentVersion) continue;

    // Wrap each migration in a transaction for atomicity
    const runMigration = db.transaction(() => {
      migration.up(db);
      db
        .prepare('INSERT INTO schema_versions (version) VALUES (?)')
        .run(migration.version);
    });

    runMigration();
  }
}

// When run directly as a script, open the DB and report status
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = openDb();
  console.log('WAL:', db.pragma('journal_mode', { simple: true }));
  console.log('FK:', db.pragma('foreign_keys', { simple: true }));
  console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all().sort().join(', '));
  const schemaVer = db.prepare('SELECT MAX(version) FROM schema_versions').pluck().get();
  console.log('Schema version:', schemaVer);
  db.close();
}
