// Thin synchronous wrapper around sql.js (WASM SQLite) with simple file persistence.
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
const DATA_DIR = IS_SERVERLESS ? '/tmp' : path.resolve(__dirname, '../../../data');
const DB_PATH = process.env.TEAMROOM_DB_PATH || process.env.NEXA_DB_PATH || path.join(DATA_DIR, 'teamroom.db');
// Databases created before the Teamroom rebrand; loaded once, then persisted
// under the new name so no local data is lost by the rename.
const LEGACY_DB_PATH = path.join(DATA_DIR, 'nexa.db');

if (!fs.existsSync(DATA_DIR)) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }

let SQL;
let db;

let sqlWasmLocated = false;
function locateSqlWasm() {
  if (sqlWasmLocated) return;
  sqlWasmLocated = true;
  try {
    // Try to resolve via Node's require resolution, then fall back to known paths.
    let resolved = null;
    try { resolved = require.resolve('sql.js/dist/sql-wasm.wasm'); } catch {}
    if (!resolved) {
      const candidates = [
        path.resolve(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm'),
        path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
        '/var/task/node_modules/sql.js/dist/sql-wasm.wasm'
      ];
      for (const c of candidates) if (fs.existsSync(c)) { resolved = c; break; }
    }
    if (resolved) globalThis.__TEAMROOM_SQL_WASM__ = resolved;
  } catch {}
}

export async function initDb() {
  locateSqlWasm();
  const opts = globalThis.__TEAMROOM_SQL_WASM__ ? { locateFile: () => globalThis.__TEAMROOM_SQL_WASM__ } : {};
  SQL = await initSqlJs(opts);
  let buf = null;
  if (fs.existsSync(DB_PATH)) buf = fs.readFileSync(DB_PATH);
  else if (fs.existsSync(LEGACY_DB_PATH)) buf = fs.readFileSync(LEGACY_DB_PATH);
  db = buf ? new SQL.Database(buf) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  migrate();
  persist();
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      avatar_color TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo', -- todo, in_progress, done
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      creator_id TEXT NOT NULL REFERENCES users(id),
      due_date INTEGER,
      created_at INTEGER NOT NULL,
      done_at INTEGER,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploader_id TEXT NOT NULL REFERENCES users(id),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL, -- 'global' | 'project:<id>' | 'dm:<a>:<b>'
      author_id TEXT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS typing (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS channel_reads (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      read_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, position);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
  `);
  // incremental migration: IF NOT EXISTS cannot add columns to pre-existing tables
  const msgCols = all(`PRAGMA table_info(messages)`).map(c => c.name);
  if (!msgCols.includes('edited_at')) db.exec(`ALTER TABLE messages ADD COLUMN edited_at INTEGER`);
}

export function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Small query helpers
export function run(sql, params = []) {
  db.run(sql, params);
  persist();
  return this;
}

export function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row && Object.keys(row).length ? row : null;
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function execMany(sql) {
  db.exec(sql);
  persist();
}

export function rawDb() {
  return db;
}
