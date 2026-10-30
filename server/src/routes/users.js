import { all, get, run, transaction } from '../db/index.js';
import { publicUser, pickColor } from '../hub.js';
import { hashPassword } from '../auth.js';
import { hasPermission, isWorkspaceAdmin } from '../access.js';
import { nanoid } from 'nanoid';

export async function userRoutes(app) {
  const auth = app.authenticate;
  const canManageMembers = app.requirePerm('members.manage');
  const workspaceAdmin = async (req, reply) => {
    if (!isWorkspaceAdmin(req.user)) return reply.code(403).send({ error: 'Only workspace admins can manage roles' });
  };

  app.get('/api/users', { preHandler: [auth] }, async (req, reply) => {
    const includeInactive = req.query.includeInactive === 'true';
    if (includeInactive && !isWorkspaceAdmin(req.user)) return reply.code(403).send({ error: 'Forbidden' });
    const users = includeInactive
      ? all('SELECT * FROM users ORDER BY name')
      : all('SELECT * FROM users WHERE disabled_at IS NULL ORDER BY name');
    return { users: users.map(publicUser) };
  });

  app.post('/api/users', { preHandler: [auth, canManageMembers] }, async (req, reply) => {
    const { email, name, password, role = 'employee', title } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || typeof name !== 'string' || !name.trim() ||
        typeof password !== 'string' || password.length < 6 || typeof role !== 'string') {
      return reply.code(400).send({ error: 'Name, email and a password of at least 6 characters are required' });
    }
    if (!isWorkspaceAdmin(req.user) && role !== 'employee') {
      return reply.code(403).send({ error: 'Only workspace admins can assign roles' });
    }
    if (!get('SELECT id FROM roles WHERE name = ?', [role])) return reply.code(400).send({ error: 'Unknown role' });
    const normalizedEmail = email.trim().toLowerCase();
    if (get('SELECT id FROM users WHERE email = ?', [normalizedEmail])) return reply.code(409).send({ error: 'Email already exists' });
    const hash = await hashPassword(password);
    // Recheck after hashing to avoid races with permission changes or another request.
    const actor = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!actor || actor.session_version !== req.user.session_version || !hasPermission(actor, 'members.manage') || (!isWorkspaceAdmin(actor) && role !== 'employee')) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (get('SELECT id FROM users WHERE email = ?', [normalizedEmail])) return reply.code(409).send({ error: 'Email already exists' });
    const id = nanoid(12);
    run(`INSERT INTO users (id, email, name, password_hash, role, avatar_color, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, normalizedEmail, name.trim(), hash, role, pickColor(normalizedEmail + name), title || null, Date.now()]);
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    app.hub.broadcast('user:join', { user: publicUser(user) });
    return { user: publicUser(user) };
  });

  app.patch('/api/users/:id', { preHandler: [auth, canManageMembers] }, async (req, reply) => {
    const { id } = req.params;
    const { name, role, title } = req.body || {};
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (!isWorkspaceAdmin(req.user) && (isWorkspaceAdmin(user) || (role !== undefined && role !== user.role))) {
      return reply.code(403).send({ error: 'Only workspace admins can manage privileged users or assign roles' });
    }
    if (id === req.user.id && role !== undefined && role !== user.role) {
      return reply.code(400).send({ error: 'You cannot change your own role' });
    }
    if ((name !== undefined && (typeof name !== 'string' || !name.trim())) ||
        (role !== undefined && (typeof role !== 'string' || !get('SELECT id FROM roles WHERE name = ?', [role]))) ||
        (title !== undefined && title !== null && typeof title !== 'string')) {
      return reply.code(400).send({ error: 'Invalid user details' });
    }
    run('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), title = COALESCE(?, title) WHERE id = ?',
      [name?.trim() ?? null, role ?? null, title ?? null, id]);
    const updated = get('SELECT * FROM users WHERE id = ?', [id]);
    if (updated.role !== user.role) app.hub.revalidateUserProjects(id);
    app.hub.broadcast('user:update', { user: publicUser(updated) });
    return { user: publicUser(updated) };
  });

  // Deactivate instead of deleting: historical messages, files and project
  // ownership remain intact, while all existing sessions are invalidated.
  app.delete('/api/users/:id', { preHandler: [auth, canManageMembers] }, async (req, reply) => {
    if (req.params.id === req.user.id) return reply.code(400).send({ error: 'Cannot deactivate yourself' });
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (!isWorkspaceAdmin(req.user) && isWorkspaceAdmin(user)) return reply.code(403).send({ error: 'Forbidden' });
    if (user.disabled_at != null) return reply.code(409).send({ error: 'User is already deactivated' });
    if (isWorkspaceAdmin(user) && get("SELECT COUNT(*) as c FROM users WHERE role IN ('owner', 'admin') AND disabled_at IS NULL").c <= 1) {
      return reply.code(409).send({ error: 'The workspace needs at least one active administrator' });
    }
    const affected = all(`SELECT project_id FROM project_members WHERE user_id = ?
                          UNION SELECT id AS project_id FROM projects WHERE owner_id = ?
                          UNION SELECT project_id FROM tasks WHERE assignee_id = ?`, [user.id, user.id, user.id]);
    transaction(db => {
      db.run('UPDATE users SET disabled_at = ?, session_version = session_version + 1 WHERE id = ?', [Date.now(), user.id]);
      // Preserve explicit membership of projects the user owns; ownership cannot
      // yet be transferred. All other project memberships must be re-granted.
      db.run(`DELETE FROM project_members WHERE user_id = ? AND project_id NOT IN
              (SELECT id FROM projects WHERE owner_id = ?)`, [user.id, user.id]);
      db.run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', [user.id]);
      db.run('DELETE FROM typing WHERE user_id = ?', [user.id]);
    });
    app.hub.broadcast('user:leave', { userId: user.id });
    for (const row of affected) app.hub.broadcastProject(row.project_id, { type: 'project:membership-changed', projectId: row.project_id });
    return { ok: true, user: publicUser(get('SELECT * FROM users WHERE id = ?', [user.id])) };
  });

  app.post('/api/users/:id/reactivate', { preHandler: [auth, workspaceAdmin] }, async (req, reply) => {
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (user.disabled_at == null) return reply.code(409).send({ error: 'User is already active' });
    run('UPDATE users SET disabled_at = NULL WHERE id = ?', [user.id]);
    const updated = get('SELECT * FROM users WHERE id = ?', [user.id]);
    app.hub.broadcast('user:join', { user: publicUser(updated) });
    return { user: publicUser(updated) };
  });

  app.get('/api/roles', { preHandler: [auth] }, async () => {
    return { roles: all('SELECT * FROM roles ORDER BY name') };
  });

  app.post('/api/roles', { preHandler: [auth, workspaceAdmin] }, async (req, reply) => {
    const { name, permissions = [] } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(permissions) || permissions.some(p => typeof p !== 'string')) {
      return reply.code(400).send({ error: 'Valid name and permissions required' });
    }
    const roleName = name.trim();
    if (get('SELECT id FROM roles WHERE name = ?', [roleName])) return reply.code(409).send({ error: 'Role already exists' });
    const id = nanoid(10);
    run('INSERT INTO roles (id, name, permissions, created_at) VALUES (?, ?, ?, ?)',
      [id, roleName, JSON.stringify(permissions), Date.now()]);
    app.hub.broadcast('role:update', { name: roleName });
    return { role: get('SELECT * FROM roles WHERE id = ?', [id]) };
  });

  app.patch('/api/roles/:name', { preHandler: [auth, workspaceAdmin] }, async (req, reply) => {
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions) || permissions.some(p => typeof p !== 'string')) return reply.code(400).send({ error: 'Invalid permissions' });
    if (!get('SELECT id FROM roles WHERE name = ?', [req.params.name])) return reply.code(404).send({ error: 'Not found' });
    run('UPDATE roles SET permissions = ? WHERE name = ?', [JSON.stringify(permissions), req.params.name]);
    app.hub.broadcast('role:update', { name: req.params.name });
    return { role: get('SELECT * FROM roles WHERE name = ?', [req.params.name]) };
  });

  app.delete('/api/roles/:name', { preHandler: [auth, workspaceAdmin] }, async (req, reply) => {
    if (['owner', 'admin', 'manager', 'employee', 'viewer'].includes(req.params.name)) {
      return reply.code(400).send({ error: 'Cannot delete built-in roles' });
    }
    if (get('SELECT id FROM users WHERE role = ? LIMIT 1', [req.params.name])) {
      return reply.code(409).send({ error: 'Role is assigned to a user' });
    }
    run('DELETE FROM roles WHERE name = ?', [req.params.name]);
    app.hub.broadcast('role:update', { name: req.params.name });
    return { ok: true };
  });
}
