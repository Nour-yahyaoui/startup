// A project is visible to its creator, explicit members and workspace admins.
// Keep these checks server-side: hiding navigation is not an access control.
import { all, get } from './db/index.js';

export function isWorkspaceAdmin(user) {
  return !!user && (user.role === 'owner' || user.role === 'admin');
}

export function hasPermission(user, permission) {
  if (!user || user.disabled_at != null) return false;
  if (isWorkspaceAdmin(user)) return true;
  const role = get('SELECT permissions FROM roles WHERE name = ?', [user.role]);
  try {
    const permissions = JSON.parse(role?.permissions || '[]');
    return Array.isArray(permissions) && (permissions.includes('*') || permissions.includes(permission));
  } catch {
    return false;
  }
}

export function getAccessibleProject(user, projectId) {
  if (!user || user.disabled_at != null || typeof projectId !== 'string' || !projectId) return null;
  const project = get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;
  if (isWorkspaceAdmin(user) || project.owner_id === user.id) return project;
  return get('SELECT 1 AS allowed FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, user.id]) ? project : null;
}

export function canManageProjectAccess(user, project) {
  return !!project && (isWorkspaceAdmin(user) || project.owner_id === user?.id);
}

export function canAccessChannel(user, channel) {
  if (!user || user.disabled_at != null || typeof channel !== 'string') return false;
  if (channel === 'global') return true;
  if (!channel.startsWith('project:')) return false; // DMs are not implemented yet.
  return !!getAccessibleProject(user, channel.slice('project:'.length));
}

// Capture recipients before deletion, when project membership still exists.
export function projectRecipientIds(projectId) {
  return all(`SELECT u.id FROM users u
    JOIN projects p ON p.id = ?
    WHERE u.role IN ('owner', 'admin') OR u.id = p.owner_id
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id)`,
  [projectId]).map(row => row.id);
}
