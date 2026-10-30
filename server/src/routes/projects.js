import { all, get, run, transaction } from '../db/index.js';
import { nanoid } from 'nanoid';
import { publicUser } from '../hub.js';
import { canManageProjectAccess, getAccessibleProject, isWorkspaceAdmin, projectRecipientIds } from '../access.js';
import { removeStoredFile } from '../storage.js';

export async function projectRoutes(app) {
  const auth = app.authenticate;
  const canWrite = app.requirePerm('projects.write');
  const notFound = reply => reply.code(404).send({ error: 'Project not found' });

  app.get('/api/projects', { preHandler: [auth] }, async (req) => {
    const projects = isWorkspaceAdmin(req.user)
      ? all(`SELECT p.*, u.name as owner_name, u.avatar_color as owner_color, u.role as owner_role
             FROM projects p JOIN users u ON u.id = p.owner_id
             WHERE p.archived = 0 ORDER BY p.created_at DESC`)
      : all(`SELECT p.*, u.name as owner_name, u.avatar_color as owner_color, u.role as owner_role
             FROM projects p JOIN users u ON u.id = p.owner_id
             LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
             WHERE p.archived = 0 AND (p.owner_id = ? OR pm.user_id IS NOT NULL)
             ORDER BY p.created_at DESC`, [req.user.id, req.user.id]);
    return { projects: projects.map(mapProject) };
  });

  app.post('/api/projects', { preHandler: [auth, canWrite] }, async (req, reply) => {
    const { name, description = '', color = '#6366f1', memberIds = [] } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof description !== 'string' ||
        typeof color !== 'string' || !Array.isArray(memberIds) ||
        memberIds.some(id => typeof id !== 'string' || !get('SELECT id FROM users WHERE id = ? AND disabled_at IS NULL', [id]))) {
      return reply.code(400).send({ error: 'Provide a name and valid project members' });
    }
    const id = nanoid(12);
    const members = [...new Set([req.user.id, ...memberIds])];
    transaction(db => {
      db.run(`INSERT INTO projects (id, name, description, color, owner_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`, [id, name.trim(), description, color, req.user.id, Date.now()]);
      for (const memberId of members) {
        db.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [id, memberId]);
      }
    });
    const project = getProjectWithMembers(id);
    app.hub.emitProjectChanged(project, 'create');
    return { project };
  });

  app.get('/api/projects/:id', { preHandler: [auth] }, async (req, reply) => {
    if (!getAccessibleProject(req.user, req.params.id)) return notFound(reply);
    return { project: getProjectWithMembers(req.params.id) };
  });

  app.patch('/api/projects/:id', { preHandler: [auth, canWrite] }, async (req, reply) => {
    if (!getAccessibleProject(req.user, req.params.id)) return notFound(reply);
    const { name, description, color, archived } = req.body || {};
    if ((name !== undefined && (typeof name !== 'string' || !name.trim())) ||
        (description !== undefined && typeof description !== 'string') ||
        (color !== undefined && typeof color !== 'string')) {
      return reply.code(400).send({ error: 'Invalid project details' });
    }
    run(`UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
         color = COALESCE(?, color), archived = COALESCE(?, archived) WHERE id = ?`,
      [name?.trim() ?? null, description ?? null, color ?? null,
        archived == null ? null : (archived ? 1 : 0), req.params.id]);
    const project = getProjectWithMembers(req.params.id);
    app.hub.emitProjectChanged(project, 'update');
    return { project };
  });

  app.delete('/api/projects/:id', { preHandler: [auth] }, async (req, reply) => {
    const project = getAccessibleProject(req.user, req.params.id);
    if (!project) return notFound(reply);
    if (!canManageProjectAccess(req.user, project)) return reply.code(403).send({ error: 'Only the project owner or an admin can delete a project' });
    const recipients = projectRecipientIds(project.id);
    const files = all('SELECT name FROM files WHERE project_id = ?', [project.id]);
    // Otherwise ON DELETE SET NULL would silently expose private files to the whole workspace.
    transaction(db => {
      db.run('DELETE FROM files WHERE project_id = ?', [project.id]);
      db.run('DELETE FROM messages WHERE channel_id = ?', ['project:' + project.id]);
      db.run('DELETE FROM typing WHERE channel_id = ?', ['project:' + project.id]);
      db.run('DELETE FROM projects WHERE id = ?', [project.id]);
    });
    for (const file of files) {
      try { removeStoredFile(file.name); } catch (error) { req.log.error(error, 'Could not remove deleted project file'); }
    }
    app.hub.notifyUsers(recipients, { type: 'project:delete', projectId: project.id });
    app.hub.forgetProject(project.id);
    return { ok: true };
  });

  app.post('/api/projects/:id/members', { preHandler: [auth] }, async (req, reply) => {
    const project = getAccessibleProject(req.user, req.params.id);
    if (!project) return notFound(reply);
    if (!canManageProjectAccess(req.user, project)) return reply.code(403).send({ error: 'Only the project owner or an admin can manage access' });
    const { userId } = req.body || {};
    if (typeof userId !== 'string' || !get('SELECT id FROM users WHERE id = ? AND disabled_at IS NULL', [userId])) {
      return reply.code(400).send({ error: 'Valid userId required' });
    }
    run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', [project.id, userId]);
    const updated = getProjectWithMembers(project.id);
    app.hub.emitProjectChanged(updated, 'update');
    return { project: updated };
  });

  app.delete('/api/projects/:id/members/:userId', { preHandler: [auth] }, async (req, reply) => {
    const project = getAccessibleProject(req.user, req.params.id);
    if (!project) return notFound(reply);
    if (!canManageProjectAccess(req.user, project)) return reply.code(403).send({ error: 'Only the project owner or an admin can manage access' });
    const { userId } = req.params;
    if (userId === project.owner_id) return reply.code(400).send({ error: 'The project owner always has access' });
    const member = get(`SELECT u.* FROM users u JOIN project_members pm ON pm.user_id = u.id
                        WHERE pm.project_id = ? AND u.id = ?`, [project.id, userId]);
    if (!member) return reply.code(404).send({ error: 'Member not found' });
    transaction(db => {
      db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, userId]);
      if (!isWorkspaceAdmin(member)) {
        db.run('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?', [project.id, userId]);
        db.run('DELETE FROM typing WHERE channel_id = ? AND user_id = ?', ['project:' + project.id, userId]);
      }
    });
    app.hub.revokeProjectAccess(userId, project.id);
    const updated = getProjectWithMembers(project.id);
    app.hub.emitProjectChanged(updated, 'update');
    return { project: updated };
  });
}

function mapProject(p) {
  const members = all(`SELECT u.* FROM users u JOIN project_members pm ON pm.user_id = u.id
                       WHERE pm.project_id = ? ORDER BY u.name`, [p.id]).map(publicUser);
  const owner = publicUser({ id: p.owner_id, name: p.owner_name, avatar_color: p.owner_color, role: p.owner_role });
  return {
    id: p.id, name: p.name, description: p.description, color: p.color,
    ownerId: p.owner_id, owner, members, createdAt: p.created_at, archived: !!p.archived
  };
}

function getProjectWithMembers(id) {
  const p = get(`SELECT p.*, u.name as owner_name, u.avatar_color as owner_color, u.role as owner_role
                 FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`, [id]);
  return p ? mapProject(p) : null;
}
