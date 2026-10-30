import bcrypt from 'bcryptjs';
import { createSigner, createVerifier as createJwtVerifier } from 'fast-jwt';
import { nanoid } from 'nanoid';
import { run, get } from './db/index.js';
import { pickColor } from './hub.js';
import { hasPermission } from './access.js';
import { loadJwtSecret } from './secret.js';

const SECRET = loadJwtSecret();
const signer = createSigner({ key: SECRET, algorithm: 'HS256', expiresIn: '7d' });
const verifier = createJwtVerifier({ key: SECRET, algorithms: ['HS256'], requiredClaims: ['sub', 'exp', 'iat'] });

export function signToken(user) {
  return signer({ sub: user.id, role: user.role, sv: user.session_version ?? 0 });
}
export function createVerifier() {
  return verifier;
}

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export async function registerUser({ email, name, password }) {
  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    throw new Error('Missing fields');
  }
  email = email.trim().toLowerCase();
  name = name.trim();
  if (!email || !name || !password) throw new Error('Missing fields');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  const hash = await hashPassword(password);
  // Check after the async hash and immediately before inserting. Concurrent first
  // registrations cannot both become owner in this single-process database.
  if (get('SELECT COUNT(*) as c FROM users').c > 0) {
    const error = new Error('This workspace is already set up. Ask an administrator to create your account.');
    error.statusCode = 403;
    throw error;
  }
  const id = nanoid(12);
  run(
    `INSERT INTO users (id, email, name, password_hash, role, avatar_color, created_at)
     VALUES (?, ?, ?, ?, 'owner', ?, ?)`,
    [id, email, name, hash, pickColor(email + name), Date.now()]
  );
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function loginUser({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Invalid credentials');
  email = email.trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || user.disabled_at != null) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error('Invalid credentials');
  const current = get('SELECT * FROM users WHERE id = ?', [user.id]);
  if (!current || current.disabled_at != null || current.session_version !== user.session_version) throw new Error('Invalid credentials');
  run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), user.id]);
  return current;
}

// A deactivation increments the version, invalidating previously issued tokens
// even if the account is later reactivated. Legacy tokens without sv map to 0.
export function getSessionUser(payload) {
  if (!payload || typeof payload.sub !== 'string') return null;
  const version = payload.sv ?? 0;
  if (!Number.isSafeInteger(version) || version < 0) return null;
  const user = get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!user || user.disabled_at != null || user.session_version !== version) return null;
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
      const user = getSessionUser(payload);
      if (!user) return reply.code(401).send({ error: 'Session is no longer valid' });
      req.user = user;
    } catch (e) {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  };
}

// Roles grant operations; project membership independently controls the scope.
export function requirePerm(...perms) {
  return async (req, reply) => {
    if (!perms.every(p => hasPermission(req.user, p))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}
