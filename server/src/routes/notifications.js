import { all, run } from '../db/index.js';
import { nanoid } from 'nanoid';
import { getAccessibleProject } from '../access.js';

// Stored notifications are untrusted historical data: a project reference must
// still be authorized when it is read, not only when it was created. Legacy
// records with no explicit scope are hidden rather than potentially leaking it.
export function visibleNotifications(rows, user, canAccess = getAccessibleProject) {
  const visible = [];
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload); } catch { continue; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    if (typeof payload.projectId === 'string' && payload.projectId) {
      if (!canAccess(user, payload.projectId)) continue;
    } else if (payload.scope !== 'workspace' || payload.projectId != null) {
      continue;
    }
    visible.push({ id: row.id, type: row.type, payload, readAt: row.read_at, createdAt: row.created_at });
    if (visible.length === 100) break;
  }
  return visible;
}

export async function notifRoutes(app) {
  const auth = app.authenticate;

  app.get('/api/notifications', { preHandler: [auth] }, async (req) => {
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    return { notifications: visibleNotifications(rows, req.user) };
  });

  app.post('/api/notifications/:id/read', { preHandler: [auth] }, async (req) => {
    run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?',
        [Date.now(), req.params.id, req.user.id]);
    return { ok: true };
  });

  app.post('/api/notifications/read-all', { preHandler: [auth] }, async (req) => {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
        [Date.now(), req.user.id]);
    return { ok: true };
  });
}

export function createNotification(userId, type, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !((typeof payload.projectId === 'string' && payload.projectId) ||
        (payload.scope === 'workspace' && payload.projectId == null))) {
    throw new Error('Notification must have an explicit project or workspace scope');
  }
  const id = nanoid(10);
  run(
    `INSERT INTO notifications (id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, userId, type, JSON.stringify(payload), Date.now()]
  );
  return id;
}
