// Thin synchronous wrapper around sql.js (WASM SQLite) with simple file persistence.
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { DEFAULT_ROLES } from './roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.NEXA_DATA_DIR
  ? path.resolve(process.env.NEXA_DATA_DIR)
  : path.resolve(__dirname, '../../../data');
const DB_PATH = path.join(DATA_DIR, 'nexa.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let SQL;
let db;

export async function initDb() {
  SQL = await initSqlJs();
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  db = buf ? new SQL.Database(buf) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  migrate();
  for (const role of DEFAULT_ROLES) {
    db.run('INSERT OR IGNORE INTO roles (id, name, permissions, created_at) VALUES (?, ?, ?, ?)',
      [nanoid(12), role.name, JSON.stringify(role.permissions), Date.now()]);
  }
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
      last_seen INTEGER,
      disabled_at INTEGER,
      session_version INTEGER NOT NULL DEFAULT 0
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
  // Existing workspaces predate account deactivation. Additive, idempotent migration.
  const userColumns = db.exec('PRAGMA table_info(users)')[0].values.map(row => row[1]);
  if (!userColumns.includes('disabled_at')) db.run('ALTER TABLE users ADD COLUMN disabled_at INTEGER');
  if (!userColumns.includes('session_version')) db.run('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
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

// Group related writes without persisting a partially completed operation.
export function transaction(fn) {
  db.run('BEGIN');
  let result;
  try {
    result = fn(db);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  persist();
  return result;
}
