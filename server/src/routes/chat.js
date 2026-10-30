import { all, get, run } from '../db/index.js';
import { canAccessChannel } from '../access.js';

export async function chatRoutes(app) {
  const auth = app.authenticate;

  app.get('/api/messages', { preHandler: [auth] }, async (req, reply) => {
    const channel = req.query.channel || 'global';
    if (!canAccessChannel(req.user, channel)) return reply.code(404).send({ error: 'Channel not found' });
    const n = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10) || 100, 500));
    const before = req.query.before ? parseInt(req.query.before, 10) : null;
    let rows;
    if (before && !Number.isNaN(before)) {
      rows = all(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? AND m.created_at < ?
         ORDER BY m.created_at DESC LIMIT ?`, [channel, before, n]
      );
    } else {
      rows = all(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?`, [channel, n]
      );
    }
    return { messages: rows.reverse().map(mapMessage) };
  });

  // Channels = global + all projects user is member of + DMs (future)
  app.get('/api/channels', { preHandler: [auth] }, async (req) => {
    const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
    const projects = isAdmin
      ? all(`SELECT id, name, color FROM projects WHERE archived = 0`)
      : all(`SELECT p.id, p.name, p.color FROM projects p
             LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
             WHERE p.archived = 0 AND (p.owner_id = ? OR pm.user_id IS NOT NULL)`,
             [req.user.id, req.user.id]);
    const channels = [
      { id: 'global', name: 'General', kind: 'global', color: '#6366f1' },
      ...projects.map(p => ({ id: 'project:' + p.id, name: p.name, kind: 'project', color: p.color }))
    ];
    // last message per channel (for previews)
    const previews = {};
    for (const ch of channels) {
      const row = get(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT 1`, [ch.id]
      );
      if (row) previews[ch.id] = mapMessage(row);
    }
    return { channels, previews };
  });
}

function mapMessage(m) {
  return {
    id: m.id, channel: m.channel_id, text: m.text, replyTo: m.reply_to,
    createdAt: m.created_at,
    author: {
      id: m.author_id, name: m.author_name, avatarColor: m.author_color, role: m.author_role
    }
  };
}
