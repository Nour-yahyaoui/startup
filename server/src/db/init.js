// Initialize database (idempotent). First-run seeds default roles.
import { initDb, run } from './index.js';
import { nanoid } from 'nanoid';

const DEFAULT_ROLES = [
  { name: 'owner',        permissions: ['*'] },
  { name: 'admin',        permissions: ['*'] },
  { name: 'manager',      permissions: ['projects.write', 'tasks.write', 'chat.write', 'files.write', 'members.manage'] },
  { name: 'employee',     permissions: ['projects.read', 'tasks.write', 'chat.write', 'files.write'] },
  { name: 'viewer',       permissions: ['projects.read', 'chat.read'] },
];

async function main() {
  await initDb();
  const now = Date.now();
  for (const r of DEFAULT_ROLES) {
    run(
      `INSERT OR IGNORE INTO roles (id, name, permissions, created_at)
       VALUES (?, ?, ?, ?)`,
      [nanoid(12), r.name, JSON.stringify(r.permissions), now]
    );
  }
  console.log('✓ Database initialized');
  console.log('  Roles:', DEFAULT_ROLES.map(r => r.name).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
