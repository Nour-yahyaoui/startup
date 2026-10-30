// Initialize database (idempotent). Startup also inserts missing default roles.
import { initDb, DATA_DIR } from './index.js';
import { DEFAULT_ROLES } from './roles.js';

async function main() {
  await initDb();
  console.log(`✓ Database initialized in ${DATA_DIR}`);
  console.log('  Roles:', DEFAULT_ROLES.map(r => r.name).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
