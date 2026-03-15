import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.ALLCLEAR_DB_PATH
  || path.join(process.cwd(), '.allclear', 'impact-map.db');

/**
 * Open the SQLite database in read-only mode.
 * Returns null if the file does not exist or if any error occurs.
 */
export function openDb() {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
    return db;
  } catch (err) {
    console.error('[allclear-mcp] Failed to open database:', err.message);
    return null;
  }
}

const server = new McpServer({ name: 'allclear-impact', version: '2.0.0' });

// Tools will be registered in Plan 02.

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGTERM', () => process.exit(0));
