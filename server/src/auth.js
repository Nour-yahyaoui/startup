import bcrypt from 'bcryptjs';
import { createSigner, createVerifier as _createVerifier } from './jwt-shim.js';
import { nanoid } from 'nanoid';
import { run, get } from './db/index.js';
import { pickColor } from './hub.js';

const SECRET = process.env.TEAMROOM_JWT_SECRET || process.env.NEXA_JWT_SECRET || 'teamroom-dev-secret-change-me';
// Tokens issued before the Teamroom rebrand were signed with this key; keep
// verifying them so nobody gets logged out by the rename.
const LEGACY_SECRET = process.env.NEXA_JWT_SECRET || 'nexa-dev-secret-change-me';

export function signToken(user) {
  return createSigner({ key: SECRET, expiresIn: '7d' })({ sub: user.id, role: user.role });
}
export function createVerifier() {
  const primary = _createVerifier({ key: SECRET });
  if (LEGACY_SECRET === SECRET) return primary;
  const legacy = _createVerifier({ key: LEGACY_SECRET });
  return (token) => { try { return primary(token); } catch { return legacy(token); } };
}

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export async function registerUser({ email, name, password, role }) {
  email = email.trim().toLowerCase();
  if (!email || !name || !password) throw new Error('Missing fields');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  // First user becomes owner; otherwise default to employee unless admin specified
  const users = get('SELECT COUNT(*) as c FROM users');
  const finalRole = (!users || users.c === 0) ? 'owner' : (role || 'employee');
  const id = nanoid(12);
  const color = pickColor(email + name);
  const now = Date.now();
  const hash = await hashPassword(password);
  run(
    `INSERT INTO users (id, email, name, password_hash, role, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, email, name.trim(), hash, finalRole, color, now]
  );
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  return user;
}

export async function loginUser({ email, password }) {
  email = email.trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error('Invalid credentials');
  run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), user.id]);
  return user;
}

// Fastify auth preHandler
export function authenticate(app) {
  return async (req, reply) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      const payload = createVerifier()(token);
      const user = get('SELECT * FROM users WHERE id = ?', [payload.sub]);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      req.user = user;
    } catch (e) {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  };
}

// Permission check: simple role-based with wildcard for owner/admin
export function requirePerm(...perms) {
  return async (req, reply) => {
    const roleName = req.user.role;
    if (roleName === 'owner' || roleName === 'admin') return;
    const role = get('SELECT * FROM roles WHERE name = ?', [roleName]);
    const permissions = role ? JSON.parse(role.permissions || '[]') : [];
    const ok = perms.every(p => permissions.includes(p) || permissions.includes('*'));
    if (!ok) return reply.code(403).send({ error: 'Forbidden' });
  };
}
